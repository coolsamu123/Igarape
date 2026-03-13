import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { getDb } from './db';

// ─── Constants ──────────────────────────────────────────────────────────────

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'data', 'service-account.json');
const DRIVE_LOCAL_ROOT = path.join(process.cwd(), 'data', 'drive');

// Supported export MIME types for Google Workspace files
const EXPORT_MIMES: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'text/plain', ext: '.txt' },
  'application/vnd.google-apps.spreadsheet': { mime: 'text/csv', ext: '.csv' },
  'application/vnd.google-apps.presentation': { mime: 'text/plain', ext: '.txt' },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: '.png' },
};

// Files we can extract text from
const TEXT_MIMES = new Set([
  'text/plain', 'text/csv', 'text/html', 'text/xml',
  'application/json', 'application/xml',
]);

const BINARY_DOWNLOADABLE = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/msword',
]);

// ─── Module-level state ─────────────────────────────────────────────────────

interface DriveDownloadStatus {
  isRunning: boolean;
  totalUrls: number;
  processedUrls: number;
  totalFiles: number;
  downloadedFiles: number;
  skippedFiles: number;
  errors: string[];
  currentProject: string;
}

let downloadStatus: DriveDownloadStatus = {
  isRunning: false,
  totalUrls: 0,
  processedUrls: 0,
  totalFiles: 0,
  downloadedFiles: 0,
  skippedFiles: 0,
  errors: [],
  currentProject: '',
};

// ─── Auth ───────────────────────────────────────────────────────────────────

function getDriveClient() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    throw new Error('Service account key not found at data/service-account.json');
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  return google.drive({ version: 'v3', auth });
}

// ─── Extract file/folder ID from various URL formats ────────────────────────

export function extractDriveId(url: string): string | null {
  if (!url || !url.includes('drive.google.com')) return null;

  // https://drive.google.com/drive/folders/FOLDER_ID
  let match = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // https://drive.google.com/file/d/FILE_ID/...
  match = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // https://drive.google.com/open?id=ID
  match = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // https://docs.google.com/.../d/ID/...
  match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  return null;
}

function isFolder(url: string): boolean {
  return url.includes('/folders/');
}

// ─── Check if URL already cached successfully ───────────────────────────────

function isUrlCached(url: string): boolean {
  const db = getDb();
  const row = db.prepare(
    `SELECT fetch_status FROM documents_cache WHERE url = ? AND fetch_status = 'success'`
  ).get(url) as { fetch_status: string } | undefined;
  return !!row;
}

// ─── Download a single file ─────────────────────────────────────────────────

async function downloadFile(
  drive: ReturnType<typeof google.drive>,
  fileId: string,
  localDir: string
): Promise<{ name: string; localPath: string; textContent: string } | null> {
  // Get file metadata
  const meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size',
    supportsAllDrives: true,
  });

  const name = meta.data.name || fileId;
  const mimeType = meta.data.mimeType || '';
  const size = parseInt(meta.data.size || '0', 10);

  // Skip very large files (>50MB)
  if (size > 50 * 1024 * 1024) {
    return { name, localPath: '', textContent: `[File too large: ${name} (${(size / 1024 / 1024).toFixed(1)}MB)]` };
  }

  // Google Workspace files → export as text
  if (EXPORT_MIMES[mimeType]) {
    const exp = EXPORT_MIMES[mimeType];
    const safeName = sanitizeFilename(name) + exp.ext;
    const localPath = path.join(localDir, safeName);

    // Skip if already downloaded locally
    if (fs.existsSync(localPath)) {
      const text = exp.ext !== '.png' ? fs.readFileSync(localPath, 'utf-8') : `[Image: ${name}]`;
      return { name, localPath, textContent: text.slice(0, 30000) };
    }

    const res = await drive.files.export(
      { fileId, mimeType: exp.mime },
      { responseType: 'text' }
    );

    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    fs.writeFileSync(localPath, text, 'utf-8');
    return { name, localPath, textContent: text.slice(0, 30000) };
  }

  // Text files → download as text
  if (TEXT_MIMES.has(mimeType)) {
    const safeName = sanitizeFilename(name);
    const localPath = path.join(localDir, safeName);

    if (fs.existsSync(localPath)) {
      const text = fs.readFileSync(localPath, 'utf-8');
      return { name, localPath, textContent: text.slice(0, 30000) };
    }

    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'text' }
    );

    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    fs.writeFileSync(localPath, text, 'utf-8');
    return { name, localPath, textContent: text.slice(0, 30000) };
  }

  // Binary files (PDF, DOCX, etc.) → download binary
  if (BINARY_DOWNLOADABLE.has(mimeType)) {
    const safeName = sanitizeFilename(name);
    const localPath = path.join(localDir, safeName);

    if (fs.existsSync(localPath)) {
      return { name, localPath, textContent: `[Binary file: ${name} (${mimeType}, ${(size / 1024).toFixed(0)}KB) — saved locally at ${localPath}]` };
    }

    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );

    fs.writeFileSync(localPath, Buffer.from(res.data as ArrayBuffer));
    return { name, localPath, textContent: `[Binary file: ${name} (${mimeType}, ${(size / 1024).toFixed(0)}KB) — saved locally at ${localPath}]` };
  }

  // Unknown type
  return { name, localPath: '', textContent: `[Unsupported file type: ${name} (${mimeType})]` };
}

