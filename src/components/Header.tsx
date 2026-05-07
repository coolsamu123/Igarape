'use client';

import { useProjectContext } from '@/context/ProjectContext';
import type { ViewType } from '@/lib/types';

const NAV_ITEMS: { key: ViewType; label: string }[] = [
  { key: 'graph', label: '⬡ Graph' },
  { key: 'matrix', label: '▦ Matrix' },
  { key: 'timeline', label: '⟶ Timeline' },
  { key: 'detail', label: '≡ Details' },
  { key: 'impact', label: '→ Impact' },
  { key: 'goals', label: '✦ Goals Extractor' },
  { key: 'drive', label: '☁ Drive Sync' },
  { key: 'strom', label: '⟳ Strom' },
];

export default function Header() {
  const { view, setView } = useProjectContext();

  return (
    <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-4 bg-[#0d1117]">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="Strom" className="w-10 h-10 rounded-lg" />
        <div className="leading-none">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold text-gray-100 tracking-tight">Strom</span>
            <span className="text-sm font-medium text-gray-400 tracking-tight">— Portfolio Intelligence</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">Air Liquide</div>
        </div>
      </div>

      <div className="flex-1" />

      {NAV_ITEMS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setView(key)}
          className={`px-4 py-1.5 rounded-md border text-[13px] font-medium transition-all cursor-pointer
            ${view === key
              ? 'bg-blue-900/30 border-blue-500 text-blue-300'
              : 'bg-transparent border-transparent text-gray-400 hover:bg-gray-800'
            }`}
        >
          {label}
        </button>
      ))}

      <div className="w-px h-6 bg-gray-700" />

      <a
        href="/admin"
        className="px-4 py-1.5 rounded-md border border-gray-700 text-[13px] font-medium text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-all"
      >
        Admin
      </a>
    </div>
  );
}
