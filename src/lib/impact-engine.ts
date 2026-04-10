import { GoogleGenerativeAI } from '@google/generative-ai';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import { extractTags } from './similarity';
import { getProjectDocuments } from './drive-engine';
import { getPrompts } from './prompts';
import type { ProjectSummary, ProjectImpact, ImpactAnalysisStatus } from './types';

// ─── Module-level state for tracking analysis progress ───────────────────────

let analysisStatus: ImpactAnalysisStatus = {
  isRunning: false,
  totalProjects: 0,
  totalBatches: 0,
  completedBatches: 0,
  totalImpacts: 0,
  currentBatchDDS: '',
  errors: [],
};

// ─── Gemini client ───────────────────────────────────────────────────────────

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env.local');
  return new GoogleGenerativeAI(apiKey);
}

// ─── Fetch all project summaries from DB ─────────────────────────────────────

function fetchAllProjectSummaries(): ProjectSummary[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT 
      g.id as goal_id, g.project_id, g.project_name, g.region, g.gate as goal_gate, 
      g.month_folder, g.digital_technologies, g.change_management, g.security_impacts, 
      g.regional_impacts, g.ia_embedded, g.gio_sl_dds_impacts, g.dds_gio_workload, 
      g.business_apps_cis, g.raw_gemini_response, g.source_files, g.analyzed_at, 
      g.status as goal_status, g.error_message,
      p.dds, p.decision, p.cost_keur, p.description, p.remarks, 
      p.review_date, p.link_positions, p.link_folder, p.link_cioo
    FROM project_goals g
    LEFT JOIN projects p ON g.project_id = p.project_id
    WHERE g.project_id != '' AND g.status = 'success'
    ORDER BY g.project_id, p.review_date DESC
  `).all() as Record<string, unknown>[];

  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = row.project_id as string;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const summaries: ProjectSummary[] = [];
  for (const [projectId, entries] of Array.from(grouped.entries())) {
    const latest = entries[0];
    const allDescriptions = entries.map(e => e.description as string).filter(Boolean);
    const allRemarks = entries.map(e => e.remarks as string).filter(Boolean);
    const bestDescription = allDescriptions[0] || '';
    const bestRemarks = allRemarks[0] || '';

    summaries.push({
      projectId,
      name: (latest.project_name as string) || '',
      dds: latest.dds as string,
      currentGate: (latest.goal_gate as string) || '',
      latestDecision: latest.decision as string,
      costKEur: latest.cost_keur as number | null,
      description: bestDescription,
      remarks: bestRemarks,
      reviewCount: entries.length,
      lastReviewDate: latest.review_date as string,
      linkPositions: (entries.find(e => e.link_positions) || latest).link_positions as string || '',
      linkFolder: (entries.find(e => e.link_folder) || latest).link_folder as string || '',
      linkCIOO: (entries.find(e => e.link_cioo) || latest).link_cioo as string || '',
      tags: extractTags({
        name: latest.project_name as string || '',
        description: bestDescription,
        remarks: bestRemarks,
      }),
      history: [],
      
      // Map new goal fields
      region: latest.region as string,
      monthFolder: latest.month_folder as string,
      digitalTechnologies: latest.digital_technologies as string,
      changeManagement: latest.change_management as string,
      securityImpacts: latest.security_impacts as string,
      regionalImpacts: latest.regional_impacts as string,
      iaEmbedded: latest.ia_embedded as string,
      gioSlDdsImpacts: latest.gio_sl_dds_impacts as string,
      ddsGioWorkload: latest.dds_gio_workload as string,
      businessAppsCis: latest.business_apps_cis as string,
      rawGeminiResponse: latest.raw_gemini_response as string,
      sourceFiles: latest.source_files as string,
      analyzedAt: latest.analyzed_at as string,
      goalStatus: latest.goal_status as string,
      errorMessage: latest.error_message as string,
    });
  }

  return summaries;
}

// ─── Build batches: group by DDS, then overflow ──────────────────────────────

interface Batch {
  label: string;
  projects: ProjectSummary[];
}

function buildBatches(projects: ProjectSummary[], batchSize: number = 22): Batch[] {
  // Group by DDS
  const byDDS = new Map<string, ProjectSummary[]>();
  for (const p of projects) {
    const dds = p.dds || '(unknown)';
    if (!byDDS.has(dds)) byDDS.set(dds, []);
    byDDS.get(dds)!.push(p);
  }

  const batches: Batch[] = [];

  for (const [dds, ddsProjects] of Array.from(byDDS.entries())) {
    // Split into batches of batchSize
    for (let i = 0; i < ddsProjects.length; i += batchSize) {
      const chunk = ddsProjects.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalChunks = Math.ceil(ddsProjects.length / batchSize);
      const label = totalChunks > 1 ? `${dds} (${batchNum}/${totalChunks})` : dds;
      batches.push({ label, projects: chunk });
    }
  }

  return batches;
}

// ─── Build cross-DDS batches ─────────────────────────────────────────────────

function buildCrossDDSBatches(projects: ProjectSummary[], topN: number = 6): Batch[] {
  const byDDS = new Map<string, ProjectSummary[]>();
  for (const p of projects) {
    const dds = p.dds || '(unknown)';
    if (!byDDS.has(dds)) byDDS.set(dds, []);
    byDDS.get(dds)!.push(p);
  }

  // Get top projects from each DDS (sorted by cost descending)
  const topByDDS: ProjectSummary[] = [];
  for (const [, ddsProjects] of Array.from(byDDS.entries())) {
    const sorted = [...ddsProjects].sort((a, b) => (b.costKEur || 0) - (a.costKEur || 0));
    topByDDS.push(...sorted.slice(0, topN));
  }

  // Build cross-DDS batches of ~22
  const batches: Batch[] = [];
  for (let i = 0; i < topByDDS.length; i += 22) {
    const chunk = topByDDS.slice(i, i + 22);
    const batchNum = Math.floor(i / 22) + 1;
    batches.push({ label: `Cross-DDS batch ${batchNum}`, projects: chunk });
  }

  return batches;
}

// ─── Build prompt for a batch ────────────────────────────────────────────────

function buildImpactPrompt(projects: ProjectSummary[]): string {
  const projectList = projects.map(p => {
    const cost = p.costKEur ? `${p.costKEur}k€` : 'N/A';
    let entry = `- ${p.projectId}: "${p.name}" (DDS: ${p.dds || 'N/A'}, Gate: ${p.currentGate || 'N/A'}, Cost: ${cost})`;
    if (p.description) entry += `\n  Description: ${p.description}`;
    if (p.remarks) entry += `\n  Remarks: ${p.remarks}`;
    if (p.digitalTechnologies) entry += `\n  Digital Technologies: ${p.digitalTechnologies}`;
    if (p.changeManagement) entry += `\n  Change Management: ${p.changeManagement}`;
    if (p.securityImpacts) entry += `\n  Security Impacts: ${p.securityImpacts}`;
    if (p.regionalImpacts) entry += `\n  Regional Impacts: ${p.regionalImpacts}`;
    if (p.iaEmbedded) entry += `\n  IA Embedded: ${p.iaEmbedded}`;
    if (p.gioSlDdsImpacts) entry += `\n  GIO Impacts: ${p.gioSlDdsImpacts}`;
    if (p.ddsGioWorkload) entry += `\n  GIO Workload: ${p.ddsGioWorkload}`;
    if (p.businessAppsCis) entry += `\n  Business Apps/CIs: ${p.businessAppsCis}`;

    // Include downloaded document content if available
    try {
      const docs = getProjectDocuments(p.projectId);
      const docTexts = docs
        .filter(d => d.status === 'success' && d.content)
        .map(d => d.content.slice(0, 2000))
        .join('\n---\n');
      if (docTexts) {
        entry += `\n  Documents:\n${docTexts.slice(0, 4000)}`;
      }
    } catch {
      // No docs available — that's fine
    }

    return entry;
  }).join('\n\n');

  // Cap project list to avoid exceeding token limits
  const cappedList = projectList.slice(0, 60000);

  const { impactPrompt } = getPrompts();
  return impactPrompt.replace('{{PROJECTS_LIST}}', cappedList);
}

// ─── Parse Gemini response robustly ──────────────────────────────────────────

interface RawImpact {
  source: string;
  target: string;
  impact_type: string;
  direction: string;
  severity: string;
  explanation: string;
  gio_services?: string[];
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
    return parsed.map((item: Record<string, unknown>) => ({
      source: (item.source || item.source_project_id || item.sourceProjectId || '') as string,
      target: (item.target || item.target_project_id || item.targetProjectId || '') as string,
      impact_type: (item.impact_type || item.impactType || item.type || 'technology_dependency') as string,
      direction: (item.direction || item.relationship || 'requires_coordination') as string,
      severity: (item.severity || item.level || 'medium') as string,
      explanation: (item.explanation || item.reason || item.description || '') as string,
      gio_services: Array.isArray(item.gio_services) ? item.gio_services as string[] : [],
    })).filter(item => item.source && item.target) as RawImpact[];
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
    (source_project_id, target_project_id, impact_type, direction, severity, explanation, batch_id, gio_services)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  const insertMany = db.transaction((items: RawImpact[]) => {
    for (const item of items) {
      const result = stmt.run(
        item.source,
        item.target,
        item.impact_type,
        item.direction,
        item.severity,
        item.explanation || '',
        batchId,
        JSON.stringify(item.gio_services || [])
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

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

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
    const projects = fetchAllProjectSummaries();
    analysisStatus.totalProjects = projects.length;

    // Build intra-DDS batches
    const ddsBatches = buildBatches(projects, 22);
    // Build cross-DDS batches
    const crossBatches = buildCrossDDSBatches(projects, 6);

    const allBatches = [...ddsBatches, ...crossBatches];
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
}

function mapImpactRow(row: ImpactDbRow): ProjectImpact {
  let parsedGio: string[] = [];
  try {
    parsedGio = row.gio_services ? JSON.parse(row.gio_services) : [];
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
  };
}