// ─── List files in a folder ─────────────────────────────────────────────────

async function listFolderFiles(
  drive: ReturnType<typeof google.drive>,
  folderId: string
): Promise<{ id: string; name: string; mimeType: string }[]> {
  const files: { id: string; name: string; mimeType: string }[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size)',
      pageSize: 100,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const f of res.data.files || []) {
      // Skip sub-folders (only go 1 level deep)
      if (f.mimeType === 'application/vnd.google-apps.folder') continue;
      files.push({ id: f.id!, name: f.name!, mimeType: f.mimeType! });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

// ─── Process a single URL (folder or file) ──────────────────────────────────

async function processUrl(
  drive: ReturnType<typeof google.drive>,
  url: string,
  projectId: string,
  projectName: string
): Promise<{ files: { name: string; localPath: string; textContent: string }[] }> {
  const driveId = extractDriveId(url);
  if (!driveId) return { files: [] };

  // Create local directory: data/drive/{projectId}/
  const safeProjName = sanitizeFilename(`${projectId}_${projectName}`.slice(0, 60));
  const localDir = path.join(DRIVE_LOCAL_ROOT, safeProjName);
  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }

  const results: { name: string; localPath: string; textContent: string }[] = [];

  if (isFolder(url)) {
    // It's a folder — list and download files
    const files = await listFolderFiles(drive, driveId);
    for (const f of files.slice(0, 20)) { // Max 20 files per folder
      try {
        const result = await downloadFile(drive, f.id, localDir);
        if (result) results.push(result);
      } catch (err: unknown) {
        // File-level error: log and continue
        const msg = err instanceof Error ? err.message : String(err);
        downloadStatus.errors.push(`${projectId}/${f.name}: ${msg}`);
        downloadStatus.skippedFiles++;
      }
    }
  } else {
    // It's a single file (open?id= or /file/d/)
    try {
      const result = await downloadFile(drive, driveId, localDir);
      if (result) results.push(result);
    } catch (err: unknown) {
      // File-level error: log and continue
      const msg = err instanceof Error ? err.message : String(err);
      downloadStatus.errors.push(`${projectId}/${driveId}: ${msg}`);
      downloadStatus.skippedFiles++;
    }
  }

  return { files: results };
}

// ─── Main: Download all project files ───────────────────────────────────────

