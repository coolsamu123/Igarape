import { getDb } from '@/lib/db';
import { getDriveStatus, getDownloadedFilesByProject } from '@/lib/drive-engine';
import { getGoalsStatus } from '@/lib/goals-analyzer';
import { getImpactStatus } from '@/lib/impact-engine';
import {
  listWatchRoots,
  getLastAutoRun,
  isAutoCycleRunning,
  getAutoCycleStage,
} from '@/lib/auto-pipeline';
import { getEffectiveSchedules } from '@/lib/scheduler';
import { getTodayLLMStats } from '@/lib/llm';

export interface DrivePanelState {
  pipeline: {
    isRunning: boolean;
    stage: string;
    root: string;
    drive: ReturnType<typeof getDriveStatus>;
    goals: ReturnType<typeof getGoalsStatus>;
    impact: ReturnType<typeof getImpactStatus>;
  };
  counts: {
    totalProjects: number;
    withFiles: number;
    withGoals: number;
    withImpacts: number;
  };
  todayLLM: ReturnType<typeof getTodayLLMStats>;
  schedule: ReturnType<typeof getEffectiveSchedules>;
  watchRoots: ReturnType<typeof listWatchRoots>;
  lastRun: ReturnType<typeof getLastAutoRun>;
  recentRuns: Array<{
    id: number;
    startedAt: string;
    finishedAt: string | null;
    trigger: string;
    status: string;
    newProjects: number;
    goalsAdded: number;
    impactsAdded: number;
    errorCount: number;
  }>;
  generatedAt: string;
}

export function buildDrivePanelState(): DrivePanelState {
  const db = getDb();

  const distinctProjectIds = db.prepare(
    'SELECT DISTINCT project_id FROM projects'
  ).all() as { project_id: string }[];
  const totalProjects = distinctProjectIds.length;

  const filesByProject = getDownloadedFilesByProject();
  let withFiles = 0;
  for (const { project_id } of distinctProjectIds) {
    if ((filesByProject.get(project_id) || 0) > 0) withFiles++;
  }

  let withGoals = 0;
  try {
    const r = db.prepare(
      "SELECT COUNT(DISTINCT project_id) c FROM project_goals WHERE status = 'success'"
    ).get() as { c: number };
    withGoals = r.c;
  } catch { /* table may not exist yet */ }

  const impactRow = db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT source_project_id AS pid FROM projects_impact
      UNION
      SELECT target_project_id AS pid FROM projects_impact
    )
  `).get() as { c: number };
  const withImpacts = impactRow?.c || 0;

  const { stage, rootLabel } = getAutoCycleStage();
  const drive = getDriveStatus();
  const goals = getGoalsStatus();
  const impact = getImpactStatus();
  const isRunning = isAutoCycleRunning() || drive.isRunning || goals.isRunning || impact.isRunning;

  const recentRunsRaw = db.prepare(`
    SELECT id, started_at, finished_at, trigger, status, new_projects, goals_added, impacts_added, errors_json
    FROM auto_runs
    ORDER BY id DESC
    LIMIT 10
  `).all() as Array<{
    id: number; started_at: string; finished_at: string | null; trigger: string;
    status: string; new_projects: number; goals_added: number; impacts_added: number; errors_json: string;
  }>;

  return {
    pipeline: {
      isRunning,
      stage,
      root: rootLabel,
      drive,
      goals,
      impact,
    },
    counts: { totalProjects, withFiles, withGoals, withImpacts },
    todayLLM: getTodayLLMStats(),
    schedule: getEffectiveSchedules(),
    watchRoots: listWatchRoots(),
    lastRun: getLastAutoRun(),
    recentRuns: recentRunsRaw.map(r => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      trigger: r.trigger,
      status: r.status,
      newProjects: r.new_projects,
      goalsAdded: r.goals_added,
      impactsAdded: r.impacts_added,
      errorCount: (() => { try { return JSON.parse(r.errors_json).length; } catch { return 0; } })(),
    })),
    generatedAt: new Date().toISOString(),
  };
}
