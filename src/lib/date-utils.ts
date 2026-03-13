// ─── Excel Date Utilities ────────────────────────────────────────────────────

/**
 * Convert Excel serial date number to ISO string (YYYY-MM-DD).
 * Excel dates are days since 1900-01-01 (with the Lotus 123 leap year bug).
 */
export function excelDateToISO(serial: number | string | null | undefined): string {
  if (serial === null || serial === undefined || serial === '') return '';

  const num = typeof serial === 'string' ? parseFloat(serial) : serial;
  if (isNaN(num) || num <= 0) return typeof serial === 'string' ? serial : '';

  // Excel epoch: 1900-01-01, but Excel incorrectly treats 1900 as leap year
  // Days since 1899-12-30 (to account for the bug)
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + num * 86400000);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Parse cost field which can be in various formats:
 * - "306.0" → 306
 * - "$19k" → 19
 * - "1,200" → 1200
 * - "1435.0" → 1435
 * - "621.0" → 621
 */
export function parseCost(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;

  if (typeof raw === 'number') return raw;

  let s = String(raw).trim();

  // Remove currency symbols and whitespace
  s = s.replace(/[$€£\s]/g, '');

  // Handle "19k" format
  if (/^\d+(\.\d+)?k$/i.test(s)) {
    return parseFloat(s.replace(/k$/i, ''));
  }

  // Handle "1.2M" format
  if (/^\d+(\.\d+)?m$/i.test(s)) {
    return parseFloat(s.replace(/m$/i, '')) * 1000;
  }

  // Remove commas and parse
  s = s.replace(/,/g, '');
  const n = parseFloat(s);

  return isNaN(n) ? null : n;
}

/**
 * Format a date string for display (e.g., "2024-01-15" → "Jan 2024")
 */
export function formatDateShort(iso: string): string {
  if (!iso || iso.length < 7) return iso || '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [year, month] = iso.split('-');
  const m = parseInt(month, 10);
  return m >= 1 && m <= 12 ? `${months[m - 1]} ${year}` : iso;
}
