import { useEffect, useState } from 'react';

// A queued cover returns quickly; retry without keeping HTTP connections occupied.
export default function VideoLibraryThumbnail({ src }: { src: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setAttempt(0); setFailed(false); }, [src]);
  useEffect(() => {
    if (!failed || attempt >= 12) return;
    const timer = window.setTimeout(() => {
      setFailed(false);
      setAttempt(value => value + 1);
    }, Math.min(30_000, 5_000 * (attempt + 1)));
    return () => window.clearTimeout(timer);
  }, [failed, attempt, src]);
  const retrySrc = attempt ? `${src}${src.includes('?') ? '&' : '?'}coverRetry=${attempt}` : src;
  return <img src={retrySrc} alt="" loading="lazy" decoding="async"
    onError={() => setFailed(true)} onLoad={() => setFailed(false)}
    style={{ visibility: failed ? 'hidden' : undefined }}
    className="absolute inset-0 h-full w-full object-cover" />;
}
