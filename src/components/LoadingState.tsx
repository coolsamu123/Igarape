export default function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 py-20">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
        </span>
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}
