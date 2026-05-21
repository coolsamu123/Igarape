import { getDb } from './db';
import { scanProjects, type ScannedProject } from './goals-scanner';
import { extractAllTexts } from './goals-extractor';
import { getPrompts } from './prompts';
import { generateContent } from './llm';
import {
  filterToCatalog,
  filterToDdsEntities,
  filterToGioServices,
  extractMentionedProjects,
} from './tech-catalog';

// Bump this when the prompt schema changes in a way that requires
// re-analysing existing successful rows. The pipeline skip-logic compares
// against project_goals.prompt_version.
export const GOALS_PROMPT_VERSION = 2;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProjectGoals {
  id: number;
  project_id: string;
  project_name: string;
  region: string;
  gate: string;
  month_folder: string;
  // Free-form
  summary_one_line: string;
  digital_technologies: string;
  change_management: string;
  security_impacts: string;
  regional_impacts: string;
  ia_embedded: string;
  gio_sl_dds_impacts: string;
  dds_gio_workload: string;
  business_apps_cis: string;
  // Canonical arrays — stored as JSON strings in SQLite, parsed at the API edge
  dds_entities_touched: string;     // JSON array
  gio_services_touched: string;     // JSON array
  tech_tags: string;                // JSON array
  vendors: string;                  // JSON array
  data_classifications: string;     // JSON array
  mentioned_projects: string;       // JSON array (regex-extracted, not from LLM)
  prompt_version: number;
  raw_gemini_response: string;
  source_files: string;
  analyzed_at: string;
  status: string;
  error_message: string;
}

export interface GoalsRunStatus {
  isRunning: boolean;
  totalProjects: number;
  processedProjects: number;
  successCount: number;
  errorCount: number;
  currentProject: string;
  errors: string[];
}

let runStatus: GoalsRunStatus = {
  isRunning: false,
  totalProjects: 0,
  processedProjects: 0,
  successCount: 0,
  errorCount: 0,
  currentProject: '',
  errors: [],
};

// ─── DB Schema ──────────────────────────────────────────────────────────────

export function initGoalsSchema() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_goals (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id            TEXT NOT NULL,
      project_name          TEXT NOT NULL,
      region                TEXT DEFAULT '',
      gate                  TEXT DEFAULT '',
      month_folder          TEXT DEFAULT '',
      digital_technologies  TEXT DEFAULT '',
      change_management     TEXT DEFAULT '',
      security_impacts      TEXT DEFAULT '',
      regional_impacts      TEXT DEFAULT '',
      ia_embedded           TEXT DEFAULT '',
      gio_sl_dds_impacts    TEXT DEFAULT '',
      dds_gio_workload      TEXT DEFAULT '',
      business_apps_cis     TEXT DEFAULT '',
      raw_gemini_response   TEXT DEFAULT '',
      source_files          TEXT DEFAULT '[]',
      analyzed_at           TEXT DEFAULT NULL,
      status                TEXT DEFAULT 'pending',
      error_message         TEXT DEFAULT ''
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_project_id ON project_goals(project_id);
    CREATE INDEX IF NOT EXISTS idx_goals_region ON project_goals(region);
    CREATE INDEX IF NOT EXISTS idx_goals_status ON project_goals(status);
  `);

  // Idempotent migrations for the structured-fields rollout. SQLite ALTER TABLE
  // only supports ADD COLUMN — wrap in try/catch so re-runs are safe.
  const addIfMissing = (col: string, decl: string) => {
    try { db.exec(`ALTER TABLE project_goals ADD COLUMN ${col} ${decl}`); }
    catch { /* column already exists */ }
  };
  addIfMissing('summary_one_line',      "TEXT DEFAULT ''");
  addIfMissing('dds_entities_touched',  "TEXT DEFAULT '[]'");
  addIfMissing('gio_services_touched',  "TEXT DEFAULT '[]'");
  addIfMissing('tech_tags',             "TEXT DEFAULT '[]'");
  addIfMissing('vendors',               "TEXT DEFAULT '[]'");
  addIfMissing('data_classifications',  "TEXT DEFAULT '[]'");
  addIfMissing('mentioned_projects',    "TEXT DEFAULT '[]'");
  addIfMissing('prompt_version',        'INTEGER DEFAULT 0');

  // Searchable indexes for tag-based filtering (LIKE '%"aws"%' style queries).
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_goals_tech_tags ON project_goals(tech_tags);
    CREATE INDEX IF NOT EXISTS idx_goals_prompt_version ON project_goals(prompt_version);
  `);
}

// ─── Prompts ────────────────────────────────────────────────────────────────

