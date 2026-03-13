import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { extractTags } from '@/lib/similarity';
import type { CIOOProject, ProjectSummary } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'summary';

    if (mode === 'raw') {
      // Return all raw rows
      const rows = db.prepare('SELECT * FROM projects ORDER BY review_date DESC').all() as DbRow[];
      return NextResponse.json({ projects: rows.map(mapRowToProject) });
    }

    // Default: return deduplicated project summaries
    const rows = db.prepare(`
      SELECT * FROM projects
      WHERE project_id != ''
      ORDER BY project_id, review_date DESC
    `).all() as DbRow[];

    const grouped = new Map<string, DbRow[]>();
    for (const row of rows) {
      const key = row.project_id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    const summaries: ProjectSummary[] = [];
    for (const [projectId, entries] of Array.from(grouped.entries())) {
      const latest = entries[0]; // Already sorted DESC
      const allDescriptions = entries.map(e => e.description).filter(Boolean);
      const allRemarks = entries.map(e => e.remarks).filter(Boolean);

      const bestDescription = allDescriptions[0] || '';
      const bestRemarks = allRemarks[0] || '';

      const summary: ProjectSummary = {
        projectId,
        name: latest.name,
        dds: latest.dds,
        currentGate: latest.gate,
        latestDecision: latest.decision,
        costKEur: latest.cost_keur,
        description: bestDescription,
        remarks: bestRemarks,
        reviewCount: entries.length,
        lastReviewDate: latest.review_date,
        linkPositions: entries.find(e => e.link_positions)?.link_positions || '',
        linkFolder: entries.find(e => e.link_folder)?.link_folder || '',
        linkCIOO: entries.find(e => e.link_cioo)?.link_cioo || '',
        tags: extractTags({ name: latest.name, description: bestDescription, remarks: bestRemarks }),
        history: entries.map(mapRowToProject),
      };

      summaries.push(summary);
    }

    // Stats
    const stats = {
      totalProjects: summaries.length,
      totalRows: rows.length,
      byDDS: countBy(summaries, s => s.dds),
      byGate: countBy(summaries, s => s.currentGate),
      byDecision: countBy(summaries, s => s.latestDecision),
      totalCost: summaries.reduce((sum, s) => sum + (s.costKEur || 0), 0),
    };

    return NextResponse.json({ projects: summaries, stats });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface DbRow {
  id: number;
  project_id: string;
  name: string;
  dds: string;
  gate: string;
  cost_keur: number | null;
  description: string;
  remarks: string;
  qa: string;
  review_date: string;
  decision: string;
  decision_mode: string;
  decision_date: string;
  review_status: string;
  documents_status: string;
  restricted: string;
  cost_before_g2: number | null;
  est_gate2_date: string;
  session_start: string;
  session_end: string;
  participants: string;
  link_positions: string;
  link_folder: string;
  link_cioo: string;
  year: number | null;
  month: number | null;
  batch_id: string;
}

function mapRowToProject(row: DbRow): CIOOProject {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    dds: row.dds,
    gate: row.gate,
    costKEur: row.cost_keur,
    description: row.description,
    remarks: row.remarks,
    qa: row.qa,
    reviewDate: row.review_date,
    decision: row.decision,
    decisionMode: row.decision_mode,
    decisionDate: row.decision_date,
    reviewStatus: row.review_status,
    documentsStatus: row.documents_status,
    restricted: row.restricted,
    costBeforeG2: row.cost_before_g2,
    estGate2Date: row.est_gate2_date,
    sessionStart: row.session_start,
    sessionEnd: row.session_end,
    participants: row.participants,
    linkPositions: row.link_positions,
    linkFolder: row.link_folder,
    linkCIOO: row.link_cioo,
    year: row.year,
    month: row.month,
    batchId: row.batch_id,
  };
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item) || '(empty)';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
