import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  CheckCircle2,
  Download,
  FileAudio,
  Film,
  Link2,
  LoaderCircle,
  Play,
  RefreshCw,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Users,
  Volume2,
  WandSparkles,
} from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';
import './copy-transfer.css';
import { resolveCpExtract, type DouyinDownloadCandidate, type DouyinResolveResult } from '@/src/lib/douyin';
import { cn } from '@/src/lib/utils';

interface VoiceTransferPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSwitchToVideo: () => void;
  onSwitchToClip: () => void;
  onSwitchToCopy: () => void;
  onSwitchToCopyTransfer?: () => void;
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
  sourceType?: 'local' | 'online';
}

interface DetectedSpeaker {
  speakerId: string | number;
  label: string;
  vocalId: string;
  vocalUrl: string;
  durationSeconds: number;
  sampleText: string;
}

interface SeparatedVocal {
  vocalId: string;
  vocalUrl: string;
  vocalFingerprint: string;
  durationSeconds: number;
  startSeconds: number;
  endSeconds: number;
  scene: SeparationScene;
  speakers: DetectedSpeaker[];
  requiresSpeakerSelection: boolean;
  cached: boolean;
}

interface GeneratedResult {
  audioUrl: string;
  fileName: string;
  size: number;
  durationSeconds: number;
  reusedVoice: boolean;
  speakerLabel: string;
  textSnapshot: string;
}

type SourceInputMode = 'link' | 'upload';
type OnlineLoadStage = 'parsing' | 'downloading' | 'checking' | 'loading';
interface OnlineLoadProgress {
  stage: OnlineLoadStage;
  percent: number;
  message: string;
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

function collectOnlineVideoCandidates(result: DouyinResolveResult) {
  const seen = new Set<string>();
  const candidates: DouyinDownloadCandidate[] = [];
  const add = (value: string | DouyinDownloadCandidate | undefined, source = 'voice-transfer') => {
    const url = typeof value === 'string' ? value : value?.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push(typeof value === 'string' ? { url, source } : value);
  };
  add(result.downloadUrl, 'downloadUrl');
  for (const candidate of result.downloadUrlCandidates || []) add(candidate);
  for (const candidate of result.videoUrlCandidates || []) add(candidate);
  add(result.previewUrl, 'previewUrl');
  for (const url of result.videoUrls || []) add(url, 'videoUrls');
  return candidates;
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
  onSwitchToCopyTransfer,
}: VoiceTransferPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaPreviewRef = useRef<HTMLMediaElement | null>(null);
  const sourceRef = useRef<UploadedSource | null>(null);
  const vocalRef = useRef<SeparatedVocal | null>(null);

