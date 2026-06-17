import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import { extractTags } from './similarity';
import { getProjectDocuments, getFileNamesForUrls } from './drive-engine';
import { getPrompts } from './prompts';
import { generateContent } from './llm';
import { normalizeDdsList } from './dds-catalog';
import type { CIOOProject, CIOOService, ProjectImpact, ProjectSummary, ImpactAnalysisStatus } from './types';

// ─── Module-level state for tracking analysis progress ───────────────────────

export const IMPACT_ANALYSIS_QUERY = `
  SELECT
    g.id as goal_id, g.project_id, g.project_name, g.region, g.gate as goal_gate,
    g.month_folder, g.summary_one_line,
    g.digital_technologies, g.change_management, g.security_impacts,
    g.regional_impacts, g.ia_embedded, g.gio_sl_dds_impacts, g.dds_gio_workload,
    g.business_apps_cis,
    g.dds_entities_touched, g.gio_services_touched,
    g.tech_tags, g.vendors, g.data_classifications, g.mentioned_projects,
    g.project_relations, g.out_of_scope,
    g.impact_claims, g.timeline_struct,
    g.raw_gemini_response, g.source_files, g.analyzed_at,
    g.status as goal_status, g.error_message,
    p.name as proj_name, p.dds, p.gate as proj_gate, p.decision, p.cost_keur, p.description, p.remarks,
    p.review_date, p.link_positions, p.link_folder, p.link_cioo,
    p.services
  FROM project_goals g
  LEFT JOIN projects p ON g.project_id = p.project_id
  WHERE g.project_id != '' AND g.status = 'success'
  ORDER BY g.project_id, p.review_date DESC
`;

let analysisStatus: ImpactAnalysisStatus = {
  isRunning: false,
  totalProjects: 0,
  totalBatches: 0,
  completedBatches: 0,
  totalImpacts: 0,
  currentBatchDDS: '',
  errors: [],
};

// ─── Fetch all project summaries from DB ─────────────────────────────────────

export interface ProjectRelation {
  project_id: string;
  kind: string;
  relation: string;
  source_file: string;
  evidence_quote: string;
  confidence: 'stated' | 'inferred';
}

export interface OutOfScope {
  topic: string;
  evidence_quote: string;
  source_file: string;
}

// Onda 3: atomic anchored claims emitted by Goals — the Impact engine treats
// these as the authoritative source for GIO/DDS edges, replacing free-text
// inference from `gio_sl_dds_impacts`.
export interface ImpactClaim {
  target_kind: 'gio' | 'dds';
  target: string;
  role: 'primary_provider' | 'downstream_consumer' | 'regional_executor' | 'risk_owner' | 'blocked_by' | string;
  severity: 'high' | 'medium' | 'low' | string;
  impact_type: string;
  evidence_file: string;
  evidence_quote: string;
  confidence: 'stated' | 'inferred';
}

export interface TimelineDep {
  project_id: string;
  reason: string;
  evidence_file: string;
  evidence_quote: string;
}

export interface TimelineStruct {
  gate1_actual: string | null;
  gate2_target: string | null;
  go_live_target: string | null;
  must_complete_before: TimelineDep[];
  blocked_by: TimelineDep[];
}

export interface GoalEntry {
  goal_id: number;
  gate: string;
  decision: string;
  review_date: string;
  region: string;
  month_folder: string;
  summary_one_line: string;
  digital_technologies: string;
  change_management: string;
  security_impacts: string;
  regional_impacts: string;
  ia_embedded: string;
  gio_sl_dds_impacts: string;
  dds_gio_workload: string;
  business_apps_cis: string;
  dds_entities_touched: string[];
  gio_services_touched: string[];
  tech_tags: string[];
  vendors: string[];
  data_classifications: string[];
  mentioned_projects: string[];
  project_relations: ProjectRelation[];
  out_of_scope: OutOfScope[];
  impact_claims: ImpactClaim[];
  timeline_struct: TimelineStruct | null;
  source_files: string;
  analyzed_at: string;
  goal_status: string;
}

export interface ProjectFullRecord {
  projectId: string;
  name: string;
  dds: string;
  currentGate: string;
  costKEur: number | null;
  description: string;
  remarks: string;
  decision: string;
  reviewDate: string;
  linkPositions: string;
  linkFolder: string;
  linkCIOO: string;
  services: CIOOService[];
  goalEntries: GoalEntry[];
  tags: string[];
}

