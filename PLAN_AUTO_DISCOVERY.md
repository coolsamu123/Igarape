# Strom — Scheduled Auto-Discovery Plan

## Goal

Persist the Drive root folders used by **Discover New Project** and re-scan them automatically **3× per day**. When new `PRJ*` folders are detected, the system runs the full pipeline end-to-end without user intervention:

```
discover → INSERT/UPDATE projects
        → download files to data/drive/
        → Goals Extractor (LLM)
        → Impact analysis (LLM)
        → Timeline / Graph / Matrix views update
          (these read from projects + project_goals + projects_impact, no extra wiring)
```

The existing manual flow (paste a URL, click *Add & Download*) stays exactly as-is.

## Non-goals

- Watching arbitrary file changes inside already-known projects.
- Real-time push notifications from Drive (would require Drive Push notifications API + a public webhook).
- Cancelling an in-flight scheduled run from the UI (v1 just waits for it to finish).

## Current state (what already exists)

| Capability | Status | Where |
|---|---|---|
| Discover folders by name match (`PRJ*`) under a root | ✅ | `discoverAndAddProjectFromDrive()` in `src/lib/drive-engine.ts:465` |
| Download files for projects with a Drive `link_folder` | ✅ | `runDriveDownload()` in `src/lib/drive-engine.ts` |
| Goals Extractor over downloaded files | ✅ | `runGoalsAnalysis()` in `src/lib/goals-analyzer.ts` |
| Impact analysis | ✅ | `runFullImpactAnalysis()` in `src/lib/impact-engine.ts` |
| Skip-already-successful in Goals | ✅ | `WHERE status = 'success'` guard inside `analyzeProject()` |
| Persistence of watched roots | ❌ | not stored anywhere — input is one-shot |
| Scheduling | ❌ | nothing; everything is user-triggered |
| Pipeline orchestration | ❌ | each stage is a separate POST today |

The only **missing primitives** are: persisted root list, a scheduler, and a thin orchestrator that chains the stages together.

## Architecture

### 1. Persistence — `drive_watch_roots` table

New SQLite table (created in `db.ts:initSchema`):

```sql
CREATE TABLE IF NOT EXISTS drive_watch_roots (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  url             TEXT NOT NULL UNIQUE,    -- the Drive URL the user pastes
  drive_id        TEXT NOT NULL,           -- extracted folder/file ID
  label           TEXT DEFAULT '',         -- optional human label
  enabled         INTEGER NOT NULL DEFAULT 1,
  added_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_run_at     TEXT,                    -- ISO timestamp of last successful scan
  last_run_status TEXT,                    -- 'success' | 'error' | 'partial'
  last_run_error  TEXT DEFAULT '',
  added_count     INTEGER NOT NULL DEFAULT 0  -- cumulative new projects discovered
);
```

This is intentionally tiny: one row per Drive root the user wants watched.

### 2. Pipeline orchestrator — `src/lib/auto-pipeline.ts`