function buildGoalsPrompt(project: ScannedProject, documentText: string): string {
  const { goalsPrompt } = getPrompts();
  
  const projectInfo = `PROJECT: ${project.projectName}
PROJECT ID: ${project.projectId}
REGION/DDS: ${project.region}
GATE: ${project.gate}
MONTHS REVIEWED: ${project.monthFolders.join(', ')}`;

  let prompt = goalsPrompt.replace('{{PROJECT_INFO}}', projectInfo);
  prompt = prompt.replace('{{DOCUMENT_TEXT}}', documentText);
  return prompt;
}

function parseGoalsResponse(text: string): Record<string, string> {
  try {
    let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
      clean = clean.slice(start, end + 1);
    }
    return JSON.parse(clean);
  } catch {
    return {};
  }
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

async function analyzeProject(project: ScannedProject): Promise<void> {
  const db = getDb();
  initGoalsSchema();

  // Skip conditions:
  //   1. Already succeeded at the CURRENT prompt version with the SAME source files → no work
  //   2. Last attempt failed/partial but source files unchanged → no point retrying
  // Both checks fail (i.e. we run) when:
  //   - the prompt was bumped (prompt_version is older / NULL)
  //   - new files were synced
  const existing = db.prepare(
    "SELECT status, source_files, prompt_version FROM project_goals WHERE project_id = ?"
  ).get(project.projectId) as
    { status: string; source_files: string; prompt_version: number | null } | undefined;

  const filesJson = JSON.stringify(project.files);
  const versionOk = (existing?.prompt_version ?? 0) >= GOALS_PROMPT_VERSION;

  if (existing?.status === 'success' && versionOk) {
    runStatus.successCount++;
    return;
  }
  if (existing && existing.source_files === filesJson && versionOk) {
    runStatus.successCount++;
    return;
  }

  runStatus.currentProject = `${project.projectId}: ${project.projectName.slice(0, 40)}`;

  const documentText = await extractAllTexts(project.files);

  if (!documentText.trim()) {
    const upsert = db.prepare(`
      INSERT INTO project_goals (project_id, project_name, region, gate, month_folder, source_files, status, error_message, prompt_version)
      VALUES (?, ?, ?, ?, ?, ?, 'error', 'No text could be extracted from files', ?)
      ON CONFLICT(project_id) DO UPDATE SET
        project_name=excluded.project_name, region=excluded.region, gate=excluded.gate,
        month_folder=excluded.month_folder, source_files=excluded.source_files,
        status='error', error_message='No text could be extracted from files',
        analyzed_at=datetime('now'), prompt_version=excluded.prompt_version
    `);
    upsert.run(
      project.projectId, project.projectName, project.region, project.gate,
      project.monthFolders.join(', '), filesJson, GOALS_PROMPT_VERSION,
    );
    runStatus.errorCount++;
    return;
  }

  // Call LLM
  const prompt = buildGoalsPrompt(project, documentText);
  const { text: responseText } = await generateContent({ prompt, model: 'pro', context: 'goals' });
  const parsed = parseGoalsResponse(responseText);

  // Sanitise canonical array fields against catalogs — drops anything the LLM
  // invented outside the allowed lists.
  const ddsEntitiesArr = filterToDdsEntities(parsed.dds_entities_touched);
  const gioServicesArr = filterToGioServices(parsed.gio_services_touched);
  const techTagsArr    = filterToCatalog(parsed.tech_tags, 'tech');
  const vendorsArr     = filterToCatalog(parsed.vendors, 'vendor');
  const dataClassArr   = filterToCatalog(parsed.data_classifications, 'data');

  // Deterministic extraction: scrape PRJ-codes from the document text AND from
  // every populated text field. Excludes self-references.
  const mentionedSources = [
    documentText,
    parsed.digital_technologies,
    parsed.change_management,
    parsed.gio_sl_dds_impacts,
    parsed.dds_gio_workload,
    parsed.business_apps_cis,
    parsed.regional_impacts,
    parsed.security_impacts,
  ].filter(Boolean).join('\n');
  const mentionedProjectsArr = extractMentionedProjects(mentionedSources, project.projectId);

  const txt = (k: string): string => (typeof parsed[k] === 'string' ? parsed[k] : '');
  const summaryOneLine = txt('summary_one_line').slice(0, 250);

  const freeFormFields = [
    'digital_technologies', 'change_management', 'security_impacts',
    'regional_impacts', 'ia_embedded', 'gio_sl_dds_impacts',
    'dds_gio_workload', 'business_apps_cis',
  ];
  const hasData =
    !!summaryOneLine ||
    freeFormFields.some(f => parsed[f] && parsed[f] !== 'Not identified in available documentation') ||
    ddsEntitiesArr.length > 0 || gioServicesArr.length > 0 ||
    techTagsArr.length > 0 || vendorsArr.length > 0 || dataClassArr.length > 0;

  const upsert = db.prepare(`
    INSERT INTO project_goals (
      project_id, project_name, region, gate, month_folder,
      summary_one_line,
      digital_technologies, change_management, security_impacts,
      regional_impacts, ia_embedded, gio_sl_dds_impacts,
      dds_gio_workload, business_apps_cis,
      dds_entities_touched, gio_services_touched,
      tech_tags, vendors, data_classifications, mentioned_projects,
      prompt_version,
      raw_gemini_response, source_files, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
    ON CONFLICT(project_id) DO UPDATE SET
      project_name=excluded.project_name, region=excluded.region, gate=excluded.gate,
      month_folder=excluded.month_folder,
      summary_one_line=excluded.summary_one_line,
      digital_technologies=excluded.digital_technologies,
      change_management=excluded.change_management,
      security_impacts=excluded.security_impacts,
      regional_impacts=excluded.regional_impacts,
      ia_embedded=excluded.ia_embedded,
      gio_sl_dds_impacts=excluded.gio_sl_dds_impacts,
      dds_gio_workload=excluded.dds_gio_workload,
      business_apps_cis=excluded.business_apps_cis,
      dds_entities_touched=excluded.dds_entities_touched,
      gio_services_touched=excluded.gio_services_touched,
      tech_tags=excluded.tech_tags,
      vendors=excluded.vendors,
      data_classifications=excluded.data_classifications,
      mentioned_projects=excluded.mentioned_projects,
      prompt_version=excluded.prompt_version,
      raw_gemini_response=excluded.raw_gemini_response,
      source_files=excluded.source_files,
      status=excluded.status,
      analyzed_at=datetime('now'),
      error_message=''
  `);

  upsert.run(
    project.projectId, project.projectName, project.region, project.gate,
    project.monthFolders.join(', '),
    summaryOneLine,
    txt('digital_technologies'),
    txt('change_management'),
    txt('security_impacts'),
    txt('regional_impacts'),
    txt('ia_embedded'),
    txt('gio_sl_dds_impacts'),
    txt('dds_gio_workload'),
    txt('business_apps_cis'),
    JSON.stringify(ddsEntitiesArr),
    JSON.stringify(gioServicesArr),
    JSON.stringify(techTagsArr),
    JSON.stringify(vendorsArr),
    JSON.stringify(dataClassArr),
    JSON.stringify(mentionedProjectsArr),
    GOALS_PROMPT_VERSION,
    responseText,
    filesJson,
    hasData ? 'success' : 'partial',
  );

  runStatus.successCount++;
}



