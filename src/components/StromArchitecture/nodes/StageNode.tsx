import { Handle, Position } from 'reactflow';
import type { StageType } from '../stages';

// Visual styling per stage type. Kept in one place so a new type only needs
// a row here + a check inside the canvas to know how to render its node.
const TYPE_STYLE: Record<StageType, { bg: string; border: string; ink: string; badge: string }> = {
  manual:    { bg: 'bg-blue-950/60',    border: 'border-blue-500/60',    ink: 'text-blue-200',    badge: 'bg-blue-900/70 text-blue-200' },
  drive:     { bg: 'bg-purple-950/60',  border: 'border-purple-500/60',  ink: 'text-purple-200',  badge: 'bg-purple-900/70 text-purple-200' },
  hygiene:   { bg: 'bg-slate-900/70',   border: 'border-slate-500/60',   ink: 'text-slate-200',   badge: 'bg-slate-800/70 text-slate-200' },
  parse:     { bg: 'bg-slate-900/70',   border: 'border-slate-500/60',   ink: 'text-slate-200',   badge: 'bg-slate-800/70 text-slate-200' },
  llm:       { bg: 'bg-orange-950/60',  border: 'border-orange-500/70',  ink: 'text-orange-200',  badge: 'bg-orange-900/70 text-orange-100' },
  sanitize:  { bg: 'bg-emerald-950/50', border: 'border-emerald-500/50', ink: 'text-emerald-100', badge: 'bg-emerald-900/70 text-emerald-100' },
  aggregate: { bg: 'bg-green-950/60',   border: 'border-green-500/60',   ink: 'text-green-200',   badge: 'bg-green-900/70 text-green-200' },
  store:     { bg: 'bg-cyan-950/60',    border: 'border-cyan-500/60',    ink: 'text-cyan-200',    badge: 'bg-cyan-900/70 text-cyan-100' },
  external:  { bg: 'bg-zinc-900/70',    border: 'border-zinc-500/40',    ink: 'text-zinc-200',    badge: 'bg-zinc-800/70 text-zinc-200' },
};

const TYPE_LABEL: Record<StageType, string> = {
  manual: 'Manual',
  drive: 'Drive I/O',
  hygiene: 'Filter',
  parse: 'Parser',
  llm: 'LLM',
  sanitize: 'Validator',
  aggregate: 'API',
  store: 'DB',
  external: 'External',
};

export default function StageNode({ data, selected }: {
  data: {
    icon: string;
    name: string;
    subtitle?: string;
    type: StageType;
    isHovered: boolean;
  };
  selected?: boolean;
}) {
  const style = TYPE_STYLE[data.type];
  const isStore = data.type === 'store';
  const ringClass = selected ? 'ring-2 ring-offset-2 ring-offset-bg ring-white/40' : '';
  // Stores are drawn as taller cards with a left "spine" to suggest a DB
  // cylinder without going full skeumorphic.
  const shape = isStore
    ? 'rounded-r-xl rounded-l-md border-l-[6px]'
    : 'rounded-xl';
  return (
    <div
      className={`relative ${shape} ${style.bg} ${style.border} border ${ringClass} shadow-lg transition-all duration-150 ${data.isHovered ? 'shadow-2xl scale-[1.02]' : ''}`}
      style={{ width: 220, padding: '12px 14px' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-3 !h-3 -top-1" />
      <div className="flex items-start gap-2.5">
        <span className="text-2xl leading-none mt-0.5">{data.icon}</span>
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-bold leading-tight ${style.ink}`}>{data.name}</div>
          {data.subtitle && (
            <div className="text-[10px] text-ink-muted leading-snug mt-0.5 break-words">{data.subtitle}</div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className={`text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${style.badge}`}>
          {TYPE_LABEL[data.type]}
        </span>
        <span className="text-[10px] text-ink-faint">click to inspect →</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-3 !h-3 -bottom-1" />
    </div>
  );
}
