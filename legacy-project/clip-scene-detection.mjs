import { spawn } from 'node:child_process';

const PREVIEW_BYTES = 16 * 16 * 3;
const LOOKAHEAD = 3;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};

function distance(a, b) {
  let total = 0;
  for (let i = 0; i < PREVIEW_BYTES; i++) total += Math.abs(a[i] - b[i]);
  return total / (PREVIEW_BYTES * 255);
}

export function getClipEndBeforeDetectedCut(cutSeconds, fps = 30, previousFrameSeconds) {
  const cut = Math.max(0, Number(cutSeconds) || 0);
  if (Number.isFinite(previousFrameSeconds) && previousFrameSeconds >= 0 && previousFrameSeconds < cut) {
    return Math.floor((previousFrameSeconds + cut) / 2 * 1e6) / 1e6;
  }
  const safeFps = Number.isFinite(Number(fps)) && Number(fps) > 0 ? Number(fps) : 30;
  return Math.max(0, Math.round((cut - 0.5 / safeFps) * 1000) / 1000);
}

// Keep only a small frame window. RGB thumbnails distinguish a lasting change
// from a flash that returns to the same image; they never enter the preview UI.
export function createBoundaryClassifier({ fps, afterSeconds = 0, onBoundary }) {
  const frames = [];
  let nextIndex = 1;
  let ignoredUntil = -1;
  let lastBoundary = afterSeconds;
  let ordinal = 0;

  function inspect(index) {
    const current = frames[index];
    if (current.ordinal <= ignoredUntil || current.time <= lastBoundary + 0.00002 || current.time < 0.08) return;
    const previous = frames[index - 1];
    const future = frames.slice(index + 1, index + 1 + LOOKAHEAD);
    if (!previous || future.length < 1) return;
    const history = frames.slice(Math.max(1, index - 8), index);
    const ambientScore = median([...history.map((f) => f.score), ...future.map((f) => f.score)]);
    const threshold = Math.max(0.075, ambientScore * 4 + 0.015);
    const jump = current.motion;
    const ambientMotion = median(history.slice(1).map((f) => f.motion));
    // Luma-only scene scores can miss different colors of similar brightness.
    const colorCut = jump >= Math.max(0.12, ambientMotion * 5 + 0.02);
    if (current.score < threshold && !colorCut) return;
    const lastingChange = median(future.map((f) => distance(previous.rgb, f.rgb)));
    if (jump > 0.025 && lastingChange < jump * 0.3) {
      // The image returned within 1–3 frames: ignore both edges of the flash.
      ignoredUntil = future.at(-1).ordinal;
      return;
    }
    if (current.score < 0.32 && (lastingChange < Math.max(0.018, ambientMotion * 2.5) || (!colorCut && current.score < ambientScore * 4 + 0.015))) return;

    // Consecutive changing frames can be one short transition. Preserve its
    // onset, as in the existing frame-accurate trim, rather than its last frame.
    let onset = index;
    for (let step = 0; step < 2 && onset > 1; step++) {
      const prior = frames[onset - 1];
      if (current.time - prior.time > 0.1 || prior.score < Math.max(0.075, ambientScore * 4 + 0.015)) break;
      onset--;
    }
    const cut = frames[onset];
    if (cut.time <= lastBoundary + 0.00002) return;
    lastBoundary = cut.time;
    ignoredUntil = current.ordinal + 2;
    onBoundary({ cutSeconds: cut.time, endSeconds: getClipEndBeforeDetectedCut(cut.time, fps, frames[onset - 1]?.time) });
  }

  return {
    push(frame) {
      const previous = frames.at(-1);
      frames.push({ ...frame, ordinal: ordinal++, motion: previous ? distance(previous.rgb, frame.rgb) : 0 });
      while (nextIndex + LOOKAHEAD < frames.length) inspect(nextIndex++);
      if (nextIndex > 16) {
        const remove = nextIndex - 8;
        frames.splice(0, remove);
        nextIndex -= remove;
      }
    },
    finish() {
      while (nextIndex < frames.length - 1) inspect(nextIndex++);
    },
  };
}