function fetchAllProjectRecords(): ProjectFullRecord[] {
  const db = getDb();
  const rows = db.prepare(IMPACT_ANALYSIS_QUERY).all() as Record<string, unknown>[];

  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = row.project_id as string;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const records: ProjectFullRecord[] = [];
  for (const [projectId, entries] of Array.from(grouped.entries())) {
    const sortedEntries = [...entries].sort((a, b) => {
      const aDate = (a.analyzed_at as string) || '';
      const bDate = (b.analyzed_at as string) || '';
      return bDate.localeCompare(aDate);
    });

    const byReviewDate = sortedEntries.filter(e => e.review_date && String(e.review_date).trim());
    const latestByReview = byReviewDate.length > 0 ? byReviewDate[0] : sortedEntries[0];
    const latestByAnalyzed = sortedEntries[0];

    const allDescriptions = entries.map(e => e.description as string).filter(Boolean);
    const allRemarks = entries.map(e => e.remarks as string).filter(Boolean);
    let bestDescription = allDescriptions.join(' | ');
    const bestRemarks = allRemarks.join(' | ');

    // Fallback: when the projects row is a placeholder (no description), synthesize one
    // from the goal analysis so Details/Timeline/Matrix/Graph have something to render.
    // Prefer the curated one-liner; fall back to tech/biz text.
    if (!bestDescription) {
      const g = latestByAnalyzed;
      const summary = (g.summary_one_line as string) || '';
      const digital = (g.digital_technologies as string) || '';
      const business = (g.business_apps_cis as string) || '';
      bestDescription = (summary || digital || business).slice(0, 400);
    }

    // Fallback review date: project row has no review_date → use goal analysis date.
    let reviewDateStr = (latestByReview.review_date as string) || '';
    if (!reviewDateStr) {
      const analyzedAt = (latestByAnalyzed.analyzed_at as string) || '';
      reviewDateStr = analyzedAt.slice(0, 10); // YYYY-MM-DD
    }

    const parseArr = (raw: unknown): string[] => {
      if (typeof raw !== 'string' || !raw) return [];
      try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : []; }
      catch { return []; }
    };
    // Onda 2: parse JSON-of-objects for the new structured arrays. Returns
    // [] on any decode error so callers never see undefined.
    const parseObjArr = <T>(raw: unknown): T[] => {
      if (typeof raw !== 'string' || !raw) return [];
      try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed as T[] : []; }
      catch { return []; }
    };

    const goalEntries: GoalEntry[] = sortedEntries.map(e => ({
      goal_id: e.goal_id as number,
      gate: (e.goal_gate as string) || '',
      decision: (e.decision as string) || '',
      review_date: (e.review_date as string) || '',
      region: (e.region as string) || '',
      month_folder: (e.month_folder as string) || '',
      summary_one_line: (e.summary_one_line as string) || '',
      digital_technologies: (e.digital_technologies as string) || '',
      change_management: (e.change_management as string) || '',
      security_impacts: (e.security_impacts as string) || '',
      regional_impacts: (e.regional_impacts as string) || '',
      ia_embedded: (e.ia_embedded as string) || '',
      gio_sl_dds_impacts: (e.gio_sl_dds_impacts as string) || '',
      dds_gio_workload: (e.dds_gio_workload as string) || '',
      business_apps_cis: (e.business_apps_cis as string) || '',
      dds_entities_touched: parseArr(e.dds_entities_touched),
      gio_services_touched: parseArr(e.gio_services_touched),
      tech_tags:            parseArr(e.tech_tags),
      vendors:              parseArr(e.vendors),
      data_classifications: parseArr(e.data_classifications),
      mentioned_projects:   parseArr(e.mentioned_projects),
      project_relations:    parseObjArr<ProjectRelation>(e.project_relations),
      out_of_scope:         parseObjArr<OutOfScope>(e.out_of_scope),
      impact_claims:        parseObjArr<ImpactClaim>(e.impact_claims),
      // Normalize timeline so downstream code can do .length without guards.
      // LLM may emit `{}` (no timeline) which serializes to a TimelineStruct
      // where must_complete_before/blocked_by are undefined.
      timeline_struct:      (() => {
        const empty: TimelineStruct = { gate1_actual: null, gate2_target: null, go_live_target: null, must_complete_before: [], blocked_by: [] };
        if (typeof e.timeline_struct !== 'string' || !e.timeline_struct) return empty;
        try {
          const t = JSON.parse(e.timeline_struct);
          if (!t || typeof t !== 'object') return empty;
          const tr = t as Record<string, unknown>;
          return {
            gate1_actual:   (typeof tr.gate1_actual   === 'string' ? tr.gate1_actual   : null),
            gate2_target:   (typeof tr.gate2_target   === 'string' ? tr.gate2_target   : null),
            go_live_target: (typeof tr.go_live_target === 'string' ? tr.go_live_target : null),
            must_complete_before: Array.isArray(tr.must_complete_before) ? tr.must_complete_before as TimelineDep[] : [],
            blocked_by:           Array.isArray(tr.blocked_by)           ? tr.blocked_by           as TimelineDep[] : [],
          } as TimelineStruct;
        } catch { return empty; }
      })(),
      source_files: (e.source_files as string) || '',
      analyzed_at: (e.analyzed_at as string) || '',
      goal_status: (e.goal_status as string) || '',
    }));

    // Prefer the real gate from projects.gate; fall back to goal_gate only if it's a real value.
    const pickGate = (v: unknown): string => {
      const s = String(v ?? '').trim();
      if (!s) return '';
      if (s.toLowerCase() === 'unknown') return '';
      return s;
    };
    const projGate = pickGate(latestByReview.proj_gate);
    const goalGateFallback = pickGate(latestByAnalyzed.goal_gate);
    const resolvedGate = projGate || goalGateFallback;

    // Prefer the clean name from projects table over the messy goal filename
    const projName = ((latestByReview.proj_name as string) || '').trim();
    const goalName = ((latestByAnalyzed.project_name as string) || '').trim();
    // projects.name is clean (from sheet); goal name is often a filename with underscores
    const resolvedName = (projName && projName !== projectId) ? projName : (goalName || projectId);

    records.push({
      projectId,
      name: resolvedName,
      dds: latestByReview.dds as string || '',
      currentGate: resolvedGate,
      costKEur: latestByReview.cost_keur as number | null ?? null,
      description: bestDescription,
      remarks: bestRemarks,
      decision: latestByReview.decision as string || '',
      reviewDate: reviewDateStr,
      linkPositions: (latestByReview.link_positions as string) || '',
      linkFolder: (latestByReview.link_folder as string) || '',
      linkCIOO: (latestByReview.link_cioo as string) || '',
      services: (() => {
        try {
          const raw = latestByReview.services as string | undefined;
          return raw ? JSON.parse(raw) as CIOOService[] : [];
        } catch { return [] as CIOOService[]; }
      })(),
      goalEntries,
      tags: extractTags({
        name: resolvedName,
        description: bestDescription,
        remarks: bestRemarks,
      }),
    });
  }

  return records;
}

