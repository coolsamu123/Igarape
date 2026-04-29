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

  // Locale-aware comma handling.
  // - "1,200.5"   → period present, treat commas as thousands     → 1200.5
  // - "1.200,50"  → both present and comma after period → European → 1200.50
  // - "1177,2"    → single comma + 1-2 digits after    → European decimal → 1177.2
  // - "12,500"    → single comma + 3 digits after      → English thousands → 12500
  // - "1,234,567" → multiple commas                    → English thousands → 1234567
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // European: "1.234,56"
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // English: "1,234.56"
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    const commas = s.match(/,/g)!.length;
    const afterLast = s.length - s.lastIndexOf(',') - 1;
    if (commas === 1 && afterLast > 0 && afterLast <= 2) {
      // European decimal like "1177,2"
      s = s.replace(',', '.');
    } else {
      // English thousands like "12,500" or "1,234,567"
      s = s.replace(/,/g, '');
    }
  }

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
