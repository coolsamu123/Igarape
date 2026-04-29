import cron, { type ScheduledTask } from 'node-cron';
import { runAutoDiscoveryCycle, isAutoCycleRunning, type CycleMode } from './auto-pipeline';
import { getSetting, setSetting, type SettingKey } from './settings';
import { getDb } from './db';

// Default: every 10 minutes. Discovery is cheap (folder list), and the heavy
// stages (download → goals → impact) are gated to skip when nothing's new.
const DEFAULT_CRON_FULL = '*/10 * * * *';
const SETTING_FULL: SettingKey = 'auto_cron_full';
const SETTING_GOALS: SettingKey = 'auto_cron_goals';

const tasks: ScheduledTask[] = [];

export interface EffectiveSchedules {
  full: { cron: string; source: 'db' | 'env' | 'default' };
  goalsOnly: { cron: string; source: 'db' | 'env' } | null;
  schedulerEnabled: boolean;
}

/**
 * Resolve which cron expressions are currently in effect.
 * Precedence (highest first):
 *   1. DB row in app_settings
 *   2. STROM_AUTO_CRON_FULL / STROM_AUTO_CRON_GOALS / STROM_AUTO_CRON env vars
 *   3. Default '*\/10 * * * *' for full mode (no default for goals-only)
 */
export function getEffectiveSchedules(): EffectiveSchedules {
  const enabled = process.env.STROM_AUTO_DISCOVERY !== '0';

  // Full
  const dbFull = getSetting(SETTING_FULL);
  let fullCron: string;
  let fullSource: 'db' | 'env' | 'default';
  if (dbFull) {
    fullCron = dbFull;
    fullSource = 'db';
  } else if (process.env.STROM_AUTO_CRON_FULL) {
    fullCron = process.env.STROM_AUTO_CRON_FULL;
    fullSource = 'env';
  } else if (process.env.STROM_AUTO_CRON) {
    fullCron = process.env.STROM_AUTO_CRON;
    fullSource = 'env';
  } else {
    fullCron = DEFAULT_CRON_FULL;
    fullSource = 'default';
  }

  // Goals-only is fully optional — no default. Only present if user sets it.
  const dbGoals = getSetting(SETTING_GOALS);
  let goalsOnly: EffectiveSchedules['goalsOnly'] = null;
  if (dbGoals) {
    goalsOnly = { cron: dbGoals, source: 'db' };
  } else if (process.env.STROM_AUTO_CRON_GOALS) {
    goalsOnly = { cron: process.env.STROM_AUTO_CRON_GOALS, source: 'env' };
  }

  return {
    full: { cron: fullCron, source: fullSource },
    goalsOnly,
    schedulerEnabled: enabled,
  };
}

function stopAllTasks() {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}

function startTasksFromEffective() {
  const eff = getEffectiveSchedules();

  if (!eff.schedulerEnabled) {
    console.log('[scheduler] STROM_AUTO_DISCOVERY=0 → auto-discovery scheduler disabled');
    return;
  }

  const entries: { expr: string; mode: CycleMode; label: string }[] = [];
  if (eff.goalsOnly) entries.push({ expr: eff.goalsOnly.cron, mode: 'goals-only', label: 'goals-only' });
  entries.push({ expr: eff.full.cron, mode: 'full', label: 'full' });

  for (const { expr, mode, label } of entries) {
    if (!cron.validate(expr)) {
      console.error(`[scheduler] invalid cron expression for ${label}: ${expr} — skipping`);
      continue;
    }
    const task = cron.schedule(expr, () => {
      if (isAutoCycleRunning()) {
        console.log(`[scheduler] ${label} tick skipped — a cycle is already running`);
        return;
      }
      console.log(`[scheduler] firing ${label} cycle at ${new Date().toISOString()}`);
      runAutoDiscoveryCycle('scheduled', mode)
        .then(report => {
          console.log(
            `[scheduler] ${label} done: status=${report.status} new=${report.newProjects.length} ` +
            `goals=${report.goalsAddedCount} impacts=${report.impactsAddedCount} ` +
            `errors=${report.errors.length}${report.capExceeded ? ' CAP_EXCEEDED' : ''}`
          );
        })
        .catch(err => {
          console.error(`[scheduler] ${label} cycle failed:`, err);
        });
    });
    tasks.push(task);
    console.log(`[scheduler] ${label}: cron="${expr}" (host TZ)`);
  }
}

let started = false;

/**
 * On boot, mark any auto_runs row left in 'running' as 'aborted'. These are
 * cycles that were killed by a server restart or HMR reload — without this,
 * they linger forever in the recent-cycles UI as "still running".
 */
function healOrphanedRuns() {
  try {
    const db = getDb();
    const result = db.prepare(`
      UPDATE auto_runs
      SET finished_at = COALESCE(finished_at, datetime('now')),
          status = 'aborted',
          errors_json = json_insert(
            COALESCE(NULLIF(errors_json, ''), '[]'),
            '$[#]',
            'Aborted: server restarted while cycle was in progress'
          )
      WHERE status = 'running'
    `).run();
    if (result.changes > 0) {
      console.log(`[scheduler] healed ${result.changes} orphaned running row(s) → aborted`);
    }
  } catch (err) {
    console.error('[scheduler] failed to heal orphaned running rows:', err);
  }
}

export function startSchedulerOnce() {
  if (started) return;
  started = true;
  healOrphanedRuns();
  startTasksFromEffective();
}

/**
 * Stop all running cron tasks and rebuild from current effective schedules.
 * Called when settings are saved via the UI so changes take effect immediately
 * without a server restart.
 */
export function restartScheduler(): EffectiveSchedules {
  stopAllTasks();
  startTasksFromEffective();
  return getEffectiveSchedules();
}

/**
 * Update the persisted full-pipeline cron expression. Pass null to clear and
 * fall back to env/default. Throws on invalid cron.
 */
export function updateFullCron(expr: string | null): EffectiveSchedules {
  if (expr !== null) {
    const trimmed = expr.trim();
    if (!trimmed) throw new Error('Cron expression cannot be empty (pass null to reset)');
    if (!cron.validate(trimmed)) throw new Error(`Invalid cron expression: ${trimmed}`);
    setSetting(SETTING_FULL, trimmed);
  } else {
    setSetting(SETTING_FULL, null);
  }
  return restartScheduler();
}

export function updateGoalsCron(expr: string | null): EffectiveSchedules {
  if (expr !== null) {
    const trimmed = expr.trim();
    if (!trimmed) throw new Error('Cron expression cannot be empty (pass null to reset)');
    if (!cron.validate(trimmed)) throw new Error(`Invalid cron expression: ${trimmed}`);
    setSetting(SETTING_GOALS, trimmed);
  } else {
    setSetting(SETTING_GOALS, null);
  }
  return restartScheduler();
}

export function stopScheduler() {
  stopAllTasks();
  started = false;
}
