'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useProjectContext } from '@/context/ProjectContext';
import type { DrivePanelState } from '@/lib/drive-panel-state';
import type { ProjectSyncStatus } from '@/lib/drive-sync-all';

// ─── Schedule presets ───────────────────────────────────────────────────────

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
  localPath: string;
}

// Per-column filter state. Text filters use a substring match (case-insensitive).
// Select/tri-state filters use 'any' to mean "no filter".
interface ColumnFilters {
  projectId: string;
  name: string;
  dds: string;        // 'any' | exact value
  gate: string;       // 'any' | exact value
  files:   'any' | 'with' | 'without';
  goals:   'any' | 'yes' | 'no';
  impacts: 'any' | 'with' | 'without';
  drive:   'any' | 'yes' | 'no';
  local:   'any' | 'yes' | 'no';
}
const EMPTY_FILTERS: ColumnFilters = {
  projectId: '', name: '', dds: 'any', gate: 'any',
  files: 'any', goals: 'any', impacts: 'any', drive: 'any', local: 'any',
};

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

  // ─── Sync all (per-project) action ────────────────────────────────────────

  const triggerProjectResync = useCallback(async (projectId: string) => {
    try {
      const res = await fetch('/api/drive/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'project', projectId }),
      });
      if (res.status === 409) {
        setToast({ kind: 'info', msg: 'Another sync is already running.' });
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to start');
      }
      setToast({ kind: 'info', msg: `Re-syncing ${projectId}…` });
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
      <StatusHeader state={state} connected={connected} />

      <div className="p-6 space-y-6">
        {/* ZONE B: Sources (collapsible) */}
        <SourcesSection state={state} />

        {/* ZONE C: Project Explorer */}
        <ProjectExplorer
          totalProjects={state?.counts.totalProjects}
          onResync={triggerProjectResync}
          isRunning={isRunning}
          knownNames={projects}
          syncAll={state?.syncAll}
          onToast={setToast}
        />
      </div>
    </div>
  );
}

// ─── Status Header ──────────────────────────────────────────────────────────

