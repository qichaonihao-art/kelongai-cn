import { BookOpenText, CalendarRange, Mic2, Wand2, Download, Network, Image, Crown, Video } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export type ModuleId = 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel' | 'feeding' | 'timeline' | 'video-library';

const MODULES: { id: ModuleId; label: string; icon: typeof Mic2; gradient: string }[] = [
  { id: 'voice', label: '声音克隆', icon: Mic2, gradient: 'from-indigo-500 to-violet-600' },
  { id: 'creative', label: '创意创作', icon: Wand2, gradient: 'from-emerald-500 to-teal-600' },
  { id: 'douyin', label: '视频解析', icon: Download, gradient: 'from-sky-500 to-blue-600' },
  { id: 'collection', label: '店铺总览', icon: Network, gradient: 'from-emerald-500 to-cyan-600' },
  { id: 'image', label: '图片生成', icon: Image, gradient: 'from-amber-500 to-orange-600' },
  { id: 'topmodel', label: '顶级模型', icon: Crown, gradient: 'from-fuchsia-500 to-purple-600' },
  { id: 'feeding', label: '创意文库', icon: BookOpenText, gradient: 'from-orange-500 to-rose-500' },
  { id: 'timeline', label: '团队轨迹', icon: CalendarRange, gradient: 'from-teal-500 to-emerald-600' },
  { id: 'video-library', label: '视频素材库', icon: Video, gradient: 'from-sky-500 to-cyan-600' },
];

interface ModuleQuickNavProps {
  current: ModuleId;
  onNavigate: (page: ModuleId) => void;
}

export default function ModuleQuickNav({ current, onNavigate }: ModuleQuickNavProps) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {MODULES.map((m) => {
        const Icon = m.icon;
        const isActive = m.id === current;
        return (
          <button
            key={m.id}
            onClick={() => {
              if (!isActive) onNavigate(m.id);
            }}
            aria-current={isActive ? 'page' : undefined}
            title={m.label}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2 transition-all duration-200',
              isActive
                ? 'cursor-default'
                : 'hover:bg-white/50'
            )}
          >
            <div
              className={cn(
                'flex size-5 items-center justify-center rounded-md transition-all',
                isActive
                  ? `bg-gradient-to-br text-white shadow-sm ${m.gradient}`
                  : 'bg-slate-100 text-slate-400'
              )}
            >
              <Icon className="size-3" />
            </div>
            <span
              className={cn(
                'hidden whitespace-nowrap text-[11px] font-bold xl:inline',
                isActive ? 'text-slate-900' : 'text-slate-500'
              )}
            >
              {m.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