// ─── Fetch ProjectSummaries for views (used by /api/projects) ───────────────

export function fetchProjectSummariesForViews(): ProjectSummary[] {
  const records = fetchAllProjectRecords();
  return records.map((r): ProjectSummary => {
    // One synthetic history entry per goal analysis so TimelineView has dots to render.
    const history: CIOOProject[] = r.goalEntries.map((g, idx) => ({
      id: g.goal_id,
      projectId: r.projectId,
      name: r.name,
      dds: r.dds,
      gate: g.gate || r.currentGate,
      costKEur: idx === 0 ? r.costKEur : null,
      description: r.description,
      remarks: r.remarks,
      qa: '',
      reviewDate: (g.review_date || g.analyzed_at.slice(0, 10)) || '',
      decision: g.decision || r.decision,
      decisionMode: '',
      decisionDate: '',
      reviewStatus: '',
      documentsStatus: '',
      restricted: '',
      costBeforeG2: null,
      estGate2Date: '',
      sessionStart: '',
      sessionEnd: '',
      participants: '',
      linkPositions: r.linkPositions,
      linkFolder: r.linkFolder,
      linkCIOO: r.linkCIOO,
      year: null,
      month: null,
      batchId: '',
      services: r.services,
    }));

    return {
    projectId: r.projectId,
    name: r.name,
    dds: r.dds,
    currentGate: r.currentGate,
    latestDecision: r.decision,
    costKEur: r.costKEur,
    description: r.description,
    remarks: r.remarks,
    reviewCount: r.goalEntries.length,
    lastReviewDate: r.reviewDate,
    linkPositions: r.linkPositions,
    linkFolder: r.linkFolder,
    linkCIOO: r.linkCIOO,
    tags: r.tags,
    history,
    services: r.services,

    digitalTechnologies: r.goalEntries[0]?.digital_technologies ?? '',
    changeManagement:    r.goalEntries[0]?.change_management    ?? '',
    securityImpacts:     r.goalEntries[0]?.security_impacts     ?? '',
    regionalImpacts:     r.goalEntries[0]?.regional_impacts     ?? '',
    iaEmbedded:          r.goalEntries[0]?.ia_embedded          ?? '',
    gioSlDdsImpacts:     r.goalEntries[0]?.gio_sl_dds_impacts   ?? '',
    ddsGioWorkload:      r.goalEntries[0]?.dds_gio_workload     ?? '',
    businessAppsCis:     r.goalEntries[0]?.business_apps_cis    ?? '',
    subappAnalyzed: true,
    };
  });
}

// ─── Build full-coverage batches ─────────────────────────────────────────────

interface Batch {
  label: string;
  projects: ProjectFullRecord[];
}

function buildFullCoverageBatches(
  records: ProjectFullRecord[],
  batchSize = 22
): Batch[] {
  const N = records.length;
  if (N === 0) return [];
  if (N <= batchSize) {
    return [{ label: `All projects (${N})`, projects: records }];
  }

  const uncovered = new Set<string>();
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      uncovered.add(`${i}|${j}`);
    }
  }

  const batches: Batch[] = [];
  let round = 1;

  while (uncovered.size > 0) {
    const inBatch: number[] = [];
    const uncoveredByIdx = new Map<number, number>();
    for (const key of uncovered) {
      const [a, b] = key.split('|').map(Number);
      uncoveredByIdx.set(a, (uncoveredByIdx.get(a) ?? 0) + 1);
      uncoveredByIdx.set(b, (uncoveredByIdx.get(b) ?? 0) + 1);
    }

    const seed = [...uncoveredByIdx.entries()].sort((a, b) => b[1] - a[1])[0][0];
    inBatch.push(seed);

    while (inBatch.length < batchSize) {
      let best = -1;
      let bestGain = -1;
      for (let cand = 0; cand < N; cand++) {
        if (inBatch.includes(cand)) continue;
        let gain = 0;
        for (const member of inBatch) {
          const key = cand < member ? `${cand}|${member}` : `${member}|${cand}`;
          if (uncovered.has(key)) gain++;
        }
        if (gain > bestGain) {
          bestGain = gain;
          best = cand;
        }
      }
      if (best < 0) break;
      inBatch.push(best);
      if (bestGain === 0) break;
    }

    if (inBatch.length < batchSize) {
      for (let cand = 0; cand < N && inBatch.length < batchSize; cand++) {
        if (!inBatch.includes(cand)) inBatch.push(cand);
      }
    }

    for (let a = 0; a < inBatch.length; a++) {
      for (let b = a + 1; b < inBatch.length; b++) {
        const i = Math.min(inBatch[a], inBatch[b]);
        const j = Math.max(inBatch[a], inBatch[b]);
        uncovered.delete(`${i}|${j}`);
      }
    }

    batches.push({
      label: `Round ${round++} (${inBatch.length} projects)`,
      projects: inBatch.map(idx => records[idx]),
    });

    if (batches.length > 200) {
      console.warn('[Impact] buildFullCoverageBatches hit 200-batch safety cap');
      break;
    }
  }

  return batches;
}

