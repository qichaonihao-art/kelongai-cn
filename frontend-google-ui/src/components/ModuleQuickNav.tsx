import { Mic2, Wand2, Download } from 'lucide-react';
import { cn } from '@/src/lib/utils';

type ModuleId = 'voice' | 'creative' | 'douyin';

const MODULES: { id: ModuleId; label: string; icon: typeof Mic2; gradient: string }[] = [
  { id: 'voice', label: '声音克隆', icon: Mic2, gradient: 'from-indigo-500 to-violet-600' },
  { id: 'creative', label: '创意创作', icon: Wand2, gradient: 'from-emerald-500 to-teal-600' },
  { id: 'douyin', label: '视频解析', icon: Download, gradient: 'from-sky-500 to-blue-600' },
];

interface ModuleQuickNavProps {
  current: ModuleId;
  onNavigate: (page: ModuleId) => void;
}

export default function ModuleQuickNav({ current, onNavigate }: ModuleQuickNavProps) {
  return (
    <div className="flex items-center gap-2">
      {MODULES.filter((m) => m.id !== current).map((m) => {
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            onClick={() => onNavigate(m.id)}
            className="flex items-center gap-1.5 h-9 rounded-full px-3 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-200"
          >
            <div className={cn('size-5 rounded-md bg-gradient-to-br flex items-center justify-center text-white', m.gradient)}>
              <Icon className="size-3" />
            </div>
            <span className="hidden md:inline text-[11px] font-bold text-slate-700">{m.label}</span>
          </button>
        );
      })}
    </div>
  );
}
