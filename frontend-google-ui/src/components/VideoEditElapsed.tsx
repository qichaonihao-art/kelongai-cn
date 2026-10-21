import { useEffect, useMemo, useState } from 'react';
import { Timer, Check } from 'lucide-react';
import './video-edit-elapsed.css';

export function formatVideoEditElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}` : `${pad(minutes)}:${pad(seconds % 60)}`;
}

// Only this small display ticks; task polling and the video editor never tick with it.
export default function VideoEditElapsed({ elapsedMs, running, completed = false, startedAt }: {
  elapsedMs: number | null | undefined; running: boolean; completed?: boolean; startedAt?: number;
}) {
  const anchor = useMemo(() => ({ elapsed: elapsedMs ?? 0, at: performance.now() }), [elapsedMs, running, startedAt]);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    setNow(performance.now());
    if (!running) return;
    const tick = () => {
      if (!document.hidden) setNow(performance.now());
    };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [running, anchor]);
  if (elapsedMs == null && !startedAt) return <span className="ve-elapsed-missing">此历史任务未记录耗时</span>;
  const value = formatVideoEditElapsed(startedAt ? Math.max(0, Date.now() - startedAt) : anchor.elapsed + (running ? Math.max(0, now - anchor.at) : 0));
  const label = completed ? '总用时' : running ? '已用时' : '本次已用时';
  return <div className={`ve-elapsed ${running ? 've-elapsed-running' : ''} ${completed ? 've-elapsed-completed' : ''}`} aria-live="off">
    <div className="ve-elapsed-caption">{completed ? <Check size={13} /> : <Timer size={13} />}<span>{label}</span></div>
    <div className="ve-elapsed-time" role="timer" aria-label={`${label} ${value}`}>
      <span className="ve-elapsed-visual" aria-hidden="true">{[...value].map((digit, index) => <span className="ve-elapsed-slot" key={index}><span key={digit} className={digit === ':' ? 've-elapsed-colon' : 've-elapsed-digit'}>{digit}</span></span>)}</span>
    </div>
    {running && <span className="ve-elapsed-activity" aria-hidden="true"><span /></span>}
  </div>;
}