// ─── Build prompt for a batch ────────────────────────────────────────────────

function buildImpactPrompt(records: ProjectFullRecord[]): string {
  const MAX_PROMPT_CHARS = 200_000;
  const DOC_SLICE = 4000;
  const DOCS_TOTAL = 8000;

  const entries: string[] = [];
  let used = 0;
  let dropped = 0;

  const emit = (field: string, value: string | number | null | undefined): string => {
    if (value === null || value === undefined || value === '') return '';
    return `\n  ${field}: ${value}`;
  };
  const emitArr = (field: string, value: string[] | null | undefined): string => {
    if (!value || value.length === 0) return '';
    return `\n  ${field}: [${value.join(', ')}]`;
  };

  for (const r of records) {
    const parts: string[] = [];
    parts.push(
      `- ${r.projectId}: "${r.name}" (DDS: ${r.dds || 'N/A'}, Gate: ${r.currentGate || 'N/A'}, Cost: ${r.costKEur ? `${r.costKEur}k€` : 'N/A'})`
    );

    // Surface the canonical arrays at the top of the project block so the LLM
    // can correlate stacks/vendors/data classes across projects without
    // re-parsing every free-form field.
    const latest = r.goalEntries[0];
    if (latest) {
      parts.push(emit('Summary', latest.summary_one_line));
      parts.push(emitArr('Tech tags', latest.tech_tags));
      parts.push(emitArr('Vendors', latest.vendors));
      parts.push(emitArr('Data classifications', latest.data_classifications));
      parts.push(emitArr('DDS entities touched', latest.dds_entities_touched));
      parts.push(emitArr('GIO services touched', latest.gio_services_touched));
      parts.push(emitArr('Mentions other projects', latest.mentioned_projects));

      // Onda 2: pre-extracted cross-project relationships from Goals. These
      // are already grounded in evidence quotes — surface them as authoritative
      // pre-edges so the LLM doesn't have to re-derive project↔project links
      // from prose. Format keeps the kind+quote so the LLM can emit a matching
      // impact row with the same wording.
      if (latest.project_relations.length > 0) {
        const lines = latest.project_relations
          .map(pr => `      • → ${pr.project_id} [${pr.kind}, ${pr.confidence}]: "${pr.evidence_quote}" (in ${pr.source_file})`)
          .join('\n');
        parts.push(`\n  Pre-extracted project relations (from Goals):\n${lines}`);
      }

      // Onda 2: explicit out-of-scope statements. Used as NEGATIVE signal — the
      // LLM is instructed below not to invent impacts that contradict these.
      if (latest.out_of_scope.length > 0) {
        const lines = latest.out_of_scope
          .map(o => `      • "${o.topic}" — "${o.evidence_quote}" (in ${o.source_file})`)
          .join('\n');
        parts.push(`\n  EXCLUSIONS (project explicitly out-of-scope for these topics — do NOT emit impacts that contradict):\n${lines}`);
      }

      // Onda 3: atomic claims, the authoritative source for GIO/DDS edges.
      // Each claim already carries target_kind + target + role + severity +
      // impact_type + evidence. The LLM should treat these as the GROUND
      // TRUTH and emit matching impact rows verbatim (one impact per claim).
      if (latest.impact_claims.length > 0) {
        const lines = latest.impact_claims
          .map(c => `      • ${c.target_kind.toUpperCase()} "${c.target}" role=${c.role} sev=${c.severity} type=${c.impact_type} (${c.confidence}): "${c.evidence_quote}" (in ${c.evidence_file})`)
          .join('\n');
        parts.push(`\n  Atomic impact claims (from Goals — emit one impact row per claim, do not invent extras):\n${lines}`);
      }

      // Onda 3: structured timeline + dependencies. Defensive: even though the
      // parser normalizes to empty arrays, guard against any legacy/malformed
      // value that slipped past.
      const tl = latest.timeline_struct;
      const mcb = Array.isArray(tl?.must_complete_before) ? tl!.must_complete_before : [];
      const blk = Array.isArray(tl?.blocked_by) ? tl!.blocked_by : [];
      if (tl && (tl.gate1_actual || tl.gate2_target || tl.go_live_target || mcb.length || blk.length)) {
        const tlParts: string[] = [];
        if (tl.gate1_actual)   tlParts.push(`gate1=${tl.gate1_actual}`);
        if (tl.gate2_target)   tlParts.push(`gate2=${tl.gate2_target}`);
        if (tl.go_live_target) tlParts.push(`go-live=${tl.go_live_target}`);
        const header = tlParts.length ? `      schedule: ${tlParts.join(', ')}` : '';
        const blocks = blk.map(d => `      • blocked_by → ${d.project_id}: "${d.evidence_quote}" (${d.evidence_file})`).join('\n');
        const before = mcb.map(d => `      • must_complete_before → ${d.project_id}: "${d.evidence_quote}" (${d.evidence_file})`).join('\n');
        const body = [header, blocks, before].filter(Boolean).join('\n');
        if (body) parts.push(`\n  Timeline:\n${body}`);
      }
    }

    parts.push(emit('Decision', r.decision));
    parts.push(emit('Review Date', r.reviewDate));
    parts.push(emit('Description', r.description));
    parts.push(emit('Remarks', r.remarks));
    if (r.linkPositions) parts.push(emit('Link (Positions)', r.linkPositions));
    if (r.linkFolder) parts.push(emit('Link (Folder)', r.linkFolder));
    if (r.linkCIOO) parts.push(emit('Link (CIOO)', r.linkCIOO));

    r.goalEntries.forEach((g, idx) => {
      const header = `\n  Goal analysis ${idx + 1}${g.month_folder ? ` [${g.month_folder}]` : ''}${g.analyzed_at ? ` (${g.analyzed_at})` : ''}:`;
      const body = [
        emit('    Region', g.region),
        emit('    Digital Technologies', g.digital_technologies),
        emit('    Change Management', g.change_management),
        emit('    Security Impacts', g.security_impacts),
        emit('    Regional Impacts', g.regional_impacts),
        emit('    IA Embedded', g.ia_embedded),
        emit('    GIO/SL/DDS Impacts', g.gio_sl_dds_impacts),
        emit('    DDS/GIO Workload', g.dds_gio_workload),
        emit('    Business Apps/CIs', g.business_apps_cis),
        emit('    Source Files', g.source_files),
      ].filter(Boolean).join('');
      if (body) parts.push(header + body);
    });

    try {
      const docs = getProjectDocuments(r.projectId);
      // Label each document chunk with its URL + file name so the LLM can
      // produce verifiable citations. The bracketed "[doc_url=..., file_name=...]"
      // header is the exact key the model echoes back in the citations array.
      const labelled = docs
        .filter(d => d.status === 'success' && d.content)
        .map(d => `[doc_url=${d.url}, file_name=${d.fileName || '(unknown)'}]\n${d.content.slice(0, DOC_SLICE)}`)
        .join('\n---\n')
        .slice(0, DOCS_TOTAL);
      if (labelled) parts.push(`\n  Documents:\n${labelled}`);
    } catch { /* no docs */ }

    const entry = parts.filter(Boolean).join('');
    if (used + entry.length > MAX_PROMPT_CHARS) {
      dropped++;
      continue;
    }
    entries.push(entry);
    used += entry.length;
  }

  if (dropped > 0) {
    console.warn(
      `[Impact] buildImpactPrompt dropped ${dropped}/${records.length} projects due to ${MAX_PROMPT_CHARS}-char cap (used=${used})`
    );
  }

  const projectList = entries.join('\n\n');
  const { impactPrompt } = getPrompts();
  return impactPrompt.replace('{{PROJECTS_LIST}}', projectList);
}

