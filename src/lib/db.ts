import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'cioo.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const instance = new Database(DB_PATH);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');

  initSchema(instance);

  // Only publish to the module-level singleton AFTER initSchema completes,
  // so concurrent callers during cold-start don't observe a half-migrated DB.
  db = instance;
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      TEXT NOT NULL,
      name            TEXT NOT NULL,
      dds             TEXT DEFAULT '',
      gate            TEXT DEFAULT '',
      cost_keur       REAL,
      description     TEXT DEFAULT '',
      remarks         TEXT DEFAULT '',
      qa              TEXT DEFAULT '',
      review_date     TEXT DEFAULT '',
      decision        TEXT DEFAULT '',
      decision_mode   TEXT DEFAULT '',
      decision_date   TEXT DEFAULT '',
      review_status   TEXT DEFAULT '',
      documents_status TEXT DEFAULT '',
      restricted      TEXT DEFAULT '',
      cost_before_g2  REAL,
      est_gate2_date  TEXT DEFAULT '',
      session_start   TEXT DEFAULT '',
      session_end     TEXT DEFAULT '',
      participants    TEXT DEFAULT '',
      link_positions  TEXT DEFAULT '',
      link_folder     TEXT DEFAULT '',
      link_cioo       TEXT DEFAULT '',
      year            INTEGER,
      month           INTEGER,
      uploaded_at     TEXT DEFAULT (datetime('now')),
      batch_id        TEXT DEFAULT '',
      services        TEXT DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_projects_project_id ON projects(project_id);
    CREATE INDEX IF NOT EXISTS idx_projects_dds ON projects(dds);
    CREATE INDEX IF NOT EXISTS idx_projects_gate ON projects(gate);
    CREATE INDEX IF NOT EXISTS idx_projects_decision ON projects(decision);
    CREATE INDEX IF NOT EXISTS idx_projects_batch ON projects(batch_id);

    CREATE TABLE IF NOT EXISTS analysis_cache (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_type   TEXT NOT NULL,
      project_ids     TEXT NOT NULL,
      prompt_hash     TEXT NOT NULL,
      request_prompt  TEXT DEFAULT '',
      response_json   TEXT DEFAULT '',
      similarity_score REAL DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      model_used      TEXT DEFAULT 'gemini-2.0-flash'
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_hash ON analysis_cache(prompt_hash);
    CREATE INDEX IF NOT EXISTS idx_analysis_projects ON analysis_cache(project_ids);

    CREATE TABLE IF NOT EXISTS documents_cache (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      url             TEXT NOT NULL UNIQUE,
      content_text    TEXT DEFAULT '',
      content_type    TEXT DEFAULT '',
      fetch_status    TEXT DEFAULT '',
      error_message   TEXT DEFAULT '',
      fetched_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_url ON documents_cache(url);

    CREATE TABLE IF NOT EXISTS projects_impact (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_project_id TEXT NOT NULL,
      target_project_id TEXT NOT NULL,
      impact_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      severity TEXT NOT NULL,
      explanation TEXT DEFAULT '',
      batch_id TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      gio_services TEXT DEFAULT '[]',
      UNIQUE(source_project_id, target_project_id, impact_type)
    );

    CREATE INDEX IF NOT EXISTS idx_impact_source ON projects_impact(source_project_id);
    CREATE INDEX IF NOT EXISTS idx_impact_target ON projects_impact(target_project_id);
    CREATE INDEX IF NOT EXISTS idx_impact_batch ON projects_impact(batch_id);

    CREATE TABLE IF NOT EXISTS drive_sheet_meta (
      id              INTEGER PRIMARY KEY CHECK (id = 1),
      sheet_id        TEXT NOT NULL,
      gid             TEXT NOT NULL,
      source_url      TEXT NOT NULL,
      headers_json    TEXT NOT NULL,
      row_count       INTEGER NOT NULL DEFAULT 0,
      loaded_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drive_sheet_rows (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      row_index       INTEGER NOT NULL,
      data_json       TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_drive_sheet_rows_idx ON drive_sheet_rows(row_index);

    CREATE TABLE IF NOT EXISTS drive_watch_roots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      url             TEXT NOT NULL UNIQUE,
      drive_id        TEXT NOT NULL,
      label           TEXT DEFAULT '',
      enabled         INTEGER NOT NULL DEFAULT 1,
      added_at        TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at     TEXT,
      last_run_status TEXT,
      last_run_error  TEXT DEFAULT '',
      added_count     INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS auto_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at    TEXT NOT NULL,
      finished_at   TEXT,
      trigger       TEXT NOT NULL,
      new_projects  INTEGER NOT NULL DEFAULT 0,
      goals_added   INTEGER NOT NULL DEFAULT 0,
      impacts_added INTEGER NOT NULL DEFAULT 0,
      errors_json   TEXT NOT NULL DEFAULT '[]',
      status        TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auto_runs_started ON auto_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS llm_calls (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      called_at   TEXT NOT NULL DEFAULT (datetime('now')),
      provider    TEXT NOT NULL,
      model       TEXT NOT NULL,
      context     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'success',
      duration_ms INTEGER,
      error_message TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_llm_calls_called_at ON llm_calls(called_at DESC);
    CREATE INDEX IF NOT EXISTS idx_llm_calls_context ON llm_calls(context);

    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  try {
    db.exec('ALTER TABLE projects_impact ADD COLUMN gio_services TEXT DEFAULT "[]"');
  } catch {
    // Ignore if column already exists
  }
  try {
    db.exec('ALTER TABLE projects ADD COLUMN services TEXT DEFAULT "[]"');
  } catch {
    // Ignore if column already exists
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
