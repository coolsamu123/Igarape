import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import { excelDateToISO, parseCost } from './date-utils';

interface RawRow {
  [key: string]: string | number | null | undefined;
}

interface ProjectInsert {
  projectId: string;
  name: string;
  dds: string;
  gate: string;
  costKEur: number | null;
  description: string;
  remarks: string;
  qa: string;
  reviewDate: string;
  decision: string;
  decisionMode: string;
  decisionDate: string;
  reviewStatus: string;
  documentsStatus: string;
  restricted: string;
  costBeforeG2: number | null;
  estGate2Date: string;
  sessionStart: string;
  sessionEnd: string;
  participants: string;
  linkPositions: string;
  linkFolder: string;
  linkCIOO: string;
  year: number | null;
  month: number | null;
  batchId: string;
}

// ─── Format detection ───────────────────────────────────────────────────────

type Format = 'cioo-legacy' | 'cdio';

function detectFormat(worksheet: XLSX.WorkSheet): Format {
  // Read first 2 rows as 2-D array to inspect headers
  const head = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  }).slice(0, 2);

  const flat = head.flat().map(v => String(v ?? '').toLowerCase());

  // CDIO sheet has headers in row 0 with these exact tokens.
  if (flat.some(s => s.includes('cdioo period')) || flat.some(s => s.includes('multi-cluster'))) {
    return 'cdio';
  }
  // Legacy CIOO Forecast has headers on row 2 with "GCIOO" or "DDS".
  return 'cioo-legacy';
}

// ─── Public entry point ─────────────────────────────────────────────────────

