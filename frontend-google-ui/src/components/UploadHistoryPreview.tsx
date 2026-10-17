import { useEffect, useState } from 'react';
import { Clock, Loader2, X } from 'lucide-react';

interface Props {
  item: { kind: 'video' | 'image'; name: string; previewUrl: string };
  duration?: number;
  selecting?: boolean;
  selectionDisabledReason?: string;
  error?: string;
  onClose: () => void;
  onSelect: () => void;
  onDuration?: (seconds: number) => void;
  onMouseEnter?: () => void;
}

export default function UploadHistoryPreview({ item, duration, selecting = false, selectionDisabledReason = '', error, onClose, onSelect, onDuration, onMouseEnter }: Props) {
  const [mediaError, setMediaError] = useState('');
  useEffect(() => { setMediaError(''); }, [item.previewUrl]);
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!selecting) onClose(); }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [onClose, selecting]);
  const canSelect = !selecting && !selectionDisabledReason;
  return <div role="dialog" aria-modal="true" aria-label={`历史${item.kind === 'video' ? '视频' : '图片'}预览`} className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-5" onClick={() => { if (!selecting) onClose(); }}>
    <div className="relative flex max-h-[92vh] min-w-0 max-w-[85vw] flex-col items-center" onClick={event => event.stopPropagation()} onMouseEnter={onMouseEnter}>
      <div className="relative flex min-h-24 min-w-40 items-center justify-center" onDoubleClick={() => { if (canSelect) onSelect(); }}>
        {item.kind === 'video' ? <video key={item.previewUrl} src={item.previewUrl} className="max-h-[65vh] max-w-[82vw] rounded-xl object-contain shadow-2xl" autoPlay loop muted controls playsInline
          onLoadedMetadata={event => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds) && seconds > 0) onDuration?.(seconds); }}
          onError={() => setMediaError('当前浏览器无法播放此视频，可以继续浏览其他素材，或选用后处理。')} />
          : <img src={item.previewUrl} alt={item.name} className="max-h-[65vh] max-w-[82vw] rounded-xl object-contain shadow-2xl" onError={() => setMediaError('图片预览失败，请重新上传原图。')} />}
        <button autoFocus type="button" disabled={selecting} onClick={onClose} aria-label="关闭预览" className="absolute -right-3 -top-3 grid size-8 place-items-center rounded-full bg-white text-slate-500 shadow hover:bg-slate-100 disabled:opacity-40"><X size={16} /></button>
      </div>
      <div className="mt-4 flex min-h-0 w-full flex-col items-center gap-3 overflow-y-auto text-center">
        <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
          <span className="max-w-full break-all rounded-2xl bg-white/10 px-4 py-1.5 text-sm font-semibold text-white">{item.name}</span>
          {item.kind === 'video' && <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/85"><Clock size={14} />视频时长 {duration && Number.isFinite(duration) ? `${duration.toFixed(1)}秒` : '正在读取…'}</span>}
        </div>
        {(error || mediaError || selectionDisabledReason) && <p role="alert" className="max-w-lg rounded-xl bg-black/40 px-3 py-2 text-xs leading-5 text-amber-200">{error || mediaError || selectionDisabledReason}</p>}
        <div className="flex items-center gap-2">
          <button type="button" disabled={selecting} onClick={onClose} className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/20 disabled:opacity-40">继续浏览</button>
          <button type="button" disabled={!canSelect} onClick={onSelect} className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100 disabled:opacity-40">{selecting && <Loader2 size={14} className="animate-spin" />}{selecting ? '正在选用…' : `选用此${item.kind === 'video' ? '视频' : '图片'}`}</button>
        </div>
      </div>
    </div>
  </div>;
}
