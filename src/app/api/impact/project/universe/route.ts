import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getProjectImpacts, aggregateImpacts } from '@/lib/impact-engine';
import type { ProjectImpact } from '@/lib/types';

interface ProjectMeta {
  projectId: string;
  name: string;
  dds: string;
  currentGate: string;
  costKEur: number | null;
  description: string;
}

interface PseudoNodeImpact {
  // Raw aggregated impact this node was extracted from
  impactId: number;
  severity: string;
  direction: string;
  impactTypes: string[];
  explanations: string[];
  // The "primary" explanation (longest at highest severity)
  explanation: string;
}

interface PseudoNode {
  // Display name (e.g., 'Cloud Services' or 'Americas')
  name: string;
  // Aggregated severity for the node (max across all impacts touching it)
  severity: string;
  // All impacts that mention this node (one project may have multiple raw rows)
  impacts: PseudoNodeImpact[];
}

interface ProjectEdge {
  otherProjectId: string;
  otherProjectName: string;
  otherProjectDds: string;
  severity: string;
  direction: string;
  impactTypes: string[];
  explanations: string[];
  explanation: string;
  count: number;
  bidirectional: boolean;
}

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

function pickMaxSeverity(items: { severity: string }[]): string {
  let best = 'low';
  let rank = 0;
  for (const it of items) {
    const r = SEVERITY_RANK[it.severity] ?? 0;
    if (r > rank) { rank = r; best = it.severity; }
  }
  return best;
}

function fanOutPseudo(
  impacts: ProjectImpact[],
  pseudoTarget: 'GIO_SERVICES' | 'DDS_IMPACTS',
  pickList: (imp: ProjectImpact) => string[]
): PseudoNode[] {
  const byName = new Map<string, PseudoNodeImpact[]>();

  for (const imp of impacts) {
    if (imp.sourceProjectId !== pseudoTarget && imp.targetProjectId !== pseudoTarget) continue;
    const names = pickList(imp);
    for (const name of names) {
      const arr = byName.get(name) ?? [];
      arr.push({
        impactId: imp.id,
        severity: imp.severity,
        direction: imp.direction,
        impactTypes: imp.impactTypes ?? [imp.impactType],
        explanations: imp.explanations ?? [imp.explanation],
        explanation: imp.explanation,
      });
      byName.set(name, arr);
    }
  }

  return Array.from(byName.entries()).map(([name, impacts]) => ({
    name,
    severity: pickMaxSeverity(impacts),
    impacts,
  })).sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));
}

function lookupProjectMeta(projectIds: string[]): Map<string, ProjectMeta> {
  if (projectIds.length === 0) return new Map();
  const db = getDb();
  const placeholders = projectIds.map(() => '?').join(',');
  // Use latest review per project for the meta
  const rows = db.prepare(`
    SELECT project_id, name, dds, gate, cost_keur, description
    FROM projects
    WHERE project_id IN (${placeholders})
    ORDER BY review_date DESC
  `).all(...projectIds) as Array<{
    project_id: string;
    name: string;
    dds: string;
    gate: string;
    cost_keur: number | null;
    description: string;
  }>;

  const out = new Map<string, ProjectMeta>();
  for (const r of rows) {
    if (out.has(r.project_id)) continue; // first wins (latest review)
    out.set(r.project_id, {
      projectId: r.project_id,
      name: r.name,
      dds: r.dds || '',
      currentGate: r.gate || '',
      costKEur: r.cost_keur,
      description: r.description || '',
    });
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'Missing required query parameter: projectId' }, { status: 400 });
    }

    // 1) Fetch all raw impacts for this project, then aggregate (merges duplicate
    //    pairs and unions gioServices/ddsEntities/explanations).
    const raw = getProjectImpacts(projectId);
    const aggregated = aggregateImpacts(raw);

    // 2) Center project meta
    const centerMetaMap = lookupProjectMeta([projectId]);
    const center = centerMetaMap.get(projectId) ?? {
      projectId,
      name: projectId,
      dds: '',
      currentGate: '',
      costKEur: null,
      description: '',
    };

    // 3) Fan out GIO services into nodes
    const gioNodes = fanOutPseudo(aggregated, 'GIO_SERVICES', imp => imp.gioServices ?? []);

    // 4) Fan out DDS entities into nodes
    const ddsNodes = fanOutPseudo(aggregated, 'DDS_IMPACTS', imp => imp.ddsEntities ?? []);

    // 5) Project-to-project edges (exclude pseudo-targets)
    const projectEdgeRaw = aggregated.filter(imp =>
      imp.sourceProjectId !== 'GIO_SERVICES' && imp.targetProjectId !== 'GIO_SERVICES' &&
      imp.sourceProjectId !== 'DDS_IMPACTS'  && imp.targetProjectId !== 'DDS_IMPACTS'
    );

    const otherIds = Array.from(new Set(
      projectEdgeRaw.flatMap(imp => [imp.sourceProjectId, imp.targetProjectId])
        .filter(id => id !== projectId)
    ));
    const otherMeta = lookupProjectMeta(otherIds);

    const projectEdges: ProjectEdge[] = projectEdgeRaw.map(imp => {
      const otherId = imp.sourceProjectId === projectId ? imp.targetProjectId : imp.sourceProjectId;
      const meta = otherMeta.get(otherId);
      return {
        otherProjectId: otherId,
        otherProjectName: meta?.name || otherId,
        otherProjectDds: meta?.dds || '',
        severity: imp.severity,
        direction: imp.direction,
        impactTypes: imp.impactTypes ?? [imp.impactType],
        explanations: imp.explanations ?? [imp.explanation],
        explanation: imp.explanation,
        count: imp.count ?? 1,
        bidirectional: imp.bidirectional ?? false,
      };
    }).sort((a, b) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0));

    return NextResponse.json({
      project: center,
      gioNodes,
      ddsNodes,
      projectEdges,
      stats: {
        gioCount: gioNodes.length,
        ddsCount: ddsNodes.length,
        projectCount: projectEdges.length,
        totalImpacts: aggregated.length,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
