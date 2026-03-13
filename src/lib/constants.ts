// ─── DDS (Division) Colors ───────────────────────────────────────────────────

export const DDS_COLORS: Record<string, string> = {
  'AMEI': '#f97316',
  'Americas': '#ef4444',
  'APAC': '#06b6d4',
  'CF': '#8b5cf6',
  'CDIO Office': '#1d4ed8',
  'CDIOO': '#1e40af',
  'Digital': '#ec4899',
  'Digital Factory': '#f472b6',
  'E&C': '#10b981',
  'EU': '#3b82f6',
  'Entreprise Apps': '#a855f7',
  'GDO': '#14b8a6',
  'GIO': '#6366f1',
  'GM&T': '#f59e0b',
  'HC D&IT': '#84cc16',
  'IDD': '#22d3ee',
  'Indutrial Apps': '#fb923c',
  'SEPPIC': '#a3e635',
  'ALIZENT': '#e879f9',
  'Alizent': '#e879f9',
};

export const DEFAULT_COLOR = '#6366f1';

// ─── Gate Order & Colors ─────────────────────────────────────────────────────

export const GATE_ORDER = [
  '0', '1', '1 MVP', 'MVP Interm.', '2', '3', '4',
  'MVP Closure', 'Contract note', 'OverRun', 'Overrun'
];

export const GATE_COLORS: Record<string, string> = {
  '0': '#94a3b8',
  '1': '#6366f1',
  '1 MVP': '#8b5cf6',
  'MVP Interm.': '#a78bfa',
  '2': '#06b6d4',
  '3': '#10b981',
  '4': '#22c55e',
  'MVP Closure': '#f59e0b',
  'Contract note': '#f97316',
  'OverRun': '#ef4444',
  'Overrun': '#ef4444',
};

// ─── Decision Colors ─────────────────────────────────────────────────────────

export const DECISION_COLORS: Record<string, string> = {
  'Passed': '#22c55e',
  'Delegated': '#3b82f6',
  'On Hold': '#f59e0b',
  'Not Passed': '#ef4444',
  '': '#475569',
};

// ─── Review Status Order ─────────────────────────────────────────────────────

export const REVIEW_STATUS_ORDER = [
  '1.To be confirmed',
  '2.Confirmed',
  '3.Minutes in prog.',
  '4.Pending valid.',
  '4a. Pending valid. (1/2)',
  '4b. Pending valid. (2/2)',
  '5.Position valid.',
  '6.Min. published',
  '0.Delegated',
];

// ─── Documents Status ────────────────────────────────────────────────────────

export const DOCUMENTS_STATUS_ORDER = [
  '0-On Hold',
  '1-Expected',
  '2-Received',
  '3-Complete',
  '4-Shared',
];

export function getDDSColor(dds: string): string {
  return DDS_COLORS[dds] || DEFAULT_COLOR;
}

export function getGateColor(gate: string): string {
  return GATE_COLORS[gate] || '#6366f1';
}

export function getDecisionColor(decision: string): string {
  return DECISION_COLORS[decision] || '#475569';
}
