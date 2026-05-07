'use client';

import { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { getDDSColor } from '@/lib/constants';

// ─── Data shapes (mirror /api/impact/project/evidence response) ──────────────

interface ProjectMeta {
  projectId: string;
  name: string;
  dds: string;
  currentGate: string;
  decision: string;
  decisionMode: string;
  description: string;
  remarks: string;
  qa: string;
  costKEur: number | null;
  reviewDate: string;
  participants: string;
  links: { folder: string; positions: string; cioo: string };
  history: Array<{ gate: string; decision: string; reviewDate: string }>;
}

interface GoalsData {
  digitalTechnologies: string;
  changeManagement: string;
  securityImpacts: string;
  regionalImpacts: string;
  iaEmbedded: string;
  gioSlDdsImpacts: string;
  ddsGioWorkload: string;
  businessAppsCis: string;
  region: string;
  monthFolder: string;
  analyzedAt: string;
  sourceFiles: string[];
  rawGeminiResponse: string;
  status: string;
}

interface DocumentExcerpt {
  url: string;
  contentType: string;
  fetchStatus: string;
  excerpt: string;
  fullLength: number;
}

interface EvidenceResponse {
  project: ProjectMeta;
  goals: GoalsData | null;
  documents: DocumentExcerpt[];
  impacts: { gio: unknown; dds: unknown };
}

type DeepDiveKind = 'gio' | 'dds';

export interface DeepDiveTarget {
  kind: DeepDiveKind;
  target: string;
}

interface EvidencePanelProps {
  projectId: string;
  // Highlights the field most directly tied to a kind of impact (subtle visual tag).
  highlight?: 'gio' | 'dds' | null;
  // Compact = thinner padding + smaller fonts. Use in the Universe side panel.
  compact?: boolean;
  // List of deep-dive targets to expose buttons for. Empty/omitted = no deep-dive section.
  deepDiveTargets?: DeepDiveTarget[];
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function EvidencePanel({ projectId, highlight = null, compact = false, deepDiveTargets = [] }: EvidencePanelProps) {
  const [data, setData] = useState<EvidenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openDocUrl, setOpenDocUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/impact/project/evidence?projectId=${encodeURIComponent(projectId)}`)
      .then(async r => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Failed to load evidence');
        return json as EvidenceResponse;
      })
      .then(json => { setData(json); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [projectId]);

  const padCls = compact ? 'p-3' : 'p-4';
  const titleCls = compact ? 'text-[11px]' : 'text-xs';
  const bodyCls = compact ? 'text-[11px]' : 'text-xs';

  if (loading) {
    return (
      <div className={`bg-gray-900/70 border border-gray-800 rounded-lg ${padCls} text-gray-500 text-xs animate-pulse`}>
        Loading evidence…
      </div>
    );
  }
  if (error) {
    return (
      <div className={`bg-red-950/30 border border-red-900/50 rounded-lg ${padCls} text-red-400 text-xs`}>
        {error}
      </div>
    );
  }
  if (!data) return null;

  const { project, goals, documents } = data;

  return (
    <div className={`bg-gray-900/40 border border-gray-800 rounded-lg ${padCls} space-y-4`}>
      {/* ─── Project metadata ──────────────────────────────────────────── */}
      <Section title="Project metadata" titleCls={titleCls}>
        <dl className={`grid grid-cols-2 gap-x-4 gap-y-1 ${bodyCls} text-gray-300`}>
          <Field label="DDS owner" value={project.dds} color={getDDSColor(project.dds)} />
          <Field label="Current gate" value={project.currentGate} />
          <Field label="Decision" value={`${project.decision}${project.decisionMode ? ` (${project.decisionMode})` : ''}`} />
          <Field label="Cost" value={project.costKEur !== null ? `${project.costKEur} k€` : '—'} />
          <Field label="Last review" value={project.reviewDate} />
          <Field label="Participants" value={project.participants} truncate />
        </dl>
        {(project.links.folder || project.links.positions || project.links.cioo) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {project.links.folder && <ExtLink href={project.links.folder} label="Drive folder" />}
            {project.links.positions && <ExtLink href={project.links.positions} label="Positions" />}
            {project.links.cioo && <ExtLink href={project.links.cioo} label="CIOO" />}
          </div>
        )}
      </Section>

      {/* ─── Description / Remarks ─────────────────────────────────────── */}
      {(project.description || project.remarks || project.qa) && (
        <Section title="CIOO sheet text" titleCls={titleCls}>
          {project.description && (
            <Para label="Description" body={project.description} bodyCls={bodyCls} />
          )}
          {project.remarks && (
            <Para label="Remarks" body={project.remarks} bodyCls={bodyCls} />
          )}
          {project.qa && (
            <Para label="QA" body={project.qa} bodyCls={bodyCls} />
          )}
        </Section>
      )}

      {/* ─── Goals Extractor fields ────────────────────────────────────── */}
      {goals ? (
        <Section
          title={`Goals Extractor · ${goals.region || 'Global'} · analyzed ${formatDate(goals.analyzedAt)}`}
          titleCls={titleCls}
        >
          <div className="space-y-2">
            <GoalsField label="GIO / SL / DDS impacts"  text={goals.gioSlDdsImpacts}  bodyCls={bodyCls} highlighted={highlight === 'gio' || highlight === 'dds'} />
            <GoalsField label="Regional impacts"        text={goals.regionalImpacts}  bodyCls={bodyCls} highlighted={highlight === 'dds'} />
            <GoalsField label="DDS / GIO workload"      text={goals.ddsGioWorkload}   bodyCls={bodyCls} highlighted={highlight === 'gio' || highlight === 'dds'} />
            <GoalsField label="Digital technologies"    text={goals.digitalTechnologies} bodyCls={bodyCls} />
            <GoalsField label="Business apps & CIs"     text={goals.businessAppsCis}  bodyCls={bodyCls} />
            <GoalsField label="Security impacts"        text={goals.securityImpacts}  bodyCls={bodyCls} />
            <GoalsField label="AI embedded"             text={goals.iaEmbedded}       bodyCls={bodyCls} />
            <GoalsField label="Change management"       text={goals.changeManagement} bodyCls={bodyCls} />
          </div>
          {goals.sourceFiles.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-800">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">
                Source files used by Goals analysis ({goals.sourceFiles.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {goals.sourceFiles.map(f => (
                  <span key={f} className="text-[10px] font-mono bg-gray-800/60 text-gray-400 px-1.5 py-0.5 rounded border border-gray-700/60">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>
      ) : (
        <Section title="Goals Extractor" titleCls={titleCls}>
          <div className={`${bodyCls} text-gray-500 italic`}>
            No Goals analysis on record for this project.
          </div>
        </Section>
      )}

      {/* ─── Documents ─────────────────────────────────────────────────── */}
      {documents.length > 0 && (
        <Section title={`Drive documents (${documents.length})`} titleCls={titleCls}>
          <ul className="space-y-1.5">
            {documents.map(doc => {
              const filename = doc.url.split('/').pop() || doc.url;
              const opened = openDocUrl === doc.url;
              return (
                <li key={doc.url}>
                  <button
                    onClick={() => setOpenDocUrl(opened ? null : doc.url)}
                    className={`w-full text-left px-2 py-1 rounded ${bodyCls} hover:bg-gray-800/50 transition-colors flex items-center gap-2`}
                  >
                    <span className="text-gray-400">{opened ? '▾' : '▸'}</span>
                    <span className="font-mono text-gray-300 truncate flex-1" title={doc.url}>{filename}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">
                      {doc.fetchStatus === 'success' ? `${doc.fullLength} chars` : doc.fetchStatus}
                    </span>
                  </button>
                  {opened && doc.excerpt && (
                    <pre className={`mt-1 ml-5 ${bodyCls} text-gray-400 bg-gray-950/60 border border-gray-800 rounded px-2 py-1.5 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto`}>
                      {doc.excerpt}
                      {doc.fullLength > doc.excerpt.length && '\n…'}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* ─── Gate history ──────────────────────────────────────────────── */}
      {project.history.length > 1 && (
        <Section title={`Gate history (${project.history.length} reviews)`} titleCls={titleCls}>
          <ul className={`${bodyCls} text-gray-300 space-y-1`}>
            {project.history.map((h, i) => (
              <li key={i} className="flex gap-3 font-mono">
                <span className="text-gray-500 shrink-0 w-24">{h.reviewDate || '—'}</span>
                <span className="text-blue-300 shrink-0 w-12">Gate {h.gate || '—'}</span>
                <span className="text-emerald-300">{h.decision || '—'}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* ─── Deep dive (LLM-generated detailed analysis) ─────────────────── */}
      {deepDiveTargets.length > 0 && (
        <Section title="Deep dive analyses (AI)" titleCls={titleCls}>
          <div className={`${bodyCls} text-gray-500 mb-2`}>
            Generate or read a detailed, evidence-backed analysis for each connection.
          </div>
          <div className="space-y-2">
            {deepDiveTargets.map(t => (
              <DeepDiveButton
                key={`${t.kind}:${t.target}`}
                projectId={projectId}
                kind={t.kind}
                target={t.target}
                compact={compact}
              />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Deep dive button (lazy-loads, caches via backend) ───────────────────────

interface DeepDiveResponse {
  projectId: string;
  kind: DeepDiveKind;
  target: string;
  responseMd: string;
  llmProvider: string;
  llmModel: string;
  generatedAt: string;
  durationMs: number | null;
  cached: boolean;
}

export function DeepDiveButton({ projectId, kind, target, compact }: { projectId: string; kind: DeepDiveKind; target: string; compact: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [response, setResponse] = useState<DeepDiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Tick a loading timer so the user has visual progress on the long LLM call.
  useEffect(() => {
    if (state !== 'loading') return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [state]);

  const trigger = useCallback(async () => {
    if (state === 'loading') return;
    if (state === 'done' && response) {
      setOpen(o => !o);
      return;
    }
    setState('loading');
    setError(null);
    setOpen(true);
    setElapsed(0);
    try {
      const res = await fetch('/api/impact/project/deep-dive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, kind, target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Deep dive failed');
      setResponse(data as DeepDiveResponse);
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setState('error');
    }
  }, [projectId, kind, target, state, response]);

  const kindColor = kind === 'gio' ? '#a855f7' : '#06b6d4';
  const kindLabel = kind === 'gio' ? 'GIO' : 'DDS';

  // Visual state of the trigger button. Each state gets distinct colors and
  // motion so the LLM call feels intentional, not buried.
  const triggerBg =
    state === 'idle'    ? 'bg-gradient-to-r from-purple-700 via-fuchsia-600 to-cyan-600 hover:from-purple-600 hover:via-fuchsia-500 hover:to-cyan-500' :
    state === 'loading' ? 'bg-gradient-to-r from-purple-800 via-fuchsia-700 to-cyan-700 animate-pulse' :
    state === 'done'    ? 'bg-gradient-to-r from-emerald-700/60 to-emerald-800/60 hover:from-emerald-600/60 hover:to-emerald-700/60' :
                          'bg-gradient-to-r from-red-800/70 to-red-900/70 hover:from-red-700/70 hover:to-red-800/70';
  const triggerGlow =
    state === 'idle'    ? 'shadow-[0_0_18px_rgba(168,85,247,0.45)] hover:shadow-[0_0_24px_rgba(168,85,247,0.7)]' :
    state === 'loading' ? 'shadow-[0_0_18px_rgba(168,85,247,0.45)]' :
    '';

  return (
    <div className="rounded-lg overflow-hidden">
      <button
        onClick={trigger}
        disabled={state === 'loading'}
        className={`group w-full flex items-center justify-between gap-3 px-4 py-3 ${compact ? 'text-[12px]' : 'text-[13px]'} font-semibold text-white transition-all duration-200 disabled:cursor-wait ${triggerBg} ${triggerGlow}`}
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0 inline-block group-hover:scale-110 transition-transform">🔬</span>
          <span
            className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0 tracking-wider bg-black/30 text-white/95 border border-white/20"
          >
            {kindLabel}
          </span>
          <span className="truncate text-white/95 font-bold" title={target}>{target}</span>
        </span>
        <span className="shrink-0 text-[10px] uppercase tracking-wider text-white/85 font-bold">
          {state === 'idle' && 'Deep dive →'}
          {state === 'loading' && `${elapsed}s …`}
          {state === 'done' && (response?.cached ? '✓ Cached · toggle' : '✓ Done · toggle')}
          {state === 'error' && '⚠ Retry'}
        </span>
      </button>

      {open && (
        <div className="bg-gray-950/70 border border-t-0 border-gray-800 rounded-b-lg px-3 py-2.5">
          {state === 'loading' && (
            <div className={`${compact ? 'text-[11px]' : 'text-xs'} text-gray-400 leading-relaxed`}>
              Generating detailed analysis (typical: 15-40s)…
            </div>
          )}
          {state === 'error' && (
            <div className="text-xs text-red-400">{error}</div>
          )}
          {state === 'done' && response && (
            <>
              <div className={`prose-deep-dive ${compact ? 'text-[11px]' : 'text-xs'} text-gray-200 leading-relaxed`}>
                <ReactMarkdown
                  components={{
                    h2: ({ children }) => (
                      <div className="text-[11px] font-bold text-gray-100 uppercase tracking-wider mt-3 mb-1.5 first:mt-0">
                        {children}
                      </div>
                    ),
                    h3: ({ children }) => (
                      <div className="text-[11px] font-semibold text-gray-200 mt-2 mb-1">{children}</div>
                    ),
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-5 space-y-0.5 mb-2">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-5 space-y-0.5 mb-2">{children}</ol>,
                    li: ({ children }) => <li>{children}</li>,
                    strong: ({ children }) => <strong className="text-gray-100">{children}</strong>,
                    em: ({ children }) => <em className="text-gray-300">{children}</em>,
                    code: ({ children }) => (
                      <code className="font-mono bg-gray-800/70 text-emerald-300 px-1 rounded">{children}</code>
                    ),
                  }}
                >
                  {response.responseMd}
                </ReactMarkdown>
              </div>
              <div className="text-[10px] text-gray-500 mt-3 pt-2 border-t border-gray-800 font-mono">
                {response.llmProvider}/{response.llmModel} · {response.durationMs ? `${(response.durationMs / 1000).toFixed(1)}s` : '—'} · generated {response.generatedAt.slice(0, 10)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Section({ title, children, titleCls }: { title: string; children: React.ReactNode; titleCls: string }) {
  return (
    <div>
      <div className={`${titleCls} font-bold text-gray-200 uppercase tracking-wider mb-2`}>{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, color, truncate }: { label: string; value: string; color?: string; truncate?: boolean }) {
  return (
    <div className="flex gap-1.5 min-w-0">
      <dt className="text-gray-500 shrink-0">{label}:</dt>
      <dd className={`text-gray-200 ${truncate ? 'truncate' : ''}`} style={color ? { color } : undefined} title={value}>
        {value || '—'}
      </dd>
    </div>
  );
}

function Para({ label, body, bodyCls }: { label: string; body: string; bodyCls: string }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">{label}</div>
      <div className={`${bodyCls} text-gray-300 leading-relaxed whitespace-pre-wrap`}>{body}</div>
    </div>
  );
}

function GoalsField({ label, text, bodyCls, highlighted }: { label: string; text: string; bodyCls: string; highlighted?: boolean }) {
  if (!text || text === 'Not identified in available documentation') {
    return (
      <div className={`flex gap-3 ${bodyCls}`}>
        <span className="text-gray-500 w-44 shrink-0">{label}</span>
        <span className="text-gray-600 italic">Not identified</span>
      </div>
    );
  }
  return (
    <div className={`${bodyCls} ${highlighted ? 'bg-blue-950/20 border-l-2 border-blue-500/60 pl-2 py-1 rounded-r' : ''}`}>
      <span className="text-gray-500 mr-2">{label}:</span>
      <span className="text-gray-200 leading-relaxed whitespace-pre-wrap">{text}</span>
    </div>
  );
}

function ExtLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      className="text-[10px] px-2 py-0.5 rounded bg-blue-900/30 text-blue-300 border border-blue-800/50 hover:bg-blue-800/50 transition-colors"
    >
      ↗ {label}
    </a>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toISOString().slice(0, 10);
}
