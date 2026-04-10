import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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
  let meta = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size,shortcutDetails',
    supportsAllDrives: true,
  });

  let name = meta.data.name || fileId;
  let mimeType = meta.data.mimeType || '';
  let actualId = fileId;

  // Resolve shortcut
  if (mimeType === 'application/vnd.google-apps.shortcut' && meta.data.shortcutDetails) {
    actualId = meta.data.shortcutDetails.targetId!;
    mimeType = meta.data.shortcutDetails.targetMimeType!;
    
    // Fetch actual target meta to get size
    try {
        meta = await drive.files.get({
            fileId: actualId,
            fields: 'id,name,mimeType,size',
            supportsAllDrives: true,
        });
        name = meta.data.name || name;
    } catch {
        // Fallback to shortcut name if target is inaccessible
    }
  }

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
      { fileId: actualId, mimeType: exp.mime },
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
      { fileId: actualId, alt: 'media', supportsAllDrives: true },
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
      { fileId: actualId, alt: 'media', supportsAllDrives: true },
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
  folderId: string,
  depth: number = 0,
  maxDepth: number = 5
): Promise<{ id: string; name: string; mimeType: string }[]> {
  const files: { id: string; name: string; mimeType: string }[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id, name, mimeType, size, shortcutDetails)',
        pageSize: 100,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const f of res.data.files || []) {
        let actualId = f.id!;
        let actualMime = f.mimeType!;
        const actualName = f.name!;

        // Resolve shortcuts
        if (f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails) {
          actualId = f.shortcutDetails.targetId!;
          actualMime = f.shortcutDetails.targetMimeType!;
        }

        if (actualMime === 'application/vnd.google-apps.folder') {
          // Recurse into subfolders up to maxDepth
          if (depth < maxDepth) {
            const subFiles = await listFolderFiles(drive, actualId, depth + 1, maxDepth);
            files.push(...subFiles);
          }
        } else {
          files.push({ id: actualId, name: actualName, mimeType: actualMime });
        }
      }

      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
  } catch (err) {
    console.warn(`Could not list folder ${folderId}`, err);
  }

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

    try {
    const meta = await drive.files.get({
      fileId: driveId,
      fields: 'id,mimeType,shortcutDetails',
      supportsAllDrives: true,
    });
    
    let actualId = driveId;
    let mimeType = meta.data.mimeType;

    if (mimeType === 'application/vnd.google-apps.shortcut' && meta.data.shortcutDetails) {
      actualId = meta.data.shortcutDetails.targetId!;
      mimeType = meta.data.shortcutDetails.targetMimeType!;
    }

    if (mimeType === 'application/vnd.google-apps.folder') {
      const files = await listFolderFiles(drive, actualId);
      for (const f of files.slice(0, 100)) { // Max 100 files per folder
        try {
          const result = await downloadFile(drive, f.id, localDir);
          if (result) results.push(result);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          downloadStatus.errors.push(`${projectId}/${f.name}: ${msg}`);
          downloadStatus.skippedFiles++;
        }
      }
    } else {
      try {
        const result = await downloadFile(drive, actualId, localDir);
        if (result) results.push(result);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        downloadStatus.errors.push(`${projectId}/${actualId}: ${msg}`);
        downloadStatus.skippedFiles++;
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    downloadStatus.errors.push(`${projectId}/${url}: ${msg}`);
    downloadStatus.skippedFiles++;
  }

  return { files: results };
}

// ─── Main: Download all project files ───────────────────────────────────────


// ─── Download a single project's files ──────────────────────────────────────

export async function runDriveDownloadSingle(projectId: string): Promise<void> {
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

    // Get specific project
    const row = db.prepare(`
      SELECT project_id, name, link_folder, link_positions, link_cioo
      FROM projects
      WHERE project_id = ?
    `).get(projectId) as { project_id: string; name: string; link_folder: string; link_positions: string; link_cioo: string } | undefined;

    if (!row) {
      throw new Error('Project not found');
    }

    const urls: string[] = [];
    const isLocal: boolean[] = [];
    const rawLinks = [row.link_folder, row.link_positions, row.link_cioo].join(' ').split(/\s+/);
    for (const link of rawLinks) {
      if (!link) continue;
      if (link.startsWith('https://drive.google.com')) {
        urls.push(link);
        isLocal.push(false);
      } else if (link.startsWith('/')) {
        urls.push(link);
        isLocal.push(true);
      }
    }

    if (urls.length === 0) {
      downloadStatus.currentProject = 'Complete (no links)';
      return;
    }

    downloadStatus.totalUrls = urls.length;
    
    // Prepare DB statements
    const upsertDoc = db.prepare(`
      INSERT OR REPLACE INTO documents_cache (url, content_text, content_type, fetch_status)
      VALUES (?, ?, ?, 'success')
    `);
    const upsertDocError = db.prepare(`
      INSERT OR REPLACE INTO documents_cache (url, fetch_status, error_message)
      VALUES (?, 'error', ?)
    `);

    downloadStatus.currentProject = `${row.project_id}: ${row.name.slice(0, 40)}`;

    for (let uIdx = 0; uIdx < urls.length; uIdx++) {
      const url = urls[uIdx];
      const isLoc = isLocal[uIdx];
      
      try {
        if (!isLoc) {
          const { files } = await processUrl(drive, url, row.project_id, row.name);

          for (const f of files) {
            downloadStatus.totalFiles++;
            if (f.localPath) {
              downloadStatus.downloadedFiles++;
            }
            upsertDoc.run(url, f.textContent, f.localPath ? 'downloaded' : 'metadata');
          }

          if (files.length === 0) {
            upsertDocError.run(url, 'No files found or not accessible');
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        downloadStatus.errors.push(`${row.project_id}: ${msg}`);
        upsertDocError.run(url, msg);
      }

      downloadStatus.processedUrls++;
    }

    downloadStatus.currentProject = 'Complete';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    downloadStatus.errors.push(`Fatal: ${msg}`);
  } finally {
    downloadStatus.isRunning = false;
  }
}

// ─── Discover project from GDrive Link ─────────────────────────────────────

export async function discoverAndAddProjectFromDrive(url: string): Promise<{ projectId: string; name: string } | null> {
  const drive = getDriveClient();
  const rootId = extractDriveId(url);
  
  if (!rootId) {
    throw new Error('Invalid Google Drive URL');
  }

  // Recursive search for a PRJ folder
  async function searchForProjectFolder(folderId: string, depth: number = 0): Promise<{ id: string; name: string; match: RegExpMatchArray } | null> {
    if (depth > 5) return null;
    
    try {
      // First get this folder's name to see if it's the one
      const folderMeta = await drive.files.get({
        fileId: folderId,
        fields: 'id,name',
        supportsAllDrives: true,
      });
      
      const name = folderMeta.data.name || '';
      const prjMatch = name.match(/PRJ[0-9]+/i);
      
      if (prjMatch) {
        return { id: folderId, name, match: prjMatch };
      }

      // If not, list subfolders and recurse
      const res = await drive.files.list({
        q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
        pageSize: 50,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const f of res.data.files || []) {
        if (!f.id) continue;
        const found = await searchForProjectFolder(f.id, depth + 1);
        if (found) return found;
      }
    } catch (err) {
      console.warn('Error searching folder', folderId, err);
    }
    
    return null;
  }

  const result = await searchForProjectFolder(rootId);
  
  if (!result) {
    throw new Error('Could not find any folder containing PRJXXXXX in its name');
  }

  const projectId = result.match[0].toUpperCase();
  const folderLink = `https://drive.google.com/drive/folders/${result.id}`;

  const db = getDb();
  
  // Upsert project manually without ON CONFLICT (no UNIQUE constraint)
  const existing = db.prepare('SELECT id, link_folder FROM projects WHERE project_id = ?').get(projectId) as { link_folder?: string } | undefined;
  if (existing) {
    const newLinkFolder = existing.link_folder ? existing.link_folder + ' ' + folderLink : folderLink;
    db.prepare('UPDATE projects SET link_folder = ? WHERE project_id = ?').run(newLinkFolder, projectId);
  } else {
    db.prepare('INSERT INTO projects (project_id, name, link_folder) VALUES (?, ?, ?)').run(projectId, result.name, folderLink);
  }

  return { projectId, name: result.name };
}

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
      WHERE p.link_folder LIKE '%drive.google.com%'
         OR p.link_positions LIKE '%drive.google.com%'
         OR p.link_cioo LIKE '%drive.google.com%'
         OR p.link_folder LIKE '/%'
         OR p.link_positions LIKE '/%'
         OR p.link_cioo LIKE '/%'
      GROUP BY p.project_id
    `).all() as { project_id: string; name: string; link_folder: string; link_positions: string; link_cioo: string }[];

    // Collect all unique URLs per project, skip already-cached URLs
    const projectUrls: { projectId: string; name: string; urls: string[]; isLocal: boolean[] }[] = [];
    let skippedCached = 0;
    for (const row of rows) {
      const urls: string[] = [];
      const isLocal: boolean[] = [];
      const rawLinks = [row.link_folder, row.link_positions, row.link_cioo].join(' ').split(/\s+/);
    for (const link of rawLinks) {
        if (!link) continue;
        if (link.startsWith('https://drive.google.com')) {
          if (isUrlCached(link)) {
            skippedCached++;
          } else {
            urls.push(link);
            isLocal.push(false);
          }
        } else if (link.startsWith('/')) { // Local path
          if (isUrlCached(link)) {
            skippedCached++;
          } else {
            urls.push(link);
            isLocal.push(true);
          }
        }
      }
      if (urls.length > 0) {
        projectUrls.push({ projectId: row.project_id, name: row.name, urls, isLocal });
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

      for (let uIdx = 0; uIdx < proj.urls.length; uIdx++) {
        const url = proj.urls[uIdx];
        const isLoc = proj.isLocal[uIdx];
        
        try {
          if (isLoc) {
            // Process local folder
            const localPath = decodeURI(url).replace(/^file:\/\//, '');
            if (fs.existsSync(localPath)) {
              let textContent = '';
              const stat = fs.statSync(localPath);
              if (stat.isDirectory()) {
                const files = fs.readdirSync(localPath);
                for (const f of files) {
                  const fp = path.join(localPath, f);
                  if (fs.statSync(fp).isFile() && f.endsWith('.docx') && !f.startsWith('~')) {
                    try {
                      const text = execSync(`unzip -p "${fp}" word/document.xml | sed -e 's/<[^>]*>/ /g'`, { encoding: 'utf-8' });
                      textContent += `\n\n--- ${f} ---\n${text.replace(/\s+/g, ' ')}`;
                    } catch {
                      console.warn(`Failed to read docx ${fp}`);
                    }
                  }
                }
              }
              downloadStatus.totalFiles++;
              downloadStatus.downloadedFiles++;
              upsertDoc.run(url, textContent.slice(0, 30000), 'local_folder');
            } else {
              upsertDocError.run(url, 'Local path does not exist');
            }
          } else {
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
          }
        } catch (err: unknown) {
          // URL-level error: log and continue to next URL
          const msg = err instanceof Error ? err.message : String(err);
          downloadStatus.errors.push(`${proj.projectId}: ${msg}`);
          upsertDocError.run(url, msg);
        }

        downloadStatus.processedUrls++;

        // Small delay to avoid rate limiting
        if (!isLoc) await new Promise(resolve => setTimeout(resolve, 200));
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
