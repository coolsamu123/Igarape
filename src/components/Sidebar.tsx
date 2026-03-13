'use client';

import { useMemo } from 'react';
import { useProjectContext } from '@/context/ProjectContext';
import { getDDSColor, getGateColor, getDecisionColor } from '@/lib/constants';

export default function Sidebar() {
  const { filtered, links } = useProjectContext();

  const ddsCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach(p => { counts[p.dds || '(empty)'] = (counts[p.dds || '(empty)'] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const gateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach(p => { counts[p.currentGate || '(empty)'] = (counts[p.currentGate || '(empty)'] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const decisionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach(p => { counts[p.latestDecision || '(empty)'] = (counts[p.latestDecision || '(empty)'] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const totalCost = useMemo(() =>
    filtered.reduce((sum, p) => sum + (p.costKEur || 0), 0),
    [filtered]
  );

  return (
    <div className="w-52 border-l border-gray-800 p-4 bg-[#0d1117] overflow-y-auto flex flex-col gap-5 shrink-0">
      {/* KPIs */}
      <div>
        <div className="text-[10px] text-gray-500 font-bold tracking-widest mb-3">PORTFOLIO KPIs</div>
        {[
          ['Projects', filtered.length],
          ['Total Cost', `${(totalCost / 1000).toFixed(1)}M€`],
          ['Connections', links.length],
          ['Avg Reviews', (filtered.length > 0 ? (filtered.reduce((s, p) => s + p.reviewCount, 0) / filtered.length).toFixed(1) : '0')],
        ].map(([k, v]) => (
          <div key={String(k)} className="mb-2.5">
            <div className="text-[10px] text-gray-500">{k}</div>
            <div className="text-xl font-bold text-gray-100 font-mono">{v}</div>
          </div>
        ))}
      </div>

      {/* By DDS */}
      <div>
        <div className="text-[10px] text-gray-500 font-bold tracking-widest mb-2.5">BY DDS</div>
        {ddsCounts.slice(0, 10).map(([dds, count]) => (
          <div key={dds} className="mb-2">
            <div className="flex justify-between text-[11px] mb-1">
              <span style={{ color: getDDSColor(dds) }}>● {dds}</span>
              <span className="text-gray-500">{count}</span>
            </div>
            <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: `${(count / filtered.length) * 100}%`,
                background: getDDSColor(dds)
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* By Gate */}
      <div>
        <div className="text-[10px] text-gray-500 font-bold tracking-widest mb-2.5">BY GATE</div>
        {gateCounts.slice(0, 8).map(([gate, count]) => (
          <div key={gate} className="mb-2">
            <div className="flex justify-between text-[11px] mb-1">
              <span style={{ color: getGateColor(gate) }}>● Gate {gate}</span>
              <span className="text-gray-500">{count}</span>
            </div>
            <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{
                width: `${(count / filtered.length) * 100}%`,
                background: getGateColor(gate)
              }} />
            </div>
          </div>
        ))}
      </div>

      {/* By Decision */}
      <div>
        <div className="text-[10px] text-gray-500 font-bold tracking-widest mb-2.5">DECISIONS</div>
        {decisionCounts.map(([decision, count]) => (
          <div key={decision} className="flex justify-between text-[11px] mb-1.5">
            <span style={{ color: getDecisionColor(decision) }}>● {decision}</span>
            <span className="text-blue-400 font-semibold">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