export async function runDriveDownload(): Promise<void> {
  if (downloadStatus.isRunning) {
    throw new Error('Drive download is already running');
  }

  downloadStatus = {
    isRunning: true,
    totalUrls: 0,
    processedUrls: 0,
    totalFiles: 0,
    downloadedFiles: 0,
    skippedFiles: 0,
    errors: [],
    currentProject: 'Initializing...',
  };

  try {
    const drive = getDriveClient();
    const db = getDb();

    // Get all unique project URLs
    const rows = db.prepare(`
      SELECT DISTINCT p.project_id, p.name,
        p.link_folder, p.link_positions, p.link_cioo
      FROM projects p
      WHERE p.link_folder LIKE 'https://drive.google.com%'
         OR p.link_positions LIKE 'https://drive.google.com%'
         OR p.link_cioo LIKE 'https://drive.google.com%'
      GROUP BY p.project_id
    `).all() as { project_id: string; name: string; link_folder: string; link_positions: string; link_cioo: string }[];

    // Collect all unique URLs per project, skip already-cached URLs
    const projectUrls: { projectId: string; name: string; urls: string[] }[] = [];
    let skippedCached = 0;
    for (const row of rows) {
      const urls: string[] = [];
      for (const link of [row.link_folder, row.link_positions, row.link_cioo]) {
        if (link?.startsWith('https://drive.google.com')) {
          if (isUrlCached(link)) {
            skippedCached++;
          } else {
            urls.push(link);
          }
        }
      }
      if (urls.length > 0) {
        projectUrls.push({ projectId: row.project_id, name: row.name, urls });
      }
    }

    downloadStatus.totalUrls = projectUrls.reduce((sum, p) => sum + p.urls.length, 0);
    downloadStatus.skippedFiles = skippedCached;

    if (downloadStatus.totalUrls === 0) {
      downloadStatus.currentProject = 'Complete (all files already cached)';
      return;
    }

    // Ensure drive root exists
    if (!fs.existsSync(DRIVE_LOCAL_ROOT)) {
      fs.mkdirSync(DRIVE_LOCAL_ROOT, { recursive: true });
    }

    // Prepare DB statement for caching
    const upsertDoc = db.prepare(`
      INSERT OR REPLACE INTO documents_cache (url, content_text, content_type, fetch_status)
      VALUES (?, ?, ?, 'success')
    `);
    const upsertDocError = db.prepare(`
      INSERT OR REPLACE INTO documents_cache (url, fetch_status, error_message)
      VALUES (?, 'error', ?)
    `);

    for (const proj of projectUrls) {
      downloadStatus.currentProject = `${proj.projectId}: ${proj.name.slice(0, 40)}`;

      for (const url of proj.urls) {
        try {
          const { files } = await processUrl(drive, url, proj.projectId, proj.name);

          for (const f of files) {
            downloadStatus.totalFiles++;
            if (f.localPath) {
              downloadStatus.downloadedFiles++;
            }

            // Cache text content in DB
            upsertDoc.run(url, f.textContent, f.localPath ? 'downloaded' : 'metadata');
          }

          if (files.length === 0) {
            upsertDocError.run(url, 'No files found or not accessible');
          }
        } catch (err: unknown) {
          // URL-level error: log and continue to next URL
          const msg = err instanceof Error ? err.message : String(err);
          downloadStatus.errors.push(`${proj.projectId}: ${msg}`);
          upsertDocError.run(url, msg);
        }

        downloadStatus.processedUrls++;

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    downloadStatus.currentProject = 'Complete';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    downloadStatus.errors.push(`Fatal: ${msg}`);
  } finally {
    downloadStatus.isRunning = false;
  }
}

// ─── Get download status ────────────────────────────────────────────────────

export function getDriveStatus(): DriveDownloadStatus {
  // If not running, compute real counts from DB
  if (!downloadStatus.isRunning) {
    try {
      const db = getDb();
      const successCount = db.prepare(
        `SELECT COUNT(*) as cnt FROM documents_cache WHERE fetch_status = 'success'`
      ).get() as { cnt: number };
      const errorCount = db.prepare(
        `SELECT COUNT(*) as cnt FROM documents_cache WHERE fetch_status = 'error'`
      ).get() as { cnt: number };
      downloadStatus.downloadedFiles = successCount.cnt;
      downloadStatus.totalFiles = successCount.cnt + errorCount.cnt;
    } catch {
      // ignore
    }
  }
  return { ...downloadStatus };
}

// ─── Get cached text content for a project's URLs ───────────────────────────

export function getProjectDocuments(projectId: string): { url: string; content: string; status: string }[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT dc.url, dc.content_text, dc.fetch_status
    FROM documents_cache dc
    INNER JOIN projects p ON (
      p.link_folder = dc.url OR p.link_positions = dc.url OR p.link_cioo = dc.url
    )
    WHERE p.project_id = ?
    GROUP BY dc.url
  `).all(projectId) as { url: string; content_text: string; fetch_status: string }[];

  return rows.map(r => ({
    url: r.url,
    content: r.content_text || '',
    status: r.fetch_status,
  }));
}

// ─── Get local file path for a project ──────────────────────────────────────

export function getProjectLocalPath(projectId: string): string | null {
  if (!fs.existsSync(DRIVE_LOCAL_ROOT)) return null;

  const dirs = fs.readdirSync(DRIVE_LOCAL_ROOT);
  const match = dirs.find(d => d.startsWith(projectId));
  if (!match) return null;

  return path.join(DRIVE_LOCAL_ROOT, match);
}

// ─── Get all downloaded content for Gemini ──────────────────────────────────

export function getAllDocumentTexts(): Map<string, string> {
  const db = getDb();
  const rows = db.prepare(`
    SELECT url, content_text FROM documents_cache
    WHERE fetch_status = 'success' AND content_text != ''
  `).all() as { url: string; content_text: string }[];

  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(r.url, r.content_text);
  }
  return map;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}
