import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import { getDb } from './db';
import type { ProjectSummary, AnalysisResult } from './types';

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in .env.local');
  return new GoogleGenerativeAI(apiKey);
}

// ─── Pairwise Intersection Analysis ─────────────────────────────────────────

export async function analyzePairwise(
  projectA: ProjectSummary,
  projectB: ProjectSummary
): Promise<AnalysisResult> {
  const prompt = buildPairwisePrompt(projectA, projectB);
  const hash = hashPrompt(prompt);

  // Check cache
  const cached = getCachedAnalysis(hash);
  if (cached) return cached;

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  const parsed = parseGeminiResponse(text);
  const analysis: AnalysisResult = {
    id: 0,
    analysisType: 'pairwise',
    projectIds: [projectA.projectId, projectB.projectId],
    themes: parsed.themes || [],
    synergies: parsed.synergies || [],
    risks: parsed.risks || [],
    recommendations: parsed.recommendations || [],
    similarityScore: parsed.similarityScore || 0,
    createdAt: new Date().toISOString(),
    modelUsed: 'gemini-2.0-flash',
  };

  // Cache result
  cacheAnalysis(hash, 'pairwise', analysis, prompt);

  return analysis;
}

// ─── Cluster Analysis ───────────────────────────────────────────────────────

export async function analyzeCluster(
  projects: ProjectSummary[]
): Promise<AnalysisResult> {
  const prompt = buildClusterPrompt(projects);
  const hash = hashPrompt(prompt);

  const cached = getCachedAnalysis(hash);
  if (cached) return cached;

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = parseGeminiResponse(text);

  const analysis: AnalysisResult = {
    id: 0,
    analysisType: 'cluster',
    projectIds: projects.map(p => p.projectId),
    themes: parsed.themes || [],
    synergies: parsed.synergies || [],
    risks: parsed.risks || [],
    recommendations: parsed.recommendations || [],
    similarityScore: parsed.similarityScore || 0,
    createdAt: new Date().toISOString(),
    modelUsed: 'gemini-2.0-flash',
  };

  cacheAnalysis(hash, 'cluster', analysis, prompt);
  return analysis;
}

// ─── Document-Enhanced Analysis ─────────────────────────────────────────────

export async function analyzeWithDocuments(
  projects: ProjectSummary[],
  documentTexts: { url: string; content: string }[]
): Promise<AnalysisResult> {
  const prompt = buildDocumentPrompt(projects, documentTexts);
  const hash = hashPrompt(prompt);

  const cached = getCachedAnalysis(hash);
  if (cached) return cached;

  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = parseGeminiResponse(text);

  const analysis: AnalysisResult = {
    id: 0,
    analysisType: 'document',
    projectIds: projects.map(p => p.projectId),
    themes: parsed.themes || [],
    synergies: parsed.synergies || [],
    risks: parsed.risks || [],
    recommendations: parsed.recommendations || [],
    similarityScore: parsed.similarityScore || 0,
    createdAt: new Date().toISOString(),
    modelUsed: 'gemini-2.0-flash',
  };

  cacheAnalysis(hash, 'document', analysis, prompt);
  return analysis;
}

// ─── Prompt Builders ────────────────────────────────────────────────────────

function buildPairwisePrompt(a: ProjectSummary, b: ProjectSummary): string {
  return `You are an IT portfolio analyst for a large industrial company (Air Liquide).
Analyze the intersection between these two IT projects:

PROJECT A: ${a.name}
- ServiceNow ID: ${a.projectId}
- Division (DDS): ${a.dds}
- Current Gate: ${a.currentGate}
- Cost: ${a.costKEur ? a.costKEur + 'k€' : 'N/A'}
- Latest Decision: ${a.latestDecision || 'N/A'}
- Description: ${a.description || 'No description available'}
- Remarks: ${a.remarks || 'No remarks'}

PROJECT B: ${b.name}
- ServiceNow ID: ${b.projectId}
- Division (DDS): ${b.dds}
- Current Gate: ${b.currentGate}
- Cost: ${b.costKEur ? b.costKEur + 'k€' : 'N/A'}
- Latest Decision: ${b.latestDecision || 'N/A'}
- Description: ${b.description || 'No description available'}
- Remarks: ${b.remarks || 'No remarks'}

Analyze and return ONLY a JSON object (no markdown, no code fences) with this structure:
{
  "themes": ["theme1", "theme2"],
  "synergies": ["synergy1", "synergy2"],
  "risks": ["risk1", "risk2"],
  "recommendations": ["recommendation1", "recommendation2"],
  "similarityScore": 0.0 to 1.0
}

Focus on:
1. Thematic overlaps (technology, business domain, infrastructure, data)
2. Potential synergies (shared resources, common platforms, cost optimization)
3. Risks (dependency conflicts, resource contention, timeline clashes, redundancy)
4. Concrete recommendations for coordination between these projects`;
}

