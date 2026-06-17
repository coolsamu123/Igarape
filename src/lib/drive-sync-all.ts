// Per-project Drive sync engine. Drives the "Sync all" button in the Project
// Explorer: enumerates every project that has at least one Drive folder URL,
// counts its files (recursively) for an accurate progress denominator, then
// downloads them — with a worker pool of 3 projects and 10 files per project.
//
// State lives in module scope and is read by buildDrivePanelState() so the SSE
// stream picks it up on its next tick. There is no separate event channel.

import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { getDb } from './db';
import {
  DRIVE_LOCAL_ROOT,
  discoverAndAddProjectFromDrive,
  downloadFile,
  extractDriveId,
  getDriveClient,
  getDriveStatus,
  listFolderFiles,
} from './drive-engine';
import { isAutoCycleRunning } from './auto-pipeline';

const PROJECT_CONCURRENCY = 3;
const FILE_CONCURRENCY    = 10;

export type ProjectSyncStatus =
  | 'pending'      // queued, not started
  | 'counting'     // enumerating files in Drive
  | 'downloading'  // pulling files
  | 'done'         // finished successfully (errorCount may be > 0 but files made it)
  | 'error'        // failed before any file could be processed
  | 'skipped';     // user pressed Stop before this project ran

export interface PerProjectSyncState {
  projectId: string;
  name: string;
  status: ProjectSyncStatus;
  totalFiles: number;
  doneFiles: number;
  errorCount: number;
  errorMessage: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface SyncAllState {
  status: 'idle' | 'running' | 'stopping' | 'done';
  startedAt: string | null;
  finishedAt: string | null;
  totalProjects: number;
  doneProjects: number;
  totalFiles: number;
  doneFiles: number;
  stopRequested: boolean;
  // Only includes entries with status !== 'pending' to keep SSE payload small.
  perProject: Record<string, PerProjectSyncState>;
}

// ─── Module-scoped state ────────────────────────────────────────────────────
// Stored on globalThis under a Symbol so that Next.js dev-mode route compilation
// (which can produce multiple instances of the same module) shares a single
// source of truth. Without this, the /api/drive/sync-all endpoint and the
// /api/drive/stream endpoint end up reading separate `state` objects.

interface InternalState {
  status: SyncAllState['status'];
  startedAt: string | null;
  finishedAt: string | null;
  totalProjects: number;
  stopRequested: boolean;
  perProject: Map<string, PerProjectSyncState>;
}

const GLOBAL_KEY = '__stromSyncAllStateRef' as const;
type GlobalRef = { current: InternalState };
const g = globalThis as unknown as Record<string, GlobalRef | undefined>;

if (!g[GLOBAL_KEY]) {
  g[GLOBAL_KEY] = {
    current: {
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      totalProjects: 0,
      stopRequested: false,
      perProject: new Map(),
    },
  };
}
const stateRef: GlobalRef = g[GLOBAL_KEY]!;

export function isSyncAllRunning(): boolean {
  return stateRef.current.status === 'running' || stateRef.current.status === 'stopping';
}

export function getSyncAllState(): SyncAllState {
  autoHealIfStuck();
  // Compute roll-up counters fresh each time so a single source of truth lives
  // in perProject. Only project rows that have advanced past 'pending' are
  // emitted — the client treats everything else as default.
  let doneProjects = 0;
  let totalFiles = 0;
  let doneFiles = 0;
  const outPerProject: Record<string, PerProjectSyncState> = {};

  for (const p of stateRef.current.perProject.values()) {
    if (p.status !== 'pending') outPerProject[p.projectId] = p;
    if (p.status === 'done' || p.status === 'error' || p.status === 'skipped') doneProjects++;
    totalFiles += p.totalFiles;
    doneFiles  += p.doneFiles;
  }

  return {
    status: stateRef.current.status,
    startedAt: stateRef.current.startedAt,
    finishedAt: stateRef.current.finishedAt,
    totalProjects: stateRef.current.totalProjects,
    doneProjects,
    totalFiles,
    doneFiles,
    stopRequested: stateRef.current.stopRequested,
    perProject: outPerProject,
  };
}

export function requestStopSyncAll(): { stopped: boolean } {
  if (stateRef.current.status !== 'running') return { stopped: false };
  stateRef.current.stopRequested = true;
  stateRef.current.status = 'stopping';
  return { stopped: true };
}

// Hard reset — used to unstick the engine when a previous run crashed or got
// into a dirty state after a hot-reload. Safe even if a real run is in-flight:
// any orphan workers will keep mutating the *old* state object via closure,
// which is now unreferenced.
export function resetSyncAllState(): void {
  stateRef.current = {
    status: 'idle',
    startedAt: null,
    finishedAt: null,
    totalProjects: 0,
    stopRequested: false,
    perProject: new Map(),
  };
}

// Auto-heal: if status claims "running" but no project has advanced past
// 'pending' for over STALE_THRESHOLD_MS since startedAt, treat it as stuck
// and force-reset. Called from getSyncAllState() so the SSE picks it up.
const STALE_THRESHOLD_MS = 60_000;
function autoHealIfStuck(): void {
  if (stateRef.current.status !== 'running' && stateRef.current.status !== 'stopping') return;
  if (!stateRef.current.startedAt) return;
  const ageMs = Date.now() - new Date(stateRef.current.startedAt).getTime();
  if (ageMs < STALE_THRESHOLD_MS) return;
  // Any sign of activity?
  let anyActive = false;
  for (const p of stateRef.current.perProject.values()) {
    if (p.status !== 'pending') { anyActive = true; break; }
  }
  if (!anyActive) {
    console.warn('[sync-all] stale state detected, resetting');
    resetSyncAllState();
  }
}

// ─── Main runner ────────────────────────────────────────────────────────────

export async function runSyncAll(): Promise<void> {
  if (stateRef.current.status === 'running' || stateRef.current.status === 'stopping') {
    throw new Error('Sync all is already running');
  }
  // Avoid clobbering the auto-pipeline cycle, which uses the global
  // drive-engine downloadStatus and writes to the same project dirs.
  if (isAutoCycleRunning() || getDriveStatus().isRunning) {
    throw new Error('Another Drive operation is in progress (scheduled cycle). Try again in a moment.');
  }

  // Discovery pass: if app_settings.discovery_root is set, scan that Drive
  // folder and attach link_folder to every existing project whose ID matches a
  // subfolder name. Runs in link-only mode so we don't spawn stub project rows
  // for unrelated folders. Failures are logged but never block the actual sync.
  const db = getDb();
  try {
    const root = db.prepare("SELECT value FROM app_settings WHERE key = 'discovery_root'").get() as { value: string } | undefined;
    if (root?.value) {
      console.log('[sync-all] running discovery against', root.value);
      const result = await discoverAndAddProjectFromDrive(root.value, { createMissing: false });
      console.log(`[sync-all] discovery: scanned=${result.scannedFolders} linked=${result.linked.length} unmatched=${result.unmatched.length}`);
    }
  } catch (err) {
    console.warn('[sync-all] discovery pass failed (continuing with current links):', err instanceof Error ? err.message : err);
  }

  // Read fresh from DB: every project (deduped by latest id) that has at least
  // one drive.google.com URL in its link columns. Sequential dedupe matches
  // /api/drive/projects so what the user sees in the table is exactly what we
  // sync.
  const rows = db.prepare(`
    SELECT p.project_id, p.name, p.link_folder, p.link_positions, p.link_cioo
    FROM projects p
    WHERE p.id = (SELECT MAX(p2.id) FROM projects p2 WHERE p2.project_id = p.project_id)
      AND (
        p.link_folder    LIKE '%drive.google.com%'
        OR p.link_positions LIKE '%drive.google.com%'
        OR p.link_cioo   LIKE '%drive.google.com%'
      )
    ORDER BY p.project_id ASC
  `).all() as Array<{
    project_id: string; name: string;
    link_folder: string | null; link_positions: string | null; link_cioo: string | null;
  }>;

  // Build per-project work items.
  const projects = rows.map(r => {
    const urls = collectDriveUrls([r.link_folder, r.link_positions, r.link_cioo]);
    return { projectId: r.project_id, name: r.name || r.project_id, urls };
  }).filter(p => p.urls.length > 0);

  // Reset stateRef.current.
  stateRef.current = {
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalProjects: projects.length,
    stopRequested: false,
    perProject: new Map(projects.map(p => [p.projectId, {
      projectId: p.projectId,
      name: p.name,
      status: 'pending' as ProjectSyncStatus,
      totalFiles: 0,
      doneFiles: 0,
      errorCount: 0,
      errorMessage: '',
      startedAt: null,
      finishedAt: null,
    }])),
  };

  // Critical: wrap the actual work in try/finally so that *any* throw —
  // including synchronous errors from getDriveClient (missing service
  // account, etc.) — releases the 'running' lock. Without this, the state
  // gets stuck and Sync-all responds 409 forever.
  try {
    if (projects.length === 0) {
      return;
    }

    // Ensure the local root exists once, before any worker writes to it.
    if (!fs.existsSync(DRIVE_LOCAL_ROOT)) {
      fs.mkdirSync(DRIVE_LOCAL_ROOT, { recursive: true });
    }

    const drive = getDriveClient();
    const queue = [...projects];

    async function worker() {
      while (true) {
        if (stateRef.current.stopRequested) return;
        const proj = queue.shift();
        if (!proj) return;
        try {
          await processProject(drive, proj);
        } catch (err: unknown) {
          // processProject should already mark the perProject row; this is a
          // safety net for unexpected throws.
          const entry = stateRef.current.perProject.get(proj.projectId);
          if (entry) {
            entry.status = 'error';
            entry.errorMessage = err instanceof Error ? err.message : String(err);
            entry.finishedAt = new Date().toISOString();
          }
        }
      }
    }

    const workers = Array.from({ length: PROJECT_CONCURRENCY }, () => worker());
    await Promise.all(workers);
  } finally {
    // Anything still pending after we exit (stop pressed OR fatal error) becomes 'skipped'.
    for (const p of stateRef.current.perProject.values()) {
      if (p.status === 'pending') {
        p.status = 'skipped';
        p.finishedAt = new Date().toISOString();
      }
    }
    stateRef.current.status = 'done';
    stateRef.current.finishedAt = new Date().toISOString();
  }
}

// ─── Per-project pipeline ───────────────────────────────────────────────────

async function processProject(
  drive: ReturnType<typeof getDriveClient>,
  proj: { projectId: string; name: string; urls: string[] },
): Promise<void> {
  const entry = stateRef.current.perProject.get(proj.projectId)!;
  entry.status = 'counting';
  entry.startedAt = new Date().toISOString();

  // Phase 1: enumerate files across every Drive URL the project has.
  const allFiles: { id: string; name: string }[] = [];
  for (const url of proj.urls) {
    if (stateRef.current.stopRequested) break;
    const driveId = extractDriveId(url);
    if (!driveId) continue;
    try {
      // We can't know a priori whether the URL points at a folder or a file
      // without a metadata call. For simplicity (and to match the existing
      // discover/download code paths), assume folder first; if that fails or
      // returns nothing, fall back to treating it as a single file.
      const files = await listFolderFiles(drive, driveId);
      if (files.length > 0) {
        for (const f of files) allFiles.push({ id: f.id, name: f.name });
      } else {
        // Could be a single file URL — try one metadata fetch.
        const meta = await drive.files.get({
          fileId: driveId,
          fields: 'id,name,mimeType',
          supportsAllDrives: true,
        }).catch(() => null);
        if (meta?.data?.id && meta.data.mimeType !== 'application/vnd.google-apps.folder') {
          allFiles.push({ id: meta.data.id, name: meta.data.name || meta.data.id });
        }
      }
    } catch (err: unknown) {
      entry.errorCount++;
      entry.errorMessage = err instanceof Error ? err.message : String(err);
    }
  }

  // Deduplicate by file id — folders inside the same Drive root can share
  // shortcut targets, and we don't want to double-count.
  const seen = new Set<string>();
  const uniqueFiles = allFiles.filter(f => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  entry.totalFiles = uniqueFiles.length;

  if (stateRef.current.stopRequested) {
    entry.status = 'skipped';
    entry.finishedAt = new Date().toISOString();
    return;
  }

  if (uniqueFiles.length === 0) {
    entry.status = 'done';
    entry.finishedAt = new Date().toISOString();
    return;
  }

  // Phase 2: download files into the project's local dir.
  entry.status = 'downloading';
  const localDir = path.join(DRIVE_LOCAL_ROOT, proj.projectId);
  if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });

  const fileLimit = pLimit(FILE_CONCURRENCY);
  const tasks = uniqueFiles.map(f => fileLimit(async () => {
    if (stateRef.current.stopRequested) return;
    try {
      const result = await downloadFile(drive, f.id, localDir);
      if (result?.localPath) {
        entry.doneFiles++;
      } else {
        // Metadata-only (no localPath) still counts toward progress so the
        // bar finishes — but it's not really a download. Treat as "done"
        // for that file.
        entry.doneFiles++;
      }
    } catch (err: unknown) {
      entry.errorCount++;
      entry.errorMessage = err instanceof Error ? err.message : String(err);
      // Still advance doneFiles so the bar reaches 100% even with errors.
      entry.doneFiles++;
    }
  }));
  await Promise.all(tasks);

  entry.status = stateRef.current.stopRequested ? 'skipped' : 'done';
  entry.finishedAt = new Date().toISOString();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function collectDriveUrls(linkFields: (string | null)[]): string[] {
  const out = new Set<string>();
  for (const field of linkFields) {
    if (!field) continue;
    for (const token of field.split(/\s+/)) {
      if (token.startsWith('https://drive.google.com')) out.add(token);
    }
  }
  return [...out];
}