export async function runSingleGoalAnalysis(projectId: string): Promise<void> {
  if (runStatus.isRunning) {
    throw new Error('Goals analysis is already running');
  }

  runStatus = {
    isRunning: true,
    totalProjects: 1,
    processedProjects: 0,
    successCount: 0,
    errorCount: 0,
    currentProject: 'Scanning project...',
    errors: [],
  };

  try {
    initGoalsSchema();
    const projects = scanProjects();
    const project = projects.find(p => p.projectId === projectId);
    
    if (!project) {
      throw new Error(`No local files found in data/drive for project ${projectId}`);
    }

    // Force re-analysis by resetting both status and prompt_version so the
    // skip-on-current-version guard in analyzeProject doesn't bail out.
    const db = getDb();
    db.prepare("UPDATE project_goals SET status = 'pending', prompt_version = 0 WHERE project_id = ?").run(projectId);

    await analyzeProject(project);
    runStatus.processedProjects++;
    runStatus.currentProject = 'Complete';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runStatus.errors.push(`Fatal: ${msg}`);
  } finally {
    runStatus.isRunning = false;
  }
}

export async function runGoalsAnalysis(): Promise<void> {
  if (runStatus.isRunning) {
    throw new Error('Goals analysis is already running');
  }

  runStatus = {
    isRunning: true,
    totalProjects: 0,
    processedProjects: 0,
    successCount: 0,
    errorCount: 0,
    currentProject: 'Scanning projects...',
    errors: [],
  };

  try {
    initGoalsSchema();
    const projects = scanProjects();
    runStatus.totalProjects = projects.length;

    for (const project of projects) {
      try {
        await analyzeProject(project);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        runStatus.errors.push(`${project.projectId}: ${msg}`);
        runStatus.errorCount++;

        // Save error state to DB
        const db = getDb();
        db.prepare(`
          INSERT INTO project_goals (project_id, project_name, region, gate, month_folder, source_files, status, error_message)
          VALUES (?, ?, ?, ?, ?, ?, 'error', ?)
          ON CONFLICT(project_id) DO UPDATE SET
            status='error', error_message=?, analyzed_at=datetime('now')
        `).run(
          project.projectId, project.projectName, project.region, project.gate,
          project.monthFolders.join(', '), JSON.stringify(project.files),
          msg, msg
        );
      }

      runStatus.processedProjects++;

      // Rate limit: 1.5s between Gemini calls
      await new Promise(resolve => setTimeout(resolve, 1500));
    }

    runStatus.currentProject = 'Complete';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    runStatus.errors.push(`Fatal: ${msg}`);
  } finally {
    runStatus.isRunning = false;
  }
}

