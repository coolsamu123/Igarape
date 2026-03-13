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

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
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
      batch_id        TEXT DEFAULT ''
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
      UNIQUE(source_project_id, target_project_id, impact_type)
    );

    CREATE INDEX IF NOT EXISTS idx_impact_source ON projects_impact(source_project_id);
    CREATE INDEX IF NOT EXISTS idx_impact_target ON projects_impact(target_project_id);
    CREATE INDEX IF NOT EXISTS idx_impact_batch ON projects_impact(batch_id);
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