Single entry point: `runAutoDiscoveryCycle()`. Does the chain in sequence (each step has its own try/catch so a failure in stage N doesn't block stage N+1 from being retried on the next cycle):

```ts
export async function runAutoDiscoveryCycle(): Promise<CycleReport> {
  // 1. Read enabled rows from drive_watch_roots
  // 2. For each: discoverAndAddProjectFromDrive(url)
  //    → diff against the current `projects` table to compute "newly added projectIds"
  // 3. If any new IDs OR any project still missing local files → runDriveDownload()
  //    (the existing function already filters internally to projects with Drive links)
  // 4. runGoalsAnalysis()
  //    (existing skip-when-success behavior means it only processes new ones)
  // 5. runFullImpactAnalysis() — but ONLY when at least one new project_goals row
  //    landed in step 4, because Impact is the most expensive stage.
  // 6. Update drive_watch_roots.last_run_at / last_run_status / added_count
  // 7. Append a row to a lightweight `auto_runs` log (see below)
}
```

A second helper, `auto_runs`, captures one row per cycle for observability:

```sql
CREATE TABLE IF NOT EXISTS auto_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  trigger      TEXT NOT NULL,         -- 'scheduled' | 'manual'
  new_projects INTEGER DEFAULT 0,
  goals_added  INTEGER DEFAULT 0,
  impacts_added INTEGER DEFAULT 0,
  errors_json  TEXT DEFAULT '[]',
  status       TEXT NOT NULL          -- 'running' | 'success' | 'error'
);
```

### 3. Scheduler

**Recommendation: `node-cron` running inside the Next.js server process.**

| Option | Pros | Cons |
|---|---|---|
| `node-cron` inside Next process | Self-contained, no host setup, restart-safe via reboot script | Doesn't run if `next dev` is down |
| Host-level `cron` calling `curl -X POST /api/auto-discovery/run` | Survives Next restarts; standard ops pattern | One more place to configure; needs cron on the VM |
| External GitHub Action / Cloud Scheduler | Fully managed | Needs a public URL, auth, and infra not present yet |

For a single-instance internal app on a GCE VM, **node-cron** is the lightest. Add `cron` host fallback later if reliability matters. Schedule:

```
0 6,14,22 * * *   →  06:00, 14:00, 22:00 server time, 3× per day
```

The cron singleton is started **once** on Next.js boot:

```ts
// src/lib/scheduler.ts
let started = false;
export function startSchedulerOnce() {
  if (started) return;
  started = true;
  cron.schedule('0 6,14,22 * * *', () => {
    runAutoDiscoveryCycle().catch(err => console.error('[auto] cycle failed', err));
  });
}
```

Hooked from `src/app/layout.tsx` (server component) or, more cleanly, from a small `instrumentation.ts` at the repo root — Next.js calls it once at server start.

**Concurrency guard.** The orchestrator must never run two cycles in parallel. A module-level `isRunning` boolean is enough; if a second tick fires while one is still running, we skip and log.

### 4. API surface

Three new endpoints under `/api/auto-discovery`:

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/api/auto-discovery` | List `drive_watch_roots` rows + last `auto_runs` row |
| `POST` | `/api/auto-discovery` | Add a root: `{ url, label? }` → INSERT, returns the row |
| `DELETE` | `/api/auto-discovery?id=N` | Remove a root |
| `POST` | `/api/auto-discovery/run` | Trigger a cycle now (manual override of the schedule) |
| `POST` | `/api/auto-discovery/toggle` | Body: `{ id, enabled }` |

### 5. UI changes (DriveSync)

Add a new panel **above** the existing *Discover New Project* block titled **"Watched Drive Roots"**:

- Table of saved roots: label, URL, last run, status badge, added count, toggle, delete.
- Input + "Watch this root" button (saves to `drive_watch_roots`; immediately enqueues a one-shot cycle so the user sees results without waiting until 06:00).
- Read-only "Last cycle" line: *2026-04-28 14:00 — 3 new projects, 18 new goal analyses, 12 new impacts*.
- "Run now" button → `POST /api/auto-discovery/run`.

The *Discover New Project* panel stays untouched — it's still the right place to one-off scan a URL you don't want to watch permanently.

## Pipeline behavior in detail

### What counts as a "new project"?

A `project_id` returned by `discoverAndAddProjectFromDrive()` that **either**:
- Did not exist in `projects` before the discover call, **or**
- Existed but had `link_folder = ''` (so we never had a way to download its files).

We detect this by capturing the projectIds present in `projects` before the call and diffing afterward.

### Which stages run, when

| Trigger | Discover | Download | Goals | Impact |
|---|---|---|---|---|
| New project found | ✅ | ✅ | ✅ (only the new ones — already filtered by `status='success'` skip) | ✅ but **only if Goals added at least 1 row** |
| No new project, but some existing project still has 0 local files | ✅ | ✅ | ✅ | conditional |
| Nothing changed | ✅ (cheap, just metadata API calls) | skipped | skipped | skipped |

This avoids the worst-case scenario: paying for a full Impact LLM run every 8 hours when nothing has changed.

### Failure isolation

- A failed Discover on **one** root does not stop other roots from being scanned.
- A failed Download for **one** project does not stop downloads for other projects (existing behavior in `runDriveDownload`).
- A failed Goals analysis for **one** project does not stop the rest (existing behavior).
- A failed Impact run is logged and the cycle ends; next tick will retry.
- All errors are accumulated into `auto_runs.errors_json` for the cycle.

### Cost guardrails

- Each cycle should log: number of LLM calls made and the active provider (`gemini` vs `deepseek`).
- A soft daily cap (e.g. `STROM_AUTO_MAX_LLM_CALLS_PER_DAY=500`) read from env. Cycle aborts at the cap with status `partial`.
- Optional: run only **Goals** during off-hours (06:00 / 22:00) and run **Impact** only at 14:00, since Impact is the most expensive stage and benefits less from being fresh by the hour.

## Phasing

Each phase is shippable on its own; run end-to-end after each.

### Phase 1 — Persistence + Manual run (no scheduler yet)
- New tables `drive_watch_roots`, `auto_runs`.
- New endpoints (`GET`/`POST`/`DELETE`/`/run`/`/toggle`).
- New UI panel "Watched Drive Roots" with manual "Run now".
- Orchestrator `runAutoDiscoveryCycle()` chains the existing functions.

**Acceptance**: I can save a root URL, click "Run now", and see new projects flow into Projects DB → Project Goals → Impact, without touching any other tab.

### Phase 2 — Scheduling
- `node-cron` integration via `instrumentation.ts`.
- Concurrency guard, log to `auto_runs` with `trigger='scheduled'`.
- `STROM_AUTO_DISCOVERY=1` env flag to disable the scheduler (for dev convenience).

**Acceptance**: At 06:00 / 14:00 / 22:00 the cycle fires, `auto_runs` gets a new row, and the Watched Drive Roots panel reflects the latest run.

### Phase 3 — Cost guardrails + observability
- Daily LLM-call cap.
- Per-cycle stats panel in DriveSync.
- Optional: separate cron for Impact (`0 14 * * *`) vs Goals (`0 6,14,22 * * *`).

**Acceptance**: Adding 50 new projects in one cycle does not exceed the daily cap; partial runs are visible.

## Open questions

1. **Server timezone.** The VM is in UTC by default; Air Liquide users are in CET/CEST. Decide whether `0 6,14,22` means UTC or local. Recommendation: store the cron string in `.env.local` (`STROM_AUTO_CRON='0 6,14,22 * * *'`) and document that it follows the host TZ.
2. **Multi-watch overlap.** If two watched roots cover overlapping subtrees, `discoverAndAddProjectFromDrive` already does upsert-by-`project_id`, so duplicates are harmless — but the cycle log will show them as "added" once per root. Consider deduping at report time.
3. **Service account quotas.** Drive API has per-minute quotas. With 1000+ projects and 3× per day, downloads might hit limits. Existing `p-limit` usage in `drive-engine` already throttles, but verify the concurrency setting is conservative enough for a 3000+ daily file-fetch budget.
4. **Stale `link_folder`.** If a project folder is moved or deleted in Drive, the next download will fail silently for that project. Add a "last successful download" timestamp per project to surface this in the UI later.

## Files touched (preview)

| File | Change |
|---|---|
| `src/lib/db.ts` | New tables `drive_watch_roots`, `auto_runs` |
| `src/lib/auto-pipeline.ts` | **New** — `runAutoDiscoveryCycle()` |
| `src/lib/scheduler.ts` | **New** — `startSchedulerOnce()` |
| `instrumentation.ts` | **New** — calls `startSchedulerOnce()` once on boot |
| `src/app/api/auto-discovery/route.ts` | **New** — CRUD on roots |
| `src/app/api/auto-discovery/run/route.ts` | **New** — `POST` triggers a cycle |
| `src/app/api/auto-discovery/toggle/route.ts` | **New** — enable/disable a root |
| `src/components/DriveView.tsx` | New "Watched Drive Roots" panel |
| `package.json` | Add `node-cron` + `@types/node-cron` |
| `.env.local` (docs) | `STROM_AUTO_DISCOVERY=1`, `STROM_AUTO_CRON='0 6,14,22 * * *'`, `STROM_AUTO_MAX_LLM_CALLS_PER_DAY=500` |

Estimated effort: **Phase 1 ≈ 4h**, **Phase 2 ≈ 1.5h**, **Phase 3 ≈ 2h**.
