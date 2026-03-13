'use client';

import { useMemo } from 'react';
import { useProjectContext } from '@/context/ProjectContext';
import { getDDSColor } from '@/lib/constants';
import { computeSimilarity } from '@/lib/similarity';

export default function MatrixView() {
  const { filtered, setSelected, setView } = useProjectContext();

  // Limit matrix to top 50 for performance
  const matrixProjects = useMemo(() => filtered.slice(0, 50), [filtered]);

  // Precompute similarity matrix
  const matrix = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    for (const a of matrixProjects) {
      m[a.projectId] = {};
      for (const b of matrixProjects) {
        if (a.projectId === b.projectId) {
          m[a.projectId][b.projectId] = 1;
        } else {
          m[a.projectId][b.projectId] = computeSimilarity(a, b);
        }
      }
    }
    return m;
  }, [matrixProjects]);

  // Tag cloud
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach(p => p.tags.forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  return (
    <div className="flex-1 overflow-auto p-6 animate-fadeIn">
      <div className="text-[13px] text-gray-500 mb-4">
        Intersection matrix — color intensity = similarity score ({matrixProjects.length} projects shown, max 50)
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="w-36 min-w-[140px]" />
              {matrixProjects.map(p => (
                <th key={p.projectId} className="p-1" style={{
                  writingMode: 'vertical-rl',
                  textOrientation: 'mixed',
                  transform: 'rotate(180deg)',
                  whiteSpace: 'nowrap',
                  maxWidth: 90,
                  color: '#94a3b8',
                  fontWeight: 600,
                }}>
                  <span style={{ color: getDDSColor(p.dds) }}>{p.projectId.replace('PRJ00', '')}</span>
                  {' '}{p.name.slice(0, 14)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrixProjects.map(pa => (
              <tr key={pa.projectId}>
                <td className="pr-3 font-semibold text-gray-200 whitespace-nowrap text-right">
                  <span className="text-[10px] font-mono mr-1.5" style={{ color: getDDSColor(pa.dds) }}>
                    {pa.projectId.replace('PRJ00', '')}
                  </span>
                  {pa.name.length > 18 ? pa.name.slice(0, 16) + '...' : pa.name}
                </td>
                {matrixProjects.map(pb => {
                  const sim = matrix[pa.projectId]?.[pb.projectId] ?? 0;
                  const isDiag = pa.projectId === pb.projectId;
                  const bg = isDiag
                    ? '#1e3a8a'
                    : sim > 0.5 ? `rgba(59,130,246,${sim})`
                    : sim > 0.2 ? `rgba(99,102,241,${sim})`
                    : sim > 0 ? `rgba(99,102,241,0.1)`
                    : 'transparent';

                  return (
                    <td key={pb.projectId}
                      title={`${pa.name} <-> ${pb.name}: ${Math.round(sim * 100)}%`}
                      onClick={() => { setSelected(pa.projectId); setView('graph'); }}
                      className="cursor-pointer text-center transition-all hover:brightness-150"
                      style={{
                        width: 32, height: 32, minWidth: 32,
                        background: bg,
                        border: '1px solid #0a0e1a',
                      }}
                    >
                      {sim > 0.15 && !isDiag && (
                        <span className="text-[9px] text-white/80 font-mono">{Math.round(sim * 100)}</span>
                      )}
                      {isDiag && <span className="text-[9px] text-blue-400">--</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tag cloud */}
      <div className="mt-8">
        <div className="text-[13px] text-gray-500 mb-3">Shared tags across portfolio</div>
        <div className="flex flex-wrap gap-2">
          {tagCounts.slice(0, 30).map(([tag, count]) => (
            <span key={tag}
              className="inline-block rounded-full border border-gray-800 text-gray-200"
              style={{
                background: `rgba(59,130,246,${Math.min(count / filtered.length, 0.8)})`,
                padding: `4px ${10 + count}px`,
                fontSize: 11 + Math.min(count, 5),
              }}
            >
              {tag} <span className="text-[10px] opacity-70">x{count}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