function StatusHeader({
  state, connected,
}: {
  state: DrivePanelState | null;
  connected: boolean;
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
            </>
          ) : (
            <>
              <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-600'}`}></span>
              <span className="text-sm text-gray-300 font-semibold">Idle</span>
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
      </div>

      {/* LLM cap warning */}
      {llm && llm.remaining === 0 && (
        <div className="px-6 py-1.5 bg-red-950/50 border-t border-red-900/50 text-[11px] text-red-300">
          Daily LLM cap reached. Cycles will skip LLM stages until tomorrow.
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

      <CollapsibleCard title="Upload CDIO Gating Pre-review Excel" subtitle="Replace base project metadata from the 'CDIO internal committee' sheet">
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

// ─── Add a Drive source ─────────────────────────────────────────────────────
// Single unified flow. The engine scans the URL for PRJxxxxx subfolders and,
// for each one found, either appends the Drive link to the existing project
// (if the PRJ code already exists in `projects`) or creates a new row.

function AddSource() {
  const { refreshProjects } = useProjectContext();
  const [url, setUrl] = useState('');
  const [state, setState] = useState<'idle'|'busy'|'ok'|'err'>('idle');
  const [result, setResult] = useState<{
    created: { projectId: string; name: string }[];
    linked:  { projectId: string; name: string }[];
    unmatched: { folderName: string; extracted: string }[];
    scannedFolders: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const submit = async () => {
    if (!url.trim()) return;
    setState('busy'); setResult(null); setErrorMsg('');
    try {
      const res = await fetch('/api/drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'discover', url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setResult({
        created:        data.created   || [],
        linked:         data.linked    || [],
        unmatched:      data.unmatched || [],
        scannedFolders: data.scannedFolders ?? 0,
      });
      setState('ok');
      setUrl('');
      refreshProjects();
    } catch (err: unknown) {
      setState('err');
      setErrorMsg(err instanceof Error ? err.message : 'Failed');
    }
  };

  const renderList = (items: { projectId: string; name: string }[]) =>
    items.slice(0, 6).map(p => (
      <span key={p.projectId} className="inline-block mr-2 mb-1 font-mono">
        {p.projectId}
      </span>
    )).concat(items.length > 6
      ? [<span key="more" className="text-gray-500">+{items.length - 6} more</span>]
      : []);

  return (
    <div className="pt-3">
      <p className="text-xs text-gray-500 mb-3">
        Paste a Drive folder URL — the engine scans subfolders for any name containing{' '}
        <code className="text-gray-300">PRJ</code>. Existing projects get the link attached;
        unknown PRJ codes are created as new entries.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="https://drive.google.com/drive/folders/..."
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          className="flex-1 bg-gray-950 border border-gray-800 text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={submit}
          disabled={!url.trim() || state === 'busy'}
          className="px-5 py-2 rounded-lg bg-purple-700 text-white text-sm font-semibold hover:bg-purple-600 disabled:opacity-40"
        >
          {state === 'busy' ? 'Scanning…' : 'Add'}
        </button>
      </div>

      {state === 'err' && (
        <div className="mt-2 text-xs text-red-400">{errorMsg}</div>
      )}

      {state === 'ok' && result && (
        <div className="mt-3 space-y-2 text-xs">
          <div className="text-gray-500">
            Scanned {result.scannedFolders} folder{result.scannedFolders !== 1 ? 's' : ''} ·
            {' '}{result.linked.length} linked, {result.created.length} created
            {result.unmatched.length > 0 && `, ${result.unmatched.length} unmatched (saved as new)`}
          </div>
          {result.created.length === 0 && result.linked.length === 0 && (
            <div className="text-gray-400 italic">No folders matching the PRJ pattern were found.</div>
          )}
          {result.linked.length > 0 && (
            <div>
              <span className="text-blue-400 font-semibold">✓ Linked to {result.linked.length} existing project{result.linked.length > 1 ? 's' : ''}:</span>{' '}
              <span className="text-gray-300">{renderList(result.linked)}</span>
            </div>
          )}
          {result.created.length > 0 && (
            <div>
              <span className="text-green-400 font-semibold">+ Created {result.created.length} new project{result.created.length > 1 ? 's' : ''}:</span>{' '}
              <span className="text-gray-300">{renderList(result.created)}</span>
            </div>
          )}
          {result.unmatched.length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-yellow-400 hover:text-yellow-300">
                ⚠ {result.unmatched.length} folder{result.unmatched.length > 1 ? 's' : ''} didn&apos;t match any existing project ID
              </summary>
              <ul className="mt-1 ml-4 space-y-0.5 text-gray-400">
                {result.unmatched.slice(0, 20).map(u => (
                  <li key={u.extracted} className="font-mono text-[11px]">
                    <span className="text-yellow-500">{u.extracted}</span>
                    <span className="text-gray-600"> ← </span>
                    <span>{u.folderName}</span>
                  </li>
                ))}
                {result.unmatched.length > 20 && (
                  <li className="text-gray-500">…and {result.unmatched.length - 20} more</li>
                )}
              </ul>
            </details>
          )}
        </div>
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
        Upload the <code className="text-gray-300">Gating Pre-review – CDIO internal committee</code> workbook to populate base project metadata. Replaces all existing projects.
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
  totalProjects, onResync, isRunning, knownNames, syncAll, onToast,
}: {
  totalProjects: number | undefined;
  onResync: (projectId: string) => void;
  isRunning: boolean;
  knownNames: { projectId: string; name: string }[];
  syncAll: DrivePanelState['syncAll'] | undefined;
  onToast: (t: { kind: 'info'|'success'|'error'; msg: string } | null) => void;
}) {
  const syncing = syncAll?.status === 'running' || syncAll?.status === 'stopping';
  // Identify the project currently being processed by Sync-all (first 'counting'
  // or 'downloading' entry) so we can keep it scrolled into view as it changes.
  const activeProjectId = useMemo(() => {
    if (!syncAll || !syncing) return '';
    for (const p of Object.values(syncAll.perProject)) {
      if (p.status === 'counting' || p.status === 'downloading') return p.projectId;
    }
    return '';
  }, [syncAll, syncing]);

  const startSyncAll = useCallback(async () => {
    try {
      const res = await fetch('/api/drive/sync-all', { method: 'POST' });
      if (res.status === 409) {
        onToast({ kind: 'info', msg: 'Sync is already running.' });
        return;
      }
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to start');
      onToast({ kind: 'info', msg: 'Sync started.' });
      setTimeout(() => onToast(null), 3000);
    } catch (err: unknown) {
      onToast({ kind: 'error', msg: err instanceof Error ? err.message : 'Failed' });
      setTimeout(() => onToast(null), 5000);
    }
  }, [onToast]);

  const stopSyncAll = useCallback(async () => {
    try {
      const res = await fetch('/api/drive/sync-all', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to stop');
      onToast({ kind: 'info', msg: 'Stop requested. Finishing in-flight files…' });
      setTimeout(() => onToast(null), 4000);
    } catch (err: unknown) {
      onToast({ kind: 'error', msg: err instanceof Error ? err.message : 'Failed' });
      setTimeout(() => onToast(null), 5000);
    }
  }, [onToast]);
  const [rows, setRows] = useState<ExplorerRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ColumnFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ col: keyof ExplorerRow; dir: 'asc'|'desc' }>({ col: 'projectId', dir: 'asc' });

  const updateFilter = <K extends keyof ColumnFilters>(key: K, value: ColumnFilters[K]) =>
    setFilters(f => ({ ...f, [key]: value }));
  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const hasActiveFilter = useMemo(
    () => (Object.keys(EMPTY_FILTERS) as (keyof ColumnFilters)[]).some(
      k => filters[k] !== EMPTY_FILTERS[k]
    ),
    [filters],
  );

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
  // or when a run finishes.
  useEffect(() => { load(); }, [load]);
  const lastTotalRef = useRef<number | undefined>(undefined);
  const lastRunningRef = useRef<boolean>(false);
  useEffect(() => {
    if (totalProjects !== lastTotalRef.current) {
      lastTotalRef.current = totalProjects;
      if (rows !== null) load();
    }
    // Cycle just finished → reload once so file counts/local paths refresh.
    if (lastRunningRef.current && !isRunning && rows !== null) {
      load();
    }
    lastRunningRef.current = isRunning;
  }, [totalProjects, isRunning, load, rows]);

  // While Sync-all is running, refresh the explorer periodically so per-project
  // file counts and Local paths advance in near real-time (independent of the
  // per-row progress bar, which comes from SSE).
  useEffect(() => {
    if (!syncing) return;
    const id = setInterval(() => { load(); }, 4000);
    return () => clearInterval(id);
  }, [syncing, load]);

  // Copy-link-to-clipboard: track which row was just copied so we can flash a ✓.
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyLink = useCallback(async (projectId: string, link: string) => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(projectId);
      setTimeout(() => {
        setCopiedId(curr => (curr === projectId ? null : curr));
      }, 1500);
    } catch {
      // Clipboard API failed (e.g. insecure context) — fall back to opening a new tab.
      window.open(link, '_blank', 'noopener,noreferrer');
    }
  }, []);

  // Auto-scroll the currently downloading project into view so the user sees progress.
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  useEffect(() => {
    if (!activeProjectId) return;
    const el = rowRefs.current.get(activeProjectId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeProjectId]);

  const ddsValues = useMemo(() => {
    const set = new Set<string>();
    (rows || []).forEach(r => r.dds && set.add(r.dds));
    return Array.from(set).sort();
  }, [rows]);
  const gateValues = useMemo(() => {
    const set = new Set<string>();
    (rows || []).forEach(r => r.gate && set.add(r.gate));
    return Array.from(set).sort();
  }, [rows]);

  const visible = useMemo(() => {
    if (!rows) return [];
    let out = rows;

    const idQ   = filters.projectId.trim().toLowerCase();
    const nameQ = filters.name.trim().toLowerCase();
    if (idQ)   out = out.filter(r => r.projectId.toLowerCase().includes(idQ));
    if (nameQ) out = out.filter(r => r.name.toLowerCase().includes(nameQ));
    if (filters.dds  !== 'any') out = out.filter(r => r.dds  === filters.dds);
    if (filters.gate !== 'any') out = out.filter(r => r.gate === filters.gate);
    if (filters.files   === 'with')    out = out.filter(r => r.filesDownloaded > 0);
    if (filters.files   === 'without') out = out.filter(r => r.filesDownloaded === 0);
    if (filters.goals   === 'yes')     out = out.filter(r => r.hasGoals);
    if (filters.goals   === 'no')      out = out.filter(r => !r.hasGoals);
    if (filters.impacts === 'with')    out = out.filter(r => r.impactCount > 0);
    if (filters.impacts === 'without') out = out.filter(r => r.impactCount === 0);
    if (filters.drive   === 'yes')     out = out.filter(r => !!r.linkFolder);
    if (filters.drive   === 'no')      out = out.filter(r => !r.linkFolder);
    if (filters.local   === 'yes')     out = out.filter(r => !!r.localPath);
    if (filters.local   === 'no')      out = out.filter(r => !r.localPath);

    const dir = sort.dir === 'asc' ? 1 : -1;
    // For hasGoals (boolean), coerce to number for stable sort.
    const accessor = (r: ExplorerRow): string | number => {
      const v = r[sort.col];
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v as string | number;
    };
    out = [...out].sort((a, b) => {
      const av = accessor(a); const bv = accessor(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return out;
  }, [rows, filters, sort]);

  const toggleSort = (col: keyof ExplorerRow) => {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' });
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl">
      <div className="px-5 py-3 flex items-center gap-3 flex-wrap border-b border-gray-800">
        <div className="text-sm font-semibold text-gray-200">Projects</div>
        <div className="text-[11px] text-gray-500">{visible.length} / {rows?.length ?? 0}</div>
        {/* DEBUG: temporary indicator so we know SSE is delivering the syncAll payload. */}
        {syncAll && (
          <div className={`text-[10px] font-mono px-2 py-0.5 rounded ${
            syncing ? 'bg-blue-900/40 text-blue-300' :
            syncAll.status === 'done' && syncAll.totalProjects > 0 ? 'bg-green-900/40 text-green-300' :
            'bg-gray-800 text-gray-500'
          }`}>
            sync:{syncAll.status} · {Object.keys(syncAll.perProject).length} entries · {syncAll.doneFiles}/{syncAll.totalFiles} files
          </div>
        )}
        {syncing && syncAll && (
          <div className="flex items-center gap-2 text-[11px] text-blue-300">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
            </span>
            <span className="font-mono">
              {syncAll.doneProjects}/{syncAll.totalProjects} projects ·
              {' '}{syncAll.doneFiles}/{syncAll.totalFiles || '?'} files
            </span>
          </div>
        )}
        <div className="flex-1" />
        {hasActiveFilter && (
          <button
            onClick={clearFilters}
            className="px-2.5 py-1 rounded bg-gray-800 text-gray-300 text-xs hover:bg-gray-700"
            title="Clear all column filters"
          >Clear filters</button>
        )}
        {!syncing ? (
          <button
            onClick={startSyncAll}
            disabled={isRunning}
            className="px-3 py-1 rounded bg-blue-700 text-white text-xs font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Count and download all linked Drive folders"
          >▶ Sync all</button>
        ) : (
          <button
            onClick={stopSyncAll}
            disabled={syncAll?.status === 'stopping'}
            className="px-3 py-1 rounded bg-red-700 text-white text-xs font-semibold hover:bg-red-600 disabled:opacity-40"
            title="Stop after finishing in-flight files"
          >■ {syncAll?.status === 'stopping' ? 'Stopping…' : 'Stop all'}</button>
        )}
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
          <thead className="bg-gray-950 sticky top-0 z-10">
            <tr>
              <ColumnHeader label="ID"      col="projectId"       sort={sort} onSort={toggleSort}
                filter={<FilterInput value={filters.projectId} onChange={v => updateFilter('projectId', v)} placeholder="PRJ…" />} />
              <ColumnHeader label="Name"    col="name"            sort={sort} onSort={toggleSort}
                filter={<FilterInput value={filters.name} onChange={v => updateFilter('name', v)} placeholder="name…" />} />
              <ColumnHeader label="DDS"     col="dds"             sort={sort} onSort={toggleSort}
                filter={<FilterSelect value={filters.dds} onChange={v => updateFilter('dds', v)}
                  options={[{ value: 'any', label: 'All' }, ...ddsValues.map(v => ({ value: v, label: v }))]} />} />
              <ColumnHeader label="Gate"    col="gate"            sort={sort} onSort={toggleSort} align="center"
                filter={<FilterSelect value={filters.gate} onChange={v => updateFilter('gate', v)}
                  options={[{ value: 'any', label: 'All' }, ...gateValues.map(v => ({ value: v, label: v }))]} />} />
              <ColumnHeader label="Files"   col="filesDownloaded" sort={sort} onSort={toggleSort} align="right"
                filter={<FilterSelect value={filters.files} onChange={v => updateFilter('files', v as ColumnFilters['files'])}
                  options={[{ value: 'any', label: 'Any' }, { value: 'with', label: '>0' }, { value: 'without', label: '0' }]} />} />
              <ColumnHeader label="Goals"   col="hasGoals"        sort={sort} onSort={toggleSort} align="center"
                filter={<FilterSelect value={filters.goals} onChange={v => updateFilter('goals', v as ColumnFilters['goals'])}
                  options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />} />
              <ColumnHeader label="Impacts" col="impactCount"     sort={sort} onSort={toggleSort} align="right"
                filter={<FilterSelect value={filters.impacts} onChange={v => updateFilter('impacts', v as ColumnFilters['impacts'])}
                  options={[{ value: 'any', label: 'Any' }, { value: 'with', label: '>0' }, { value: 'without', label: '0' }]} />} />
              <ColumnHeader label="Drive"   col="linkFolder"      sort={sort} onSort={toggleSort} align="center"
                filter={<FilterSelect value={filters.drive} onChange={v => updateFilter('drive', v as ColumnFilters['drive'])}
                  options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Linked' }, { value: 'no', label: 'None' }]} />} />
              <ColumnHeader label="Local"   col="localPath"       sort={sort} onSort={toggleSort}
                filter={<FilterSelect value={filters.local} onChange={v => updateFilter('local', v as ColumnFilters['local'])}
                  options={[{ value: 'any', label: 'Any' }, { value: 'yes', label: 'Downloaded' }, { value: 'no', label: 'No' }]} />} />
              <th className="px-2 py-1.5 text-right align-top text-[10px] uppercase text-gray-500 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/60">
            {loading && rows === null && (
              <tr><td colSpan={10} className="px-5 py-6 text-center text-gray-500 text-xs">Carregando…</td></tr>
            )}
            {!loading && visible.length === 0 && rows !== null && (
              <tr><td colSpan={10} className="px-5 py-6 text-center text-gray-500 text-xs italic">No matches.</td></tr>
            )}
            {visible.map(r => {
              const ps = syncAll?.perProject[r.projectId];
              const isActive = ps?.status === 'counting' || ps?.status === 'downloading';
              const psStatus: ProjectSyncStatus | undefined = ps?.status;
              const psPct = ps && ps.totalFiles > 0
                ? Math.min(100, (ps.doneFiles / ps.totalFiles) * 100)
                : (ps?.status === 'counting' ? 5 : 0);
              // Row-wide progress: paint a gradient across the whole row that
              // fills exactly to psPct%. Color encodes the status. Opacities
              // pushed high enough to be obviously visible on the dark theme.
              const barColor =
                ps?.status === 'counting'    ? 'rgba(234,179,8,0.40)'  : // yellow-500
                ps?.status === 'downloading' ? 'rgba(59,130,246,0.45)' : // blue-500
                ps?.status === 'done'        ? 'rgba(34,197,94,0.28)'  : // green-500
                ps?.status === 'error'       ? 'rgba(239,68,68,0.40)'  : // red-500
                ps?.status === 'skipped'     ? 'rgba(107,114,128,0.32)': // gray-500
                                               'transparent';
              const rowStyle: React.CSSProperties | undefined =
                ps && ps.status !== 'pending'
                  ? {
                      backgroundImage: `linear-gradient(to right, ${barColor} ${psPct}%, transparent ${psPct}%)`,
                      transition: 'background-image 300ms linear',
                    }
                  : undefined;
              return (
              <tr
                key={r.projectId}
                ref={(el) => {
                  if (el) rowRefs.current.set(r.projectId, el);
                  else rowRefs.current.delete(r.projectId);
                }}
                style={rowStyle}
                className={`hover:bg-gray-800/30 ${isActive ? 'shadow-[inset_3px_0_0_0_rgb(59_130_246)]' : ''}`}
              >
                <td className="px-2 py-1.5 font-mono text-gray-200">
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot status={psStatus} />
                    {r.projectId}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-gray-300 max-w-xs truncate" title={r.name}>{r.name || '—'}</td>
                <td className="px-2 py-1.5 text-gray-400">{r.dds || '—'}</td>
                <td className="px-2 py-1.5 text-center text-gray-400">{r.gate || '—'}</td>
                <td className="px-2 py-1.5 text-right font-mono">
                  {ps && ps.status !== 'pending' ? (
                    <span className={ps.status === 'error' ? 'text-red-400' : 'text-blue-300'}>
                      {ps.doneFiles}{ps.totalFiles > 0 && <span className="text-gray-500">/{ps.totalFiles}</span>}
                    </span>
                  ) : (
                    <span className={r.filesDownloaded > 0 ? 'text-blue-300' : 'text-gray-600'}>
                      {r.filesDownloaded}
                    </span>
                  )}
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
                  {r.linkFolder ? (
                    <button
                      onClick={() => copyLink(r.projectId, r.linkFolder.split(' ')[0])}
                      title={copiedId === r.projectId ? 'Copied!' : `Copy link\n${r.linkFolder.split(' ')[0]}`}
                      className={`inline-flex items-center justify-center w-6 h-6 rounded transition-colors ${
                        copiedId === r.projectId
                          ? 'text-green-400'
                          : 'text-blue-400 hover:bg-gray-800 hover:text-blue-300'
                      }`}
                    >
                      {copiedId === r.projectId ? '✓' : '⧉'}
                    </button>
                  ) : (
                    <span className="text-gray-700">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 font-mono text-[10px] max-w-[260px]">
                  {r.localPath ? (
                    <span className="text-gray-400 truncate inline-block max-w-full align-bottom" title={r.localPath}>
                      {r.localPath}
                    </span>
                  ) : (
                    <span className="text-gray-700">—</span>
                  )}
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
              );
            })}
          </tbody>
        </table>
      </div>
      {/* knownNames is here just to silence unused warning if needed */}
      <span className="hidden">{knownNames.length}</span>
    </div>
  );
}

// Combined sort + filter header. The label area is clickable to toggle sort
// direction; the filter input/select lives directly below in the same column,
// so each control unambiguously belongs to its column.
function ColumnHeader({
  label, col, sort, onSort, filter, align = 'left',
}: {
  label: string;
  col: keyof ExplorerRow;
  sort: { col: keyof ExplorerRow; dir: 'asc'|'desc' };
  onSort: (col: keyof ExplorerRow) => void;
  filter: React.ReactNode;
  align?: 'left'|'right'|'center';
}) {
  const isActive = sort.col === col;
  const justify = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className="px-1.5 py-1.5 align-top">
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => onSort(col)}
          className={`flex items-center gap-1 ${justify} text-[10px] uppercase font-medium text-gray-500 hover:text-gray-200 cursor-pointer select-none`}
        >
          <span>{label}</span>
          <span className="text-gray-400 w-2 inline-block">
            {isActive ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
          </span>
        </button>
        <div onClick={e => e.stopPropagation()}>{filter}</div>
      </div>
    </th>
  );
}

function FilterInput({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded px-1.5 py-0.5 text-[11px] font-normal normal-case focus:outline-none focus:border-blue-500 placeholder:text-gray-600"
    />
  );
}

function StatusDot({ status }: { status: ProjectSyncStatus | undefined }) {
  if (!status || status === 'pending') return null;
  const cls = status === 'counting'    ? 'bg-yellow-400 animate-pulse ring-yellow-300/40' :
              status === 'downloading' ? 'bg-blue-400 animate-pulse ring-blue-300/40' :
              status === 'done'        ? 'bg-green-500 ring-green-400/30' :
              status === 'error'       ? 'bg-red-500 ring-red-400/40' :
                                         'bg-gray-500 ring-gray-400/30';
  const tip = status === 'counting' ? 'Counting files in Drive…' :
              status === 'downloading' ? 'Downloading…' :
              status === 'done' ? 'Done' :
              status === 'error' ? 'Error' :
                                   'Skipped';
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ring-2 ${cls}`} title={tip} />;
}

function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      onClick={e => e.stopPropagation()}
      className="w-full bg-gray-900 border border-gray-700 text-gray-200 rounded px-1 py-0.5 text-[11px] font-normal normal-case focus:outline-none focus:border-blue-500 cursor-pointer"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function describeCron(cron: string): string {
  const preset = SCHEDULE_PRESETS.find(p => p.cron === cron);
  if (preset) return preset.label;
  return cron;
}

