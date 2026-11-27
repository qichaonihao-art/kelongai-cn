import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  CheckCircle2,
  Download,
  FileAudio,
  Film,
  LoaderCircle,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';
import { cn } from '@/src/lib/utils';

interface VoiceTransferPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSwitchToVideo: () => void;
  onSwitchToClip: () => void;
  onSwitchToCopy: () => void;
}

interface UploadedSource {
  sourceId: string;
  fileName: string;
  url: string;
  size: number;
  durationSeconds: number;
  hasVideo: boolean;
  defaultStartSeconds: number;
  defaultEndSeconds: number;
}

interface SeparatedVocal {
  vocalId: string;
  vocalUrl: string;
  vocalFingerprint: string;
  durationSeconds: number;
  startSeconds: number;
  endSeconds: number;
  scene: SeparationScene;
  cached: boolean;
}

interface GeneratedResult {
  audioUrl: string;
  fileName: string;
  size: number;
  durationSeconds: number;
  reusedVoice: boolean;
  textSnapshot: string;
}

type SeparationScene = 'Narrate' | 'Audio';
type PipelineStage = 'idle' | 'separating' | 'synthesizing';

const MAX_SLICE_SECONDS = 30;
const MIN_SLICE_SECONDS = 1;
const MAX_TEXT_LENGTH = 2000;

