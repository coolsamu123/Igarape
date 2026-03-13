'use client';

import { useMemo } from 'react';
import { useProjectContext } from '@/context/ProjectContext';
import { getDDSColor, getDecisionColor, getGateColor } from '@/lib/constants';

export default function TimelineView() {
  const { filtered, setSelected } = useProjectContext();

  const { months, projectsByDDS } = useMemo(() => {
    // Generate months from 2018-01 to 2026-06
    const months: string[] = [];
    for (let y = 2018; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
      }
    }

    // Find actual date range
    const dates = filtered
      .map(p => p.lastReviewDate)
      .filter(d => d && d.length >= 7)
      .map(d => d.slice(0, 7))
      .sort();

    const minDate = dates[0] || '2020-01';
    const maxDate = dates[dates.length - 1] || '2026-01';

    // Filter months to actual range +/- buffer
    const displayMonths = months.filter(m => m >= minDate && m <= maxDate);

    // Group by DDS
    const grouped = new Map<string, typeof filtered>();
    for (const p of filtered) {
      const key = p.dds || '(none)';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    return {
      months: displayMonths,
      projectsByDDS: Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length),
    };
  }, [filtered]);

  const cellW = 28;
  const toIdx = (dateStr: string) => {
    const m = dateStr?.slice(0, 7);
    return months.indexOf(m);
  };

  // Current month
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const todayIdx = months.indexOf(currentMonth);

  return (
    <div className="flex-1 overflow-auto p-6 animate-fadeIn">
      <div className="text-[13px] text-gray-500 mb-5">
        Project review timeline by DDS — each bar shows when a project was reviewed at CIOO
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: months.length * cellW + 220, position: 'relative' }}>
          {/* Month headers */}
          <div className="flex" style={{ marginLeft: 220, marginBottom: 8 }}>
            {months.map((m) => {
              const [y, mo] = m.split('-');
              return (
                <div key={m}
                  className="shrink-0 text-center"
                  style={{
                    width: cellW,
                    fontSize: 9,
                    color: mo === '01' ? '#94a3b8' : '#475569',
                    borderLeft: mo === '01' ? '1px solid #374151' : 'none',
                    paddingLeft: 2,
                  }}
                >
                  {mo === '01' ? y : parseInt(mo) % 3 === 1
                    ? ['', 'Jan', '', 'Mar', 'Apr', '', 'Jun', 'Jul', '', 'Sep', 'Oct', '', 'Dec'][parseInt(mo)] || ''
                    : ''}
                </div>
              );
            })}
          </div>

          {/* DDS groups */}
          {projectsByDDS.map(([dds, projects]) => (
            <div key={dds}>
              <div className="text-[10px] font-bold tracking-widest mb-1 mt-4 pl-1"
                style={{ color: getDDSColor(dds) }}>
                ● {dds.toUpperCase()} ({projects.length})
              </div>

              {projects.slice(0, 30).map(p => {
                const color = getDDSColor(p.dds);

                // Show all review dates from history
                const reviewDots = (p.history || [])
                  .map(h => ({ idx: toIdx(h.reviewDate), gate: h.gate, decision: h.decision }))
                  .filter(d => d.idx >= 0);

                return (
                  <div key={p.projectId} className="flex items-center mb-1" style={{ height: 26 }}>
                    {/* Project label */}
                    <div className="flex items-center gap-2 shrink-0" style={{ width: 220, paddingRight: 12 }}>
                      <span className="text-[10px] font-mono shrink-0" style={{ color, width: 70 }}>
                        {p.projectId.replace('PRJ00', '')}
                      </span>
                      <span className="text-[11px] text-gray-200 whitespace-nowrap overflow-hidden text-ellipsis">
                        {p.name}
                      </span>
                    </div>

                    {/* Timeline bar */}
                    <div className="relative flex-1" style={{ height: '100%' }}>
                      {/* Grid lines */}
                      {months.map((m, i) => (
                        <div key={m} className="absolute top-0 bottom-0"
                          style={{
                            left: i * cellW,
                            width: cellW,
                            borderRight: '1px solid #1a2435',
                            background: i % 6 === 0 ? '#0d1117' : 'transparent',
                          }}
                        />
                      ))}

                      {/* Review dots */}
                      {reviewDots.map((dot, di) => (
                        <div key={di}
                          onClick={() => setSelected(p.projectId)}
                          className="absolute cursor-pointer group"
                          style={{
                            left: dot.idx * cellW + cellW / 2 - 5,
                            top: 3,
                            width: 10,
                            height: 10,
                          }}
                        >
                          {/* Dot */}
                          <div className="w-full h-full rounded-full border"
                            style={{
                              background: getDecisionColor(dot.decision),
                              borderColor: color,
                            }}
                          />
                          {/* Gate label */}
                          <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[7px] font-bold"
                            style={{ color: getGateColor(dot.gate) }}>
                            G{dot.gate}
                          </div>
                          {/* Tooltip */}
                          <div className="hidden group-hover:block absolute top-full left-1/2 -translate-x-1/2 mt-1 bg-gray-800 rounded px-2 py-1 text-[9px] text-gray-200 whitespace-nowrap z-10 border border-gray-700">
                            Gate {dot.gate} · {dot.decision || 'Pending'}
                          </div>
                        </div>
                      ))}

                      {/* Connection line between dots */}
                      {reviewDots.length > 1 && (() => {
                        const sorted = [...reviewDots].sort((a, b) => a.idx - b.idx);
                        const first = sorted[0].idx;
                        const last = sorted[sorted.length - 1].idx;
                        return (
                          <div className="absolute"
                            style={{
                              left: first * cellW + cellW / 2,
                              width: (last - first) * cellW,
                              top: 7,
                              height: 2,
                              background: `${color}44`,
                              borderRadius: 1,
                            }}
                          />
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Today line */}
          {todayIdx >= 0 && (
            <div className="absolute top-0 bottom-0 pointer-events-none"
              style={{
                left: 220 + todayIdx * cellW,
                width: 2,
                background: '#ef4444',
                opacity: 0.5,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