// ─── Parse Gemini response robustly ──────────────────────────────────────────

interface RawCitation {
  doc_url: string;
  snippet: string;
}

interface RawImpact {
  source: string;
  target: string;
  impact_type: string;
  direction: string;
  severity: string;
  explanation: string;
  gio_services?: string[];
  dds_entities?: string[];
  citations?: RawCitation[];
}

function parseImpactResponse(text: string): RawImpact[] {
  try {
    // Remove markdown code fences if present
    let clean = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

    // Find the JSON array
    const start = clean.indexOf('[');
    const end = clean.lastIndexOf(']');
    if (start >= 0 && end > start) {
      clean = clean.slice(start, end + 1);
    }

    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed)) {
      console.error('[Impact] Gemini returned non-array:', text.slice(0, 300));
      return [];
    }

    // Normalize field names — Gemini may use different keys
    return parsed.map((item: Record<string, unknown>) => {
      const rawCitations = Array.isArray(item.citations) ? item.citations as Record<string, unknown>[] : [];
      const citations: RawCitation[] = rawCitations
        .map(c => ({
          doc_url: String(c.doc_url || c.docUrl || c.url || '').trim(),
          snippet: String(c.snippet || c.quote || c.text || '').trim(),
        }))
        .filter(c => c.doc_url && c.snippet);

      return {
        source: (item.source || item.source_project_id || item.sourceProjectId || '') as string,
        target: (item.target || item.target_project_id || item.targetProjectId || '') as string,
        impact_type: (item.impact_type || item.impactType || item.type || 'technology_dependency') as string,
        direction: (item.direction || item.relationship || 'requires_coordination') as string,
        severity: (item.severity || item.level || 'medium') as string,
        explanation: (item.explanation || item.reason || item.description || '') as string,
        gio_services: Array.isArray(item.gio_services) ? item.gio_services as string[] : [],
        dds_entities: normalizeDdsList(item.dds_entities ?? item.ddsEntities ?? item.dds),
        citations,
      };
    }).filter(item => item.source && item.target) as RawImpact[];
  } catch (err) {
    console.error('[Impact] Failed to parse Gemini response:', (err as Error).message, '— raw:', text.slice(0, 500));
    return [];
  }
}

