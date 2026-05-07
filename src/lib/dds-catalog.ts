// ─── DDS (Division / Entity) Catalog ─────────────────────────────────────────
// The canonical list of DDS entities Air Liquide projects are mapped against.
// Used by the Impact engine to emit `target='DDS_IMPACTS'` rows with a
// `dds_entities` array, mirroring how `target='GIO_SERVICES'` works for
// GIO Service Lines.

export const DDS_CATALOG = [
  // Geographic zones
  'Americas', 'Europe', 'APAC', 'AMEI',
  // Business divisions / SBUs
  'CF', 'GM&T', 'E&C', 'HC D&IT',
  'Alizent', 'GDO', 'SEPPIC', 'Airgas', 'HHC',
  // App / functional groups
  'Industrial Apps', 'Enterprise Apps', 'Data & AI Apps',
  'Digital Factory', 'InnoTech', 'CDIO Office', 'IDD',
] as const;

export type DdsEntity = typeof DDS_CATALOG[number];

const CATALOG_SET = new Set<string>(DDS_CATALOG);

// Aliases observed in the existing DB → canonical form. Applied at ingestion
// (impact prompt response parsing) and on the project.dds field for display.
export const DDS_ALIASES: Record<string, string> = {
  'EU': 'Europe',
  'Indutrial Apps': 'Industrial Apps',
  'Entreprise Apps': 'Enterprise Apps',
  'Digital': 'Digital Factory',
  'Digital & AI': 'Data & AI Apps',
  'CDIOO': 'CDIO Office',
  'ALIZENT': 'Alizent',
};

// Normalize an arbitrary DDS string to its canonical form. Returns null if the
// value cannot be reconciled to the catalog (caller decides whether to drop).
export function normalizeDds(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (CATALOG_SET.has(trimmed)) return trimmed;
  const aliased = DDS_ALIASES[trimmed];
  if (aliased) return aliased;
  // Last-chance case-insensitive match
  const lower = trimmed.toLowerCase();
  for (const c of DDS_CATALOG) {
    if (c.toLowerCase() === lower) return c;
  }
  return null;
}

// Filter+normalize an array. Drops unknowns. Deduplicates while preserving order.
export function normalizeDdsList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const norm = normalizeDds(item);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}
