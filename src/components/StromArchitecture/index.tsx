'use client';

import { useEffect, useState } from 'react';
import ArchitectureCanvas from './canvas';
import DetailPanel from './panels/DetailPanel';
import { getStage } from './stages';

export interface StromStats {
  projects: number;
  documents: { success: number; skipped: number; error: number; total: number };
  goals: { success: number; v4: number };
  impacts: { total: number; withCitations: number; withChain: number };
  deepDives: number;
}

export default function StromArchitecture() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState<StromStats | null>(null);
  const selectedStage = selectedId ? getStage(selectedId) : null;

  // Live stats — polled lightly. Cheap query, ~1KB response.
  useEffect(() => {
    let alive = true;
    const fetchStats = () =>
      fetch('/api/strom/stats')
        .then(r => r.json())
        .then(d => { if (alive && !d.error) setStats(d); })
        .catch(() => {});
    fetchStats();
    const id = setInterval(fetchStats, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <Header stats={stats} />
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0">
          <ArchitectureCanvas selectedId={selectedId} onSelect={setSelectedId} />
        </div>
        {selectedStage && (
          <DetailPanel stage={selectedStage} stats={stats} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </div>
  );
}

function Header({ stats }: { stats: StromStats | null }) {
  return (
    <div className="shrink-0 px-6 py-3 border-b border-line bg-surface-1">
      <div className="flex items-center justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-ink-1">Alumen Pipeline Architecture</h1>
          <p className="text-[11px] text-ink-muted mt-0.5">
            Click any stage to inspect inputs, outputs, code, and run controls.
          </p>
        </div>
        <div className="flex items-center gap-5 text-xs">
          <Counter label="Projects" value={stats?.projects} tone="cyan" />
          <Counter label="Docs (success)" value={stats?.documents.success} tone="cyan" sub={stats ? `${stats.documents.skipped} skipped` : undefined} />
          <Counter label="Goals v4" value={stats?.goals.v4} tone="emerald" />
          <Counter label="Impacts" value={stats?.impacts.total} tone="orange" sub={stats ? `${pct(stats.impacts.withChain, stats.impacts.total)}% chained` : undefined} />
          <Counter label="Deep dives" value={stats?.deepDives} tone="orange" />
        </div>
      </div>
    </div>
  );
}

function Counter({ label, value, tone, sub }: { label: string; value?: number; tone: 'cyan' | 'orange' | 'emerald'; sub?: string }) {
  const toneClass = tone === 'cyan' ? 'text-cyan-300' : tone === 'orange' ? 'text-orange-300' : 'text-emerald-300';
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wider text-ink-muted">{label}</span>
      <span className={`text-base font-mono font-bold ${toneClass}`}>
        {value ?? '—'}
      </span>
      {sub && <span className="text-[9px] text-ink-faint">{sub}</span>}
    </div>
  );
}

function pct(num: number, den: number): string {
  if (!den) return '0';
  return (100 * num / den).toFixed(1);
}
