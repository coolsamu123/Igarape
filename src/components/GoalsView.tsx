'use client';

import { useState, useEffect, useCallback } from 'react';
import LoadingState from './LoadingState';

interface ProjectGoals {
  id: number;
  project_id: string;
  project_name: string;
  region: string;
  gate: string;
  month_folder: string;
  summary_one_line: string;
  digital_technologies: string;
  change_management: string;
  security_impacts: string;
  regional_impacts: string;
  ia_embedded: string;
  gio_sl_dds_impacts: string;
  dds_gio_workload: string;
  business_apps_cis: string;
  dds_entities_touched: string;     // JSON
  gio_services_touched: string;     // JSON
  tech_tags: string;                // JSON
  vendors: string;                  // JSON
  data_classifications: string;     // JSON
  mentioned_projects: string;       // JSON
  prompt_version: number;
  source_files: string;
  analyzed_at: string;
  status: string;
  error_message: string;
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : []; }
  catch { return []; }
}

interface RunStatus {
  isRunning: boolean;
  totalProjects: number;
  processedProjects: number;
  successCount: number;
  errorCount: number;
  currentProject: string;
  errors: string[];
}

const FIELDS = [
  { key: 'digital_technologies', label: 'Digital Technologies' },
  { key: 'change_management', label: 'Change Management' },
  { key: 'security_impacts', label: 'Security Impacts (DRMT)' },
  { key: 'regional_impacts', label: 'Regional Impacts' },
  { key: 'ia_embedded', label: 'AI Embedded' },
  { key: 'gio_sl_dds_impacts', label: 'GIO SL / DDS Impacts' },
  { key: 'dds_gio_workload', label: 'DDS / GIO Workload' },
  { key: 'business_apps_cis', label: 'Business Apps & CIs' },
] as const;

