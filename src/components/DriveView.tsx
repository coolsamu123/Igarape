'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useProjectContext } from '@/context/ProjectContext';
import type { DrivePanelState } from '@/lib/drive-panel-state';

// ─── Run modes ──────────────────────────────────────────────────────────────

type RunMode = 'full' | 'goals-only' | 'download-only';

const RUN_MODES: { mode: RunMode; label: string; help: string }[] = [
  { mode: 'full',          label: 'Full pipeline',     help: 'Discover → Download → Goals → Impact' },
  { mode: 'goals-only',    label: 'Skip Impact',       help: 'Discover → Download → Goals' },
  { mode: 'download-only', label: 'Download only',     help: 'Re-download all linked Drive files' },
];

const SCHEDULE_PRESETS: { label: string; cron: string }[] = [
  { label: 'Every 5 minutes',   cron: '*/5 * * * *' },
  { label: 'Every 10 minutes',  cron: '*/10 * * * *' },
  { label: 'Every 15 minutes',  cron: '*/15 * * * *' },
  { label: 'Every 30 minutes',  cron: '*/30 * * * *' },
  { label: 'Every hour',        cron: '0 * * * *' },
  { label: 'Every 2 hours',     cron: '0 */2 * * *' },
  { label: 'Every 4 hours',     cron: '0 */4 * * *' },
  { label: '3× per day (06h, 14h, 22h)', cron: '0 6,14,22 * * *' },
  { label: 'Once per day at midnight',   cron: '0 0 * * *' },
];

// ─── Types ──────────────────────────────────────────────────────────────────

interface ExplorerRow {
  projectId: string;
  name: string;
  dds: string;
  gate: string;
  filesDownloaded: number;
  hasGoals: boolean;
  impactCount: number;
  linkFolder: string;
  linkPositions: string;
  linkCIOO: string;
}

type ExplorerFilter = 'all' | 'no-files' | 'no-goals' | 'no-impacts' | 'with-impacts';

// ─── Hook: SSE-driven panel state ───────────────────────────────────────────

function useDrivePanelStream() {
  const [state, setState] = useState<DrivePanelState | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      es = new EventSource('/api/drive/stream');
      es.addEventListener('hello', () => setConnected(true));
      es.addEventListener('state', (e) => {
        try {
          setState(JSON.parse((e as MessageEvent).data));
        } catch { /* ignore */ }
      });
      es.onerror = () => {
        setConnected(false);
        es?.close();
        es = null;
        // Browser auto-reconnects EventSource normally, but if it dropped
        // entirely (e.g. after sleep), retry manually.
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 2500);
        }
      };
    };
    connect();

    // Snapshot fetch in parallel so the user sees data even before the first
    // SSE tick arrives.
    fetch('/api/drive/state')
      .then(r => r.json())
      .then(d => { if (!cancelled && d && !d.error) setState(prev => prev || d); })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  return { state, connected };
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DriveView() {
  const { projects, refreshProjects } = useProjectContext();
  const { state, connected } = useDrivePanelStream();

  // Toast: detect new projects discovered during a cycle.
  const lastTotalRef = useRef<number | null>(null);
  const [toast, setToast] = useState<{ kind: 'info'|'success'|'error'; msg: string } | null>(null);
  useEffect(() => {
    if (!state) return;
    const total = state.counts.totalProjects;
    if (lastTotalRef.current !== null && total > lastTotalRef.current) {
      const delta = total - lastTotalRef.current;
      setToast({ kind: 'success', msg: `${delta} new project${delta > 1 ? 's' : ''} discovered.` });
      refreshProjects();
      setTimeout(() => setToast(null), 6000);
    }
    lastTotalRef.current = total;
  }, [state, refreshProjects]);

  // ─── Run pipeline (unified action) ────────────────────────────────────────

  const [runOpen, setRunOpen] = useState(false);
  const runMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!runOpen) return;
    const handler = (e: MouseEvent) => {
      if (runMenuRef.current && !runMenuRef.current.contains(e.target as Node)) {
        setRunOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [runOpen]);

  const triggerRun = useCallback(async (mode: RunMode | 'project', projectId?: string) => {
    setRunOpen(false);
    try {
      const res = await fetch('/api/drive/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, projectId }),
      });
      if (res.status === 409) {
        setToast({ kind: 'info', msg: 'Pipeline is already running.' });
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start');
      }
      setToast({ kind: 'info', msg: mode === 'project' ? `Re-syncing ${projectId}…` : 'Pipeline started.' });
      setTimeout(() => setToast(null), 4000);
    } catch (err: unknown) {
      setToast({ kind: 'error', msg: err instanceof Error ? err.message : 'Run failed' });
      setTimeout(() => setToast(null), 6000);
    }
  }, []);

  const isRunning = state?.pipeline.isRunning ?? false;

  return (
    <div className="flex-1 overflow-auto bg-[#0a0e1a] animate-fadeIn">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-2xl border text-sm font-medium ${
            toast.kind === 'success' ? 'bg-green-900/90 border-green-700 text-green-100' :
            toast.kind === 'error'   ? 'bg-red-900/90 border-red-700 text-red-100' :
                                       'bg-blue-900/90 border-blue-700 text-blue-100'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* ZONE 1: Sticky Status Header */}
      <StatusHeader
        state={state}
        connected={connected}
        runOpen={runOpen}
        setRunOpen={setRunOpen}
        runMenuRef={runMenuRef}
        onRun={triggerRun}
      />

      <div className="p-6 space-y-6">
        {/* ZONE A: Live activity (only while pipeline running) */}
        {isRunning && state && <LiveActivity state={state} />}

        {/* ZONE B: Sources (collapsible) */}
        <SourcesSection state={state} />

        {/* ZONE C: Project Explorer */}
        <ProjectExplorer
          stateGen={state?.generatedAt}
          totalProjects={state?.counts.totalProjects}
          onResync={(pid) => triggerRun('project', pid)}
          isRunning={isRunning}
          knownNames={projects}
        />
      </div>
    </div>
  );
}

