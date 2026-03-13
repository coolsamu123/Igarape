import type { ProjectSummary, SimilarityLink } from './types';

// ─── Extract keywords from text ─────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'not', 'no', 'all', 'each', 'every',
  'any', 'some', 'such', 'as', 'if', 'so', 'than', 'too', 'very',
  'just', 'also', 'more', 'most', 'other', 'into', 'over', 'after',
  'before', 'between', 'under', 'above', 'up', 'out', 'off', 'down',
  'then', 'only', 'about', 'which', 'when', 'where', 'how', 'what',
  'who', 'whom', 'why', 'new', 'project', 'system', 'solution',
  'implementation', 'implement', 'deploy', 'deployment', 'use', 'using',
  'based', 'across', 'within', 'through', 'during', 'including',
  'includes', 'include', 'provide', 'provides', 'support',
  'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'et', 'en',
  'pour', 'par', 'sur', 'avec', 'dans', 'est', 'sont', 'au', 'aux',
]);

export function extractKeywords(text: string): Set<string> {
  if (!text) return new Set();

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9àâäéèêëïîôùûüç\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  return new Set(words);
}

// ─── Compute similarity between two projects ────────────────────────────────

export function computeSimilarity(a: ProjectSummary, b: ProjectSummary): number {
  // 1. Keyword similarity (Jaccard on description + remarks)
  const textA = `${a.description} ${a.remarks} ${a.name}`;
  const textB = `${b.description} ${b.remarks} ${b.name}`;
  const kwA = extractKeywords(textA);
  const kwB = extractKeywords(textB);

  let intersection = 0;
  for (const w of kwA) {
    if (kwB.has(w)) intersection++;
  }
  const union = new Set([...kwA, ...kwB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // 2. DDS match bonus
  const ddsMatch = a.dds === b.dds && a.dds !== '' ? 0.15 : 0;

  // 3. Similar project name detection (same prefix or strong overlap)
  const nameA = a.name.toLowerCase();
  const nameB = b.name.toLowerCase();
  const nameOverlap = computeNameSimilarity(nameA, nameB);

  // 4. Tag overlap bonus (extracted tags)
  const tagOverlap = computeTagOverlap(a.tags, b.tags);

  const score = Math.min(1, jaccard * 1.5 + ddsMatch + nameOverlap * 0.3 + tagOverlap * 0.2);
  return Math.round(score * 100) / 100;
}

function computeNameSimilarity(a: string, b: string): number {
  // Check word overlap in names
  const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let common = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) common++;
  }
  return common / Math.max(wordsA.size, wordsB.size);
}

function computeTagOverlap(tagsA: string[], tagsB: string[]): number {
  if (tagsA.length === 0 || tagsB.length === 0) return 0;
  const setA = new Set(tagsA.map(t => t.toLowerCase()));
  const setB = new Set(tagsB.map(t => t.toLowerCase()));
  let common = 0;
  for (const t of setA) {
    if (setB.has(t)) common++;
  }
  return common / Math.max(setA.size, setB.size);
}

// ─── Build all similarity links above threshold ─────────────────────────────

export function buildSimilarityLinks(
  projects: ProjectSummary[],
  threshold: number = 0.15
): SimilarityLink[] {
  const links: SimilarityLink[] = [];

  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const strength = computeSimilarity(projects[i], projects[j]);
      if (strength >= threshold) {
        links.push({
          source: projects[i].projectId,
          target: projects[j].projectId,
          strength,
          aiAnalyzed: false,
        });
      }
    }
  }

  return links.sort((a, b) => b.strength - a.strength);
}

// ─── Extract tags from project text ─────────────────────────────────────────

const TECH_KEYWORDS = new Set([
  'sap', 'erp', 'crm', 'scada', 'iot', 'cloud', 'aws', 'azure', 'gcp',
  'salesforce', 'oracle', 'microsoft', 'google', 'servicenow', 'jira',
  'sharepoint', 'teams', 'office365', 'm365', 'dynamics', 'power bi',
  'tableau', 'qlik', 'bi', 'analytics', 'ai', 'ml', 'rpa', 'automation',
  'api', 'integration', 'etl', 'data', 'database', 'sql', 'nosql',
  'security', 'cybersecurity', 'firewall', 'vpn', 'mfa', 'sso', 'iam',
  'devops', 'cicd', 'docker', 'kubernetes', 'microservices',
  'blockchain', 'digital', 'mobile', 'web', 'portal', 'ecommerce',
  'finance', 'hr', 'supply chain', 'logistics', 'manufacturing',
  'maintenance', 'quality', 'compliance', 'audit', 'risk',
  'ocr', 'edm', 'dms', 'bpm', 'workflow', 'reporting',
  'migration', 'upgrade', 'modernization', 'transformation',
  'infrastructure', 'network', 'server', 'storage', 'backup',
  'pharma', 'healthcare', 'industrial', 'energy', 'gas',
  'mes', 'plc', 'hmi', 'dcs', 'ot', 'it/ot',
]);

export function extractTags(project: { name: string; description: string; remarks: string }): string[] {
  const text = `${project.name} ${project.description} ${project.remarks}`.toLowerCase();
  const tags: string[] = [];

  for (const kw of TECH_KEYWORDS) {
    if (text.includes(kw)) {
      tags.push(kw.toUpperCase());
    }
  }

  return [...new Set(tags)].slice(0, 10);
}