export default function GoalsView() {
  const [goals, setGoals] = useState<ProjectGoals[]>([]);
  const [status, setStatus] = useState<RunStatus | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterRegion, setFilterRegion] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterRegion) params.set('region', filterRegion);
      if (filterStatus) params.set('status', filterStatus);
      const res = await fetch(`/api/goals?${params}`);
      const data = await res.json();
      setGoals(data.goals || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [filterRegion, filterStatus]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/goals?action=status');
      const data = await res.json();
      setStatus(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchGoals();
    fetchStatus();
  }, [fetchGoals, fetchStatus]);

  // Poll status while running
  useEffect(() => {
    if (!status?.isRunning) return;
    const interval = setInterval(() => {
      fetchStatus();
      fetchGoals();
    }, 3000);
    return () => clearInterval(interval);
  }, [status?.isRunning, fetchStatus, fetchGoals]);


  const handleRunSingle = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch('/api/goals', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_single', projectId })
    });
    fetchStatus();
  };

  const startAnalysis = async () => {
    await fetch('/api/goals', { method: 'POST' });
    fetchStatus();
  };

  const exportCsv = () => {
    window.open('/api/goals?action=export', '_blank');
  };

  const handleEraseAll = async () => {
    if (!confirm('Are you sure you want to delete all extracted goals? This cannot be undone.')) return;
    try {
      await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_everything' }),
      });
      fetchStatus();
      fetchGoals();
    } catch { /* ignore */ }
  };

  const regions = [...new Set(goals.map(g => g.region).filter(Boolean))].sort();
  const filtered = goals.filter(g => {
    if (search) {
      const s = search.toLowerCase();
      return g.project_id.toLowerCase().includes(s) ||
        g.project_name.toLowerCase().includes(s);
    }
    return true;
  });

  const statusColor = (s: string) => {
    if (s === 'success') return 'bg-green-500/20 text-green-400 border border-green-500/30';
    if (s === 'error') return 'bg-red-500/20 text-red-400 border border-red-500/30';
    if (s === 'partial') return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
    return 'bg-gray-800 text-gray-400 border border-gray-700';
  };

  return (
    <div className="flex-1 overflow-auto bg-[#0a0e1a] p-6 text-gray-200">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-100">Project Goals Extractor</h1>
            <p className="text-sm text-gray-500 mt-1">
              AI-powered extraction of governance fields from project documentation
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleEraseAll}
              disabled={status?.isRunning}
              className="px-4 py-2 text-sm bg-red-900/30 text-red-400 border border-red-800 rounded-md hover:bg-red-900/50 transition-colors disabled:opacity-50"
            >
              Erase All
            </button>
            <button
              onClick={exportCsv}
              disabled={goals.length === 0}
              className="px-4 py-2 text-sm bg-blue-900/30 text-blue-300 border border-blue-800 rounded-md hover:bg-blue-900/50 transition-colors disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              onClick={startAnalysis}
              disabled={status?.isRunning}
              className="px-4 py-2 text-sm bg-blue-600 text-white border border-blue-500 rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50"
            >
              {status?.isRunning ? 'Running...' : 'Run Analysis'}
            </button>
          </div>
        </div>

        {/* Status bar */}
        {status?.isRunning && (
          <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-4 mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium text-blue-300">
                Analyzing: {status.currentProject}
              </span>
              <span className="text-blue-400">
                {status.processedProjects} / {status.totalProjects} projects
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${status.totalProjects ? (status.processedProjects / status.totalProjects) * 100 : 0}%` }}
              />
            </div>
            <div className="flex gap-4 mt-2 text-xs text-blue-400">
              <span>Success: {status.successCount}</span>
              <span>Errors: {status.errorCount}</span>
            </div>
            {status.errors.length > 0 && (
              <div className="mt-2 text-xs text-red-400 max-h-20 overflow-y-auto">
                {status.errors.slice(-5).map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <input
            type="text"
            placeholder="Search by ID or name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-lg w-64 text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <select
            value={filterRegion}
            onChange={e => setFilterRegion(e.target.value)}
            className="px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Regions</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            className="px-3 py-2 text-sm bg-gray-900 border border-gray-700 rounded-lg text-gray-200 focus:outline-none focus:border-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="success">Success</option>
            <option value="partial">Partial</option>
            <option value="error">Error</option>
            <option value="pending">Pending</option>
          </select>
          <span className="text-sm text-gray-500 self-center">
            {filtered.length} project{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        {loading ? (
          <LoadingState />
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {goals.length === 0
              ? 'No projects analyzed yet. Click "Run Analysis" to start.'
              : 'No projects match the current filters.'}
          </div>
        ) : (
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden shadow-lg">
            {/* Header */}
                        <div className="grid grid-cols-[minmax(0,1fr)_100px_60px_40px_80px_120px_90px_30px] gap-2 bg-[#0d1117] text-gray-500 text-xs font-semibold uppercase px-4 py-3 border-b border-gray-800">
              <div>Project</div>
              <div>Region</div>
              <div>Gate</div>
              <div className="text-center">Files</div>
              <div className="text-center">Status</div>
              <div>Last Analyzed</div>
              <div className="text-center">Action</div>
              <div></div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-gray-800">
              {filtered.map(g => {
                const isExpanded = expandedId === g.project_id;
                let fileCount = 0;
                try { fileCount = JSON.parse(g.source_files || '[]').length; } catch { /* */ }

                return (
                  <div key={g.project_id}>
                    <div
                                            className="grid grid-cols-[minmax(0,1fr)_100px_60px_40px_80px_120px_90px_30px] gap-2 items-center cursor-pointer hover:bg-gray-800/50 px-4 py-3 text-sm transition-colors"
                      onClick={() => setExpandedId(isExpanded ? null : g.project_id)}
                    >
                      <div className="min-w-0 truncate pr-2">
                        <span className="font-mono text-xs text-blue-400 mr-2">{g.project_id}</span>
                        <span className="font-medium text-gray-200">{g.project_name}</span>
                      </div>
                      <div className="text-gray-400 truncate">{g.region}</div>
                      <div className="text-gray-400">{g.gate}</div>
                      <div className="text-gray-500 text-center">{fileCount}</div>
                      <div className="text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${statusColor(g.status)}`}>
                          {g.status}
                        </span>
                      </div>
                      <div className="text-gray-500 text-[10px]">
                        {g.analyzed_at ? new Date(g.analyzed_at).toLocaleString() : 'Never'}
                      </div>
                      <div className="text-center">
                        <button
                          onClick={(e) => handleRunSingle(g.project_id, e)}
                          disabled={status?.isRunning}
                          className="px-2 py-1 bg-gray-800 text-gray-300 text-xs font-medium rounded hover:bg-gray-700 transition-colors border border-gray-700 disabled:opacity-50"
                        >
                          Analyze
                        </button>
                      </div>
                      <div className="text-gray-600 text-center text-xs">
                        {isExpanded ? '▲' : '▼'}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-6 pb-6 pt-2 bg-[#0d1117] border-t border-gray-800">
                        {g.error_message && (
                          <div className="mt-3 p-3 bg-red-900/20 border border-red-800/50 rounded text-sm text-red-400">
                            {g.error_message}
                          </div>
                        )}

                        {/* Executive one-liner */}
                        {g.summary_one_line && (
                          <div className="mt-4 p-3 bg-blue-950/30 border border-blue-900/40 rounded text-sm text-blue-100 leading-relaxed">
                            <span className="text-[10px] font-bold tracking-widest text-blue-400 uppercase mr-2">Summary</span>
                            {g.summary_one_line}
                          </div>
                        )}

                        {/* Canonical tags surfaced as pills */}
                        {(() => {
                          const blocks: { label: string; items: string[]; color: string }[] = [
                            { label: 'Tech tags',           items: parseJsonArray(g.tech_tags),            color: 'bg-blue-900/40 text-blue-200 border-blue-800/60' },
                            { label: 'Vendors',             items: parseJsonArray(g.vendors),              color: 'bg-purple-900/40 text-purple-200 border-purple-800/60' },
                            { label: 'Data classifications',items: parseJsonArray(g.data_classifications), color: 'bg-amber-900/40 text-amber-200 border-amber-800/60' },
                            { label: 'DDS entities touched',items: parseJsonArray(g.dds_entities_touched), color: 'bg-emerald-900/40 text-emerald-200 border-emerald-800/60' },
                            { label: 'GIO services touched',items: parseJsonArray(g.gio_services_touched), color: 'bg-cyan-900/40 text-cyan-200 border-cyan-800/60' },
                            { label: 'Mentions',            items: parseJsonArray(g.mentioned_projects),   color: 'bg-gray-800 text-gray-300 border-gray-700' },
                          ];
                          const visible = blocks.filter(b => b.items.length > 0);
                          if (visible.length === 0) return null;
                          return (
                            <div className="mt-3 space-y-2">
                              {visible.map(b => (
                                <div key={b.label} className="flex flex-wrap gap-1.5 items-center">
                                  <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase w-44 shrink-0">{b.label}</span>
                                  {b.items.map(it => (
                                    <span key={it} className={`px-2 py-0.5 rounded text-[11px] font-mono border ${b.color}`}>{it}</span>
                                  ))}
                                </div>
                              ))}
                            </div>
                          );
                        })()}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                          {FIELDS.map(({ key, label }) => {
                            const val = (g as unknown as Record<string, string>)[key];
                            const isEmpty = !val || val === 'Not identified';
                            return (
                              <div key={key} className={`bg-gray-900 rounded-lg border p-4 ${isEmpty ? 'border-gray-800 opacity-60' : 'border-gray-700'}`}>
                                <div className="text-[10px] font-bold tracking-widest text-gray-500 uppercase mb-2">{label}</div>
                                <div className={`text-sm leading-relaxed whitespace-pre-wrap ${isEmpty ? 'text-gray-600 italic' : 'text-gray-300'}`}>
                                  {val || '—'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}