function formatSeconds(value: number): string {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const mins = Math.floor(safe / 60);
  const secs = safe - mins * 60;
  return `${String(mins).padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string' && data.error.trim()) return data.error.trim();
    if (typeof data?.message === 'string' && data.message.trim()) return data.message.trim();
  } catch {}
  return fallback;
}

export default function VoiceTransferPage({
  onBack,
  onNavigate,
  onSwitchToVideo,
  onSwitchToClip,
  onSwitchToCopy,
}: VoiceTransferPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaPreviewRef = useRef<HTMLMediaElement | null>(null);
  const sourceRef = useRef<UploadedSource | null>(null);
  const vocalRef = useRef<SeparatedVocal | null>(null);

  const [source, setSource] = useState<UploadedSource | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);

  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(15);
  const [scene, setScene] = useState<SeparationScene>('Narrate');
  const [previewingRange, setPreviewingRange] = useState(false);

  const [vocal, setVocal] = useState<SeparatedVocal | null>(null);
  const [text, setText] = useState('');
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    vocalRef.current = vocal;
  }, [vocal]);

  useEffect(() => {
    return () => {
      const currentSource = sourceRef.current;
      const currentVocal = vocalRef.current;
      if (currentSource || currentVocal) {
        void fetch('/api/voice-transfer/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            sourceId: currentSource?.sourceId,
            vocalId: currentVocal?.vocalId,
          }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, []);

  const isBusy = uploadProgress !== null || stage !== 'idle';
  const roundedStart = Math.round(startSeconds * 10) / 10;
  const roundedEnd = Math.round(endSeconds * 10) / 10;
  const selectedDuration = Math.max(0, Math.round((roundedEnd - roundedStart) * 10) / 10);

  const vocalMatchesCurrentSelection = Boolean(
    vocal &&
      source &&
      Math.abs(vocal.startSeconds - roundedStart) < 0.05 &&
      Math.abs(vocal.endSeconds - roundedEnd) < 0.05 &&
      vocal.scene === scene
  );

  function cleanupRemote(oldSource?: UploadedSource | null, oldVocal?: SeparatedVocal | null) {
    if (!oldSource && !oldVocal) return;
    void fetch('/api/voice-transfer/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        sourceId: oldSource?.sourceId,
        vocalId: oldVocal?.vocalId,
      }),
    }).catch(() => {});
  }

  function stopRangePreview() {
    const player = mediaPreviewRef.current;
    if (player && !player.paused) player.pause();
    setPreviewingRange(false);
  }

  function handleUploadFile(file: File) {
    if (!file) return;
    setError('');
    stopRangePreview();
    const prevSource = source;
    const prevVocal = vocal;

    setUploadProgress(1);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/voice-transfer/source');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name || 'source-media'));

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        setUploadProgress(Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100))));
      }
    };

    xhr.onload = () => {
      setUploadProgress(null);
      let payload: any = null;
      try {
        payload = JSON.parse(xhr.responseText || '{}');
      } catch {}
      if (xhr.status < 200 || xhr.status >= 300 || !payload?.ok) {
        setError(payload?.error || '素材上传失败，请检查文件格式后重试');
        return;
      }
      cleanupRemote(prevSource, prevVocal);
      const uploaded: UploadedSource = {
        sourceId: String(payload.sourceId),
        fileName: String(payload.fileName || file.name),
        url: String(payload.url),
        size: Number(payload.size || file.size),
        durationSeconds: Number(payload.durationSeconds || 0),
        hasVideo: Boolean(payload.hasVideo),
        defaultStartSeconds: Number(payload.defaultStartSeconds || 0),
        defaultEndSeconds: Number(payload.defaultEndSeconds || Math.min(15, Number(payload.durationSeconds || 0))),
      };
      setSource(uploaded);
      setStartSeconds(uploaded.defaultStartSeconds);
      setEndSeconds(uploaded.defaultEndSeconds);
      setVocal(null);
      setResult(null);
    };

    xhr.onerror = () => {
      setUploadProgress(null);
      setError('上传过程中网络中断，请重试');
    };

    xhr.send(file);
  }

  function handleStartChange(nextValue: number) {
    if (!source) return;
    const maxStart = Math.max(0, source.durationSeconds - MIN_SLICE_SECONDS);
    const clampedStart = Math.max(0, Math.min(maxStart, Math.round(nextValue * 10) / 10));
    let nextEnd = endSeconds;
    if (nextEnd - clampedStart < MIN_SLICE_SECONDS) {
      nextEnd = Math.min(source.durationSeconds, clampedStart + MIN_SLICE_SECONDS);
    } else if (nextEnd - clampedStart > MAX_SLICE_SECONDS) {
      nextEnd = Math.min(source.durationSeconds, clampedStart + MAX_SLICE_SECONDS);
    }
    setStartSeconds(clampedStart);
    setEndSeconds(Math.round(nextEnd * 10) / 10);
  }

  function handleEndChange(nextValue: number) {
    if (!source) return;
    const clampedEnd = Math.max(MIN_SLICE_SECONDS, Math.min(source.durationSeconds, Math.round(nextValue * 10) / 10));
    let nextStart = startSeconds;
    if (clampedEnd - nextStart < MIN_SLICE_SECONDS) {
      nextStart = Math.max(0, clampedEnd - MIN_SLICE_SECONDS);
    } else if (clampedEnd - nextStart > MAX_SLICE_SECONDS) {
      nextStart = Math.max(0, clampedEnd - MAX_SLICE_SECONDS);
    }
    setStartSeconds(Math.round(nextStart * 10) / 10);
    setEndSeconds(clampedEnd);
  }

  function toggleRangePreview() {
    const player = mediaPreviewRef.current;
    if (!player || !source) return;
    if (previewingRange && !player.paused) {
      stopRangePreview();
      return;
    }
    player.currentTime = roundedStart;
    setPreviewingRange(true);
    void player.play().catch(() => {
      setPreviewingRange(false);
    });
  }

  function handleMediaTimeUpdate() {
    const player = mediaPreviewRef.current;
    if (!player || !previewingRange) return;
    if (player.currentTime >= roundedEnd - 0.05) {
      player.pause();
      setPreviewingRange(false);
    }
  }

  async function runSeparateVocal(): Promise<SeparatedVocal | null> {
    if (!source) {
      setError('请先上传包含人声的视频或音频文件');
      return null;
    }
    setError('');
    setStage('separating');
    try {
      const response = await fetch('/api/voice-transfer/separate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sourceId: source.sourceId,
          startSeconds: roundedStart,
          endSeconds: roundedEnd,
          scene,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, '人声与 BGM 分离失败，请重试'));
      }
      const data = await response.json();
      const extracted: SeparatedVocal = {
        vocalId: String(data.vocalId),
        vocalUrl: String(data.vocalUrl),
        vocalFingerprint: String(data.vocalFingerprint || ''),
        durationSeconds: Number(data.durationSeconds || 0),
        startSeconds: Number(data.startSeconds ?? roundedStart),
        endSeconds: Number(data.endSeconds ?? roundedEnd),
        scene: (data.scene === 'Audio' ? 'Audio' : 'Narrate') as SeparationScene,
        cached: Boolean(data.cached),
      };
      setVocal(extracted);
      return extracted;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '人声与 BGM 分离失败');
      return null;
    } finally {
      setStage('idle');
    }
  }

  async function handleSeparateOnly() {
    if (isBusy) return;
    await runSeparateVocal();
  }

  async function handleGenerateMp3() {
    if (isBusy) return;
    if (!source) {
      setError('请先在左侧上传视频或音频文件');
      return;
    }
    const trimmedText = text.trim();
    if (!trimmedText) {
      setError('请在右侧输入需要配音的目标文案');
      return;
    }

    setError('');
    stopRangePreview();

    let activeVocal = vocalMatchesCurrentSelection ? vocal : null;
    if (!activeVocal) {
      activeVocal = await runSeparateVocal();
      if (!activeVocal) return;
    }

    setStage('synthesizing');
    try {
      const response = await fetch('/api/voice-transfer/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          vocalId: activeVocal.vocalId,
          text: trimmedText,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, '音色克隆或 MP3 生成失败，请稍后重试'));
      }
      const data = await response.json();
      setResult({
        audioUrl: String(data.audioUrl),
        fileName: String(data.fileName || '音色转移.mp3'),
        size: Number(data.size || 0),
        durationSeconds: Number(data.durationSeconds || 0),
        reusedVoice: Boolean(data.reusedVoice),
        textSnapshot: trimmedText,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '音色克隆或 MP3 生成失败');
    } finally {
      setStage('idle');
    }
  }

  function handleResetSource() {
    if (isBusy) return;
    stopRangePreview();
    cleanupRemote(source, vocal);
    setSource(null);
    setVocal(null);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f5f7fb] text-slate-900">
      <div className="pointer-events-none absolute inset-x-0 top-14 h-[420px] bg-[radial-gradient(circle_at_15%_10%,rgba(244,63,94,0.10),transparent_36%),radial-gradient(circle_at_85%_20%,rgba(245,158,11,0.11),transparent_36%)]" />

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,.mp4,.mov,.m4v,.mkv,.webm,.avi,.mp3,.wav,.m4a,.aac,.flac,.ogg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleUploadFile(file);
        }}
      />

      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 shadow-sm backdrop-blur-xl md:px-6">
        <div className="flex items-center gap-3">
          <HomeBackButton onClick={onBack} />
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
          <CreativeSubNav
            current="voice-transfer"
            onSwitchVideo={onSwitchToVideo}
            onSwitchClip={onSwitchToClip}
            onSwitchCopy={onSwitchToCopy}
            onSwitchVoiceTransfer={() => {}}
          />
        </div>
        <div className="hidden text-xs font-bold text-slate-500 sm:block">
          AI MediaKit 分离 BGM · 阿里云克隆音色 · 临时使用不入库
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-slate-950">
              <AudioLines className="size-5 text-rose-600" />
              音色转移
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              上传视频或音频自动剥离 BGM 提取纯人声，再用该音色朗读新文案，直接输出 MP3。
            </p>
          </div>
          <div className="text-xs font-semibold text-slate-400">
            建议截取 15 秒清晰人声 · 支持 MP4 / MOV / MP3 / WAV / M4A
          </div>
        </div>

        {error && (
          <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 shadow-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 窗口一：上传原视频/音频 & 提取纯净人声 */}
          <section className="flex flex-col rounded-3xl border border-slate-200/90 bg-white/95 p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.28)] backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-xl bg-rose-100 text-xs font-black text-rose-600">
                  1
                </span>
                <div>
                  <h2 className="text-base font-black text-slate-900">原音色素材</h2>
                  <p className="text-xs text-slate-500">上传视频或音频，自动分离背景音乐</p>
                </div>
              </div>
              {source && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleResetSource}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  更换素材
                </button>
              )}
            </div>

            {!source ? (
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!isBusy) fileInputRef.current?.click();
                }}
                onKeyDown={(event) => {
                  if ((event.key === 'Enter' || event.key === ' ') && !isBusy) {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDraggingFile(true);
                }}
                onDragLeave={() => setDraggingFile(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDraggingFile(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file && !isBusy) handleUploadFile(file);
                }}
                className={cn(
                  'flex flex-1 min-h-[300px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition-all',
                  draggingFile
                    ? 'border-rose-500 bg-rose-50/70'
                    : 'border-slate-200 bg-slate-50/70 hover:border-rose-300 hover:bg-rose-50/30'
                )}
              >
                {uploadProgress !== null ? (
                  <div className="w-full max-w-xs space-y-3">
                    <LoaderCircle className="mx-auto size-9 animate-spin text-rose-600" />
                    <div className="text-sm font-black text-slate-800">正在上传并解析素材… {uploadProgress}%</div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500 transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-lg shadow-rose-200/70">
                      <Upload className="size-6" />
                    </div>
                    <div className="mt-4 text-base font-black text-slate-900">点击或拖拽上传视频 / 音频</div>
                    <p className="mt-1.5 max-w-xs text-xs leading-5 text-slate-500">
                      支持 MP4、MOV、MKV、MP3、WAV、M4A 等常见格式，最大 500MB。长素材默认截取前 15 秒提取音色。
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* 文件信息条 */}
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-3.5 py-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
                    {source.hasVideo ? <Film className="size-4" /> : <FileAudio className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-slate-900">{source.fileName}</div>
                    <div className="text-xs text-slate-500">
                      总时长 {formatSeconds(source.durationSeconds)} · {formatFileSize(source.size)}
                    </div>
                  </div>
                </div>

                {/* 原素材播放器 */}
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
                  {source.hasVideo ? (
                    <video
                      ref={(node) => {
                        mediaPreviewRef.current = node;
                      }}
                      src={source.url}
                      controls
                      preload="metadata"
                      onTimeUpdate={handleMediaTimeUpdate}
                      onPause={() => setPreviewingRange(false)}
                      onEnded={() => setPreviewingRange(false)}
                      className="max-h-56 w-full object-contain"
                    />
                  ) : (
                    <div className="bg-slate-900 p-4">
                      <audio
                        ref={(node) => {
                          mediaPreviewRef.current = node;
                        }}
                        src={source.url}
                        controls
                        preload="metadata"
                        onTimeUpdate={handleMediaTimeUpdate}
                        onPause={() => setPreviewingRange(false)}
                        onEnded={() => setPreviewingRange(false)}
                        className="w-full"
                      />
                    </div>
                  )}
                </div>

                {/* 截取区间控制（默认 15 秒） */}
                <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-900">
                      <Scissors className="size-3.5 text-amber-600" />
                      截取人声片段（建议 10～15 秒）
                    </div>
                    <button
                      type="button"
                      onClick={toggleRangePreview}
                      className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-bold text-amber-700 shadow-sm ring-1 ring-amber-200 transition hover:bg-amber-100/60"
                    >
                      {previewingRange ? <Square className="size-3 fill-current" /> : <Play className="size-3 fill-current" />}
                      {previewingRange ? '停止试听' : '试听选区'}
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="block">
                      <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>开始时间</span>
                        <span className="font-mono text-slate-900">{formatSeconds(roundedStart)}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, Math.round((source.durationSeconds - MIN_SLICE_SECONDS) * 10) / 10)}
                        step={0.1}
                        value={roundedStart}
                        disabled={isBusy || source.durationSeconds <= MIN_SLICE_SECONDS}
                        onChange={(event) => handleStartChange(Number(event.target.value))}
                        className="w-full accent-rose-600"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>结束时间</span>
                        <span className="font-mono text-slate-900">{formatSeconds(roundedEnd)}</span>
                      </div>
                      <input
                        type="range"
                        min={MIN_SLICE_SECONDS}
                        max={Math.max(MIN_SLICE_SECONDS, Math.round(source.durationSeconds * 10) / 10)}
                        step={0.1}
                        value={roundedEnd}
                        disabled={isBusy || source.durationSeconds <= MIN_SLICE_SECONDS}
                        onChange={(event) => handleEndChange(Number(event.target.value))}
                        className="w-full accent-amber-600"
                      />
                    </label>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600">
                    <span>
                      当前已选：<strong className="font-mono text-slate-900">{selectedDuration.toFixed(1)} 秒</strong>（单次 1～30 秒）
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setScene('Narrate')}
                        className={cn(
                          'rounded-lg px-2 py-0.5 text-[11px] font-bold transition',
                          scene === 'Narrate'
                            ? 'bg-rose-600 text-white'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900'
                        )}
                      >
                        口播（去音乐+音效）
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setScene('Audio')}
                        className={cn(
                          'rounded-lg px-2 py-0.5 text-[11px] font-bold transition',
                          scene === 'Audio'
                            ? 'bg-rose-600 text-white'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900'
                        )}
                      >
                        通用（去背景音）
                      </button>
                    </div>
                  </div>
                </div>

                {/* 分离后的纯净人声试听 */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                      <Volume2 className="size-4 text-emerald-600" />
                      分离后的纯净人声
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleSeparateOnly()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                    >
                      {stage === 'separating' ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      {stage === 'separating'
                        ? '正在分离 BGM…'
                        : vocalMatchesCurrentSelection
                          ? '重新分离'
                          : '先提取并试听纯人声'}
                    </button>
                  </div>

                  {vocalMatchesCurrentSelection && vocal ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                        <CheckCircle2 className="size-3.5" />
                        纯人声已就绪（有效时长 {vocal.durationSeconds.toFixed(1)} 秒），可直接用于右侧生成
                      </div>
                      <audio controls src={vocal.vocalUrl} className="w-full" />
                    </div>
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      你可以先点上方按钮提前试听分离效果；也可以直接在右侧填好文案后一键完成「分离 BGM + 克隆 + 生成 MP3」。
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* 窗口二：输入目标文案 & 输出 MP3 */}
          <section className="flex flex-col rounded-3xl border border-slate-200/90 bg-white/95 p-5 shadow-[0_20px_50px_-32px_rgba(15,23,42,0.28)] backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-xl bg-amber-100 text-xs font-black text-amber-700">
                  2
                </span>
                <div>
                  <h2 className="text-base font-black text-slate-900">目标文案与 MP3 输出</h2>
                  <p className="text-xs text-slate-500">使用提取出的音色朗读下方文案，生成 MP3 音频</p>
                </div>
              </div>
              {text.trim() && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setText('')}
                  className="text-xs font-bold text-slate-400 transition hover:text-slate-600 disabled:opacity-50"
                >
                  清空文案
                </button>
              )}
            </div>

            <div className="flex flex-1 flex-col">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value.slice(0, MAX_TEXT_LENGTH))}
                disabled={isBusy}
                rows={8}
                placeholder="在这里输入你想让这个音色说的新文案…&#10;&#10;提示：标点符号（逗号、句号、感叹号）可以帮助控制停顿和语气；生成后如果修改文案再次生成，会自动复用当前音色，几秒内出新 MP3。"
                className="min-h-[200px] w-full flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-sm leading-6 text-slate-900 placeholder:text-slate-400 focus:border-rose-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-rose-100 disabled:opacity-60"
              />

              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                <span>克隆引擎：阿里云声音克隆（qwen-audio-3.1-tts-flash）</span>
                <span className="font-mono">
                  {text.length} / {MAX_TEXT_LENGTH}
                </span>
              </div>

              {/* 进度提示 */}
              {stage !== 'idle' && (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-black text-rose-700">
                    <LoaderCircle className="size-4 animate-spin" />
                    {stage === 'separating'
                      ? '第 1/2 步：正在截取音频并调用 AI MediaKit 分离 BGM…'
                      : '第 2/2 步：正在用阿里云克隆音色并合成 MP3…'}
                  </div>
                  <p className="mt-1 text-xs text-rose-600/80">
                    {stage === 'separating'
                      ? '通常需要 10～25 秒，分离出纯净人声后将自动进入克隆合成。'
                      : '首次克隆该音色需等待几秒部署就绪；同素材修改文案再次生成时会直接复用音色。'}
                  </p>
                </div>
              )}

              <button
                type="button"
                disabled={isBusy || !source || !text.trim()}
                onClick={() => void handleGenerateMp3()}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-amber-500 px-5 text-sm font-black text-white shadow-lg shadow-rose-200/80 transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stage !== 'idle' ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {stage === 'separating'
                  ? '正在分离 BGM 提取人声…'
                  : stage === 'synthesizing'
                    ? '正在克隆音色并生成 MP3…'
                    : vocalMatchesCurrentSelection
                      ? '使用当前纯人声生成 MP3'
                      : '一键分离人声并生成 MP3'}
              </button>

              {/* 生成结果区 */}
              {result && (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      <span className="text-sm font-black text-slate-900">MP3 生成完成</span>
                      {result.reusedVoice && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                          已复用当前音色
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-semibold text-slate-500">
                      {result.durationSeconds > 0 ? `${result.durationSeconds.toFixed(1)} 秒 · ` : ''}
                      {formatFileSize(result.size)}
                    </span>
                  </div>

                  <audio controls src={result.audioUrl} className="mt-3 w-full" />

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-slate-500">{result.fileName}</span>
                    <a
                      href={result.audioUrl}
                      download={result.fileName}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white transition hover:bg-slate-700"
                    >
                      <Download className="size-3.5" />
                      下载 MP3
                    </a>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
