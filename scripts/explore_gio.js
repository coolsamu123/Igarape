const Database = require('better-sqlite3');
const db = new Database('/opt/strom/data/cioo.db', { readonly: true });

console.log('=== projects_impact cols ===');
const cols = db.prepare(`PRAGMA table_info(projects_impact)`).all();
console.log(cols.map(c => c.name).join(', '));

console.log('\n=== sample 3 rows ===');
const sample = db.prepare(`SELECT * FROM projects_impact LIMIT 3`).all();
sample.forEach(r => console.log(JSON.stringify(r, null, 2)));

console.log('\n=== impact counts per GIO 2026 project ===');
const counts = db.prepare(`
  SELECT p.project_id, p.name,
    (SELECT COUNT(*) FROM projects_impact pi WHERE pi.source_project_id = p.project_id) as out_n,
    (SELECT COUNT(*) FROM projects_impact pi WHERE pi.target_project_id = p.project_id) as in_n
  FROM (SELECT DISTINCT project_id, name FROM projects WHERE dds='GIO' AND substr(review_date,1,4)='2026') p
  ORDER BY (out_n + in_n) DESC
`).all();
counts.forEach(c => console.log(' ', c.project_id, '| out:', c.out_n, 'in:', c.in_n, '|', c.name));

console.log('\n=== severity distribution for GIO 2026 ===');
const sev = db.prepare(`
  SELECT pi.severity, COUNT(*) as n
  FROM projects_impact pi
  WHERE pi.source_project_id IN (SELECT DISTINCT project_id FROM projects WHERE dds='GIO' AND substr(review_date,1,4)='2026')
  GROUP BY pi.severity
`).all();
console.log(sev);
