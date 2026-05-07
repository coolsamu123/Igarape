import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getDownloadedFilesByProject } from '@/lib/drive-engine';

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
}

// One row per project (deduped across review batches), with download/goal/impact
// counts joined in. Used by the Drive Sync project explorer.
export async function GET() {
  try {
    const db = getDb();

    // Latest row per project_id, ordered by uploaded_at descending so we keep
    // the most recent links/metadata.
    const rows = db.prepare(`
      SELECT p.project_id, p.name, p.dds, p.gate,
             p.link_folder, p.link_positions, p.link_cioo
      FROM projects p
      INNER JOIN (
        SELECT project_id, MAX(uploaded_at) AS mx
        FROM projects GROUP BY project_id
      ) latest ON latest.project_id = p.project_id AND latest.mx = p.uploaded_at
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

    const out: ExplorerRow[] = rows.map(r => ({
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
    }));

    return NextResponse.json({ rows: out, generatedAt: new Date().toISOString() });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