export function getGoalsStatus(): GoalsRunStatus {
  return { ...runStatus };
}

export function getGoalsList(filters?: { region?: string; gate?: string; status?: string }): ProjectGoals[] {
  initGoalsSchema();
  const db = getDb();

  // Auto-sync discovered projects into the DB
  try {
    const scanned = scanProjects();
    const upsertStmt = db.prepare(`
      INSERT INTO project_goals (project_id, project_name, region, gate, source_files, status, analyzed_at)
      VALUES (?, ?, ?, ?, ?, 'pending', NULL)
      ON CONFLICT(project_id) DO UPDATE SET
        source_files = excluded.source_files
    `);
    for (const p of scanned) {
      upsertStmt.run(p.projectId, p.projectName, p.region, p.gate, JSON.stringify(p.files));
    }
  } catch (e) {
    console.error('Failed to sync projects into goals list:', e);
  }

  let sql = 'SELECT * FROM project_goals WHERE 1=1';
  const params: string[] = [];

  if (filters?.region) {
    sql += ' AND region = ?';
    params.push(filters.region);
  }
  if (filters?.gate) {
    sql += ' AND gate = ?';
    params.push(filters.gate);
  }
  if (filters?.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }

  sql += ' ORDER BY project_id';
  return db.prepare(sql).all(...params) as ProjectGoals[];
}

export function getGoalsExportCsv(): string {
  const goals = getGoalsList();
  const headers = [
    'Project ID', 'Project Name', 'Region', 'Gate', 'Month',
    'Summary',
    'Digital Technologies', 'Change Management', 'Security Impacts',
    'Regional Impacts', 'AI Embedded', 'GIO SL / DDS Impacts',
    'DDS / GIO Workload', 'Business Apps & CIs',
    'DDS Entities', 'GIO Services', 'Tech Tags', 'Vendors',
    'Data Classifications', 'Mentioned Projects',
    'Prompt Version', 'Status',
  ];

  const escape = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
  const fmtJson = (val: string) => {
    try { const arr = JSON.parse(val || '[]'); return Array.isArray(arr) ? arr.join('; ') : ''; }
    catch { return ''; }
  };

  const rows = goals.map(g => [
    g.project_id, g.project_name, g.region, g.gate, g.month_folder,
    g.summary_one_line || '',
    g.digital_technologies, g.change_management, g.security_impacts,
    g.regional_impacts, g.ia_embedded, g.gio_sl_dds_impacts,
    g.dds_gio_workload, g.business_apps_cis,
    fmtJson(g.dds_entities_touched),
    fmtJson(g.gio_services_touched),
    fmtJson(g.tech_tags),
    fmtJson(g.vendors),
    fmtJson(g.data_classifications),
    fmtJson(g.mentioned_projects),
    String(g.prompt_version ?? 0),
    g.status,
  ].map(v => escape(String(v))).join(','));

  return [headers.map(escape).join(','), ...rows].join('\n');
}

export function resetGoalsData(): void {
  if (runStatus.isRunning) {
    throw new Error('Cannot reset while analysis is running');
  }

  const db = getDb();
  db.exec(`
    UPDATE project_goals
    SET summary_one_line = '',
        digital_technologies = '',
        change_management = '',
        security_impacts = '',
        regional_impacts = '',
        ia_embedded = '',
        gio_sl_dds_impacts = '',
        dds_gio_workload = '',
        business_apps_cis = '',
        dds_entities_touched = '[]',
        gio_services_touched = '[]',
        tech_tags = '[]',
        vendors = '[]',
        data_classifications = '[]',
        mentioned_projects = '[]',
        prompt_version = 0,
        raw_gemini_response = '',
        analyzed_at = NULL,
        status = 'pending',
        error_message = ''
  `);

  runStatus = {
    isRunning: false,
    totalProjects: 0,
    processedProjects: 0,
    successCount: 0,
    errorCount: 0,
    currentProject: '',
    errors: [],
  };
}
