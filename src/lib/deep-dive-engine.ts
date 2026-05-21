import crypto from 'crypto';
import { getDb } from './db';
import { generateContent } from './llm';
import { getProjectDocuments } from './drive-engine';
import { getProjectImpacts, aggregateImpacts } from './impact-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export type DeepDiveKind = 'gio' | 'dds';

export interface DeepDiveResult {
  projectId: string;
  kind: DeepDiveKind;
  target: string;
  responseMd: string;
  llmProvider: string;
  llmModel: string;
  generatedAt: string;
  durationMs: number | null;
  cached: boolean;
}

interface DeepDiveRow {
  project_id: string;
  kind: string;
  target: string;
  response_md: string;
  llm_provider: string;
  llm_model: string;
  generated_at: string;
  source_sig: string;
  duration_ms: number | null;
}

interface ProjectRow {
  project_id: string;
  name: string;
  dds: string;
  gate: string;
  decision: string;
  cost_keur: number | null;
  description: string;
  remarks: string;
  qa: string;
  review_date: string;
  link_folder: string;
  link_positions: string;
  link_cioo: string;
}

interface GoalsRow {
  summary_one_line: string;
  digital_technologies: string;
  change_management: string;
  security_impacts: string;
  regional_impacts: string;
  ia_embedded: string;
  gio_sl_dds_impacts: string;
  dds_gio_workload: string;
  business_apps_cis: string;
  dds_entities_touched: string;     // JSON
  gio_services_touched: string;     // JSON
  tech_tags: string;                // JSON
  vendors: string;                  // JSON
  data_classifications: string;     // JSON
  mentioned_projects: string;       // JSON
  region: string;
  source_files: string;
  analyzed_at: string;
}

// ─── Cache key (source signature) ────────────────────────────────────────────
//
// Hashes the source_files + analyzed_at of the latest Goals analysis. If the
// underlying inputs change (re-extraction with different files, or re-analysis
// with same files but newer LLM run), the cached deep-dive is invalidated
// automatically — no TTL, no manual flush.

function computeSourceSig(goalsRow: GoalsRow | undefined): string {
  if (!goalsRow) return 'no-goals';
  const payload = `${goalsRow.source_files || '[]'}|${goalsRow.analyzed_at || ''}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ─── Cache lookup / write ────────────────────────────────────────────────────

function readCache(projectId: string, kind: DeepDiveKind, target: string, sig: string): DeepDiveRow | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT project_id, kind, target, response_md, llm_provider, llm_model,
           generated_at, source_sig, duration_ms
    FROM impact_deep_dives
    WHERE project_id = ? AND kind = ? AND target = ? AND source_sig = ?
  `).get(projectId, kind, target, sig) as DeepDiveRow | undefined;
}