function buildClusterPrompt(projects: ProjectSummary[]): string {
  const projectList = projects.map(p =>
    `- ${p.name} (${p.projectId}, DDS: ${p.dds}, Gate: ${p.currentGate}, Cost: ${p.costKEur || 'N/A'}k€)
  Description: ${p.description || 'N/A'}
  Remarks: ${p.remarks || 'N/A'}`
  ).join('\n\n');

  return `You are an IT portfolio analyst for a large industrial company (Air Liquide).
Analyze this cluster of ${projects.length} related IT projects:

${projectList}

Analyze and return ONLY a JSON object (no markdown, no code fences) with this structure:
{
  "themes": ["common theme1", "common theme2"],
  "synergies": ["portfolio synergy1", "portfolio synergy2"],
  "risks": ["portfolio risk1", "portfolio risk2"],
  "recommendations": ["portfolio recommendation1"],
  "similarityScore": 0.0 to 1.0
}

Focus on:
1. Common threads across all projects
2. Redundancies or overlapping investments
3. Portfolio optimization opportunities
4. Governance and coordination recommendations`;
}

function buildDocumentPrompt(
  projects: ProjectSummary[],
  docs: { url: string; content: string }[]
): string {
  const projectList = projects.map(p =>
    `- ${p.name} (${p.projectId}): ${p.description || 'N/A'}`
  ).join('\n');

  const docList = docs.map(d =>
    `--- Document: ${d.url} ---\n${d.content.slice(0, 3000)}`
  ).join('\n\n');

  return `You are an IT portfolio analyst for Air Liquide.
Based on the project information AND the attached documents, provide a deep intersection analysis.

PROJECTS:
${projectList}

DOCUMENTS:
${docList}

Return ONLY a JSON object (no markdown, no code fences):
{
  "themes": ["theme1", "theme2"],
  "synergies": ["synergy1", "synergy2"],
  "risks": ["risk1", "risk2"],
  "recommendations": ["recommendation1"],
  "similarityScore": 0.0 to 1.0
}`;
}

// ─── Response Parser ────────────────────────────────────────────────────────

function parseGeminiResponse(text: string): {
  themes: string[];
  synergies: string[];
  risks: string[];
  recommendations: string[];
  similarityScore: number;
} {
  try {
    // Remove code fences if present
    let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    // Find the JSON object
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start >= 0 && end > start) {
      clean = clean.slice(start, end + 1);
    }

    return JSON.parse(clean);
  } catch {
    return {
      themes: ['Unable to parse AI response'],
      synergies: [],
      risks: [],
      recommendations: [],
      similarityScore: 0,
    };
  }
}

// ─── Cache Operations ───────────────────────────────────────────────────────

function hashPrompt(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex');
}

function getCachedAnalysis(hash: string): AnalysisResult | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM analysis_cache WHERE prompt_hash = ?'
  ).get(hash) as {
    id: number;
    analysis_type: string;
    project_ids: string;
    response_json: string;
    similarity_score: number;
    created_at: string;
    model_used: string;
  } | undefined;

  if (!row) return null;

  try {
    const parsed = JSON.parse(row.response_json);
    return {
      id: row.id,
      analysisType: row.analysis_type as AnalysisResult['analysisType'],
      projectIds: JSON.parse(row.project_ids),
      themes: parsed.themes || [],
      synergies: parsed.synergies || [],
      risks: parsed.risks || [],
      recommendations: parsed.recommendations || [],
      similarityScore: row.similarity_score,
      createdAt: row.created_at,
      modelUsed: row.model_used,
    };
  } catch {
    return null;
  }
}

function cacheAnalysis(
  hash: string,
  type: string,
  analysis: AnalysisResult,
  prompt: string
) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO analysis_cache
    (analysis_type, project_ids, prompt_hash, request_prompt, response_json, similarity_score, model_used)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    type,
    JSON.stringify(analysis.projectIds),
    hash,
    prompt,
    JSON.stringify({
      themes: analysis.themes,
      synergies: analysis.synergies,
      risks: analysis.risks,
      recommendations: analysis.recommendations,
    }),
    analysis.similarityScore,
    analysis.modelUsed
  );
}
