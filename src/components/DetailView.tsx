'use client';

import { useProjectContext } from '@/context/ProjectContext';
import { getDDSColor, getGateColor, getDecisionColor } from '@/lib/constants';

export default function DetailView() {
  const { filtered, links, selected, setSelected } = useProjectContext();

  return (
    <div className="flex-1 overflow-auto p-6 animate-fadeIn">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(p => {
          const color = getDDSColor(p.dds);
          const related = links.filter(l => l.source === p.projectId || l.target === p.projectId).length;
          const isSelected = selected === p.projectId;

          return (
            <div
              key={p.projectId}
              onClick={() => setSelected(isSelected ? null : p.projectId)}
              className={`bg-gray-900 border rounded-xl p-5 cursor-pointer transition-all hover:-translate-y-0.5
                ${isSelected ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-gray-800 hover:border-gray-600'}`}
            >
              {/* Header */}
              <div className="flex justify-between items-start mb-2.5">
                <span className="text-[11px] font-mono font-semibold" style={{ color }}>
                  {p.projectId}
                </span>
                <div className="flex gap-1.5">
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: `${getGateColor(p.currentGate)}22`, color: getGateColor(p.currentGate) }}>
                    G{p.currentGate}
                  </span>
                  <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: `${color}22`, color }}>
                    {p.dds}
                  </span>
                </div>
              </div>

              {/* Name */}
              <div className="text-sm font-bold text-gray-100 mb-2 leading-snug line-clamp-2">
                {p.name}
              </div>

              {/* Description */}
              {p.description && (
                <div className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-3">
                  {p.description}
                </div>
              )}

              {/* Decision badge */}
              {p.latestDecision && (
                <div className="mb-3">
                  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold"
                    style={{ background: `${getDecisionColor(p.latestDecision)}22`, color: getDecisionColor(p.latestDecision) }}>
                    {p.latestDecision}
                  </span>
                </div>
              )}

              {/* Stats row */}
              <div className="flex justify-between text-[11px] text-gray-500">
                <span>{p.costKEur ? `${p.costKEur}k€` : '—'}</span>
                <span>{p.reviewCount} review{p.reviewCount !== 1 ? 's' : ''}</span>
                <span>{related > 0 ? `${related} links` : '—'}</span>
              </div>

              {/* Tags */}
              {p.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-3">
                  {p.tags.slice(0, 5).map(t => (
                    <span key={t} className="inline-block px-2 py-0.5 rounded text-[9px] text-gray-400 bg-gray-800 border border-gray-700">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Links */}
              {(p.linkFolder || p.linkPositions) && (
                <div className="flex gap-2 mt-3">
                  {p.linkFolder && (
                    <a href={p.linkFolder} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] text-blue-400 hover:text-blue-300 underline">
                      Folder
                    </a>
                  )}
                  {p.linkPositions && (
                    <a href={p.linkPositions} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] text-blue-400 hover:text-blue-300 underline">
                      CIOO Position
                    </a>
                  )}
                </div>
              )}

              {/* Expanded detail when selected */}
              {isSelected && (
                <div className="mt-4 pt-4 border-t border-gray-700 space-y-3 animate-fadeIn">
                  {p.remarks && (
                    <div>
                      <div className="text-[10px] text-gray-500 font-semibold mb-1">REMARKS</div>
                      <div className="text-xs text-gray-300 leading-relaxed">{p.remarks}</div>
                    </div>
                  )}

                  {p.lastReviewDate && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-gray-800 rounded-lg p-2">
                        <div className="text-[10px] text-gray-500">Last Review</div>
                        <div className="text-xs font-semibold text-gray-200">{p.lastReviewDate}</div>
                      </div>
                      <div className="bg-gray-800 rounded-lg p-2">
                        <div className="text-[10px] text-gray-500">Cost</div>
                        <div className="text-xs font-semibold text-gray-200">{p.costKEur ? `${p.costKEur}k€` : 'N/A'}</div>
                      </div>
                    </div>
                  )}

                  {/* Review history */}
                  {p.history && p.history.length > 1 && (
                    <div>
                      <div className="text-[10px] text-gray-500 font-semibold mb-1">REVIEW HISTORY ({p.history.length})</div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {p.history.slice(0, 8).map((h, i) => (
                          <div key={i} className="flex justify-between text-[10px] text-gray-400 bg-gray-800/50 rounded px-2 py-1">
                            <span>{h.reviewDate || '—'}</span>
                            <span style={{ color: getGateColor(h.gate) }}>G{h.gate}</span>
                            <span style={{ color: getDecisionColor(h.decision) }}>{h.decision || '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
