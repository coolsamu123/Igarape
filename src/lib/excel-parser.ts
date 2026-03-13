import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './db';
import { excelDateToISO, parseCost } from './date-utils';

// Column mapping from Excel to our schema
// Row 2 headers: A=GCIOO Date, B=DDS, C=Project # in ServiceNow, D=Project Name,
// E=Gate, F=Project cost k€ (Cx+Ox), G=Documents, H=Restricted, I=Remarks,
// J=Q&A, K=Short description, L=Cost before Gate 2, M=Est.Gate 2 date,
// N=Review Status, O=Decision mode, P=Date, Q=Début, R=Fin, S=Decision,
// T=Participants, U=Link to GCIOO Positions, V=HyperLink to folder,
// W=HyperLink to CIOO positions, X=Année, Y=Mois

interface RawRow {
  [key: string]: string | number | null | undefined;
}

export function parseExcelBuffer(buffer: Buffer): {
  count: number;
  batchId: string;
  errors: string[];
} {
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // Use the first sheet (0_CIOO Forecast)
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Parse to JSON with header row at row 2 (index 1)
  const rawData: RawRow[] = XLSX.utils.sheet_to_json(worksheet, {
    header: 'A',
    range: 2, // Skip rows 1 (cloud header) and 2 (headers) — start from data row 3
    defval: '',
  });

  const db = getDb();
  const batchId = uuidv4();
  const errors: string[] = [];

  // Delete previous data
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

  let count = 0;

  const insertMany = db.transaction((rows: RawRow[]) => {
    for (const row of rows) {
      const projectId = str(row['C']);
      const name = str(row['D']);

      // Skip empty rows
      if (!projectId && !name) continue;

      try {
        const reviewDateRaw = row['A'];
        const reviewDate = typeof reviewDateRaw === 'number'
          ? excelDateToISO(reviewDateRaw)
          : str(reviewDateRaw);

        const decisionDateRaw = row['P'];
        const decisionDate = typeof decisionDateRaw === 'number'
          ? excelDateToISO(decisionDateRaw)
          : str(decisionDateRaw);

        const estGate2Raw = row['M'];
        const estGate2Date = typeof estGate2Raw === 'number'
          ? excelDateToISO(estGate2Raw)
          : str(estGate2Raw);

        const gate = normalizeGate(row['E']);
        const yearRaw = row['X'];
        const monthRaw = row['Y'];

        insert.run({
          projectId: projectId || `UNKNOWN-${count}`,
          name: name || 'Unnamed Project',
          dds: str(row['B']),
          gate,
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
          batchId,
        });

        count++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`Row ${count + 3}: ${msg}`);
      }
    }
  });

  insertMany(rawData);

  return { count, batchId, errors };
}

function str(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function normalizeGate(raw: string | number | null | undefined): string {
  const s = str(raw);
  // Handle numeric gates like "2.0" → "2", "1.0" → "1"
  if (/^\d+\.0$/.test(s)) return s.replace('.0', '');
  return s;
}