export function parseExcelBuffer(buffer: Buffer): {
  count: number;
  batchId: string;
  errors: string[];
  format: Format;
} {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const format = detectFormat(worksheet);

  const rows: ProjectInsert[] = format === 'cdio'
    ? parseCdioSheet(worksheet)
    : parseCiooLegacySheet(worksheet);

  const db = getDb();
  const batchId = uuidv4();
  const errors: string[] = [];
  let count = 0;

  // Replace previous data
  db.exec('DELETE FROM projects');

  const insert = db.prepare(`
    INSERT INTO projects (
      project_id, name, dds, gate, cost_keur, description, remarks, qa,
      review_date, decision, decision_mode, decision_date, review_status,
      documents_status, restricted, cost_before_g2, est_gate2_date,
      session_start, session_end, participants,
      link_positions, link_folder, link_cioo,
      year, month, batch_id
    ) VALUES (
      @projectId, @name, @dds, @gate, @costKEur, @description, @remarks, @qa,
      @reviewDate, @decision, @decisionMode, @decisionDate, @reviewStatus,
      @documentsStatus, @restricted, @costBeforeG2, @estGate2Date,
      @sessionStart, @sessionEnd, @participants,
      @linkPositions, @linkFolder, @linkCIOO,
      @year, @month, @batchId
    )
  `);

  const insertMany = db.transaction((entries: ProjectInsert[]) => {
    for (const entry of entries) {
      try {
        insert.run({ ...entry, batchId });
        count++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Row ${count}: ${msg}`);
      }
    }
  });

  insertMany(rows);

  return { count, batchId, errors, format };
}

// ─── CDIO (new) format ──────────────────────────────────────────────────────
// Headers on row 1 (0-indexed). 17 columns A..Q.
//   A CDIOO Period (Excel serial number)
//   B Internal review date (DD/MM/YYYY string OR Excel serial)
//   C [OBSOLETE] Mgt review date (ignored)
//   D Multi-Cluster (region label → dds)
//   E Project # in ServiceNow
//   F Project Name
//   G CDIO folder (free text "Link" or actual URL)
//   H Q&A
//   I NotebookLM
//   J Short Desc
//   K Gate
//   L Project cost (CAPEX)
//   M Project cost (OPEX)
//   N Impact on IT costs
//   O Impact on non-IT costs
//   P IT Proc Attention points
//   Q CDIOO Decision

function parseCdioSheet(worksheet: XLSX.WorkSheet): ProjectInsert[] {
  const rawData: RawRow[] = XLSX.utils.sheet_to_json(worksheet, {
    header: 'A',
    range: 1, // skip header row 0
    defval: '',
    blankrows: false,
  });

  // The "CDIO folder" column (G) shows visible text "Link" but the source xlsx
  // we've seen does NOT embed an actual hyperlink (no <hyperlinks> in sheet1.xml).
  // Drive URLs must come from another path — the Drive Sync "Discover" flow.
  const folderHyperlinks = extractColumnHyperlinks(worksheet, 'G', 2);

  const entries: ProjectInsert[] = [];

  for (let i = 0; i < rawData.length; i++) {
    const row = rawData[i];
    const projectId = str(row['E']);
    const name = str(row['F']);
    if (!projectId && !name) continue;

    const reviewDate = parseAnyDate(row['B']);
    const period = parseAnyDate(row['A']);
    const periodSerialAsNumber = typeof row['A'] === 'number' ? (row['A'] as number) : NaN;

    // Year/Month derived from CDIOO Period (or fallback to review_date)
    let year: number | null = null;
    let month: number | null = null;
    const ymSource = reviewDate || period;
    if (ymSource && /^\d{4}-\d{2}-\d{2}/.test(ymSource)) {
      year = parseInt(ymSource.slice(0, 4), 10) || null;
      month = parseInt(ymSource.slice(5, 7), 10) || null;
    } else if (!isNaN(periodSerialAsNumber) && periodSerialAsNumber > 0) {
      const iso = excelDateToISO(periodSerialAsNumber);
      if (iso) {
        year = parseInt(iso.slice(0, 4), 10) || null;
        month = parseInt(iso.slice(5, 7), 10) || null;
      }
    }

    // Cost: combine CAPEX + OPEX when both are parseable numbers; otherwise use whichever exists.
    const capexNum = parseCost(row['L']);
    const opexNum = parseCost(row['M']);
    let costKEur: number | null = null;
    if (capexNum !== null && opexNum !== null) {
      costKEur = capexNum + opexNum;
    } else if (capexNum !== null) {
      costKEur = capexNum;
    } else if (opexNum !== null) {
      costKEur = opexNum;
    }

    // Compose remarks from secondary cost/impact/attention fields, preserving the original
    // strings so the LLM still sees them when they're not parseable as numbers.
    const remarksParts: string[] = [];
    const itProc = str(row['P']);
    if (itProc) remarksParts.push(`IT Proc Attention: ${itProc}`);
    const capexRaw = str(row['L']);
    const opexRaw = str(row['M']);
    if (capexRaw && capexNum === null) remarksParts.push(`CAPEX: ${capexRaw}`);
    if (opexRaw) remarksParts.push(`OPEX: ${opexRaw}`);
    const impactIt = str(row['N']);
    if (impactIt) remarksParts.push(`Impact on IT costs: ${impactIt}`);
    const impactNonIt = str(row['O']);
    if (impactNonIt) remarksParts.push(`Impact on non-IT costs: ${impactNonIt}`);
    const notebook = str(row['I']);
    if (notebook && notebook.toLowerCase() !== 'notebooklm') {
      remarksParts.push(`NotebookLM: ${notebook}`);
    }

    // CDIO folder column (G): prefer the embedded hyperlink target; fall back to the
    // visible text only if it actually looks like a URL (and not the literal "Link").
    const folderHyperlink = folderHyperlinks[i] || '';
    const linkFolderRaw = str(row['G']);
    const linkFolder = folderHyperlink
      || (linkFolderRaw && linkFolderRaw.toLowerCase() !== 'link' ? linkFolderRaw : '');

    entries.push({
      projectId,
      name: name || 'Unnamed Project',
      dds: str(row['D']),
      gate: normalizeGate(row['K']),
      costKEur,
      description: str(row['J']),
      remarks: remarksParts.join('\n'),
      qa: str(row['H']),
      reviewDate,
      decision: str(row['Q']),
      decisionMode: '',
      decisionDate: '',
      reviewStatus: '',
      documentsStatus: '',
      restricted: '',
      costBeforeG2: null,
      estGate2Date: '',
      sessionStart: '',
      sessionEnd: '',
      participants: '',
      linkPositions: '',
      linkFolder,
      linkCIOO: '',
      year,
      month,
      batchId: '', // assigned at insert time
    });
  }

  return entries;
}

// ─── Legacy CIOO Forecast format ────────────────────────────────────────────
// Row 2 headers, 25 columns A..Y. See git history of this file for the original mapping.

function parseCiooLegacySheet(worksheet: XLSX.WorkSheet): ProjectInsert[] {
  const rawData: RawRow[] = XLSX.utils.sheet_to_json(worksheet, {
    header: 'A',
    range: 2,
    defval: '',
    blankrows: false,
  });

  const entries: ProjectInsert[] = [];

  for (const row of rawData) {
    const projectId = str(row['C']);
    const name = str(row['D']);
    if (!projectId && !name) continue;

    const reviewDate = parseAnyDate(row['A']);
    const decisionDate = parseAnyDate(row['P']);
    const estGate2Date = parseAnyDate(row['M']);
    const yearRaw = row['X'];
    const monthRaw = row['Y'];

    entries.push({
      projectId: projectId || `UNKNOWN-${entries.length}`,
      name: name || 'Unnamed Project',
      dds: str(row['B']),
      gate: normalizeGate(row['E']),
      costKEur: parseCost(row['F']),
      description: str(row['K']),
      remarks: str(row['I']),
      qa: str(row['J']),
      reviewDate,
      decision: str(row['S']),
      decisionMode: str(row['O']),
      decisionDate,
      reviewStatus: str(row['N']),
      documentsStatus: str(row['G']),
      restricted: str(row['H']),
      costBeforeG2: parseCost(row['L']),
      estGate2Date,
      sessionStart: str(row['Q']),
      sessionEnd: str(row['R']),
      participants: str(row['T']),
      linkPositions: str(row['U']),
      linkFolder: str(row['V']),
      linkCIOO: str(row['W']),
      year: typeof yearRaw === 'number' ? yearRaw : (parseInt(str(yearRaw)) || null),
      month: typeof monthRaw === 'number' ? monthRaw : (parseInt(str(monthRaw)) || null),
      batchId: '',
    });
  }

  return entries;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Pull cell.l.Target values (embedded hyperlinks) for a given column starting at
// the given 1-indexed row, in the same order rows appear in sheet_to_json output.
function extractColumnHyperlinks(
  worksheet: XLSX.WorkSheet,
  column: string,
  startRow: number,
): string[] {
  const ref = worksheet['!ref'];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const out: string[] = [];
  for (let r = startRow - 1; r <= range.e.r; r++) {
    const cellRef = column + (r + 1);
    const cell = worksheet[cellRef] as XLSX.CellObject | undefined;
    const target = cell?.l?.Target ?? '';
    out.push(typeof target === 'string' ? target : '');
  }
  return out;
}

function str(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function normalizeGate(raw: string | number | null | undefined): string {
  const s = str(raw);
  if (/^\d+\.0$/.test(s)) return s.replace('.0', '');
  return s;
}

// Parse a value that might be:
//  - an Excel date serial (number, e.g. 45658)
//  - a serial with thousands-space ("45 694")
//  - a DD/MM/YYYY string ("13/01/2025")
//  - an ISO string ("2025-01-13")
//  - empty / "N/A" / "n/a"
function parseAnyDate(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return '';

  if (typeof raw === 'number') return excelDateToISO(raw);

  const s = String(raw).trim();
  if (!s) return '';
  if (/^n\/?a$/i.test(s)) return '';

  // ISO already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY or D/M/YYYY
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // "45 694" → 45694 serial
  const compact = s.replace(/\s/g, '');
  if (/^\d{4,6}$/.test(compact)) {
    const serial = parseInt(compact, 10);
    return excelDateToISO(serial);
  }

  // Last resort: try Date.parse for strings like "Jan 15 2025"
  const ts = Date.parse(s);
  if (!isNaN(ts)) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  return s; // give back unmodified so the value isn't lost
}