function writeCache(row: {
  projectId: string;
  kind: DeepDiveKind;
  target: string;
  responseMd: string;
  llmProvider: string;
  llmModel: string;
  sourceSig: string;
  durationMs: number;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO impact_deep_dives
      (project_id, kind, target, response_md, llm_provider, llm_model, source_sig, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, kind, target) DO UPDATE SET
      response_md  = excluded.response_md,
      llm_provider = excluded.llm_provider,
      llm_model    = excluded.llm_model,
      source_sig   = excluded.source_sig,
      duration_ms  = excluded.duration_ms,
      generated_at = datetime('now')
  `).run(
    row.projectId, row.kind, row.target, row.responseMd,
    row.llmProvider, row.llmModel, row.sourceSig, row.durationMs
  );
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

const DOC_SLICE = 2000;     // chars per doc
const DOC_TOTAL = 8000;     // total chars across all docs

function buildPrompt(args: {
  kind: DeepDiveKind;
  target: string;
  project: ProjectRow;
  goals: GoalsRow | undefined;
  docs: { url: string; content: string; status: string }[];
  existingExplanation: string;
}): string {
  const { kind, target, project, goals, docs, existingExplanation } = args;

  const kindLabel = kind === 'gio' ? `GIO Service Line "${target}"` : `DDS entity "${target}"`;
  const kindHelper = kind === 'gio'
    ? 'a global infrastructure service line that the project depends on (e.g. Cloud Services, Security & Compliance, User Workplace, Site Infrastructure, Command Center)'
    : 'a Digital & Data Solutions organisational entity affected by the project (geographic zone, business division, or functional app group)';

  // Compose document excerpts (truncated)
  const docExcerpts: string[] = [];
  let used = 0;
  for (const d of docs) {
    if (d.status !== 'success' || !d.content) continue;
    const filename = d.url.split('/').pop() || d.url;
    const text = d.content.slice(0, DOC_SLICE);
    if (used + text.length > DOC_TOTAL) break;
    docExcerpts.push(`\n--- ${filename} ---\n${text}`);
    used += text.length;
  }
  const docsBlock = docExcerpts.join('\n') || '(no documents available in cache for this project)';

  const parseArr = (raw: string | undefined): string[] => {
    if (!raw) return [];
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
    catch { return []; }
  };
  const fmtArr = (arr: string[]): string => (arr.length ? arr.join(', ') : 'Not identified');

  const goalsBlock = goals
    ? [
        `- Summary: ${goals.summary_one_line || 'Not identified'}`,
        `- Tech tags (canonical): ${fmtArr(parseArr(goals.tech_tags))}`,
        `- Vendors (canonical): ${fmtArr(parseArr(goals.vendors))}`,
        `- Data classifications: ${fmtArr(parseArr(goals.data_classifications))}`,
        `- DDS entities touched: ${fmtArr(parseArr(goals.dds_entities_touched))}`,
        `- GIO services touched: ${fmtArr(parseArr(goals.gio_services_touched))}`,
        `- Mentions other projects: ${fmtArr(parseArr(goals.mentioned_projects))}`,
        `- Digital Technologies: ${goals.digital_technologies || 'Not identified'}`,
        `- Regional Impacts: ${goals.regional_impacts || 'Not identified'}`,
        `- GIO/SL/DDS Impacts: ${goals.gio_sl_dds_impacts || 'Not identified'}`,
        `- DDS/GIO Workload: ${goals.dds_gio_workload || 'Not identified'}`,
        `- Business Apps & CIs: ${goals.business_apps_cis || 'Not identified'}`,
        `- Security Impacts: ${goals.security_impacts || 'Not identified'}`,
        `- Change Management: ${goals.change_management || 'Not identified'}`,
        `- AI Embedded: ${goals.ia_embedded || 'Not identified'}`,
        `- Region: ${goals.region || 'Not identified'}`,
      ].join('\n')
    : '(no Goals analysis on record)';

  return `You are a senior IT portfolio analyst at Air Liquide CIOO.

Your task: explain in detail WHY the project below has an impact on the ${kindLabel} (${kindHelper}). Produce a defensible, evidence-backed analysis that an executive could review before approving the next gate.

PROJECT
- ID: ${project.project_id}
- Name: ${project.name}
- Owning DDS: ${project.dds || 'unspecified'}
- Current gate: ${project.gate || 'unspecified'} (${project.decision || 'no decision'})
- Cost: ${project.cost_keur !== null ? `${project.cost_keur} k€` : 'unspecified'}
- Last review: ${project.review_date || 'unspecified'}
- Description (CIOO sheet): ${project.description || '(empty)'}
- Remarks (CIOO sheet): ${project.remarks || '(empty)'}
- QA notes: ${project.qa || '(empty)'}

GOALS-EXTRACTOR FIELDS (raw text the system ingested from project docs)
${goalsBlock}

PRIMARY DOCUMENT EXCERPTS (truncated to ~${DOC_TOTAL} chars total)
${docsBlock}

EXISTING ONE-LINER ALREADY ON RECORD (do not just rephrase — expand)
${existingExplanation || '(none)'}

OUTPUT REQUIREMENTS
- Markdown only. No code fences, no JSON.
- 5–7 short paragraphs maximum.
- Use exactly these section headers (## level):
  ## Why this impact exists
  ## Concrete touchpoints
  ## Estimated workload
  ## Risks and dependencies
  ## Origin of the inference
- In "Concrete touchpoints", use a bulleted list of specific things this project does that touch ${target}.
- In "Estimated workload", give FTE or man-days if mentioned, else say "Not documented".
- In "Origin of the inference", name the Goals fields and/or document filenames that support each claim.
- Quote short verbatim phrases from the source documents when relevant — wrap them in double quotes.
- If a claim is unsupported by the inputs, say "not documented" instead of inventing.
- Do not repeat the project name in every paragraph; refer to it as "the project" after the first mention.`;
}

// ─── Main entry: get-or-generate a deep dive ─────────────────────────────────

export async function getOrGenerateDeepDive(args: {
  projectId: string;
  kind: DeepDiveKind;
  target: string;
}): Promise<DeepDiveResult> {
  const { projectId, kind, target } = args;
  const db = getDb();

  // Load project + goals + docs in parallel-friendly fashion (sync queries).
  const project = db.prepare(`
    SELECT project_id, name, dds, gate, decision, cost_keur, description, remarks, qa,
           review_date, link_folder, link_positions, link_cioo
    FROM projects
    WHERE project_id = ?
    ORDER BY review_date DESC, id DESC
    LIMIT 1
  `).get(projectId) as ProjectRow | undefined;

  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const goals = db.prepare(`
    SELECT summary_one_line,
           digital_technologies, change_management, security_impacts, regional_impacts,
           ia_embedded, gio_sl_dds_impacts, dds_gio_workload, business_apps_cis,
           dds_entities_touched, gio_services_touched,
           tech_tags, vendors, data_classifications, mentioned_projects,
           region, source_files, analyzed_at
    FROM project_goals
    WHERE project_id = ?
    ORDER BY analyzed_at DESC
    LIMIT 1
  `).get(projectId) as GoalsRow | undefined;

  // Cache lookup
  const sig = computeSourceSig(goals);
  const cached = readCache(projectId, kind, target, sig);
  if (cached) {
    return {
      projectId: cached.project_id,
      kind: cached.kind as DeepDiveKind,
      target: cached.target,
      responseMd: cached.response_md,
      llmProvider: cached.llm_provider,
      llmModel: cached.llm_model,
      generatedAt: cached.generated_at,
      durationMs: cached.duration_ms,
      cached: true,
    };
  }

  // Cache miss — gather context, build prompt, call LLM.
  const docs = getProjectDocuments(projectId);
  const aggregated = aggregateImpacts(getProjectImpacts(projectId));
  const matchingImpact = aggregated.find(imp => {
    if (kind === 'gio') {
      const isGio = imp.targetProjectId === 'GIO_SERVICES' || imp.sourceProjectId === 'GIO_SERVICES';
      return isGio && imp.gioServices?.includes(target);
    }
    const isDds = imp.targetProjectId === 'DDS_IMPACTS' || imp.sourceProjectId === 'DDS_IMPACTS';
    return isDds && imp.ddsEntities?.includes(target);
  });

  const existingExplanation = matchingImpact
    ? (matchingImpact.explanations?.join(' / ') || matchingImpact.explanation || '')
    : '';

  const prompt = buildPrompt({ kind, target, project, goals, docs, existingExplanation });

  const startedAt = Date.now();
  const { text, provider, modelUsed } = await generateContent({
    prompt,
    model: 'pro',
    context: 'deep-dive',
  });
  const durationMs = Date.now() - startedAt;

  const cleaned = stripCodeFences(text).trim();

  writeCache({
    projectId, kind, target,
    responseMd: cleaned,
    llmProvider: provider,
    llmModel: modelUsed,
    sourceSig: sig,
    durationMs,
  });

  return {
    projectId, kind, target,
    responseMd: cleaned,
    llmProvider: provider,
    llmModel: modelUsed,
    generatedAt: new Date().toISOString(),
    durationMs,
    cached: false,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripCodeFences(text: string): string {
  return text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '');
}

// ─── Convenience: list cached deep dives for a project (introspection) ───────

export function listDeepDivesForProject(projectId: string): DeepDiveResult[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT project_id, kind, target, response_md, llm_provider, llm_model,
           generated_at, source_sig, duration_ms
    FROM impact_deep_dives
    WHERE project_id = ?
    ORDER BY generated_at DESC
  `).all(projectId) as DeepDiveRow[];

  return rows.map(r => ({
    projectId: r.project_id,
    kind: r.kind as DeepDiveKind,
    target: r.target,
    responseMd: r.response_md,
    llmProvider: r.llm_provider,
    llmModel: r.llm_model,
    generatedAt: r.generated_at,
    durationMs: r.duration_ms,
    cached: true,
  }));
}
