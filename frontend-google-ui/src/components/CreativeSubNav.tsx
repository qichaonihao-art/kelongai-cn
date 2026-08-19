import { Video, FileText } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export type CreativeSubMode = 'video' | 'copy';

interface CreativeSubNavProps {
  current: CreativeSubMode;
  onSwitchVideo: () => void;
  onSwitchCopy: () => void;
}

export default function CreativeSubNav({ current, onSwitchVideo, onSwitchCopy }: CreativeSubNavProps) {
  const items = [
    { id: 'video' as const, label: '视频创作', icon: Video, onClick: onSwitchVideo },
    { id: 'copy' as const, label: '文案创作', icon: FileText, onClick: onSwitchCopy },
  ];

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-slate-200 bg-slate-100/80 p-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.id === current;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (!isActive) item.onClick();
            }}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition-all',
              isActive
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon className="size-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