// ─── Store impacts in DB ─────────────────────────────────────────────────────

function storeImpacts(impacts: RawImpact[], batchId: string): number {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO projects_impact
    (source_project_id, target_project_id, impact_type, direction, severity, explanation, batch_id, gio_services, dds_entities, citations, evidence_chain)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Onda 4: load each source project's Goals once so we can attach an
  // evidence_chain pointer for every impact row we store. Two-pass design:
  //   1. Fetch all relevant project_goals (source projects in this batch).
  //   2. For each impact row, find which atomic claim (or project_relation)
  //      it corresponds to and persist the trace.
  const sourceProjectIds = Array.from(new Set(impacts.map(i => i.source).filter(Boolean)));
  const goalsByProject = new Map<string, { goal_id: number; impact_claims: string; project_relations: string }>();
  if (sourceProjectIds.length > 0) {
    const placeholders = sourceProjectIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, project_id, impact_claims, project_relations FROM project_goals WHERE project_id IN (${placeholders}) AND status = 'success'`
    ).all(...sourceProjectIds) as Array<{ id: number; project_id: string; impact_claims: string; project_relations: string }>;
    for (const r of rows) goalsByProject.set(r.project_id, { goal_id: r.id, impact_claims: r.impact_claims, project_relations: r.project_relations });
  }

  const buildChain = (item: RawImpact): string => {
    const g = goalsByProject.get(item.source);
    if (!g) return '[]';
    // Pseudo-targets → match against impact_claims by (target_kind, target).
    if (item.target === 'GIO_SERVICES' || item.target === 'DDS_IMPACTS') {
      let claims: Array<{ target_kind: string; target: string }> = [];
      try { const v = JSON.parse(g.impact_claims || '[]'); if (Array.isArray(v)) claims = v as typeof claims; } catch { /* ignore */ }
      const expectedKind = item.target === 'GIO_SERVICES' ? 'gio' : 'dds';
      const labels = item.target === 'GIO_SERVICES' ? (item.gio_services || []) : (item.dds_entities || []);
      const matches: number[] = [];
      claims.forEach((c, idx) => {
        if (c.target_kind === expectedKind && labels.includes(c.target)) matches.push(idx);
      });
      if (matches.length === 0) return JSON.stringify([{ goal_id: g.goal_id, source: 'free' as const }]);
      return JSON.stringify(matches.map(idx => ({ goal_id: g.goal_id, claim_idx: idx, source: 'claim' as const })));
    }
    // Project↔project → match against project_relations by target project_id.
    if (item.target && item.target.startsWith('PRJ')) {
      let relations: Array<{ project_id: string }> = [];
      try { const v = JSON.parse(g.project_relations || '[]'); if (Array.isArray(v)) relations = v as typeof relations; } catch { /* ignore */ }
      const matchIdx = relations.findIndex(r => r.project_id === item.target);
      if (matchIdx >= 0) return JSON.stringify([{ goal_id: g.goal_id, relation_idx: matchIdx, source: 'relation' as const }]);
    }
    return JSON.stringify([{ goal_id: g.goal_id, source: 'free' as const }]);
  };

  let inserted = 0;
  const insertMany = db.transaction((items: RawImpact[]) => {
    for (const item of items) {
      // Drop self-loops: an LLM occasionally emits source===target rows from
      // out_of_scope-flavored sentences. They are never meaningful as edges.
      if (item.source && item.target && item.source === item.target) continue;
      const result = stmt.run(
        item.source,
        item.target,
        item.impact_type,
        item.direction,
        item.severity,
        item.explanation || '',
        batchId,
        JSON.stringify(item.gio_services || []),
        JSON.stringify(item.dds_entities || []),
        JSON.stringify(item.citations || []),
        buildChain(item),
      );
      if (result.changes > 0) inserted++;
    }
  });

  insertMany(impacts);
  return inserted;
}

// ─── Process a single batch via Gemini ───────────────────────────────────────

async function processBatch(batch: Batch, batchId: string): Promise<number> {
  const prompt = buildImpactPrompt(batch.projects);

  const { text } = await generateContent({ prompt, model: 'fast', json: true, context: 'impact' });

  console.log(`[Impact] Batch "${batch.label}" (${batch.projects.length} projects) — response length: ${text.length}, preview: ${text.slice(0, 200)}`);

  const impacts = parseImpactResponse(text);
  console.log(`[Impact] Batch "${batch.label}" — parsed ${impacts.length} impacts`);

  if (impacts.length === 0) return 0;

  return storeImpacts(impacts, batchId);
}

// ─── Main: Run Full Impact Analysis ──────────────────────────────────────────

export async function runFullImpactAnalysis(): Promise<void> {
  if (analysisStatus.isRunning) {
    throw new Error('Impact analysis is already running');
  }

  // Reset status
  analysisStatus = {
    isRunning: true,
    totalProjects: 0,
    totalBatches: 0,
    completedBatches: 0,
    totalImpacts: 0,
    currentBatchDDS: 'Initializing...',
    errors: [],
  };

  try {
    const records = fetchAllProjectRecords();
    analysisStatus.totalProjects = records.length;

    const allBatches = buildFullCoverageBatches(records, 22);
    analysisStatus.totalBatches = allBatches.length;

    const runBatchId = uuidv4();

    for (let i = 0; i < allBatches.length; i++) {
      const batch = allBatches[i];
      analysisStatus.currentBatchDDS = batch.label;

      try {
        const inserted = await processBatch(batch, runBatchId);
        analysisStatus.totalImpacts += inserted;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        analysisStatus.errors.push(`Batch "${batch.label}": ${msg}`);
      }

      analysisStatus.completedBatches = i + 1;

      // Small delay to avoid rate limiting
      if (i < allBatches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Update total impacts from DB (more accurate)
    const db = getDb();
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM projects_impact').get() as { cnt: number };
    analysisStatus.totalImpacts = countRow.cnt;

    analysisStatus.currentBatchDDS = 'Complete';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    analysisStatus.errors.push(`Fatal: ${msg}`);
  } finally {
    analysisStatus.isRunning = false;
  }
}

// ─── Get current analysis status ─────────────────────────────────────────────

export function getImpactStatus(): ImpactAnalysisStatus {
  // If not running, refresh total impacts from DB
  if (!analysisStatus.isRunning) {
    try {
      const db = getDb();
      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM projects_impact').get() as { cnt: number };
      analysisStatus.totalImpacts = countRow.cnt;
    } catch {
      // ignore
    }
  }
  return { ...analysisStatus };
}

// ─── Get impacts for a specific project ──────────────────────────────────────

export function getProjectImpacts(projectId: string): ProjectImpact[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM projects_impact
    WHERE source_project_id = ? OR target_project_id = ?
    ORDER BY
      CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
      created_at DESC
  `).all(projectId, projectId) as ImpactDbRow[];

  return rows.map(mapImpactRow);
}