export function scanClipBoundaries({ sourcePath, fps, shotCount, afterSeconds = 0, scanDuration, frameSyncArgs = [], spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    const cutPoints = [];
    // copyts retains exact source PTS when continuing a previous scan, also VFR.
    const seek = Math.max(0, afterSeconds - 0.3);
    const args = ['-v', 'error', ...(seek > 0 ? ['-ss', String(seek)] : []), '-copyts', '-start_at_zero', '-t', String(scanDuration - seek), '-i', sourcePath,
      '-map', '0:v:0', '-vf', "scale=320:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score:file='pipe\\:2',scale=16:16,format=rgb24",
      ...frameSyncArgs, '-an', '-f', 'rawvideo', 'pipe:1'];
    const child = spawnImpl('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stopped = false;
    let failure;
    let raw = Buffer.alloc(0);
    let lines = '';
    let errorText = '';
    let frameTime;
    const images = [];
    const metadata = [];
    const classifier = createBoundaryClassifier({ fps, afterSeconds, onBoundary(boundary) {
      if (stopped || boundary.cutSeconds >= scanDuration - 0.001) return;
      cutPoints.push(boundary);
      if (cutPoints.length >= shotCount) {
        stopped = true;
        child.kill('SIGTERM');
      }
    } });
    const timer = setTimeout(() => {
      failure = new Error('镜头识别超时，请缩短视频后重试');
      child.kill('SIGKILL');
    }, 120_000);

    function consume() {
      while (!stopped && images.length && metadata.length) {
        classifier.push({ ...metadata.shift(), rgb: images.shift() });
      }
    }
    child.stdout.on('data', (chunk) => {
      if (stopped) return;
      raw = Buffer.concat([raw, chunk]);
      let offset = 0;
      while (offset + PREVIEW_BYTES <= raw.length) {
        images.push(Buffer.from(raw.subarray(offset, offset + PREVIEW_BYTES)));
        offset += PREVIEW_BYTES;
      }
      raw = raw.subarray(offset);
      consume();
    });
    child.stderr.on('data', (chunk) => {
      if (stopped) return;
      lines += chunk.toString();
      const parts = lines.split(/\r?\n/);
      lines = parts.pop() || '';
      for (const line of parts) {
        const time = line.match(/frame:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([-+\d.eE]+)/);
        const score = line.match(/^lavfi\.scene_score=([-+\d.eE]+)/);
        if (time) frameTime = Number(time[1]);
        else if (score && Number.isFinite(frameTime)) {
          metadata.push({ time: frameTime, score: Number(score[1]) });
          frameTime = undefined;
        } else if (line.trim()) errorText = (errorText + '\n' + line).slice(-4000);
      }
      consume();
    });
    child.on('error', (error) => { failure = error; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (!stopped && code !== 0) return reject(new Error(errorText || '镜头识别失败，请检查视频格式'));
      const complete = !stopped;
      if (complete) {
        consume();
        if (raw.length || images.length || metadata.length) return reject(new Error('镜头分析帧未完整读取，请重试'));
        classifier.finish();
      }
      resolve({ cutPoints, complete });
    });
  });
}

export function createClipSceneDetectionService({ probe, getFrameSyncArgs, scan = scanClipBoundaries, ttlMs = 15 * 60 * 1000 }) {
  const cache = new Map();
  return {
    forget(sourceId) { cache.delete(sourceId); },
    async detect({ sourceId, sourcePath, shotCount }) {
      for (const [key, value] of cache) if (value.expiresAt < Date.now() && !value.pending) cache.delete(key);
      let entry = cache.get(sourceId);
      if (!entry) {
        while (cache.size >= 64) {
          const oldest = [...cache].find(([, value]) => !value.pending);
          if (!oldest) break;
          cache.delete(oldest[0]);
        }
        entry = { cutPoints: [], complete: false, metadata: null, expiresAt: Date.now() + ttlMs };
        cache.set(sourceId, entry);
      }
      while (entry.pending) await entry.pending;
      if (entry.cutPoints.length < shotCount && !entry.complete) {
        entry.pending = (async () => {
          entry.metadata ||= await probe(sourcePath);
          const result = await scan({ sourcePath, fps: entry.metadata.fps, shotCount: shotCount - entry.cutPoints.length,
            afterSeconds: entry.cutPoints.at(-1)?.cutSeconds || 0, scanDuration: Math.min(entry.metadata.durationSeconds, 60),
            frameSyncArgs: await getFrameSyncArgs('passthrough') });
          entry.cutPoints.push(...result.cutPoints);
          entry.complete = result.complete;
        })();
        try { await entry.pending; } finally { entry.pending = null; }
      }
      return { cutPoints: entry.cutPoints.slice(0, shotCount), metadata: entry.metadata,
        scannedToVideoEnd: entry.complete && entry.metadata.durationSeconds <= 60 };
    },
  };
}
