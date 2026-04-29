/* Manual recursive Drive download for a single project.
 * Usage: node scripts/manual-download-prj.js PRJ0020888
 *
 * Mirrors drive-engine's logic but:
 *  - preserves file extension when sanitizing (avoids .pdf → .pd truncation)
 *  - logs every step
 *  - recurses fully, including shortcuts and nested folders
 */
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PROJECT_ID = process.argv[2];
if (!PROJECT_ID) { console.error('Usage: node scripts/manual-download-prj.js <PRJ_ID>'); process.exit(1); }

const ROOT = path.resolve(__dirname, '..');
const SA = path.join(ROOT, 'data', 'service-account.json');
const DRIVE_ROOT = path.join(ROOT, 'data', 'drive');

const EXPORT_MIMES = {
  'application/vnd.google-apps.document':     { mime: 'text/plain', ext: '.txt' },
  'application/vnd.google-apps.spreadsheet':  { mime: 'text/csv',   ext: '.csv' },
  'application/vnd.google-apps.presentation': { mime: 'text/plain', ext: '.txt' },
  'application/vnd.google-apps.drawing':      { mime: 'image/png',  ext: '.png' },
};
const TEXT_MIMES = new Set(['text/plain','text/csv','text/html','text/xml','application/json','application/xml']);
const BINARY_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/msword',
]);

function sanitize(name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  const cleanStem = stem.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_');
  const cleanExt = ext.replace(/[<>:"/\\|?*]/g, '_');
  const max = Math.max(1, 120 - cleanExt.length);
  return cleanStem.slice(0, max) + cleanExt;
}

function extractDriveId(url) {
  if (!url) return null;
  let m = url.match(/\/folders\/([a-zA-Z0-9_-]+)/); if (m) return m[1];
  m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);     if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);         if (m) return m[1];
  m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);           if (m) return m[1];
  return null;
}

const db = new Database(path.join(ROOT, 'data', 'cioo.db'), { readonly: true });
const proj = db.prepare('SELECT name, link_folder FROM projects WHERE project_id=?').get(PROJECT_ID);
db.close();
if (!proj) { console.error('Project not found:', PROJECT_ID); process.exit(1); }
if (!proj.link_folder) { console.error('No link_folder for', PROJECT_ID); process.exit(1); }

const folderId = extractDriveId(proj.link_folder);
if (!folderId) { console.error('Could not parse drive id from', proj.link_folder); process.exit(1); }

// Same target folder name as drive-engine (sanitize keeps existing local files in place)
const safeProjName = sanitize(`${PROJECT_ID}_${proj.name}`.slice(0, 60));
const localDir = path.join(DRIVE_ROOT, safeProjName);
fs.mkdirSync(localDir, { recursive: true });
console.log('→ Project   :', PROJECT_ID, '|', proj.name);
console.log('→ Drive ID  :', folderId);
console.log('→ Local dir :', localDir);
console.log();

const auth = new google.auth.GoogleAuth({ keyFile: SA, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
const drive = google.drive({ version: 'v3', auth });

let downloaded = 0, skipped = 0, errors = 0;

async function listFolder(id, depth = 0) {
  const out = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q: `'${id}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, shortcutDetails)',
      pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    for (const f of res.data.files || []) {
      let actualId = f.id, actualMime = f.mimeType, actualName = f.name;
      if (f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails) {
        actualId = f.shortcutDetails.targetId; actualMime = f.shortcutDetails.targetMimeType;
      }
      if (actualMime === 'application/vnd.google-apps.folder') {
        const indent = '  '.repeat(depth);
        console.log(`${indent}↳ folder: ${actualName}`);
        const sub = await listFolder(actualId, depth + 1);
        out.push(...sub);
      } else {
        out.push({ id: actualId, name: actualName, mimeType: actualMime, size: f.size });
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return out;
}

async function downloadOne(f) {
  const sz = parseInt(f.size || '0', 10);
  if (sz > 50 * 1024 * 1024) { console.log('  SKIP (too big):', f.name); skipped++; return; }

  if (EXPORT_MIMES[f.mimeType]) {
    const exp = EXPORT_MIMES[f.mimeType];
    const safe = sanitize(f.name) + exp.ext;
    const fp = path.join(localDir, safe);
    if (fs.existsSync(fp) && fs.statSync(fp).size > 0) { console.log('  cached:', safe); skipped++; return; }
    const res = await drive.files.export({ fileId: f.id, mimeType: exp.mime }, { responseType: 'text' });
    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    fs.writeFileSync(fp, text, 'utf-8');
    console.log(`  ✓ exported ${exp.ext}: ${safe} (${text.length} chars)`); downloaded++; return;
  }
  if (TEXT_MIMES.has(f.mimeType)) {
    const safe = sanitize(f.name);
    const fp = path.join(localDir, safe);
    if (fs.existsSync(fp) && fs.statSync(fp).size > 0) { console.log('  cached:', safe); skipped++; return; }
    const res = await drive.files.get({ fileId: f.id, alt: 'media', supportsAllDrives: true }, { responseType: 'text' });
    fs.writeFileSync(fp, typeof res.data === 'string' ? res.data : JSON.stringify(res.data), 'utf-8');
    console.log('  ✓ text:', safe); downloaded++; return;
  }
  if (BINARY_MIMES.has(f.mimeType)) {
    const safe = sanitize(f.name);
    const fp = path.join(localDir, safe);
    if (fs.existsSync(fp) && fs.statSync(fp).size > 0) { console.log('  cached:', safe); skipped++; return; }
    const res = await drive.files.get({ fileId: f.id, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    fs.writeFileSync(fp, Buffer.from(res.data));
    console.log(`  ✓ binary: ${safe} (${(sz/1024).toFixed(0)} KB)`); downloaded++; return;
  }
  console.log('  ? unsupported mime:', f.mimeType, '|', f.name); skipped++;
}

(async () => {
  console.log('Listing tree...');
  const files = await listFolder(folderId);
  console.log(`\nFound ${files.length} downloadable files. Downloading...\n`);
  for (const f of files) {
    try { await downloadOne(f); }
    catch (e) { errors++; console.log('  ✗ ERROR:', f.name, '|', e.message); }
  }
  console.log(`\nDone. downloaded=${downloaded} cached=${skipped} errors=${errors} total_seen=${files.length}`);
  console.log('\nLocal contents:');
  for (const n of fs.readdirSync(localDir).sort()) {
    const st = fs.statSync(path.join(localDir, n));
    console.log(`  ${n}  (${st.size} b)`);
  }
})();
