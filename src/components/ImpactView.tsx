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

const TYPE_LABELS: Record<string, string> = {
  technology_dependency: 'Technology',
  infrastructure_shared: 'Infrastructure',
  data_dependency: 'Data',
  timeline_blocking: 'Timeline',
  resource_contention: 'Resource',
  organizational: 'Organizational',
  platform_shared: 'Platform',
  vendor_shared: 'Vendor',
  integration_required: 'Integration',
  security_dependency: 'Security',
};

export default function ImpactView() {
  const { projects, setSelected } = useProjectContext();
  const [impacts, setImpacts] = useState<ProjectImpact[]>([]);
  const [status, setStatus] = useState<ImpactAnalysisStatus | null>(null);
  const [stats, setStats] = useState<{ total: number; bySeverity: Record<string, number>; byType: Record<string, number>; byDirection: Record<string, number> } | null>(null);
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterType, setFilterType] = useState('All');
  const [filterProject, setFilterProject] = useState('');
  const [isStarting, setIsStarting] = useState(false);

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
            loadData(); // Refresh full data when done
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

  const filtered = useMemo(() => {
    return impacts.filter(imp => {
      if (filterSeverity !== 'All' && imp.severity !== filterSeverity) return false;
      if (filterType !== 'All' && imp.impactType !== filterType) return false;
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
  }, [impacts, filterSeverity, filterType, filterProject, projects]);

  const projectMap = useMemo(() => {
    const m = new Map<string, { name: string; dds: string }>();
    projects.forEach(p => m.set(p.projectId, { name: p.name, dds: p.dds }));
    return m;
  }, [projects]);

  const impactTypes = useMemo(() =>
    ['All', ...Array.from(new Set(impacts.map(i => i.impactType))).sort()],
    [impacts]
  );

  return (
    <div className="flex-1 overflow-auto p-6 animate-fadeIn">
      {/* Status / Launch bar */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-100">Impact Analysis Engine</h2>
            <p className="text-sm text-gray-500">
              Gemini analyzes ALL projects to identify impact relationships — technology dependencies, shared platforms, timeline blocking, etc.
            </p>
          </div>
          <button
            onClick={startAnalysis}
            disabled={status?.isRunning || isStarting}
            className="px-5 py-2.5 rounded-lg bg-blue-700 text-white text-sm font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {status?.isRunning ? 'Running...' : isStarting ? 'Starting...' : impacts.length > 0 ? 'Re-run Analysis' : 'Start Full Analysis'}
          </button>
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
            className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500"
          >
            {impactTypes.map(t => (
              <option key={t} value={t}>{t === 'All' ? 'All Types' : TYPE_LABELS[t] || t}</option>
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
        <div className="space-y-2">
          {filtered.slice(0, 200).map(imp => {
            const src = projectMap.get(imp.sourceProjectId);
            const tgt = projectMap.get(imp.targetProjectId);
            const sevColor = SEVERITY_COLORS[imp.severity] || '#6b7280';

            return (
              <div key={imp.id}
                className="bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* Severity dot */}
                  <div className="mt-1 shrink-0">
                    <div className="w-3 h-3 rounded-full" style={{ background: sevColor }} title={imp.severity} />
                  </div>

                  {/* Source → Target */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      {/* Source */}
                      <button
                        onClick={() => setSelected(imp.sourceProjectId)}
                        className="text-sm font-semibold text-gray-100 hover:text-blue-300 transition-colors text-left"
                      >
                        <span className="text-[10px] font-mono mr-1" style={{ color: getDDSColor(src?.dds || '') }}>
                          {imp.sourceProjectId.replace('PRJ00', '')}
                        </span>
                        {src?.name || imp.sourceProjectId}
                      </button>

                      {/* Arrow with direction */}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 shrink-0">
                        {DIRECTION_LABELS[imp.direction] || imp.direction} →
                      </span>

                      {/* Target */}
                      <button
                        onClick={() => setSelected(imp.targetProjectId)}
                        className="text-sm font-semibold text-gray-100 hover:text-blue-300 transition-colors text-left"
                      >
                        <span className="text-[10px] font-mono mr-1" style={{ color: getDDSColor(tgt?.dds || '') }}>
                          {imp.targetProjectId.replace('PRJ00', '')}
                        </span>
                        {tgt?.name || imp.targetProjectId}
                      </button>
                    </div>

                    {/* Explanation */}
                    <div className="text-xs text-gray-400 leading-relaxed">{imp.explanation}</div>

                    {/* Badges */}
                    <div className="flex gap-1.5 mt-2">
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
                        style={{ background: `${sevColor}22`, color: sevColor }}>
                        {imp.severity}
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-gray-800 text-gray-400">
                        {TYPE_LABELS[imp.impactType] || imp.impactType}
                      </span>
                      {src?.dds && (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
                          style={{ background: `${getDDSColor(src.dds)}22`, color: getDDSColor(src.dds) }}>
                          {src.dds}
                        </span>
                      )}
                      {tgt?.dds && tgt.dds !== src?.dds && (
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
                          style={{ background: `${getDDSColor(tgt.dds)}22`, color: getDDSColor(tgt.dds) }}>
                          {tgt.dds}
                        </span>
                      )}
                    </div>
                  </div>
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
    </div>
  );
}
