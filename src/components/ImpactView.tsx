'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useProjectContext } from '@/context/ProjectContext';
import { getDDSColor } from '@/lib/constants';
import type { ProjectImpact, ImpactAnalysisStatus } from '@/lib/types';

const SEVERITY_COLORS: Record<string, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#6b7280',
};

const DIRECTION_LABELS: Record<string, string> = {
  blocks: 'Blocks',
  enables: 'Enables',
  shares_resource: 'Shares resource',
  feeds_data: 'Feeds data',
  competes_with: 'Competes with',
  requires_coordination: 'Requires coordination',
};


export default function ImpactView() {
  const { projects, filtered: globalFilteredProjects, filters } = useProjectContext();
  const [impacts, setImpacts] = useState<ProjectImpact[]>([]);
  const [status, setStatus] = useState<ImpactAnalysisStatus | null>(null);
  const [stats, setStats] = useState<{ total: number; bySeverity: Record<string, number>; byType: Record<string, number>; byDirection: Record<string, number> } | null>(null);
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [filterProject, setFilterProject] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/impact');
      const data = await res.json();
      if (data.impacts) setImpacts(data.impacts);
      if (data.stats) setStats(data.stats);
      if (data.status) setStatus(data.status);
    } catch { /* ignore */ }
  }, []);

  // Initial load
  useEffect(() => { loadData(); }, [loadData]);

  // Poll while running
  useEffect(() => {
    if (!status?.isRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/impact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
        });
        const data = await res.json();
        if (data.status) {
          setStatus(data.status);
          if (!data.status.isRunning) {
            loadData();
          }
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [status?.isRunning, loadData]);

  const startAnalysis = async () => {
    setIsStarting(true);
    try {
      const res = await fetch('/api/impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (data.status) setStatus(data.status);
    } catch { /* ignore */ }
    setIsStarting(false);
  };

  const eraseImpacts = async () => {
    if (status?.isRunning || isClearing) return;
    const confirmed = window.confirm(
      `Erase all ${stats?.total ?? impacts.length} stored impacts? This cannot be undone.`
    );
    if (!confirmed) return;
    setIsClearing(true);
    try {
      const res = await fetch('/api/impact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      });
      const data = await res.json();
      if (res.ok) {
        setImpacts([]);
        setStats({ total: 0, bySeverity: {}, byType: {}, byDirection: {} });
        if (data.status) setStatus(data.status);
      }
    } catch { /* ignore */ }
    setIsClearing(false);
  };

  const filtered = useMemo(() => {
    // Create a Set of globally filtered project IDs for O(1) lookups
    const globalFilteredIds = new Set(globalFilteredProjects.map(p => p.projectId));

    return impacts.filter(imp => {
      // Respect the global ProjectContext filters (Toolbar filters)
      // An impact is shown ONLY IF at least one of the projects involved (source OR target)
      // is currently visible in the global filter (e.g. DDS = 'GIO')
      let isSourceVisible = globalFilteredIds.has(imp.sourceProjectId);
      let isTargetVisible = globalFilteredIds.has(imp.targetProjectId);
      
      // Special case for GIO Services pseudo-project
      if (imp.targetProjectId === 'GIO_SERVICES' && (filters.dds === 'All' || filters.dds === 'GIO')) {
        isTargetVisible = true;
      }
      if (imp.sourceProjectId === 'GIO_SERVICES' && (filters.dds === 'All' || filters.dds === 'GIO')) {
        isSourceVisible = true;
      }
      
      if (!isSourceVisible && !isTargetVisible) return false;

      // Apply local impact-specific filters
      if (filterSeverity !== 'All' && imp.severity !== filterSeverity) return false;
      
      if (filterType !== 'All') {
        const svc = filterType.replace('GIO_', '');
        if (!imp.gioServices?.includes(svc)) return false;
      }
      
      if (filterProject) {
        const s = filterProject.toLowerCase();
        const srcName = projects.find(p => p.projectId === imp.sourceProjectId)?.name || '';
        const tgtName = projects.find(p => p.projectId === imp.targetProjectId)?.name || '';
        const match = imp.sourceProjectId.toLowerCase().includes(s) ||
          imp.targetProjectId.toLowerCase().includes(s) ||
          srcName.toLowerCase().includes(s) ||
          tgtName.toLowerCase().includes(s);
        if (!match) return false;
      }
      return true;
    });
  }, [impacts, filterSeverity, filterType, filterProject, projects, globalFilteredProjects, filters.dds]);

  const projectMap = useMemo(() => {
    const m = new Map<string, { name: string; dds: string }>();
    projects.forEach(p => m.set(p.projectId, { name: p.name, dds: p.dds }));
    return m;
  }, [projects]);

  const filterOptions = useMemo(() => {
    const types = new Set(impacts.map(i => i.impactType));
    const gioSvc = new Set(impacts.flatMap(i => i.gioServices || []));
    return {
      impactTypes: Array.from(types).sort(),
      gioServices: Array.from(gioSvc).sort(),
    };
  }, [impacts]);

  return (
    <div className="flex-1 overflow-auto p-6 animate-fadeIn">
      <>
      {/* Status / Launch bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-100">Impact Analysis Engine</h2>
            <p className="text-sm text-gray-500">
              Gemini analyzes ALL projects to identify impact relationships — technology dependencies, shared platforms, timeline blocking, etc.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={eraseImpacts}
              disabled={status?.isRunning || isClearing || (stats?.total ?? impacts.length) === 0}
              className="px-4 py-2.5 rounded-lg bg-red-900/60 text-red-200 text-sm font-semibold hover:bg-red-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border border-red-800/60"
              title="Delete all stored impacts from the database"
            >
              {isClearing ? 'Erasing...' : 'Erase All'}
            </button>
            <button
              onClick={startAnalysis}
              disabled={status?.isRunning || isStarting}
              className="px-5 py-2.5 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {status?.isRunning ? 'Running...' : isStarting ? 'Starting...' : impacts.length > 0 ? 'Re-run Analysis' : 'Start Full Analysis'}
            </button>
          </div>
        </div>

        {/* Progress */}
        {status?.isRunning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">
                Batch {status.completedBatches}/{status.totalBatches} — {status.currentBatchDDS}
              </span>
              <span className="text-blue-400 font-semibold">{status.totalImpacts} impacts found</span>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${status.totalBatches > 0 ? (status.completedBatches / status.totalBatches) * 100 : 0}%` }}
              />
            </div>
            {status.errors.length > 0 && (
              <div className="text-xs text-red-400 mt-1">
                {status.errors.length} error(s): {status.errors[status.errors.length - 1]}
              </div>
            )}
          </div>
        )}

        {/* Stats summary */}
        {stats && stats.total > 0 && !status?.isRunning && (
          <div className="flex gap-4 flex-wrap">
            <div className="bg-gray-800 rounded-lg px-4 py-2">
              <div className="text-xs text-gray-500">Total Impacts</div>
              <div className="text-xl font-bold text-gray-100 font-mono">{stats.total}</div>
            </div>
            {Object.entries(stats.bySeverity).sort().map(([sev, count]) => (
              <div key={sev} className="bg-gray-800 rounded-lg px-4 py-2">
                <div className="text-xs" style={{ color: SEVERITY_COLORS[sev] || '#6b7280' }}>
                  {sev.charAt(0).toUpperCase() + sev.slice(1)}
                </div>
                <div className="text-xl font-bold text-gray-100 font-mono">{count}</div>
              </div>
            ))}
            <div className="bg-gray-800 rounded-lg px-4 py-2">
              <div className="text-xs text-gray-500">Impact Types</div>
              <div className="text-xl font-bold text-gray-100 font-mono">{Object.keys(stats.byType).length}</div>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      {impacts.length > 0 && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <span className="text-xs text-gray-500">Filter:</span>
          <select
            value={filterSeverity}
            onChange={e => setFilterSeverity(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500"
          >
            <option value="All">All Severity</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500 max-w-[200px]"
          >
            <option value="All">All GIO Services</option>
            {filterOptions.gioServices.map(s => (
              <option key={`GIO_${s}`} value={`GIO_${s}`}>{s}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search project..."
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-3 py-1 text-[13px] focus:outline-none focus:border-blue-500 w-48"
          />
          <div className="flex-1" />
          <span className="text-xs text-gray-500">{filtered.length} relationships shown</span>
        </div>
      )}

      {/* Impact list */}
      {filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.slice(0, 200).map(imp => {
            const src = projectMap.get(imp.sourceProjectId);
            const tgt = projectMap.get(imp.targetProjectId);
            const sevColor = SEVERITY_COLORS[imp.severity] || '#6b7280';
            const srcName = imp.sourceProjectId === 'GIO_SERVICES' ? 'GIO Services & Infrastructure' : src?.name || imp.sourceProjectId;
            const tgtName = imp.targetProjectId === 'GIO_SERVICES' ? 'GIO Services & Infrastructure' : tgt?.name || imp.targetProjectId;

            return (
              <div key={imp.id}
                className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3.5 hover:bg-gray-800/40 hover:border-gray-700 transition-colors"
                style={{ borderLeftColor: sevColor, borderLeftWidth: '3px' }}
              >
                {/* Row 1: Direction → Target + badges */}
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ background: sevColor }} />
                    <span className="text-[13px] font-semibold text-gray-100">
                      {DIRECTION_LABELS[imp.direction] || imp.direction} → {tgtName}
                    </span>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold"
                      style={{ background: `${sevColor}22`, color: sevColor }}>
                      {imp.severity}
                    </span>
                    {imp.gioServices && imp.gioServices.map(svc => (
                      <span key={svc} className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-purple-900/30 text-purple-300 border border-purple-800/50">
                        {svc}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Row 2: Source project name + ID */}
                <div className="flex items-center gap-2 mb-1.5 pl-[18px]">
                  {srcName !== imp.sourceProjectId && (
                    <span className="text-xs text-gray-400">{srcName}</span>
                  )}
                  <span className="text-[10px] font-mono" style={{ color: getDDSColor(src?.dds || '') }}>
                    {imp.sourceProjectId === 'GIO_SERVICES' ? '' : imp.sourceProjectId}
                  </span>
                </div>

                {/* Row 3: Full explanation */}
                <div className="text-xs text-gray-300 leading-relaxed pl-[18px]">
                  {imp.explanation}
                </div>
              </div>
            );
          })}
          {filtered.length > 200 && (
            <div className="text-center text-sm text-gray-500 py-4">
              Showing 200 of {filtered.length} — use filters to narrow down
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {impacts.length === 0 && !status?.isRunning && (
        <div className="text-center text-gray-500 py-20">
          <div className="text-4xl mb-4">→</div>
          <div className="text-lg font-semibold text-gray-300 mb-2">No impact analysis yet</div>
          <div className="text-sm">Click &ldquo;Start Full Analysis&rdquo; to let Gemini analyze all projects</div>
        </div>
      )}
      </>
    </div>
  );
}
