import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from './db';
import { scanProjects, type ScannedProject } from './goals-scanner';
import { extractAllTexts } from './goals-extractor';
import { getPrompts } from './prompts';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProjectGoals {
  id: number;
  project_id: string;
  project_name: string;
  region: string;
  gate: string;
  month_folder: string;
  digital_technologies: string;
  change_management: string;
  security_impacts: string;
  regional_impacts: string;
  ia_embedded: string;
  gio_sl_dds_impacts: string;
  dds_gio_workload: string;
  business_apps_cis: string;
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
}

// ─── Gemini ─────────────────────────────────────────────────────────────────

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env.local');
  return new GoogleGenerativeAI(apiKey);
}

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

  // Skip already successful projects
  const existing = db.prepare(
    "SELECT status FROM project_goals WHERE project_id = ? AND status = 'success'"
  ).get(project.projectId) as { status: string } | undefined;
  if (existing) {
    runStatus.successCount++;
    return;
  }

  runStatus.currentProject = `${project.projectId}: ${project.projectName.slice(0, 40)}`;

  // Extract text from all project files
  const documentText = await extractAllTexts(project.files);

  if (!documentText.trim()) {
    const upsert = db.prepare(`
      INSERT INTO project_goals (project_id, project_name, region, gate, month_folder, source_files, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, 'error', 'No text could be extracted from files')
      ON CONFLICT(project_id) DO UPDATE SET
        project_name=excluded.project_name, region=excluded.region, gate=excluded.gate,
        month_folder=excluded.month_folder, source_files=excluded.source_files,
        status='error', error_message='No text could be extracted from files',
        analyzed_at=datetime('now')
    `);
    upsert.run(
      project.projectId, project.projectName, project.region, project.gate,
      project.monthFolders.join(', '), JSON.stringify(project.files)
    );
    runStatus.errorCount++;
    return;
  }

  // Call Gemini
  const prompt = buildGoalsPrompt(project, documentText);
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  const parsed = parseGoalsResponse(responseText);

  const fields = [
    'digital_technologies', 'change_management', 'security_impacts',
    'regional_impacts', 'ia_embedded', 'gio_sl_dds_impacts',
    'dds_gio_workload', 'business_apps_cis'
  ];

  const hasData = fields.some(f => parsed[f] && parsed[f] !== 'Not identified in available documentation');

  const upsert = db.prepare(`
    INSERT INTO project_goals (
      project_id, project_name, region, gate, month_folder,
      digital_technologies, change_management, security_impacts,
      regional_impacts, ia_embedded, gio_sl_dds_impacts,
      dds_gio_workload, business_apps_cis,
      raw_gemini_response, source_files, status, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
    ON CONFLICT(project_id) DO UPDATE SET
      project_name=excluded.project_name, region=excluded.region, gate=excluded.gate,
      month_folder=excluded.month_folder,
      digital_technologies=excluded.digital_technologies,
      change_management=excluded.change_management,
      security_impacts=excluded.security_impacts,
      regional_impacts=excluded.regional_impacts,
      ia_embedded=excluded.ia_embedded,
      gio_sl_dds_impacts=excluded.gio_sl_dds_impacts,
      dds_gio_workload=excluded.dds_gio_workload,
      business_apps_cis=excluded.business_apps_cis,
      raw_gemini_response=excluded.raw_gemini_response,
      source_files=excluded.source_files,
      status=excluded.status,
      analyzed_at=datetime('now'),
      error_message=''
  `);

  upsert.run(
    project.projectId, project.projectName, project.region, project.gate,
    project.monthFolders.join(', '),
    parsed.digital_technologies || '',
    parsed.change_management || '',
    parsed.security_impacts || '',
    parsed.regional_impacts || '',
    parsed.ia_embedded || '',
    parsed.gio_sl_dds_impacts || '',
    parsed.dds_gio_workload || '',
    parsed.business_apps_cis || '',
    responseText,
    JSON.stringify(project.files),
    hasData ? 'success' : 'partial'
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

    // Force re-analysis by deleting existing success status temporarily
    const db = getDb();
    db.prepare("UPDATE project_goals SET status = 'pending' WHERE project_id = ?").run(projectId);

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
    'Digital Technologies', 'Change Management', 'Security Impacts',
    'Regional Impacts', 'AI Embedded', 'GIO SL / DDS Impacts',
    'DDS / GIO Workload', 'Business Apps & CIs', 'Status'
  ];

  const escape = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;

  const rows = goals.map(g => [
    g.project_id, g.project_name, g.region, g.gate, g.month_folder,
    g.digital_technologies, g.change_management, g.security_impacts,
    g.regional_impacts, g.ia_embedded, g.gio_sl_dds_impacts,
    g.dds_gio_workload, g.business_apps_cis, g.status
  ].map(escape).join(','));

  return [headers.map(escape).join(','), ...rows].join('\n');
}

export function resetGoalsData(): void {
  if (runStatus.isRunning) {
    throw new Error('Cannot reset while analysis is running');
  }

  const db = getDb();
  db.exec(`
    UPDATE project_goals 
    SET digital_technologies = '',
        change_management = '',
        security_impacts = '',
        regional_impacts = '',
        ia_embedded = '',
        gio_sl_dds_impacts = '',
        dds_gio_workload = '',
        business_apps_cis = '',
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
