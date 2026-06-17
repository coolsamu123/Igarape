'use client';

import { useProjectContext } from '@/context/ProjectContext';
import type { ViewType } from '@/lib/types';

const NAV_ITEMS: { key: ViewType; label: string }[] = [
  { key: 'impact', label: '→ Impact' },
  { key: 'graph', label: '⬡ Graph' },
  { key: 'timeline', label: '⟶ Timeline' },
  { key: 'detail', label: '≡ Details' },
  { key: 'goals', label: '✦ Goals Extractor' },
  { key: 'drive', label: '☁ Drive Sync' },
  { key: 'strom', label: '✦ Alumen' },
];

const PUBLIC_VIEWS: ViewType[] = ['graph', 'timeline', 'detail', 'impact'];

export default function Header() {
  const { view, setView, isPublic, theme, toggleTheme } = useProjectContext();
  const navItems = isPublic
    ? NAV_ITEMS.filter(n => PUBLIC_VIEWS.includes(n.key))
    : NAV_ITEMS;

  return (
    <div className="px-6 py-3 border-b border-line flex items-center gap-4 bg-surface">
      <div className="flex items-center gap-3">
        <img src="/icon-192.png" alt="Alumen" className="w-10 h-10 rounded-lg" />
        <div className="leading-none">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-extrabold text-ink-1 tracking-tight">Alumen</span>
            <span className="text-sm font-medium text-ink-4 tracking-tight">— Portfolio Intelligence</span>
          </div>
          <div className="text-xs text-ink-muted mt-1">Air Liquide</div>
        </div>
      </div>

      <div className="flex-1" />

      {navItems.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => setView(key)}
          className={`px-4 py-1.5 rounded-md border text-[13px] font-medium transition-all cursor-pointer
            ${view === key
              ? 'bg-accent-soft border-accent-border text-accent-text'
              : 'bg-transparent border-transparent text-ink-4 hover:bg-surface-2'
            }`}
        >
          {label}
        </button>
      ))}

      <button
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        className="w-8 h-8 flex items-center justify-center rounded-md border border-line-strong text-ink-3 hover:bg-surface-2 hover:text-ink-1 transition-all"
      >
        <span className="text-base leading-none">{theme === 'dark' ? '☀' : '☾'}</span>
      </button>

      {!isPublic && (
        <>
          <div className="w-px h-6 bg-surface-3" />
          <a
            href="/admin"
            className="px-4 py-1.5 rounded-md border border-line-strong text-[13px] font-medium text-ink-4 hover:bg-surface-2 hover:text-ink-2 transition-all"
          >
            Admin
          </a>
        </>
      )}
    </div>
  );
}