  const [sourceMode, setSourceMode] = useState<SourceInputMode>('link');
  const [linkInput, setLinkInput] = useState('');
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineProgress, setOnlineProgress] = useState<OnlineLoadProgress | null>(null);
  const [onlineElapsedSeconds, setOnlineElapsedSeconds] = useState(0);

  const [source, setSource] = useState<UploadedSource | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [draggingFile, setDraggingFile] = useState(false);

  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(15);
  const [scene, setScene] = useState<SeparationScene>('Narrate');
  const [previewingRange, setPreviewingRange] = useState(false);

  const [vocal, setVocal] = useState<SeparatedVocal | null>(null);
  const [selectedSpeakerVocalId, setSelectedSpeakerVocalId] = useState('');
  const [confirmedSpeakerVocalId, setConfirmedSpeakerVocalId] = useState('');
  const [pendingGenerateAfterConfirm, setPendingGenerateAfterConfirm] = useState(false);

  const [text, setText] = useState('');
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [stageStartedAt, setStageStartedAt] = useState(Date.now());
  const [stageNow, setStageNow] = useState(Date.now());
  const [result, setResult] = useState<GeneratedResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    vocalRef.current = vocal;
  }, [vocal]);

  useEffect(() => {
    if (!onlineLoading) return;
    const timer = window.setInterval(() => {
      setOnlineElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onlineLoading]);

  useEffect(() => {
    if (stage === 'idle') return;
    setStageStartedAt(Date.now());
    const timer = window.setInterval(() => setStageNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    return () => {
      const currentSource = sourceRef.current;
      const currentVocal = vocalRef.current;
      if (currentSource || currentVocal) {
        const vocalIds = [
          currentVocal?.vocalId,
          ...(currentVocal?.speakers.map((sp) => sp.vocalId) || []),
        ].filter(Boolean);
        void fetch('/api/voice-transfer/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            sourceId: currentSource?.sourceId,
            vocalIds,
          }),
          keepalive: true,
        }).catch(() => {});
      }
    };
  }, []);

  const isBusy = onlineLoading || uploadProgress !== null || stage !== 'idle';
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

  const activeSpeakers = vocalMatchesCurrentSelection && vocal ? vocal.speakers : [];
  const hasMultipleSpeakers = activeSpeakers.length > 1;
  const selectedSpeaker = activeSpeakers.find((sp) => sp.vocalId === selectedSpeakerVocalId) || activeSpeakers[0] || null;
  const confirmedSpeaker = activeSpeakers.find((sp) => sp.vocalId === confirmedSpeakerVocalId) || null;
  const needsSpeakerConfirmation = Boolean(vocalMatchesCurrentSelection && hasMultipleSpeakers && !confirmedSpeaker);

  function cleanupRemote(oldSource?: UploadedSource | null, oldVocal?: SeparatedVocal | null) {
    if (!oldSource && !oldVocal) return;
    const vocalIds = [
      oldVocal?.vocalId,
      ...(oldVocal?.speakers.map((sp) => sp.vocalId) || []),
    ].filter(Boolean);
    void fetch('/api/voice-transfer/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        sourceId: oldSource?.sourceId,
        vocalIds,
      }),
    }).catch(() => {});
  }

  function stopRangePreview() {
    const player = mediaPreviewRef.current;
    if (player && !player.paused) player.pause();
    setPreviewingRange(false);
  }

  function activateSource(nextSource: UploadedSource, prevSource?: UploadedSource | null, prevVocal?: SeparatedVocal | null) {
    cleanupRemote(prevSource, prevVocal);
    setSource(nextSource);
    setStartSeconds(nextSource.defaultStartSeconds);
    setEndSeconds(nextSource.defaultEndSeconds);
    setVocal(null);
    setSelectedSpeakerVocalId('');
    setConfirmedSpeakerVocalId('');
    setPendingGenerateAfterConfirm(false);
    setResult(null);
    setError('');
    setNotice('');
  }

  function handleUploadFile(file: File) {
    if (!file) return;
    setError('');
    setNotice('');
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
      const duration = Number(payload.durationSeconds || 0);
      activateSource(
        {
          sourceId: String(payload.sourceId),
          fileName: String(payload.fileName || file.name),
          url: String(payload.url),
          size: Number(payload.size || file.size),
          durationSeconds: duration,
          hasVideo: Boolean(payload.hasVideo),
          defaultStartSeconds: Number(payload.defaultStartSeconds || 0),
          defaultEndSeconds: Number(payload.defaultEndSeconds || Math.min(15, duration)),
          sourceType: 'local',
        },
        prevSource,
        prevVocal
      );
    };

    xhr.onerror = () => {
      setUploadProgress(null);
      setError('上传过程中网络中断，请重试');
    };

    xhr.send(file);
  }

  async function parseAndLoadOnlineVideo() {
    const input = linkInput.trim();
    if (!input) {
      setError('请先粘贴视频链接或完整分享文字。');
      return;
    }
    setOnlineLoading(true);
    setOnlineElapsedSeconds(0);
    setOnlineProgress({ stage: 'parsing', percent: 4, message: '正在识别平台并解析视频地址…' });
    setError('');
    setNotice('');
    stopRangePreview();
    const prevSource = source;
    const prevVocal = vocal;

    try {
      const parsed = await resolveCpExtract(input);
      const candidates = collectOnlineVideoCandidates(parsed);
      if (candidates.length === 0) throw new Error('没有解析到可用视频，请改用本地上传。');
      setOnlineProgress({ stage: 'downloading', percent: 25, message: '链接解析成功，正在下载视频…' });

      const response = await fetch('/api/clips/import-url-stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          downloadUrl: candidates[0]?.url,
          downloadUrlCandidates: candidates,
          videoUrls: parsed.videoUrls || [],
          title: parsed.title || `${parsed.authorName || '在线'}视频`,
          sourceUrl: parsed.sourceUrl || input,
          platform: parsed.platform || '',
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '在线视频载入失败'));
      if (!response.body) throw new Error('浏览器无法读取载入进度，请刷新后重试。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let imported: any = null;

      const handleEvent = (event: any) => {
        if (event?.type === 'error') throw new Error(String(event.message || '在线视频载入失败'));
        if (event?.type === 'done' && event.source) {
          imported = event.source;
          setOnlineProgress({ stage: 'loading', percent: 100, message: '视频已载入，准备提取音色…' });
          return;
        }
        if (event?.type !== 'progress') return;
        const progressStage: OnlineLoadStage =
          event.stage === 'checking' ? 'checking' : event.stage === 'loading' ? 'loading' : 'downloading';
        setOnlineProgress((current) => ({
          stage: progressStage,
          percent: Math.max(
            current?.percent || 0,
            Math.max(0, Math.min(99, Number(event.percent) || (progressStage === 'checking' ? 84 : 25)))
          ),
          message: String(event.message || '正在载入视频…'),
        }));
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line));
        if (done) break;
      }
      if (buffer.trim()) handleEvent(JSON.parse(buffer));
      if (!imported?.sourceId) throw new Error('视频载入未完成，请重试或改用本地上传。');

      const duration = Number(imported.durationSeconds || 0);
      activateSource(
        {
          sourceId: String(imported.sourceId),
          fileName: String(imported.fileName || parsed.title || '在线视频.mp4'),
          url: String(imported.url),
          size: Number(imported.size || 0),
          durationSeconds: duration,
          hasVideo: true,
          defaultStartSeconds: 0,
          defaultEndSeconds: Math.round(Math.min(15, duration) * 10) / 10,
          sourceType: 'online',
        },
        prevSource,
        prevVocal
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '视频解析失败，请重试或改用本地上传。');
    } finally {
      setOnlineLoading(false);
    }
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
      setError('请先解析在线视频链接或上传本地视频/音频');
      return null;
    }
    setError('');
    setNotice('');
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
      const speakers: DetectedSpeaker[] = Array.isArray(data.speakers) && data.speakers.length > 0
        ? data.speakers.map((sp: any, idx: number) => ({
            speakerId: sp.speakerId ?? idx,
            label: String(sp.label || `音色 ${idx + 1}`),
            vocalId: String(sp.vocalId || data.vocalId),
            vocalUrl: String(sp.vocalUrl || data.vocalUrl),
            durationSeconds: Number(sp.durationSeconds || 0),
            sampleText: String(sp.sampleText || ''),
          }))
        : [
            {
              speakerId: 0,
              label: '音色 1',
              vocalId: String(data.vocalId),
              vocalUrl: String(data.vocalUrl),
              durationSeconds: Number(data.durationSeconds || 0),
              sampleText: '',
            },
          ];

      const requiresSpeakerSelection = Boolean(data.requiresSpeakerSelection && speakers.length > 1);
      const extracted: SeparatedVocal = {
        vocalId: String(data.vocalId),
        vocalUrl: String(data.vocalUrl),
        vocalFingerprint: String(data.vocalFingerprint || ''),
        durationSeconds: Number(data.durationSeconds || 0),
        startSeconds: Number(data.startSeconds ?? roundedStart),
        endSeconds: Number(data.endSeconds ?? roundedEnd),
        scene: (data.scene === 'Audio' ? 'Audio' : 'Narrate') as SeparationScene,
        speakers,
        requiresSpeakerSelection,
        cached: Boolean(data.cached),
      };
      setVocal(extracted);
      setSelectedSpeakerVocalId(speakers[0].vocalId);
      setConfirmedSpeakerVocalId(requiresSpeakerSelection ? '' : speakers[0].vocalId);
      return extracted;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '人声与 BGM 分离失败');
      return null;
    } finally {
      setStage('idle');
    }
  }

  async function runSynthesizeWithVocal(targetVocalId: string, speakerLabel: string, trimmedText: string) {
    setError('');
    setNotice('');
    setStage('synthesizing');
    try {
      const response = await fetch('/api/voice-transfer/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          vocalId: targetVocalId,
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
        speakerLabel,
        textSnapshot: trimmedText,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '音色克隆或 MP3 生成失败');
    } finally {
      setStage('idle');
    }
  }

  async function handleSeparateOnly() {
    if (isBusy) return;
    setPendingGenerateAfterConfirm(false);
    const extracted = await runSeparateVocal();
    if (extracted?.requiresSpeakerSelection) {
      setNotice(`检测到 ${extracted.speakers.length} 种音色，请先在左侧试听并确认要使用的音色。`);
    }
  }

  async function handleConfirmSpeaker(andGenerate = false) {
    if (isBusy || !selectedSpeaker) return;
    setConfirmedSpeakerVocalId(selectedSpeaker.vocalId);
    setPendingGenerateAfterConfirm(false);
    setError('');
    setNotice(`已确认使用「${selectedSpeaker.label}」。`);

    const trimmedText = text.trim();
    if (andGenerate && trimmedText) {
      await runSynthesizeWithVocal(selectedSpeaker.vocalId, selectedSpeaker.label, trimmedText);
    }
  }

  async function handleGenerateMp3() {
    if (isBusy) return;
    if (!source) {
      setError('请先在左侧解析视频链接或上传本地视频/音频');
      return;
    }
    const trimmedText = text.trim();
    if (!trimmedText) {
      setError('请在右侧输入需要配音的目标文案');
      return;
    }

    setError('');
    setNotice('');
    stopRangePreview();

    let activeVocal = vocalMatchesCurrentSelection ? vocal : null;
    if (!activeVocal) {
      activeVocal = await runSeparateVocal();
      if (!activeVocal) return;
      if (activeVocal.requiresSpeakerSelection) {
        setPendingGenerateAfterConfirm(true);
        setNotice(`检测到 ${activeVocal.speakers.length} 种音色！请先在左侧试听「音色 1 / 音色 2」，点击确认后再生成 MP3。`);
        return;
      }
    }

    if (activeVocal.requiresSpeakerSelection) {
      const targetSpeaker = activeVocal.speakers.find((sp) => sp.vocalId === confirmedSpeakerVocalId);
      if (!targetSpeaker) {
        setPendingGenerateAfterConfirm(true);
        setNotice(`检测到 ${activeVocal.speakers.length} 种音色，请先在左侧试听并点击「确认使用」后再生成 MP3。`);
        return;
      }
      await runSynthesizeWithVocal(targetSpeaker.vocalId, targetSpeaker.label, trimmedText);
      return;
    }

    const singleSpeaker = activeVocal.speakers[0];
    await runSynthesizeWithVocal(
      singleSpeaker?.vocalId || activeVocal.vocalId,
      singleSpeaker?.label || '音色 1',
      trimmedText
    );
  }

  function handleResetSource() {
    if (isBusy) return;
    stopRangePreview();
    cleanupRemote(source, vocal);
    setSource(null);
    setVocal(null);
    setSelectedSpeakerVocalId('');
    setConfirmedSpeakerVocalId('');
    setPendingGenerateAfterConfirm(false);
    setResult(null);
    setError('');
    setNotice('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f3f6fa] text-slate-900">

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

      <header className="sticky top-0 z-30 flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-white/90 px-4 py-2 shadow-sm backdrop-blur-xl md:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <HomeBackButton onClick={onBack} />
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
          <CreativeSubNav
            current="voice-transfer"
            onSwitchVideo={onSwitchToVideo}
            onSwitchClip={onSwitchToClip}
            onSwitchCopy={onSwitchToCopy}
            onSwitchVoiceTransfer={() => {}}
            onSwitchCopyTransfer={onSwitchToCopyTransfer}
          />
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-7xl flex-1 space-y-4 p-4 pb-16 md:p-6">
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-200/70 border-l-4 border-l-violet-500 bg-gradient-to-r from-violet-50 via-white to-white px-5 py-4 shadow-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><AudioLines className="size-5" /></span>
            <div className="min-w-0"><h1 className="text-xl font-bold tracking-tight">音色转移</h1><p className="mt-0.5 text-sm text-slate-500">提取原音色，输入文案生成 MP3</p></div>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            {isBusy && <span className="size-2 animate-pulse rounded-full bg-violet-500" />}
            <span>{onlineLoading ? '正在载入素材' : uploadProgress !== null ? `上传中 ${uploadProgress}%` : stage === 'separating' ? '正在提取音色' : stage === 'synthesizing' ? '正在生成 MP3' : result ? 'MP3 已就绪' : '等待素材'}</span>
          </div>
        </section>

        {(error || notice) && (
          <div
            className={cn(
              'mb-5 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm',
              error
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            )}
          >
            {error || notice}
          </div>
        )}

        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-2">
          {/* 窗口一：链接解析 / 本地上传 + 截取与多音色试听确认 */}
          <section className="flex flex-col rounded-2xl border border-slate-200/90 border-t-2 border-t-violet-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div>
                  <h2 className="border-l-2 border-violet-400 pl-3 text-lg font-black text-slate-900">选择原声素材</h2>
                  <p className="text-xs text-slate-500">支持在线视频链接解析或本地音视频上传</p>
                </div>
              </div>
              {source && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleResetSource}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  更换素材
                </button>
              )}
            </div>

            {!source ? (
              <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-violet-100 bg-white">
                {/* 复用镜头截取的双模式切换：链接解析 / 本地上传 */}
                <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 p-1.5">
                  <button
                    type="button"
                    disabled={onlineLoading || uploadProgress !== null}
                    onClick={() => setSourceMode('link')}
                    className={cn(
                      'flex h-10 items-center justify-center gap-2 rounded-xl border text-sm font-black transition',
                      sourceMode === 'link'
                        ? 'border-violet-200 bg-white text-violet-700 shadow-sm'
                        : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white/70 hover:text-slate-800'
                    )}
                  >
                    <Link2 className="size-4" />
                    链接解析
                  </button>
                  <button
                    type="button"
                    disabled={onlineLoading || uploadProgress !== null}
                    onClick={() => setSourceMode('upload')}
                    className={cn(
                      'flex h-10 items-center justify-center gap-2 rounded-xl border text-sm font-black transition',
                      sourceMode === 'upload'
                        ? 'border-violet-200 bg-white text-violet-700 shadow-sm'
                        : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white/70 hover:text-slate-800'
                    )}
                  >
                    <Upload className="size-4" />
                    本地上传
                  </button>
                </div>

                {sourceMode === 'link' ? (
                  <div className="flex flex-1 flex-col justify-between bg-[radial-gradient(circle_at_90%_10%,rgba(139,92,246,0.06),transparent_35%)] p-5">
                    <div>
                      <div className="text-sm font-black text-slate-800">粘贴视频链接或分享文字</div>
                      <div className="mt-1 text-xs text-slate-400">支持抖音、快手和微信视频号，直接复用镜头截取解析引擎</div>
                      <textarea
                        value={linkInput}
                        disabled={onlineLoading}
                        onChange={(event) => setLinkInput(event.target.value)}
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            void parseAndLoadOnlineVideo();
                          }
                        }}
                        rows={4}
                        placeholder="粘贴视频链接或完整分享文案，例如：https://v.douyin.com/…"
                        className="mt-3 min-h-28 w-full resize-y rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm font-semibold leading-6 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        disabled={onlineLoading || !linkInput.trim()}
                        onClick={() => void parseAndLoadOnlineVideo()}
                        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#252041] text-sm font-black text-white shadow-lg shadow-violet-950/15 transition hover:bg-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {onlineLoading ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
                        {onlineLoading ? '正在解析并载入视频…' : '解析链接并载入'}
                      </button>

                      {onlineLoading && onlineProgress && (
                        <div
                          className="relative mt-4 overflow-hidden rounded-2xl border border-cyan-200/80 bg-gradient-to-br from-cyan-50 via-white to-sky-50 p-4 text-slate-700"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <LoaderCircle className="size-4 shrink-0 animate-spin text-cyan-600" />
                              <div className="truncate text-xs font-black text-slate-800">{onlineProgress.message}</div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="font-mono text-sm font-black text-cyan-700">{Math.round(onlineProgress.percent)}%</div>
                              <div className="text-[10px] font-bold text-slate-500">耗时 {onlineElapsedSeconds} 秒</div>
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-4 gap-1.5">
                            {([
                              ['parsing', '解析链接'],
                              ['downloading', '下载视频'],
                              ['checking', '校验素材'],
                              ['loading', '载入页面'],
                            ] as const).map(([stageKey, label], index, stages) => {
                              const activeIndex = stages.findIndex(([value]) => value === onlineProgress.stage);
                              const done = index < activeIndex;
                              const active = stageKey === onlineProgress.stage;
                              return (
                                <div
                                  key={stageKey}
                                  className={cn(
                                    'rounded-lg border px-1.5 py-1 text-center text-[10px] font-black',
                                    done
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : active
                                        ? 'border-cyan-300 bg-cyan-100/80 text-cyan-800'
                                        : 'border-slate-200 bg-white/75 text-slate-400'
                                  )}
                                >
                                  {done ? '✓ ' : active ? '● ' : ''}
                                  {label}
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-cyan-100/80">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 transition-[width] duration-500"
                              style={{ width: `${onlineProgress.percent}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 p-5">
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
                        'flex flex-1 min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-6 text-center transition-all',
                        draggingFile
                          ? 'border-violet-500 bg-violet-50/70'
                          : 'border-violet-200 bg-violet-50/30 hover:border-violet-400 hover:bg-violet-50/70'
                      )}
                    >
                      {uploadProgress !== null ? (
                        <div className="w-full max-w-xs space-y-3">
                          <LoaderCircle className="mx-auto size-9 animate-spin text-violet-600 motion-reduce:animate-none" />
                          <div className="text-sm font-black text-slate-800">正在上传并解析素材… {uploadProgress}%</div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-lg shadow-violet-200/70">
                            <Upload className="size-6" />
                          </div>
                          <div className="mt-4 text-base font-black text-slate-900">点击或拖拽上传本地视频 / 音频</div>
                          <p className="mt-1.5 max-w-xs text-xs leading-5 text-slate-500">
                            支持 MP4、MOV、MKV、MP3、WAV、M4A 等常见格式，最大 500MB。长素材默认截取前 15 秒。
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* 文件信息条 */}
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-slate-50 px-3.5 py-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-600">
                    {source.hasVideo ? <Film className="size-4" /> : <FileAudio className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-black text-slate-900">{source.fileName}</span>
                      {source.sourceType === 'online' && (
                        <span className="shrink-0 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-black text-cyan-700">
                          在线解析
                        </span>
                      )}
                    </div>
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
                <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
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
                        className="w-full accent-violet-600"
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
                            ? 'bg-violet-600 text-white'
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
                            ? 'bg-violet-600 text-white'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-900'
                        )}
                      >
                        通用（去背景音）
                      </button>
                    </div>
                  </div>
                </div>

                {/* 分离后的纯净人声 & 多音色试听确认区 */}
                <div
                  className={cn(
                    'rounded-2xl border p-4 transition-colors',
                    needsSpeakerConfirmation
                      ? 'border-amber-400 bg-amber-50/70 ring-2 ring-amber-200/70'
                      : 'border-violet-100 bg-violet-50/40'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                      {hasMultipleSpeakers ? (
                        <Users className="size-4 text-amber-600" />
                      ) : (
                        <Volume2 className="size-4 text-emerald-600" />
                      )}
                      {hasMultipleSpeakers
                        ? `检测到 ${activeSpeakers.length} 种音色 · 请试听并选择`
                        : '分离后的纯净人声'}
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleSeparateOnly()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
                    >
                      {stage === 'separating' ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                      {stage === 'separating'
                        ? '正在分离并识别音色…'
                        : vocalMatchesCurrentSelection
                          ? '重新分离'
                          : '先提取并检测音色'}
                    </button>
                  </div>

                  {vocalMatchesCurrentSelection && vocal ? (
                    hasMultipleSpeakers ? (
                      <div className="mt-3 space-y-2.5">
                        <p className="text-xs leading-5 text-amber-900">
                          这段素材包含多位说话人。请分别试听下方音色，选中你要复刻的那一位并点击确认：
                        </p>
                        <div className="space-y-2">
                          {activeSpeakers.map((sp) => {
                            const isSelected = selectedSpeaker?.vocalId === sp.vocalId;
                            const isConfirmed = confirmedSpeaker?.vocalId === sp.vocalId;
                            return (
                              <div
                                key={sp.vocalId}
                                onClick={() => {
                                  if (!isBusy) {
                                    setSelectedSpeakerVocalId(sp.vocalId);
                                    if (confirmedSpeakerVocalId && confirmedSpeakerVocalId !== sp.vocalId) {
                                      setConfirmedSpeakerVocalId('');
                                    }
                                  }
                                }}
                                className={cn(
                                  'cursor-pointer rounded-xl border-2 bg-white p-3 transition',
                                  isSelected
                                    ? 'border-violet-500 shadow-sm'
                                    : 'border-slate-200 hover:border-violet-200'
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        'size-4 shrink-0 rounded-full border-2',
                                        isSelected
                                          ? 'border-violet-600 bg-violet-600 shadow-[inset_0_0_0_3px_white]'
                                          : 'border-slate-300'
                                      )}
                                    />
                                    <span className="text-xs font-black text-slate-900">{sp.label}</span>
                                    <span className="text-[11px] font-semibold text-slate-400">
                                      有效语音 {sp.durationSeconds.toFixed(1)} 秒
                                    </span>
                                  </div>
                                  {isConfirmed && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                                      <CheckCircle2 className="size-3" />
                                      已确认
                                    </span>
                                  )}
                                </div>
                                {sp.sampleText && (
                                  <p className="mt-1.5 line-clamp-1 text-[11px] text-slate-500">
                                    “{sp.sampleText}”
                                  </p>
                                )}
                                <audio
                                  controls
                                  src={sp.vocalUrl}
                                  onClick={(event) => event.stopPropagation()}
                                  className="mt-2 h-9 w-full"
                                />
                              </div>
                            );
                          })}
                        </div>

                        {selectedSpeaker && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleConfirmSpeaker(pendingGenerateAfterConfirm || Boolean(text.trim()))}
                              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 text-xs font-black text-white transition hover:bg-slate-700 disabled:opacity-50"
                            >
                              <CheckCircle2 className="size-4" />
                              {text.trim()
                                ? `确认使用「${selectedSpeaker.label}」并生成 MP3`
                                : `确认使用「${selectedSpeaker.label}」`}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                          <CheckCircle2 className="size-3.5" />
                          纯人声已就绪（单说话人 · 有效时长 {vocal.durationSeconds.toFixed(1)} 秒）
                        </div>
                        <audio controls src={vocal.vocalUrl} className="w-full" />
                      </div>
                    )
                  ) : (
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      你可以先点上方按钮提前分离 BGM 并检测是否包含多种音色；也可以直接在右侧填好文案后一键运行（若检测到多种音色会自动暂停请你试听选择）。
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* 窗口二：输入目标文案 & 输出 MP3 */}
          <section className="flex flex-col rounded-2xl border border-slate-200/90 border-t-2 border-t-fuchsia-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div>
                  <h2 className="border-l-2 border-fuchsia-400 pl-3 text-lg font-black text-slate-900">目标文案与音频</h2>
                  <p className="text-xs text-slate-500">使用确认后的音色朗读下方文案，生成 MP3 音频</p>
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
                className="min-h-[230px] w-full flex-1 resize-y rounded-2xl border border-violet-100 bg-slate-50/70 p-5 text-sm leading-7 text-slate-900 placeholder:text-slate-400 focus:border-violet-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-violet-100 disabled:opacity-60"
              />

              <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                <span>克隆引擎：阿里云声音克隆（qwen-audio-3.1-tts-flash）</span>
                <span className="font-mono">
                  {text.length} / {MAX_TEXT_LENGTH}
                </span>
              </div>

              {/* 多音色待确认提醒 */}
              {needsSpeakerConfirmation && stage === 'idle' && (
                <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-900">
                  左侧已识别出 {activeSpeakers.length} 种音色，请先试听并点击「确认使用」选定目标说话人，再继续克隆生成 MP3。
                </div>
              )}

              {/* 进度提示 */}
              {stage !== 'idle' && (
                <div className="relative mt-4 overflow-hidden rounded-2xl border border-violet-300/20 bg-gradient-to-r from-[#171b36] to-[#36244d] px-5 py-4 text-white shadow-lg shadow-violet-950/10" role="status" aria-live="polite">
                  <div className="copy-transfer-scan pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-violet-300/15 to-transparent" />
                  <div className="relative flex items-center gap-2 text-sm font-black text-violet-100">
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                    {stage === 'separating'
                      ? '第 1/2 步 · 分离背景音并检测音色'
                      : `第 2/2 步 · 阿里云克隆${confirmedSpeaker ? `「${confirmedSpeaker.label}」` : '音色'}并生成 MP3`}
                  </div>
                  <p className="relative mt-2 text-xs text-violet-200">
                    {stage === 'separating'
                      ? '正在等待分离服务处理；如检测到多种音色，会暂停供你试听。'
                      : '首次生成可能需要等待音色部署；再次生成会复用当前音色。'}
                    <span className="ml-2 font-mono tabular-nums">已用时 {Math.floor(Math.max(0, stageNow - stageStartedAt) / 60000)}分{String(Math.floor(Math.max(0, stageNow - stageStartedAt) / 1000) % 60).padStart(2, '0')}秒</span>
                  </p>
                  <div className="relative mt-4 grid grid-cols-2 gap-2 text-center text-[11px] font-bold"><span className={cn('rounded-lg px-2 py-2', stage === 'separating' ? 'bg-violet-400/25 text-white' : 'bg-emerald-400/20 text-emerald-200')}>{stage === 'synthesizing' ? '✓ ' : '● '}人声分离</span><span className={cn('rounded-lg px-2 py-2', stage === 'synthesizing' ? 'bg-violet-400/25 text-white' : 'bg-white/10 text-slate-400')}>{stage === 'synthesizing' ? '● ' : ''}音色克隆与导出</span></div>
                </div>
              )}

              <button
                type="button"
                disabled={isBusy || !source || !text.trim() || needsSpeakerConfirmation}
                onClick={() => void handleGenerateMp3()}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-700 to-fuchsia-600 px-5 text-sm font-black text-white shadow-lg shadow-violet-200/80 transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {stage !== 'idle' ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {stage === 'separating'
                  ? '正在分离 BGM 并检测音色…'
                  : stage === 'synthesizing'
                    ? '正在克隆音色并生成 MP3…'
                    : needsSpeakerConfirmation
                      ? '请先在左侧试听并确认音色'
                      : vocalMatchesCurrentSelection && confirmedSpeaker
                        ? `使用「${confirmedSpeaker.label}」生成 MP3`
                        : '一键分离人声并生成 MP3'}
              </button>

              {/* 生成结果区 */}
              {result && (
                <div className="mt-5 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="size-4 text-emerald-600" />
                      <span className="text-sm font-black text-slate-900">MP3 生成完成</span>
                      <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-700">
                        {result.speakerLabel}
                      </span>
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
