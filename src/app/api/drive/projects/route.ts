import { NextResponse } from 'next/server';
import path from 'path';
import { getDb } from '@/lib/db';
import { getDownloadedFilesByProject, getProjectLocalPath } from '@/lib/drive-engine';

interface ExplorerRow {
  projectId: string;
  name: string;
  dds: string;
  gate: string;
  filesDownloaded: number;
  hasGoals: boolean;
  impactCount: number;
  linkFolder: string;
  linkPositions: string;
  linkCIOO: string;
  localPath: string;
}

// One row per project (deduped across review batches), with download/goal/impact
// counts joined in. Used by the Drive Sync project explorer.
export async function GET() {
  try {
    const db = getDb();

    // One row per project_id, keeping the most recent insert (highest auto-increment id).
    // Using MAX(uploaded_at) here was unreliable because Excel uploads insert all
    // duplicates in a single transaction, so their uploaded_at is identical.
    const rows = db.prepare(`
      SELECT p.project_id, p.name, p.dds, p.gate,
             p.link_folder, p.link_positions, p.link_cioo
      FROM projects p
      WHERE p.id = (
        SELECT MAX(p2.id) FROM projects p2 WHERE p2.project_id = p.project_id
      )
      ORDER BY p.project_id ASC
    `).all() as Array<{
      project_id: string; name: string; dds: string; gate: string;
      link_folder: string | null; link_positions: string | null; link_cioo: string | null;
    }>;

    // Goals: which projects have a successful goals row.
    const goalRows = (() => {
      try {
        return db.prepare(
          "SELECT DISTINCT project_id FROM project_goals WHERE status = 'success'"
        ).all() as { project_id: string }[];
      } catch { return []; }
    })();
    const goalsSet = new Set(goalRows.map(r => r.project_id));

    // Impact count per project (counts edges where the project appears as source or target).
    const impactRows = db.prepare(`
      SELECT pid, COUNT(*) c FROM (
        SELECT source_project_id AS pid FROM projects_impact
        UNION ALL
        SELECT target_project_id AS pid FROM projects_impact
      )
      GROUP BY pid
    `).all() as { pid: string; c: number }[];
    const impactMap = new Map(impactRows.map(r => [r.pid, r.c]));

    const filesMap = getDownloadedFilesByProject();
    const cwd = process.cwd();

    const out: ExplorerRow[] = rows.map(r => {
      const absPath = getProjectLocalPath(r.project_id);
      // Show as repo-relative path when possible so the column stays compact.
      const localPath = absPath
        ? (absPath.startsWith(cwd) ? path.relative(cwd, absPath) : absPath)
        : '';
      return {
        projectId: r.project_id,
        name: r.name,
        dds: r.dds || '',
        gate: r.gate || '',
        filesDownloaded: filesMap.get(r.project_id) || 0,
        hasGoals: goalsSet.has(r.project_id),
        impactCount: impactMap.get(r.project_id) || 0,
        linkFolder: r.link_folder || '',
        linkPositions: r.link_positions || '',
        linkCIOO: r.link_cioo || '',
        localPath,
      };
    });

    return NextResponse.json({ rows: out, generatedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
