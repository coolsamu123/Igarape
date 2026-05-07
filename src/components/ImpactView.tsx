'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useProjectContext } from '@/context/ProjectContext';
import { getDDSColor } from '@/lib/constants';
import { DDS_CATALOG } from '@/lib/dds-catalog';
import LoadingState from './LoadingState';
import EvidencePanel from './EvidencePanel';
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
  const { projects, filtered: globalFilteredProjects, filters, openUniverse } = useProjectContext();
  const [impacts, setImpacts] = useState<ProjectImpact[]>([]);
  const [status, setStatus] = useState<ImpactAnalysisStatus | null>(null);
  const [stats, setStats] = useState<{ total: number; bySeverity: Record<string, number>; byType: Record<string, number>; byDirection: Record<string, number> } | null>(null);
  const [filterSeverity, setFilterSeverity] = useState('All');
  const [filterGioService, setFilterGioService] = useState('All');
  const [filterDdsEntity, setFilterDdsEntity] = useState('All');
  const [filterImpactType, setFilterImpactType] = useState('All');
  const [filterProject, setFilterProject] = useState('');
  const [expandedEvidenceId, setExpandedEvidenceId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/impact');
      const data = await res.json();
      if (data.impacts) setImpacts(data.impacts);
      if (data.stats) setStats(data.stats);
      if (data.status) setStatus(data.status);
    } catch { /* ignore */ }
    setLoading(false);
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
      // Scope: this view only lists impacts onto the GIO Service Lines and the
      // DDS entities. Cross-project impacts ("infrastructure shared",
      // "platform shared", etc.) are not shown here.
      const isPseudoTarget =
        imp.targetProjectId === 'GIO_SERVICES' ||
        imp.targetProjectId === 'DDS_IMPACTS' ||
        imp.sourceProjectId === 'GIO_SERVICES' ||
        imp.sourceProjectId === 'DDS_IMPACTS';
      if (!isPseudoTarget) return false;

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
      // DDS_IMPACTS pseudo-project is always visible (entity-level impacts apply
      // regardless of which DDS is selected in the global filter)
      if (imp.targetProjectId === 'DDS_IMPACTS' || imp.sourceProjectId === 'DDS_IMPACTS') {
        isTargetVisible = true;
      }

      if (!isSourceVisible && !isTargetVisible) return false;

      // Apply local impact-specific filters
      if (filterSeverity !== 'All' && imp.severity !== filterSeverity) return false;

      if (filterGioService !== 'All') {
        const svc = filterGioService.replace('GIO_', '');
        if (!imp.gioServices?.includes(svc)) return false;
      }

      if (filterDdsEntity !== 'All') {
        if (!imp.ddsEntities?.includes(filterDdsEntity)) return false;
      }

      if (filterImpactType !== 'All') {
        const types = imp.impactTypes ?? [imp.impactType];
        if (!types.includes(filterImpactType)) return false;
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
    }).sort((a, b) => {
      // Group order: GIO Services rows first, then DDS Entities rows.
      const groupOf = (imp: ProjectImpact): number => {
        const isGio = imp.targetProjectId === 'GIO_SERVICES' || imp.sourceProjectId === 'GIO_SERVICES';
        if (isGio) return 0;
        const isDds = imp.targetProjectId === 'DDS_IMPACTS' || imp.sourceProjectId === 'DDS_IMPACTS';
        if (isDds) return 1;
        return 2;
      };
      const g = groupOf(a) - groupOf(b);
      if (g !== 0) return g;
      // Within each group, keep severity-first ordering (high → medium → low).
      const sevRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      return (sevRank[b.severity] ?? 0) - (sevRank[a.severity] ?? 0);
    });
  }, [impacts, filterSeverity, filterGioService, filterDdsEntity, filterImpactType, filterProject, projects, globalFilteredProjects, filters.dds]);

  const projectMap = useMemo(() => {
    const m = new Map<string, { name: string; dds: string }>();
    projects.forEach(p => m.set(p.projectId, { name: p.name, dds: p.dds }));
    return m;
  }, [projects]);

  const filterOptions = useMemo(() => {
    const types = new Set<string>();
    const gioSvc = new Set<string>();
    const ddsEnt = new Set<string>();
    for (const i of impacts) {
      for (const t of i.impactTypes ?? [i.impactType]) types.add(t);
      for (const s of i.gioServices ?? []) gioSvc.add(s);
      for (const d of i.ddsEntities ?? []) ddsEnt.add(d);
    }
    // Sort DDS entities by catalog order so the dropdown is stable
    const ddsOrdered = DDS_CATALOG.filter(d => ddsEnt.has(d));
    return {
      impactTypes: Array.from(types).sort(),
      gioServices: Array.from(gioSvc).sort(),
      ddsEntities: ddsOrdered,
    };
  }, [impacts]);

  if (loading) {
    return <LoadingState />;
  }

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
            value={filterGioService}
            onChange={e => setFilterGioService(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500 max-w-[200px]"
          >
            <option value="All">All GIO Services</option>
            {filterOptions.gioServices.map(s => (
              <option key={`GIO_${s}`} value={`GIO_${s}`}>{s}</option>
            ))}
          </select>
          <select
            value={filterDdsEntity}
            onChange={e => setFilterDdsEntity(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500 max-w-[200px]"
          >
            <option value="All">All DDS Entities</option>
            {filterOptions.ddsEntities.map(d => (
              <option key={`DDS_${d}`} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={filterImpactType}
            onChange={e => setFilterImpactType(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500 max-w-[200px]"
          >
            <option value="All">All Impact Types</option>
            {filterOptions.impactTypes.map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
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

      {/* Impact list — one card per project, merging GIO and DDS impacts. */}
      {filtered.length > 0 && (() => {
        const SEV_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
        const realProjectId = (imp: ProjectImpact): string | null => {
          if (imp.sourceProjectId !== 'GIO_SERVICES' && imp.sourceProjectId !== 'DDS_IMPACTS') return imp.sourceProjectId;
          if (imp.targetProjectId !== 'GIO_SERVICES' && imp.targetProjectId !== 'DDS_IMPACTS') return imp.targetProjectId;
          return null;
        };

        // Group filtered impacts by project. Each group can have at most 2 rows
        // after aggregation: one for GIO_SERVICES and one for DDS_IMPACTS.
        const groups = new Map<string, { gio?: ProjectImpact; dds?: ProjectImpact }>();
        for (const imp of filtered) {
          const pid = realProjectId(imp);
          if (!pid) continue;
          const slot = groups.get(pid) ?? {};
          const isGio = imp.sourceProjectId === 'GIO_SERVICES' || imp.targetProjectId === 'GIO_SERVICES';
          if (isGio) slot.gio = imp; else slot.dds = imp;
          groups.set(pid, slot);
        }

        const cards = Array.from(groups.entries()).map(([pid, slot]) => {
          const meta = projectMap.get(pid);
          const gio = slot.gio;
          const dds = slot.dds;
          const sevs = [gio?.severity, dds?.severity].filter(Boolean) as string[];
          const maxSev = sevs.sort((a, b) => (SEV_RANK[b] ?? 0) - (SEV_RANK[a] ?? 0))[0] || 'low';
          return { pid, meta, gio, dds, severity: maxSev };
        }).sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0));

        const limited = cards.slice(0, 200);

        return (
          <div className="space-y-3">
            {limited.map(({ pid, meta, gio, dds, severity }) => {
              const sevColor = SEVERITY_COLORS[severity] || '#6b7280';
              const ddsColorOfProject = getDDSColor(meta?.dds || '');
              const projectName = meta?.name || pid;
              return (
                <div key={pid}
                  onClick={() => openUniverse(pid)}
                  className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3.5 transition-colors cursor-pointer hover:bg-gray-800/60 hover:border-gray-600 hover:shadow-lg"
                  style={{ borderLeftColor: sevColor, borderLeftWidth: '3px' }}
                  title="Abrir Project Universe"
                >
                  {/* Header row: ID + name (left) ·  severity (right) */}
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ background: sevColor }} />
                      <span className="text-[10px] font-mono shrink-0 text-gray-400">{pid}</span>
                      <span className="text-[13px] font-semibold text-gray-100 truncate" title={projectName}>{projectName}</span>
                    </div>
                    <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0"
                      style={{ background: `${sevColor}22`, color: sevColor }}>
                      {severity}
                    </span>
                  </div>

                  {/* Two right-aligned rows of badges: GIO services (top), DDS entities (bottom) */}
                  <div className="space-y-1.5 mb-2">
                    {gio?.gioServices && gio.gioServices.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {gio.gioServices.map(svc => (
                          <span key={`gio-${svc}`} className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-900/30 text-purple-300 border border-purple-800/50">
                            {svc}
                          </span>
                        ))}
                      </div>
                    )}
                    {dds?.ddsEntities && dds.ddsEntities.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {dds.ddsEntities.map(ent => {
                          const c = getDDSColor(ent);
                          return (
                            <span key={`dds-${ent}`} className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold border"
                              style={{ background: `${c}22`, color: c, borderColor: `${c}55` }}>
                              {ent}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Explanations */}
                  <div className="pl-[18px] space-y-1.5">
                    {gio?.explanation && (
                      <div className="text-xs text-gray-300 leading-relaxed">
                        <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wide mr-1.5">GIO</span>
                        {gio.explanation}
                      </div>
                    )}
                    {dds?.explanation && (
                      <div className="text-xs text-gray-300 leading-relaxed">
                        <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wide mr-1.5">DDS</span>
                        {dds.explanation}
                      </div>
                    )}
                  </div>

                  {/* Evidence expand toggle */}
                  <div className="pl-[18px] mt-2.5 flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedEvidenceId(prev => prev === pid ? null : pid);
                      }}
                      className="text-[10px] uppercase tracking-wider text-gray-400 hover:text-blue-300 transition-colors flex items-center gap-1"
                    >
                      <span>{expandedEvidenceId === pid ? '▾' : '▸'}</span>
                      <span>Evidence</span>
                    </button>
                    <span className="text-[10px] text-gray-600">
                      · click anywhere else to open Project Universe
                    </span>
                  </div>

                  {expandedEvidenceId === pid && (
                    <div
                      className="pl-[18px] mt-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <EvidencePanel
                        projectId={pid}
                        highlight={gio && dds ? null : (gio ? 'gio' : 'dds')}
                        compact={false}
                        deepDiveTargets={[
                          ...((gio?.gioServices ?? []).map(svc => ({ kind: 'gio' as const, target: svc }))),
                          ...((dds?.ddsEntities ?? []).map(ent => ({ kind: 'dds' as const, target: ent }))),
                        ]}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {cards.length > 200 && (
              <div className="text-center text-sm text-gray-500 py-4">
                Mostrando 200 de {cards.length} projetos — use filtros pra reduzir
              </div>
            )}
          </div>
        );
      })()}

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