// ─── Clear all impacts ───────────────────────────────────────────────────────

export function clearAllImpacts(): number {
  if (analysisStatus.isRunning) {
    throw new Error('Cannot clear impacts while an analysis is running');
  }
  const db = getDb();
  const result = db.prepare('DELETE FROM projects_impact').run();
  // Onda 4: cascade invalidation of deep dives. Without this, the cached
  // narrative in impact_deep_dives keeps citing edges that no longer exist
  // — a "stale dive" UX bug surfaced in the Impact_Coherence_Report. Re-run
  // of Goals + Impact will trigger fresh dives on demand from the UI.
  const ddResult = db.prepare('DELETE FROM impact_deep_dives').run();
  if (ddResult.changes > 0) {
    console.log(`[impact] cleared ${result.changes} impacts and cascaded ${ddResult.changes} cached deep dives`);
  }
  analysisStatus.totalImpacts = 0;
  return result.changes;
}

// ─── Get all impacts ─────────────────────────────────────────────────────────

export function getAllImpacts(): ProjectImpact[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM projects_impact
    ORDER BY
      CASE severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
      created_at DESC
  `).all() as ImpactDbRow[];

  return rows.map(mapImpactRow);
}

// ─── DB row mapping ──────────────────────────────────────────────────────────

interface ImpactDbRow {
  id: number;
  source_project_id: string;
  target_project_id: string;
  impact_type: string;
  direction: string;
  severity: string;
  explanation: string;
  batch_id: string;
  created_at: string;
  gio_services: string;
  dds_entities: string;
  citations: string;
  evidence_chain?: string;
}

// ─── Aggregation ─────────────────────────────────────────────────────────────
// Raw rows in `projects_impact` are granular: the same pair of projects can
// appear up to N times — once per `impact_type`, plus duplicates for bidirectional
// edges (A→B and B→A). For dashboard views this fragmentation inflates the count
// and clutters the UI. `aggregateImpacts` collapses every raw row sharing the
// same unordered pair into a single representative entry, preserving the full
// detail in the *plural* fields (impactTypes, directions, explanations).

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

export function aggregateImpacts(rows: ProjectImpact[]): ProjectImpact[] {
  const groups = new Map<string, ProjectImpact[]>();
  for (const r of rows) {
    const a = r.sourceProjectId;
    const b = r.targetProjectId;
    const key = a < b ? `${a}__${b}` : `${b}__${a}`;
    const arr = groups.get(key) ?? [];
    arr.push(r);
    groups.set(key, arr);
  }

  const uniqSorted = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort();

  const out: ProjectImpact[] = [];
  for (const arr of groups.values()) {
    // Primary = highest severity, longest explanation as tiebreaker. Used to
    // pick the orientation (source/target) and the headline explanation.
    const primary = [...arr].sort((x, y) => {
      const dr = (SEVERITY_RANK[y.severity] ?? 0) - (SEVERITY_RANK[x.severity] ?? 0);
      if (dr !== 0) return dr;
      return (y.explanation?.length ?? 0) - (x.explanation?.length ?? 0);
    })[0];

    const distinctSources = new Set(arr.map(r => r.sourceProjectId));

    // Keep explanations, citationsByExplanation, impactTypeByExplanation,
    // severityByExplanation in lock-step: each non-empty explanation gets its
    // metadata at the same index. Primary goes first. This is what lets the
    // UI render per-message badges (impact_type + severity) and per-message
    // citation popovers correctly aligned to their originating raw row.
    const ordered = [primary, ...arr.filter(r => r.id !== primary.id)];
    const explanations: string[] = [];
    const citationsByExplanation: NonNullable<ProjectImpact['citations']>[] = [];
    const impactTypeByExplanation: string[] = [];
    const severityByExplanation: string[] = [];
    const gioServicesByExplanation: string[][] = [];
    const ddsEntitiesByExplanation: string[][] = [];
    for (const r of ordered) {
      if (!r.explanation) continue;
      explanations.push(r.explanation);
      citationsByExplanation.push(r.citations ?? []);
      impactTypeByExplanation.push(r.impactType);
      severityByExplanation.push(r.severity);
      gioServicesByExplanation.push(r.gioServices ?? []);
      ddsEntitiesByExplanation.push(r.ddsEntities ?? []);
    }

    out.push({
      id: primary.id,
      sourceProjectId: primary.sourceProjectId,
      targetProjectId: primary.targetProjectId,
      impactType: primary.impactType,
      direction: primary.direction,
      severity: primary.severity,
      explanation: primary.explanation,
      batchId: primary.batchId,
      createdAt: primary.createdAt,
      gioServices: uniqSorted(arr.flatMap(r => r.gioServices ?? [])),
      ddsEntities: uniqSorted(arr.flatMap(r => r.ddsEntities ?? [])),
      citations: primary.citations ?? [],
      evidenceChain: arr.flatMap(r => r.evidenceChain ?? []),
      impactTypes: uniqSorted(arr.map(r => r.impactType)),
      directions: uniqSorted(arr.map(r => r.direction)),
      explanations,
      citationsByExplanation,
      impactTypeByExplanation,
      severityByExplanation,
      gioServicesByExplanation,
      ddsEntitiesByExplanation,
      count: arr.length,
      bidirectional: distinctSources.size > 1,
    });
  }

  return out.sort((x, y) => {
    const dr = (SEVERITY_RANK[y.severity] ?? 0) - (SEVERITY_RANK[x.severity] ?? 0);
    if (dr !== 0) return dr;
    return (y.count ?? 1) - (x.count ?? 1);
  });
}

function mapImpactRow(row: ImpactDbRow): ProjectImpact {
  let parsedGio: string[] = [];
  try {
    parsedGio = row.gio_services ? JSON.parse(row.gio_services) : [];
  } catch { /* ignore */ }
  let parsedDds: string[] = [];
  try {
    parsedDds = row.dds_entities ? JSON.parse(row.dds_entities) : [];
  } catch { /* ignore */ }
  // Citations are stored without file_name (LLM doesn't get a stable one). We
  // enrich at read time so the popover always shows the human-readable name
  // currently in documents_cache, not a snapshot from generation time.
  let parsedCitations: { doc_url: string; file_name: string; snippet: string }[] = [];
  try {
    if (row.citations) {
      const raw = JSON.parse(row.citations) as { doc_url?: string; snippet?: string; file_name?: string }[];
      if (Array.isArray(raw)) {
        parsedCitations = raw
          .filter(c => c && typeof c.doc_url === 'string' && typeof c.snippet === 'string')
          .map(c => ({ doc_url: c.doc_url!, snippet: c.snippet!, file_name: c.file_name || '' }));
      }
    }
  } catch { /* ignore */ }

  if (parsedCitations.length > 0) {
    const urls = parsedCitations.map(c => c.doc_url);
    const nameByUrl = getFileNamesForUrls(urls);
    parsedCitations = parsedCitations.map(c => ({
      ...c,
      file_name: c.file_name || nameByUrl.get(c.doc_url) || '',
    }));
  }

  // Onda 4: parse evidence_chain so the API layer can synthesize fallback
  // citations from goal claims when the LLM left `citations` empty.
  let parsedChain: { goal_id: number; claim_idx?: number; relation_idx?: number; source: 'claim' | 'relation' | 'free' }[] = [];
  try {
    if (row.evidence_chain) {
      const raw = JSON.parse(row.evidence_chain);
      if (Array.isArray(raw)) parsedChain = raw;
    }
  } catch { /* ignore */ }

  return {
    id: row.id,
    sourceProjectId: row.source_project_id,
    targetProjectId: row.target_project_id,
    impactType: row.impact_type,
    direction: row.direction,
    severity: row.severity,
    explanation: row.explanation,
    batchId: row.batch_id,
    createdAt: row.created_at,
    gioServices: parsedGio,
    ddsEntities: parsedDds,
    citations: parsedCitations,
    evidenceChain: parsedChain,
  };
}

// ─── Query Preview ───────────────────────────────────────────────────────────

export interface ImpactQueryPreview {
  query: string;
  columns: string[];
  rowCount: number;
  rows: Record<string, unknown>[];
  groupedRowCount: number;
  generatedAt: string;
}

export function getImpactQueryPreview(mode: 'raw' | 'grouped' = 'raw'): ImpactQueryPreview {
  const db = getDb();
  const rawRows = db.prepare(IMPACT_ANALYSIS_QUERY).all() as Record<string, unknown>[];

  const grouped = new Set(rawRows.map(r => String(r.project_id)));

  const rows = mode === 'grouped'
    ? fetchAllProjectRecords() as unknown as Record<string, unknown>[]
    : rawRows;

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return {
    query: IMPACT_ANALYSIS_QUERY.trim(),
    columns,
    rowCount: rows.length,
    rows,
    groupedRowCount: grouped.size,
    generatedAt: new Date().toISOString(),
  };
}
