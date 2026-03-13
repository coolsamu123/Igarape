'use client';

import { useMemo } from 'react';
import { useProjectContext } from '@/context/ProjectContext';

export default function Toolbar() {
  const { projects, filtered, links, view, threshold, setThreshold, filters, setFilters } = useProjectContext();

  const ddsList = useMemo(() => {
    const vals = new Set(projects.map(p => p.dds).filter(Boolean));
    return ['All', ...Array.from(vals).sort()];
  }, [projects]);

  const gateList = useMemo(() => {
    const vals = new Set(projects.map(p => p.currentGate).filter(Boolean));
    return ['All', ...Array.from(vals).sort()];
  }, [projects]);

  const decisionList = useMemo(() => {
    const vals = new Set(projects.map(p => p.latestDecision).filter(Boolean));
    return ['All', ...Array.from(vals).sort()];
  }, [projects]);

  const yearList = useMemo(() => {
    const years = new Set(
      projects
        .map(p => parseInt(p.lastReviewDate?.slice(0, 4)))
        .filter(y => !isNaN(y) && y > 2000)
    );
    return Array.from(years).sort();
  }, [projects]);

  return (
    <div className="px-6 py-2.5 border-b border-gray-800 flex items-center gap-3 bg-[#0d1117] flex-wrap">
      <span className="text-xs text-gray-500 mr-1">Filter:</span>

      <select
        value={filters.dds}
        onChange={e => setFilters({ ...filters, dds: e.target.value })}
        className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500"
      >
        {ddsList.map(d => <option key={d} value={d}>{d === 'All' ? 'All DDS' : d}</option>)}
      </select>

      <select
        value={filters.gate}
        onChange={e => setFilters({ ...filters, gate: e.target.value })}
        className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500"
      >
        {gateList.map(g => <option key={g} value={g}>{g === 'All' ? 'All Gates' : `Gate ${g}`}</option>)}
      </select>

      <select
        value={filters.decision}
        onChange={e => setFilters({ ...filters, decision: e.target.value })}
        className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500"
      >
        {decisionList.map(d => <option key={d} value={d}>{d === 'All' ? 'All Decisions' : d}</option>)}
      </select>

      <span className="text-xs text-gray-500 ml-1">Year:</span>
      <select
        value={filters.yearFrom ?? ''}
        onChange={e => setFilters({ ...filters, yearFrom: e.target.value ? Number(e.target.value) : null })}
        className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500"
      >
        <option value="">From</option>
        {yearList.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select
        value={filters.yearTo ?? ''}
        onChange={e => setFilters({ ...filters, yearTo: e.target.value ? Number(e.target.value) : null })}
        className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-2.5 py-1 text-[13px] focus:outline-none focus:border-blue-500"
      >
        <option value="">To</option>
        {yearList.map(y => <option key={y} value={y}>{y}</option>)}
      </select>

      <input
        type="text"
        placeholder="Search projects..."
        value={filters.search}
        onChange={e => setFilters({ ...filters, search: e.target.value })}
        className="bg-gray-800 border border-gray-700 text-gray-200 rounded-md px-3 py-1 text-[13px] focus:outline-none focus:border-blue-500 w-48"
      />

      {view === 'graph' && (
        <label className="flex items-center gap-2 text-xs text-gray-400 ml-2">
          Similarity:
          <strong className="text-gray-200 w-8">{Math.round(threshold * 100)}%</strong>
          <input
            type="range"
            min={0}
            max={90}
            value={Math.round(threshold * 100)}
            onChange={e => setThreshold(Number(e.target.value) / 100)}
            className="w-24"
          />
        </label>
      )}

      <div className="flex-1" />
      <span className="text-xs text-gray-500">
        {filtered.length} projects · {links.length} connections
      </span>
    </div>
  );
}
