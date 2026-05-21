#!/usr/bin/env node
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const dbPath = path.join(root, 'data', 'cioo.db');
const driveDir = path.join(root, 'data', 'drive');

const tablesToClear = [
  'projects',
  'documents_cache',
  'analysis_cache',
  'projects_impact',
  'impact_deep_dives',
  'drive_sheet_meta',
  'drive_sheet_rows',
  'auto_runs',
  'llm_calls',
  'drive_watch_roots',
];

const optionalTables = ['project_goals'];

const db = new Database(dbPath);
const counts = {};

for (const t of tablesToClear) {
  try {
    const before = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    db.exec(`DELETE FROM ${t}`);
    counts[t] = before;
  } catch (e) {
    counts[t] = `MISSING (${e.message})`;
  }
}
for (const t of optionalTables) {
  try {
    const before = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
    db.exec(`DELETE FROM ${t}`);
    counts[t] = before;
  } catch {
    counts[t] = 'n/a';
  }
}

db.close();

let removedFiles = 0;
if (fs.existsSync(driveDir)) {
  for (const entry of fs.readdirSync(driveDir)) {
    fs.rmSync(path.join(driveDir, entry), { recursive: true, force: true });
    removedFiles++;
  }
}

console.log('Rows deleted per table:');
for (const [t, c] of Object.entries(counts)) {
  console.log(`  ${t.padEnd(22)} ${c}`);
}
console.log(`Drive root entries removed: ${removedFiles}`);
console.log('Kept: app_settings');