// ─── Status Header ──────────────────────────────────────────────────────────

function StatusHeader({
  state, connected, runOpen, setRunOpen, runMenuRef, onRun,
}: {
  state: DrivePanelState | null;
  connected: boolean;
  runOpen: boolean;
  setRunOpen: (v: boolean) => void;
  runMenuRef: React.RefObject<HTMLDivElement>;
  onRun: (mode: RunMode | 'project', projectId?: string) => void;
}) {
  const counts = state?.counts;
  const llm = state?.todayLLM;
  const sched = state?.schedule;
  const isRunning = state?.pipeline.isRunning ?? false;

  return (
    <div className="sticky top-0 z-30 bg-[#0a0e1a]/95 backdrop-blur border-b border-gray-800">
      <div className="px-6 py-3 flex items-center gap-4 flex-wrap">
        {/* State */}
        <div className="flex items-center gap-2 min-w-[140px]">
          {isRunning ? (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
              </span>
              <span className="text-sm text-blue-300 font-semibold">Running</span>
              <span className="text-xs text-gray-500 capitalize">· {state?.pipeline.stage}</span>
            </>
          ) : (
            <>
              <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-600'}`}></span>
              <span className="text-sm text-gray-300 font-semibold">Idle</span>
              {state?.lastRun && (
                <span className="text-xs text-gray-500">· last {timeAgo(state.lastRun.startedAt)}</span>
              )}
            </>
          )}
        </div>

        {/* Counts */}
        <div className="flex items-center gap-3 text-xs text-gray-400 flex-1 min-w-[280px]">
          <Stat label="projects" value={counts?.totalProjects} tone="default" />
          <span className="text-gray-700">·</span>
          <Stat label="with files"   value={counts?.withFiles}   tone="files" />
          <Stat label="with goals"   value={counts?.withGoals}   tone="goals" />
          <Stat label="with impacts" value={counts?.withImpacts} tone="impacts" />
        </div>

        {/* Schedule + LLM */}
        <div className="flex items-center gap-4 text-xs text-gray-500">
          {sched && (
            <span title={`Cron: ${sched.full.cron}`}>
              <span className="text-gray-600">⏱</span>{' '}
              <span className="text-gray-300">{describeCron(sched.full.cron)}</span>
              {!sched.schedulerEnabled && <span className="ml-1 text-yellow-500">(off)</span>}
            </span>
          )}
          {llm && (
            <span title={`Today: ${llm.total}/${llm.cap} LLM calls`}>
              <span className="text-gray-600">⚡</span>{' '}
              <span className={`font-mono ${llm.remaining === 0 ? 'text-red-400' : llm.remaining < llm.cap * 0.2 ? 'text-yellow-400' : 'text-gray-300'}`}>
                {llm.total}
              </span>
              <span className="text-gray-600">/{llm.cap}</span>
            </span>
          )}
        </div>

        {/* Run button + dropdown */}
        <div className="relative" ref={runMenuRef}>
          <div className="flex">
            <button
              onClick={() => onRun('full')}
              disabled={isRunning}
              className="px-4 py-2 rounded-l-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isRunning ? 'Running…' : '▶ Run pipeline'}
            </button>
            <button
              onClick={() => setRunOpen(!runOpen)}
              disabled={isRunning}
              aria-label="Run options"
              className="px-2 py-2 rounded-r-lg bg-blue-700 border-l border-blue-600 text-white text-sm hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ▾
            </button>
          </div>
          {runOpen && (
            <div className="absolute right-0 mt-1 w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
              {RUN_MODES.map(m => (
                <button
                  key={m.mode}
                  onClick={() => onRun(m.mode)}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-800 border-b border-gray-800 last:border-b-0"
                >
                  <div className="text-sm text-gray-100 font-medium">{m.label}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{m.help}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* LLM cap warning */}
      {llm && llm.remaining === 0 && (
        <div className="px-6 py-1.5 bg-red-950/50 border-t border-red-900/50 text-[11px] text-red-300">
          Daily LLM cap reached. Cycles will skip LLM stages until tomorrow. Override with <code className="text-gray-300">STROM_LLM_DAILY_CAP</code>.
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone: 'default'|'files'|'goals'|'impacts' }) {
  const colorMap = {
    default: 'text-gray-100',
    files:   'text-blue-300',
    goals:   'text-green-300',
    impacts: 'text-purple-300',
  };
  return (
    <span>
      <span className={`font-mono font-semibold ${colorMap[tone]}`}>{value ?? '—'}</span>{' '}
      <span className="text-gray-500">{label}</span>
    </span>
  );
}

// ─── Live Activity ──────────────────────────────────────────────────────────

function LiveActivity({ state }: { state: DrivePanelState }) {
  const { drive, goals, impact, stage, root } = state.pipeline;
  const stages: { key: string; label: string }[] = [
    { key: 'discover', label: 'Discover' },
    { key: 'download', label: 'Download' },
    { key: 'goals',    label: 'Goals' },
    { key: 'impact',   label: 'Impact' },
  ];
  const order: Record<string, number> = { idle:-1, discover:0, download:1, goals:2, impact:3, finishing:4 };
  const activeIdx = order[stage] ?? -1;

  const drivePct = drive.totalFiles > 0
    ? Math.min(100, ((drive.downloadedFiles + drive.skippedFiles) / drive.totalFiles) * 100) : 0;
  const goalsPct = goals.totalProjects > 0
    ? Math.min(100, (goals.processedProjects / goals.totalProjects) * 100) : 0;
  const impactPct = impact.totalBatches > 0
    ? Math.min(100, (impact.completedBatches / impact.totalBatches) * 100) : 0;

  return (
    <div className="bg-gray-900 border border-blue-900/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-wider text-blue-300 font-semibold">Active cycle</span>
        {root && <span className="text-[11px] text-gray-400">→ {root}</span>}
      </div>

      {/* Stage strip */}
      <div className="flex items-center gap-1 mb-4">
        {stages.map((s, i) => {
          const stateK = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
          return (
            <div key={s.key} className="flex-1 flex items-center gap-1.5">
              <div className={`flex-1 h-1.5 rounded-full ${
                stateK === 'done'   ? 'bg-green-500' :
                stateK === 'active' ? 'bg-blue-500 animate-pulse' :
                                      'bg-gray-800'
              }`} />
              <span className={`text-[10px] font-medium whitespace-nowrap ${
                stateK === 'done'   ? 'text-green-400' :
                stateK === 'active' ? 'text-blue-300' :
                                      'text-gray-600'
              }`}>
                {stateK === 'done' ? '✓ ' : ''}{s.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Per-stage detail */}
      <div className="space-y-1.5 text-[11px]">
        <ProgressRow label="Download"
          pct={drivePct}
          right={<>
            {drive.downloadedFiles + drive.skippedFiles}/{drive.totalFiles || '?'} files
            {drive.totalUrls > 0 && <span className="text-gray-500"> · {drive.processedUrls}/{drive.totalUrls} urls</span>}
          </>}
          subtitle={drive.isRunning ? drive.currentProject : ''}
        />
        <ProgressRow label="Goals"
          pct={goalsPct}
          right={<>
            {goals.processedProjects}/{goals.totalProjects || '?'}
            {goals.errorCount > 0 && <span className="text-red-400"> · {goals.errorCount} err</span>}
          </>}
          subtitle={goals.isRunning ? goals.currentProject : ''}
        />
        <ProgressRow label="Impact"
          pct={impactPct}
          right={<>
            {impact.completedBatches}/{impact.totalBatches || '?'} batches
            {impact.currentBatchDDS && <span className="text-gray-500"> · {impact.currentBatchDDS}</span>}
          </>}
        />
      </div>
    </div>
  );
}

function ProgressRow({ label, pct, right, subtitle }: { label: string; pct: number; right: React.ReactNode; subtitle?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-gray-400">
        <span className="w-20 text-gray-500">{label}</span>
        <span className="flex-1 mx-2">
          <div className="h-1 bg-gray-800 rounded overflow-hidden">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </span>
        <span className="font-mono text-gray-300 tabular-nums text-right">{right}</span>
      </div>
      {subtitle && (
        <div className="text-gray-500 text-[10px] pl-20 ml-2 truncate" title={subtitle}>→ {subtitle}</div>
      )}
    </div>
  );
}

// ─── Sources Section (collapsible cards) ────────────────────────────────────

function SourcesSection({ state }: { state: DrivePanelState | null }) {
  return (
    <div className="space-y-3">
      <CollapsibleCard
        title="Watched Drive Roots"
        subtitle={`${state?.watchRoots.length ?? 0} configured · re-scanned on schedule`}
        defaultOpen={!state?.watchRoots.length}
      >
        <WatchedRoots state={state} />
      </CollapsibleCard>

      <CollapsibleCard title="Add a Drive source" subtitle="Discover a new project or attach a link to an existing one">
        <AddSource />
      </CollapsibleCard>

      <CollapsibleCard
        title="Discovery Schedule"
        subtitle={state?.schedule ? `${describeCron(state.schedule.full.cron)} · source: ${state.schedule.full.source}` : '—'}
      >
        <ScheduleEditor state={state} />
      </CollapsibleCard>

      <CollapsibleCard title="Upload CIOO Excel" subtitle="Replace base project metadata from 0_CIOO Forecast.xlsx">
        <ExcelUpload />
      </CollapsibleCard>

      {state?.recentRuns.length ? (
        <CollapsibleCard title="Recent cycles" subtitle={`Last ${state.recentRuns.length} runs`}>
          <RecentRunsTable runs={state.recentRuns} />
        </CollapsibleCard>
      ) : null}
    </div>
  );
}

function CollapsibleCard({ title, subtitle, defaultOpen = false, children }: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-gray-800/30 transition-colors rounded-t-xl"
      >
        <div>
          <div className="text-sm font-semibold text-gray-200">{title}</div>
          {subtitle && <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>}
        </div>
        <span className="text-gray-500 text-sm">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-5 pb-5 pt-1 border-t border-gray-800">{children}</div>}
    </div>
  );
}

// ─── Watched Roots editor ───────────────────────────────────────────────────

function WatchedRoots({ state }: { state: DrivePanelState | null }) {
  const roots = state?.watchRoots ?? [];
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const handleAdd = async () => {
    if (!newUrl.trim()) return;
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/auto-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim(), label: newLabel.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setNewUrl(''); setNewLabel('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = (id: number, enabled: boolean) =>
    fetch('/api/auto-discovery/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    });

  const handleDelete = (id: number) => {
    if (!confirm('Remove this watched root?')) return;
    fetch(`/api/auto-discovery?id=${id}`, { method: 'DELETE' });
  };

  return (
    <div className="pt-3">
      <div className="space-y-2 mb-3">
        {roots.length === 0 ? (
          <div className="text-xs text-gray-500 italic">No watched roots yet. Add one below.</div>
        ) : roots.map(r => (
          <div key={r.id} className="bg-gray-950 border border-gray-800 rounded-lg p-3 flex items-center gap-3">
            <input
              type="checkbox" checked={r.enabled}
              onChange={e => handleToggle(r.id, e.target.checked)}
              className="cursor-pointer"
              title={r.enabled ? 'Disable' : 'Enable'}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-200 font-medium truncate">
                {r.label || <span className="text-gray-500 italic">(no label)</span>}
              </div>
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                 className="text-[11px] text-blue-400 hover:underline font-mono truncate block max-w-full">
                {r.url}
              </a>
              <div className="text-[11px] text-gray-500 mt-0.5">
                Added projects: <span className="text-gray-400 font-mono">{r.addedCount}</span>
                {' · '}Last: {r.lastRunAt ? (
                  <>
                    <span className="text-gray-400">{new Date(r.lastRunAt).toLocaleString()}</span>
                    {r.lastRunStatus && (
                      <span className={`ml-1 ${r.lastRunStatus === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                        ({r.lastRunStatus})
                      </span>
                    )}
                  </>
                ) : <span className="text-gray-600">never</span>}
              </div>
            </div>
            <button
              onClick={() => handleDelete(r.id)}
              className="px-2 py-1 text-xs rounded bg-red-900/30 text-red-400 border border-red-800 hover:bg-red-900/50 transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        <input
          type="text" placeholder="Label (optional)"
          value={newLabel} onChange={e => setNewLabel(e.target.value)}
          className="w-48 bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
        <input
          type="text" placeholder="https://drive.google.com/drive/folders/..."
          value={newUrl} onChange={e => setNewUrl(e.target.value)}
          className="flex-1 min-w-[280px] bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleAdd} disabled={!newUrl.trim() || adding}
          className="px-5 py-2 rounded-lg bg-purple-700 text-white text-sm font-semibold hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {adding ? 'Adding…' : 'Watch root'}
        </button>
      </div>
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}

// ─── Add a Drive source (Discover / Associate) ──────────────────────────────

function AddSource() {
  const { projects, refreshProjects } = useProjectContext();
  const [tab, setTab] = useState<'discover'|'associate'>('discover');

  // Discover
  const [discoverUrl, setDiscoverUrl] = useState('');
  const [discoverState, setDiscoverState] = useState<'idle'|'busy'|'ok'|'err'>('idle');
  const [discoverMsg, setDiscoverMsg] = useState('');

  const submitDiscover = async () => {
    if (!discoverUrl.trim()) return;
    setDiscoverState('busy'); setDiscoverMsg('');
    try {
      const res = await fetch('/api/drive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', url: discoverUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const added: { projectId: string; name: string }[] = data.added || [];
      setDiscoverState('ok');
      if (added.length === 0) setDiscoverMsg('No new PRJ folders found at that link.');
      else if (added.length === 1) setDiscoverMsg(`Discovered ${added[0].projectId}: ${added[0].name}.`);
      else setDiscoverMsg(`Discovered ${added.length} projects: ${added.slice(0,3).map(a=>a.projectId).join(', ')}${added.length>3?', …':''}`);
      setDiscoverUrl('');
      refreshProjects();
    } catch (err: unknown) {
      setDiscoverState('err');
      setDiscoverMsg(err instanceof Error ? err.message : 'Failed');
    }
  };

  // Associate
  const [search, setSearch] = useState('');
  const [assocUrl, setAssocUrl] = useState('');
  const [assocState, setAssocState] = useState<'idle'|'busy'|'ok'|'err'>('idle');
  const [assocMsg, setAssocMsg] = useState('');

  const match = search.trim().length >= 3
    ? projects.find(p =>
        p.projectId.toLowerCase().includes(search.toLowerCase()) ||
        p.name.toLowerCase().includes(search.toLowerCase())
      )
    : null;

  const submitAssoc = async () => {
    if (!assocUrl.trim() || !match) return;
    setAssocState('busy'); setAssocMsg('');
    try {
      const res = await fetch('/api/drive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_link', projectId: match.projectId, url: assocUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssocState('ok');
      setAssocMsg(`Link added to ${match.projectId}.`);
      setAssocUrl(''); setSearch('');
      refreshProjects();
    } catch (err: unknown) {
      setAssocState('err');
      setAssocMsg(err instanceof Error ? err.message : 'Failed');
    }
  };

  return (
    <div className="pt-3">
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => setTab('discover')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium ${
            tab==='discover' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >Discover new project</button>
        <button
          onClick={() => setTab('associate')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium ${
            tab==='associate' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
          }`}
        >Associate to existing</button>
      </div>

      {tab === 'discover' ? (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Paste a Drive folder URL — the engine scans subfolders for any name containing <code className="text-gray-300">PRJ</code> and adds them.
          </p>
          <div className="flex gap-2">
            <input
              type="text" placeholder="https://drive.google.com/drive/folders/..."
              value={discoverUrl} onChange={e => setDiscoverUrl(e.target.value)}
              className="flex-1 bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={submitDiscover} disabled={!discoverUrl.trim() || discoverState==='busy'}
              className="px-5 py-2 rounded-lg bg-purple-700 text-white text-sm font-semibold hover:bg-purple-600 disabled:opacity-40"
            >
              {discoverState==='busy' ? 'Scanning…' : 'Discover'}
            </button>
          </div>
          {discoverMsg && (
            <div className={`mt-2 text-xs ${
              discoverState==='ok' ? 'text-green-400' : discoverState==='err' ? 'text-red-400' : 'text-gray-400'
            }`}>{discoverMsg}</div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            Find an existing project, then paste any Drive folder or file URL to attach as additional source.
          </p>
          <div className="flex gap-2 flex-wrap items-center">
            <input
              type="text" placeholder="Search project (e.g. PRJ46228TR)"
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-56 bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <input
              type="text" placeholder="https://drive.google.com/..."
              value={assocUrl} onChange={e => setAssocUrl(e.target.value)}
              className="flex-1 min-w-[260px] bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={submitAssoc} disabled={!assocUrl.trim() || !match || assocState==='busy'}
              className="px-5 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-40"
            >
              {assocState==='busy' ? 'Adding…' : 'Add link'}
            </button>
          </div>
          {search.trim().length >= 3 && !match && (
            <div className="mt-2 text-xs text-red-400">No project found matching &quot;{search}&quot;</div>
          )}
          {match && (
            <div className="mt-2 text-xs text-blue-400">
              ✓ Selected: <span className="font-mono text-gray-300">{match.projectId}</span> — {match.name}
            </div>
          )}
          {assocMsg && (
            <div className={`mt-2 text-xs ${
              assocState==='ok' ? 'text-green-400' : assocState==='err' ? 'text-red-400' : 'text-gray-400'
            }`}>{assocMsg}</div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Schedule Editor ────────────────────────────────────────────────────────

function ScheduleEditor({ state }: { state: DrivePanelState | null }) {
  const [advanced, setAdvanced] = useState(false);
  const [cron, setCron] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state?.schedule.full.cron) {
      setCron(state.schedule.full.cron);
      if (!SCHEDULE_PRESETS.some(p => p.cron === state.schedule.full.cron)) setAdvanced(true);
    }
  }, [state?.schedule.full.cron]);

  const save = async (newCron: string | null) => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const res = await fetch('/api/auto-discovery/schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullCron: newCron }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pt-3">
      <div className="flex items-center gap-2 mb-3 text-xs text-gray-500">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)} className="cursor-pointer" />
          Advanced (raw cron)
        </label>
        {state?.schedule && !state.schedule.schedulerEnabled && (
          <span className="text-yellow-400">scheduler disabled by env</span>
        )}
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        {advanced ? (
          <input
            type="text" value={cron} onChange={e => setCron(e.target.value)}
            placeholder="*/10 * * * *"
            className="flex-1 min-w-[200px] bg-gray-950 border border-gray-800 text-gray-200 rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-blue-500"
          />
        ) : (
          <select
            value={SCHEDULE_PRESETS.some(p => p.cron === cron) ? cron : ''}
            onChange={e => setCron(e.target.value)}
            className="flex-1 min-w-[240px] bg-gray-950 border border-gray-800 text-gray-200 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 cursor-pointer"
          >
            {!SCHEDULE_PRESETS.some(p => p.cron === cron) && cron && (
              <option value="" disabled>Custom: {cron} — switch to Advanced</option>
            )}
            {SCHEDULE_PRESETS.map(p => <option key={p.cron} value={p.cron}>{p.label}</option>)}
          </select>
        )}
        <button
          onClick={() => save(cron)}
          disabled={saving || !cron.trim() || cron === state?.schedule.full.cron}
          className="px-4 py-1.5 rounded bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-40"
        >{saving ? 'Saving…' : 'Apply'}</button>
        {state?.schedule.full.source !== 'default' && (
          <button
            onClick={() => save(null)}
            disabled={saving}
            className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-xs font-medium border border-gray-700 hover:bg-gray-700 disabled:opacity-40"
            title="Clear DB override and use env/default"
          >Reset</button>
        )}
      </div>
      {error && <div className="mt-2 text-[11px] text-red-400">{error}</div>}
      {saved && <div className="mt-2 text-[11px] text-green-400">Schedule applied.</div>}
    </div>
  );
}

// ─── Excel upload ───────────────────────────────────────────────────────────

function ExcelUpload() {
  const { refreshProjects } = useProjectContext();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setMsg('Uploading…');
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch('/api/projects/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMsg(`Success: parsed ${data.count} projects from ${file.name}.`);
      refreshProjects();
    } catch (err: unknown) {
      setMsg(`Error: ${err instanceof Error ? err.message : 'Upload failed'}`);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  return (
    <div className="pt-3">
      <p className="text-xs text-gray-500 mb-3">
        Upload <code className="text-gray-300">0_CIOO Forecast.xlsx</code> to populate base project metadata. Replaces all existing projects.
      </p>
      <label className={`inline-block px-5 py-2 rounded-lg bg-blue-700 text-white text-sm font-semibold ${busy ? 'opacity-50' : 'hover:bg-blue-600 cursor-pointer'}`}>
        {busy ? 'Uploading…' : 'Upload Excel'}
        <input type="file" accept=".xlsx,.xls" className="hidden" disabled={busy} onChange={onChange} />
      </label>
      {msg && <div className="mt-2 text-xs text-gray-400">{msg}</div>}
    </div>
  );
}

// ─── Recent runs table ──────────────────────────────────────────────────────

function RecentRunsTable({ runs }: { runs: DrivePanelState['recentRuns'] }) {
  return (
    <div className="pt-3 overflow-hidden rounded-lg border border-gray-800">
      <table className="w-full text-[11px]">
        <thead className="bg-gray-900 text-gray-500 uppercase">
          <tr>
            <th className="px-2 py-1.5 text-left font-medium">Started</th>
            <th className="px-2 py-1.5 text-left font-medium">Trig</th>
            <th className="px-2 py-1.5 text-left font-medium">Status</th>
            <th className="px-2 py-1.5 text-right font-medium">New</th>
            <th className="px-2 py-1.5 text-right font-medium">Goals</th>
            <th className="px-2 py-1.5 text-right font-medium">Impacts</th>
            <th className="px-2 py-1.5 text-right font-medium">Errors</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {runs.map(r => (
            <tr key={r.id} className="hover:bg-gray-800/30">
              <td className="px-2 py-1.5 text-gray-300 font-mono">{new Date(r.startedAt).toLocaleString()}</td>
              <td className="px-2 py-1.5 text-gray-400">{r.trigger}</td>
              <td className="px-2 py-1.5">
                <span className={
                  r.status === 'success' ? 'text-green-400' :
                  r.status === 'error'   ? 'text-red-400' :
                  r.status === 'partial' ? 'text-yellow-400' : 'text-blue-400'
                }>{r.status}</span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-gray-300">{r.newProjects}</td>
              <td className="px-2 py-1.5 text-right font-mono text-gray-300">{r.goalsAdded}</td>
              <td className="px-2 py-1.5 text-right font-mono text-gray-300">{r.impactsAdded}</td>
              <td className="px-2 py-1.5 text-right font-mono text-gray-300">{r.errorCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Project Explorer ───────────────────────────────────────────────────────

function ProjectExplorer({
  stateGen, totalProjects, onResync, isRunning, knownNames,
}: {
  stateGen: string | undefined;
  totalProjects: number | undefined;
  onResync: (projectId: string) => void;
  isRunning: boolean;
  knownNames: { projectId: string; name: string }[];
}) {
  const [rows, setRows] = useState<ExplorerRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ExplorerFilter>('all');
  const [search, setSearch] = useState('');
  const [ddsFilter, setDdsFilter] = useState<string>('All');
  const [sort, setSort] = useState<{ col: keyof ExplorerRow; dir: 'asc'|'desc' }>({ col: 'projectId', dir: 'asc' });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/drive/projects');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRows(data.rows || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + reload when totalProjects changes (new projects discovered)
  // or when generated time advances after a run.
  useEffect(() => { load(); }, [load]);
  const lastTotalRef = useRef<number | undefined>(undefined);
  const lastGenRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (totalProjects !== lastTotalRef.current) {
      lastTotalRef.current = totalProjects;
      if (rows !== null) load();
    }
    // After a cycle finishes, isRunning flips false → reload once.
    if (!isRunning && stateGen && stateGen !== lastGenRef.current && rows !== null) {
      lastGenRef.current = stateGen;
    }
  }, [totalProjects, stateGen, isRunning, load, rows]);

  const ddsValues = useMemo(() => {
    const set = new Set<string>();
    (rows || []).forEach(r => r.dds && set.add(r.dds));
    return ['All', ...Array.from(set).sort()];
  }, [rows]);

  const visible = useMemo(() => {
    if (!rows) return [];
    let out = rows;
    if (filter === 'no-files')      out = out.filter(r => r.filesDownloaded === 0);
    if (filter === 'no-goals')      out = out.filter(r => !r.hasGoals);
    if (filter === 'no-impacts')    out = out.filter(r => r.impactCount === 0);
    if (filter === 'with-impacts')  out = out.filter(r => r.impactCount > 0);
    if (ddsFilter !== 'All')        out = out.filter(r => r.dds === ddsFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      out = out.filter(r => r.projectId.toLowerCase().includes(s) || r.name.toLowerCase().includes(s));
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = a[sort.col]; const bv = b[sort.col];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return out;
  }, [rows, filter, search, ddsFilter, sort]);

  const toggleSort = (col: keyof ExplorerRow) => {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl">
      <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-gray-800">
        <div className="text-sm font-semibold text-gray-200">Projects</div>
        <div className="text-[11px] text-gray-500">{visible.length} / {rows?.length ?? 0}</div>
        <div className="flex-1" />
        <input
          type="text" placeholder="Search…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-48 bg-gray-950 border border-gray-800 text-gray-200 rounded px-2.5 py-1 text-xs focus:outline-none focus:border-blue-500"
        />
        <select
          value={ddsFilter} onChange={e => setDdsFilter(e.target.value)}
          className="bg-gray-950 border border-gray-800 text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          {ddsValues.map(v => <option key={v} value={v}>{v === 'All' ? 'All DDS' : v}</option>)}
        </select>
        <select
          value={filter} onChange={e => setFilter(e.target.value as ExplorerFilter)}
          className="bg-gray-950 border border-gray-800 text-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value="all">All projects</option>
          <option value="no-files">Without files</option>
          <option value="no-goals">Without goals</option>
          <option value="no-impacts">Without impacts</option>
          <option value="with-impacts">With impacts</option>
        </select>
        <button
          onClick={load} disabled={loading}
          className="px-2.5 py-1 rounded bg-gray-800 text-gray-300 text-xs hover:bg-gray-700 disabled:opacity-40"
          title="Reload"
        >↻</button>
      </div>

      {error && (
        <div className="px-5 py-3 text-xs text-red-400 border-b border-gray-800">
          {error}{' — '}
          {error.includes('404') || error.includes('Cannot find') ? 'restart the dev server to register the new endpoints.' : ''}
        </div>
      )}

      <div className="overflow-auto max-h-[55vh]">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-950 text-gray-500 uppercase text-[10px] sticky top-0">
            <tr>
              <SortHeader label="ID"     col="projectId"        sort={sort} onSort={toggleSort} />
              <SortHeader label="Name"   col="name"             sort={sort} onSort={toggleSort} />
              <SortHeader label="DDS"    col="dds"              sort={sort} onSort={toggleSort} />
              <SortHeader label="Gate"   col="gate"             sort={sort} onSort={toggleSort} align="center" />
              <SortHeader label="Files"  col="filesDownloaded"  sort={sort} onSort={toggleSort} align="right" />
              <th className="px-2 py-2 text-center font-medium">Goals</th>
              <SortHeader label="Impacts" col="impactCount"     sort={sort} onSort={toggleSort} align="right" />
              <th className="px-2 py-2 text-center font-medium">Drive</th>
              <th className="px-2 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {loading && rows === null && (
              <tr><td colSpan={9} className="px-5 py-6 text-center text-gray-500 text-xs">Carregando…</td></tr>
            )}
            {!loading && visible.length === 0 && rows !== null && (
              <tr><td colSpan={9} className="px-5 py-6 text-center text-gray-500 text-xs italic">No matches.</td></tr>
            )}
            {visible.map(r => (
              <tr key={r.projectId} className="hover:bg-gray-800/30">
                <td className="px-2 py-1.5 font-mono text-gray-200">{r.projectId}</td>
                <td className="px-2 py-1.5 text-gray-300 max-w-xs truncate" title={r.name}>{r.name || '—'}</td>
                <td className="px-2 py-1.5 text-gray-400">{r.dds || '—'}</td>
                <td className="px-2 py-1.5 text-center text-gray-400">{r.gate || '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono">
                  <span className={r.filesDownloaded > 0 ? 'text-blue-300' : 'text-gray-600'}>
                    {r.filesDownloaded}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  {r.hasGoals
                    ? <span className="text-green-400" title="Goals extracted">✓</span>
                    : <span className="text-gray-700">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">
                  <span className={r.impactCount > 0 ? 'text-purple-300' : 'text-gray-600'}>
                    {r.impactCount}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-center">
                  {r.linkFolder
                    ? <a href={r.linkFolder.split(' ')[0]} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">↗</a>
                    : <span className="text-gray-700">—</span>}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    onClick={() => onResync(r.projectId)}
                    disabled={isRunning}
                    title="Re-sync this project's Drive links"
                    className="px-2 py-0.5 rounded text-[11px] bg-gray-800 text-gray-300 hover:bg-blue-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    ↻ Sync
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* knownNames is here just to silence unused warning if needed */}
      <span className="hidden">{knownNames.length}</span>
    </div>
  );
}

function SortHeader({
  label, col, sort, onSort, align = 'left',
}: {
  label: string;
  col: keyof ExplorerRow;
  sort: { col: keyof ExplorerRow; dir: 'asc'|'desc' };
  onSort: (col: keyof ExplorerRow) => void;
  align?: 'left'|'right'|'center';
}) {
  const isActive = sort.col === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={`px-2 py-2 font-medium cursor-pointer select-none hover:text-gray-300 text-${align}`}
    >
      {label} {isActive ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
    </th>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function describeCron(cron: string): string {
  const preset = SCHEDULE_PRESETS.find(p => p.cron === cron);
  if (preset) return preset.label;
  return cron;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
