import { House } from 'lucide-react';

interface HomeBackButtonProps {
  onClick: () => void;
}

export default function HomeBackButton({ onClick }: HomeBackButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="返回主页"
      className="group inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-1.5 pr-3 text-xs font-black text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50 hover:shadow-md"
    >
      <span className="flex size-6.5 items-center justify-center rounded-lg bg-slate-900 text-white transition-transform group-hover:scale-105">
        <House className="size-3.5" />
      </span>
      返回主页
    </button>
  );
}
