// ─── CIOO Project Data Model ─────────────────────────────────────────────────

export interface CIOOService {
  id: string;
  name: string;
  owner: string;
  domain: string;
}

export interface CIOOProject {
  id: number;
  projectId: string;        // ServiceNow # (PRJ0004517)
  name: string;
  dds: string;              // Division (AMEI, APAC, CF, etc.)
  gate: string;             // 0, 1, 1 MVP, 2, 3, 4, etc.
  costKEur: number | null;
  description: string;
  remarks: string;
  qa: string;
  reviewDate: string;       // ISO date
  decision: string;         // Passed, Not Passed, On Hold, Delegated
  decisionMode: string;     // Meeting / Off-line
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
  services?: CIOOService[];
}

// Deduplicated project (latest gate review per ServiceNow #)
export interface ProjectSummary {
  projectId: string;
  name: string;
  dds: string;
  currentGate: string;
  latestDecision: string;
  costKEur: number | null;
  description: string;
  remarks: string;
  reviewCount: number;
  lastReviewDate: string;
  linkPositions: string;
  linkFolder: string;
  linkCIOO: string;
  // Computed
  tags: string[];
  history: CIOOProject[];

  // New Sub-App fields
  digitalTechnologies?: string;
  changeManagement?: string;
  securityImpacts?: string;
  regionalImpacts?: string;
  iaEmbedded?: string;
  gioSlDdsImpacts?: string;
  ddsGioWorkload?: string;
  businessAppsCis?: string;
  
  // project_goals fields
  region?: string;
  monthFolder?: string;
  rawGeminiResponse?: string;
  sourceFiles?: string;
  analyzedAt?: string;
  goalStatus?: string;
  errorMessage?: string;

  subappAnalyzed?: boolean;
  services?: CIOOService[];
}

// Similarity link between two projects
export interface SimilarityLink {
  source: string;
  target: string;
  strength: number;
  aiAnalyzed: boolean;
}

// Gemini analysis result
export interface AnalysisResult {
  id: number;
  analysisType: 'pairwise' | 'cluster' | 'document';
  projectIds: string[];
  themes: string[];
  synergies: string[];
  risks: string[];
  recommendations: string[];
  similarityScore: number;
  createdAt: string;
  modelUsed: string;
}

// Filter state
export interface FilterState {
  dds: string;
  gate: string;
  decision: string;
  yearFrom: number | null;
  yearTo: number | null;
  search: string;
}

// View type
export type ViewType = 'graph' | 'matrix' | 'timeline' | 'detail' | 'impact' | 'goals' | 'drive' | 'archflow';

// ─── Impact Analysis ──────────────────────────────────────────────────────────

export interface ProjectImpact {
  id: number;
  sourceProjectId: string;
  targetProjectId: string;
  impactType: string;
  direction: string;
  severity: string;
  explanation: string;
  batchId: string;
  createdAt: string;
  // GIO specific flags parsed from JSON (JSON array stored in DB)
  gioServices?: string[];
}

export interface ImpactAnalysisStatus {
  isRunning: boolean;
  totalProjects: number;
  totalBatches: number;
  completedBatches: number;
  totalImpacts: number;
  currentBatchDDS: string;
  errors: string[];
}
