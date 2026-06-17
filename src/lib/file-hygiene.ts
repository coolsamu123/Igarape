// File-hygiene filters used at Drive ingestion time and as a post-pass in
// `documents_cache`. The goal is simple: the Goals/Impact LLMs should never
// see deprecated, cross-project, or duplicate content.
//
// Three classifications, applied in this order:
//   1. DEPRECATED   — file name signals obsolescence (OLD_VERSION, DO_NOT_USE…)
//   2. CROSS_PRJ    — file name embeds a PRJ-ID different from the project_id
//   3. DUPLICATE    — content_text identical to another row of the same project
//
// Each filter writes a distinct `fetch_status` value so the cause is auditable:
//   'skipped_deprecated' | 'skipped_cross_prj' | 'skipped_duplicate'
//
// Callers of `getProjectDocuments` filter on `fetch_status='success'` so any
// 'skipped_*' row is invisible to the LLM prompt.

import crypto from 'crypto';

export type SkipReason = 'deprecated' | 'cross_prj' | 'duplicate';

// File-name patterns that mean "do not use this version". Match is
// case-insensitive against the post-export local filename.
const DEPRECATED_PATTERNS = [
  /old.?version/i,
  /\bdo[\s_-]?not[\s_-]?use\b/i,
  /\bdeprecated\b/i,
  /\bsuperseded\b/i,
  /\bobsolete\b/i,
];

// Extract the canonical PRJ-ID embedded in a filename (if any). Returns null
// when the filename doesn't carry a clear PRJ pattern. The returned ID is
// uppercased and trimmed of separators; zero-padding is NOT normalized — the
// caller is expected to do digit-key matching to stay robust against the
// project_id format inconsistencies in the DB.
function extractPrjIdFromName(name: string): { canonical: string; digitsKey: string } | null {
  const m = name.match(/PRJ[\s\-_]*([0-9]+)([A-Z]{0,4})/i);
  if (!m) return null;
  const digits = m[1];
  const suffix = (m[2] || '').toUpperCase();
  return {
    canonical: `PRJ${digits}${suffix}`,
    digitsKey: `${String(parseInt(digits, 10))}${suffix}`, // strip leading zeros
  };
}

/**
 * Decides whether a file should be downloaded/cached given its filename and
 * the project it belongs to. Returns `{ keep: true }` for normal files; a
 * `SkipReason` otherwise.
 *
 * Cross-PRJ matching is digit-key based: a file named `PRJ001395_…` inside
 * a project with id `PRJ0001395` is NOT cross — both digit-keys are `1395`.
 * Only when the digits genuinely differ do we flag it.
 */
export function classifyFile(
  projectId: string,
  fileName: string,
): { keep: true } | { keep: false; reason: SkipReason } {
  // 1. Deprecated name patterns
  for (const re of DEPRECATED_PATTERNS) {
    if (re.test(fileName)) return { keep: false, reason: 'deprecated' };
  }

  // 2. Cross-PRJ: filename carries a different project id
  const fileId = extractPrjIdFromName(fileName);
  if (fileId) {
    const projMatch = projectId.match(/^PRJ([0-9]+)([A-Z]*)$/i);
    if (projMatch) {
      const projDigitsKey = `${String(parseInt(projMatch[1], 10))}${(projMatch[2] || '').toUpperCase()}`;
      // Drop the case where the file ID is a known placeholder like "PRJ00XXXXX"
      // (extractor returns NaN on parse; the comparison fails open).
      if (fileId.digitsKey && fileId.digitsKey !== 'NaN' && fileId.digitsKey !== projDigitsKey) {
        return { keep: false, reason: 'cross_prj' };
      }
    }
  }

  return { keep: true };
}

/**
 * SHA-256 of the content. Truncated to 16 hex chars in the DB use case — that
 * gives 2^64 collision space which is more than enough for the per-project
 * dedupe scope (a project rarely has more than ~50 files).
 */
export function hashContent(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Given a list of rows for ONE project (already in cache), returns the IDs
 * that should be marked as duplicates. Strategy: group by content hash; keep
 * the row with the shortest file_name (canonical: typically without the
 * `CIOO-Archiv_` prefix and without subfolder paths). All others go.
 *
 * `id` field is whatever unique key the caller uses (DB row id).
 */
export function pickDuplicatesToSkip<T extends { id: number | string; fileName: string; contentText: string }>(
  rows: T[],
): T['id'][] {
  if (rows.length < 2) return [];

  const byHash = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.contentText) continue; // skip empties; the empty-content row will fail other filters anyway
    const h = hashContent(r.contentText);
    const bucket = byHash.get(h) ?? [];
    bucket.push(r);
    byHash.set(h, bucket);
  }

  const toSkip: T['id'][] = [];
  for (const bucket of byHash.values()) {
    if (bucket.length < 2) continue;
    // Keep the one with shortest file_name (most canonical). Tiebreaker: lowest id.
    bucket.sort((a, b) => {
      const dl = a.fileName.length - b.fileName.length;
      if (dl !== 0) return dl;
      return String(a.id).localeCompare(String(b.id));
    });
    // First in sorted is kept, rest are duplicates
    for (let i = 1; i < bucket.length; i++) toSkip.push(bucket[i].id);
  }
  return toSkip;
}
