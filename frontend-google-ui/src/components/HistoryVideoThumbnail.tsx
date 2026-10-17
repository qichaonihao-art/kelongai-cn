import { Film } from 'lucide-react';

export default function HistoryVideoThumbnail({ src, name }: { src: string; name: string }) {
  return <div className="relative aspect-video w-full overflow-hidden bg-slate-950">
    {src ? <img src={src} alt={name} className="absolute inset-0 size-full object-contain" />
      : <div className="absolute inset-0 grid place-items-center text-white/50"><Film className="size-5" /></div>}
  </div>;
}
