import { useEffect, useRef, useState } from 'react';
import {
  AudioLines,
  Check,
  CheckCircle2,
  Clock,
  Download,
  FileAudio,
  Film,
  Link2,
  LoaderCircle,
  Mic,
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

  const estimatedSpeechSeconds = text.trim() ? Math.max(1, Math.round(text.trim().length / 4.5)) : 0;
  const totalDurationSafe = Math.max(source?.durationSeconds || 1, 0.1);
  const selectionStartPct = Math.min(100, Math.max(0, (roundedStart / totalDurationSafe) * 100));
  const selectionEndPct = Math.min(100, Math.max(selectionStartPct, (roundedEnd / totalDurationSafe) * 100));
  const waveformBars = [26, 48, 34, 68, 84, 52, 38, 76, 92, 60, 42, 72, 88, 56, 32, 64, 96, 70, 44, 80, 62, 36, 54, 86, 74, 46, 66, 90, 58, 40, 78, 50, 34, 62, 44, 28];

  const voiceReady = Boolean(vocalMatchesCurrentSelection && !needsSpeakerConfirmation);
  const steps = [
    { key: 'source', num: '01', label: '导入原声', done: Boolean(source), active: !source },
    { key: 'vocal', num: '02', label: '提取定音', done: voiceReady, active: Boolean(source) && !voiceReady },
    { key: 'script', num: '03', label: '输入文案', done: Boolean(text.trim()), active: Boolean(source) && voiceReady && !text.trim() },
    { key: 'export', num: '04', label: '导出 MP3', done: Boolean(result), active: Boolean(source && text.trim() && !result) },
  ];

  const statusText = onlineLoading
    ? '正在载入素材'
    : uploadProgress !== null
      ? `上传中 ${uploadProgress}%`
      : stage === 'separating'
        ? '正在提取音色'
        : stage === 'synthesizing'
          ? '正在生成 MP3'
          : result
            ? 'MP3 已就绪'
            : source
              ? '素材已就绪'
              : '等待导入素材';

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#faf7f7] text-slate-900">
      {/* 柔和氛围光晕 + 细微点阵网格，与创意创作入口页视觉统一 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-28 top-12 size-[30rem] rounded-full bg-rose-200/35 blur-[110px]" />
        <div className="absolute -right-24 top-24 size-[28rem] rounded-full bg-amber-200/35 blur-[110px]" />
        <div className="absolute bottom-0 left-1/3 size-[26rem] rounded-full bg-orange-100/30 blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.28] [background-image:linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(to_bottom,black_10%,black_75%,transparent)]" />
      </div>

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

      <header className="sticky top-0 z-30 flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-rose-200/50 bg-white/80 px-4 py-2 shadow-[0_4px_24px_-16px_rgba(15,23,42,0.18)] backdrop-blur-xl md:px-6">
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
        <div className="hidden items-center gap-2 rounded-full border border-rose-200/70 bg-rose-50/70 px-3 py-1 text-xs font-bold text-rose-700 sm:inline-flex">
          <span className={cn('size-2 rounded-full', isBusy ? 'animate-pulse bg-rose-500' : result ? 'bg-emerald-500' : 'bg-amber-400')} />
          {statusText}
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 space-y-5 p-4 pb-16 md:p-6">
        {/* 顶部工作台 Hero 卡 */}
        <section className="relative overflow-hidden rounded-[28px] border border-white/90 bg-white/85 px-5 py-5 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.3)] backdrop-blur-xl sm:px-7">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-gradient-to-br from-rose-200/45 to-amber-200/45 blur-3xl" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex size-13 shrink-0 items-center justify-center rounded-[18px] bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-lg shadow-rose-200/80">
                <AudioLines className="size-6" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-black tracking-[-0.025em] text-slate-950 sm:text-2xl">音色转移</h1>
                  <span className="rounded-full border border-rose-200/80 bg-gradient-to-r from-rose-50 to-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-rose-700">
                    AI 声纹复刻
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">提取原声纯净音色，输入新文案即可一键生成高保真 MP3</p>
              </div>
            </div>

            {/* 4 步流程状态胶囊 */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {steps.map((step, idx) => (
                <div key={step.key} className="flex items-center gap-1.5 sm:gap-2">
                  <div
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all',
                      step.done
                        ? 'border-emerald-200 bg-emerald-50/90 text-emerald-700'
                        : step.active
                          ? 'border-rose-300 bg-gradient-to-r from-rose-50 to-amber-50 text-rose-700 shadow-sm shadow-rose-100'
                          : 'border-slate-200/80 bg-white/70 text-slate-400'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-4 items-center justify-center rounded-full text-[10px] font-black',
                        step.done
                          ? 'bg-emerald-500 text-white'
                          : step.active
                            ? 'bg-gradient-to-br from-rose-500 to-amber-500 text-white'
                            : 'bg-slate-200/80 text-slate-500'
                      )}
                    >
                      {step.done ? <Check className="size-2.5" strokeWidth={3} /> : step.num}
                    </span>
                    <span>{step.label}</span>
                  </div>
                  {idx < steps.length - 1 && <span className="hidden h-px w-3 bg-slate-200 sm:block" />}
                </div>
              ))}
            </div>
          </div>
        </section>

        {(error || notice) && (
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-2xl border px-4 py-3 text-sm font-bold shadow-sm backdrop-blur-md',
              error
                ? 'border-red-200 bg-red-50/95 text-red-700'
                : 'border-amber-200 bg-amber-50/95 text-amber-900'
            )}
          >
            <span className={cn('size-2 shrink-0 rounded-full', error ? 'bg-red-500' : 'bg-amber-500')} />
            <span>{error || notice}</span>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {/* 左栏：原声采集与定音舱 */}
          <section className="flex flex-col rounded-[28px] border border-white/90 bg-white/90 p-5 shadow-[0_22px_55px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-black tracking-wide text-rose-600">
                  <Mic className="size-3" />
                  STEP 01 · 原声采集
                </div>
                <h2 className="mt-2 text-lg font-black tracking-tight text-slate-950">选择原声素材</h2>
                <p className="mt-0.5 text-xs text-slate-500">支持短视频链接在线解析，或直接上传本地音视频</p>
              </div>
              {source && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleResetSource}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-xs transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                  更换素材
                </button>
              )}
            </div>

            {!source ? (
              <div className="flex flex-1 flex-col overflow-hidden rounded-[22px] border border-rose-100/90 bg-gradient-to-b from-white to-rose-50/20">
                {/* 分段胶囊切换 */}
                <div className="grid grid-cols-2 gap-1.5 border-b border-rose-100/80 bg-slate-100/70 p-1.5">
                  <button
                    type="button"
                    disabled={onlineLoading || uploadProgress !== null}
                    onClick={() => setSourceMode('link')}
                    className={cn(
                      'flex h-10 items-center justify-center gap-2 rounded-[14px] text-sm font-black transition-all',
                      sourceMode === 'link'
                        ? 'bg-white text-rose-600 shadow-sm ring-1 ring-rose-100'
                        : 'text-slate-500 hover:bg-white/60 hover:text-slate-800'
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
                      'flex h-10 items-center justify-center gap-2 rounded-[14px] text-sm font-black transition-all',
                      sourceMode === 'upload'
                        ? 'bg-white text-rose-600 shadow-sm ring-1 ring-rose-100'
                        : 'text-slate-500 hover:bg-white/60 hover:text-slate-800'
                    )}
                  >
                    <Upload className="size-4" />
                    本地上传
                  </button>
                </div>

                {sourceMode === 'link' ? (
                  <div className="flex flex-1 flex-col justify-between bg-[radial-gradient(circle_at_92%_8%,rgba(244,63,94,0.07),transparent_42%),radial-gradient(circle_at_10%_95%,rgba(245,158,11,0.07),transparent_42%)] p-5">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-black text-slate-800">粘贴视频链接或分享文案</span>
                        <div className="flex items-center gap-1">
                          {['抖音', '快手', '视频号'].map((platform) => (
                            <span
                              key={platform}
                              className="rounded-full border border-rose-100 bg-white/90 px-2 py-0.5 text-[10px] font-bold text-slate-500"
                            >
                              {platform}
                            </span>
                          ))}
                        </div>
                      </div>
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
                        placeholder="粘贴视频链接或完整分享文字，例如：https://v.douyin.com/…"
                        className="mt-3 min-h-32 w-full resize-y rounded-2xl border border-slate-200/90 bg-white/90 px-4 py-3.5 text-sm font-medium leading-6 text-slate-800 shadow-inner shadow-slate-100/60 outline-none transition placeholder:text-slate-400 focus:border-rose-400 focus:bg-white focus:ring-4 focus:ring-rose-100/80 disabled:opacity-60"
                      />
                      <button
                        type="button"
                        disabled={onlineLoading || !linkInput.trim()}
                        onClick={() => void parseAndLoadOnlineVideo()}
                        className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-rose-950 text-sm font-black text-white shadow-lg shadow-slate-900/15 transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        {onlineLoading ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4 text-amber-300" />}
                        {onlineLoading ? '正在解析并载入视频…' : '解析链接并载入'}
                      </button>

                      {onlineLoading && onlineProgress && (
                        <div
                          className="relative mt-4 overflow-hidden rounded-2xl border border-amber-200/80 bg-gradient-to-br from-rose-50/90 via-white to-amber-50/90 p-4 text-slate-700 shadow-sm"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <LoaderCircle className="size-4 shrink-0 animate-spin text-rose-500" />
                              <div className="truncate text-xs font-black text-slate-800">{onlineProgress.message}</div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="font-mono text-sm font-black text-rose-600">{Math.round(onlineProgress.percent)}%</div>
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
                                        ? 'border-rose-300 bg-rose-100/80 text-rose-800'
                                        : 'border-slate-200 bg-white/75 text-slate-400'
                                  )}
                                >
                                  {done ? '✓ ' : active ? '● ' : ''}
                                  {label}
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-rose-100/80">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500 transition-[width] duration-500"
                              style={{ width: `${onlineProgress.percent}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="mt-4 text-[11px] text-slate-400">快捷键：按 <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">⌘ / Ctrl + Enter</kbd> 立即开始解析</p>
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
                        'group relative flex min-h-[250px] flex-1 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[20px] border-2 border-dashed p-6 text-center transition-all',
                        draggingFile
                          ? 'border-rose-500 bg-rose-50/80 ring-4 ring-rose-100'
                          : 'border-rose-200/90 bg-gradient-to-br from-rose-50/40 via-white to-amber-50/40 hover:border-rose-400 hover:bg-rose-50/50'
                      )}
                    >
                      {uploadProgress !== null ? (
                        <div className="w-full max-w-xs space-y-3">
                          <LoaderCircle className="mx-auto size-9 animate-spin text-rose-500 motion-reduce:animate-none" />
                          <div className="text-sm font-black text-slate-800">正在上传并解析素材… {uploadProgress}%</div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-rose-100">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-amber-500 transition-all"
                              style={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex size-16 items-center justify-center rounded-[20px] bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-xl shadow-rose-200/80 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-105">
                            <Upload className="size-7" />
                          </div>
                          <div className="mt-4 text-base font-black text-slate-900">点击或拖拽上传本地音视频</div>
                          <p className="mt-1.5 max-w-xs text-xs leading-5 text-slate-500">
                            长素材默认自动截取前 15 秒人声，导入后可精细调节起止区间
                          </p>
                          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
                            {['MP4', 'MOV', 'MP3', 'WAV', 'M4A', '≤ 500MB'].map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full border border-rose-100 bg-white/90 px-2.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-2xs"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {/* 文件信息条 */}
                <div className="flex items-center gap-3 rounded-2xl border border-rose-100/90 bg-gradient-to-r from-rose-50/50 via-white to-amber-50/40 px-4 py-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-amber-500 text-white shadow-md shadow-rose-200/60">
                    {source.hasVideo ? <Film className="size-4" /> : <FileAudio className="size-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-black text-slate-900">{source.fileName}</span>
                      {source.sourceType === 'online' && (
                        <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
                          在线解析
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-700">{formatSeconds(source.durationSeconds)}</span>
                      <span>·</span>
                      <span>{formatFileSize(source.size)}</span>
                    </div>
                  </div>
                </div>

                {/* 原素材播放器 */}
                <div className="overflow-hidden rounded-[20px] border border-slate-200/80 bg-slate-950 shadow-md shadow-slate-900/10">
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
                    <div className="bg-gradient-to-r from-slate-900 to-slate-950 p-4">
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

                {/* 可视化人声截取区间控制 */}
                <div className="rounded-[22px] border border-slate-200/80 bg-gradient-to-b from-slate-50/90 to-white p-4 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-black text-slate-900">
                      <span className="flex size-6 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                        <Scissors className="size-3.5" />
                      </span>
                      截取人声片段
                      <span className="font-normal text-slate-400">（建议 10～15 秒）</span>
                    </div>
                    <button
                      type="button"
                      onClick={toggleRangePreview}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold shadow-xs transition',
                        previewingRange
                          ? 'bg-rose-600 text-white shadow-rose-200'
                          : 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                      )}
                    >
                      {previewingRange ? <Square className="size-3 fill-current" /> : <Play className="size-3 fill-current" />}
                      {previewingRange ? '停止试听' : '试听选区'}
                    </button>
                  </div>

                  {/* 可视化声波选区条 */}
                  <div className="relative mt-3.5 overflow-hidden rounded-xl border border-slate-200/70 bg-white px-3 py-3">
                    <div className="relative flex h-10 items-center justify-between gap-[3px]">
                      {waveformBars.map((height, idx) => {
                        const barPct = (idx / (waveformBars.length - 1)) * 100;
                        const inRange = barPct >= selectionStartPct && barPct <= selectionEndPct;
                        return (
                          <span
                            key={idx}
                            className={cn(
                              'w-1 flex-1 rounded-full transition-colors duration-200',
                              inRange
                                ? 'bg-gradient-to-t from-rose-500 to-amber-400'
                                : 'bg-slate-200/80'
                            )}
                            style={{ height: `${height}%` }}
                          />
                        );
                      })}
                      {/* 选区高亮框 */}
                      <div
                        className="pointer-events-none absolute inset-y-0 rounded-md border-x-2 border-rose-500 bg-rose-500/[0.06] transition-all duration-150"
                        style={{
                          left: `${selectionStartPct}%`,
                          width: `${Math.max(1.5, selectionEndPct - selectionStartPct)}%`,
                        }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-between font-mono text-[10px] font-semibold text-slate-400">
                      <span>00:00.0</span>
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600">
                        已选 {formatSeconds(roundedStart)} – {formatSeconds(roundedEnd)}（{selectedDuration.toFixed(1)}s）
                      </span>
                      <span>{formatSeconds(source.durationSeconds)}</span>
                    </div>
                  </div>

                  <div className="mt-3.5 grid grid-cols-2 gap-4">
                    <label className="block">
                      <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>开始时间</span>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">{formatSeconds(roundedStart)}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, Math.round((source.durationSeconds - MIN_SLICE_SECONDS) * 10) / 10)}
                        step={0.1}
                        value={roundedStart}
                        disabled={isBusy || source.durationSeconds <= MIN_SLICE_SECONDS}
                        onChange={(event) => handleStartChange(Number(event.target.value))}
                        className="studio-range w-full"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold text-slate-600">
                        <span>结束时间</span>
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-slate-900">{formatSeconds(roundedEnd)}</span>
                      </div>
                      <input
                        type="range"
                        min={MIN_SLICE_SECONDS}
                        max={Math.max(MIN_SLICE_SECONDS, Math.round(source.durationSeconds * 10) / 10)}
                        step={0.1}
                        value={roundedEnd}
                        disabled={isBusy || source.durationSeconds <= MIN_SLICE_SECONDS}
                        onChange={(event) => handleEndChange(Number(event.target.value))}
                        className="studio-range w-full"
                      />
                    </label>
                  </div>

                  <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                    <span>单次 1～30 秒 · 清晰无杂音效果更佳</span>
                    <div className="inline-flex items-center rounded-xl bg-slate-100/90 p-0.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setScene('Narrate')}
                        className={cn(
                          'rounded-lg px-2.5 py-1 text-[11px] font-bold transition',
                          scene === 'Narrate'
                            ? 'bg-white text-rose-600 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
                        )}
                      >
                        口播（去音乐+音效）
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setScene('Audio')}
                        className={cn(
                          'rounded-lg px-2.5 py-1 text-[11px] font-bold transition',
                          scene === 'Audio'
                            ? 'bg-white text-rose-600 shadow-xs'
                            : 'text-slate-500 hover:text-slate-800'
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
                    'rounded-[22px] border p-4 transition-all',
                    needsSpeakerConfirmation
                      ? 'border-amber-300 bg-gradient-to-br from-amber-50/90 to-orange-50/50 ring-4 ring-amber-100/70'
                      : 'border-rose-100/90 bg-gradient-to-br from-rose-50/35 via-white to-amber-50/25'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-black text-slate-800">
                      <span
                        className={cn(
                          'flex size-7 items-center justify-center rounded-xl',
                          hasMultipleSpeakers ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                        )}
                      >
                        {hasMultipleSpeakers ? <Users className="size-4" /> : <Volume2 className="size-4" />}
                      </span>
                      {hasMultipleSpeakers
                        ? `检测到 ${activeSpeakers.length} 种音色 · 请试听并选择`
                        : '分离后的纯净人声'}
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleSeparateOnly()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-600 shadow-2xs transition hover:bg-rose-50 disabled:opacity-50"
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
                      <div className="mt-3.5 space-y-3">
                        <p className="text-xs leading-5 text-amber-900">
                          检测到多位说话人。请试听下方音色档案，选中你要复刻的一位并确认：
                        </p>
                        <div className="space-y-2.5">
                          {activeSpeakers.map((sp, spIndex) => {
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
                                  'cursor-pointer rounded-2xl border-2 bg-white p-3.5 transition-all',
                                  isSelected
                                    ? 'border-rose-400 shadow-md shadow-rose-100/80 ring-2 ring-rose-100'
                                    : 'border-slate-200/80 hover:border-rose-200'
                                )}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2.5">
                                    <span
                                      className={cn(
                                        'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-black text-white',
                                        spIndex % 2 === 0
                                          ? 'bg-gradient-to-br from-rose-500 to-amber-500'
                                          : 'bg-gradient-to-br from-amber-500 to-orange-500'
                                      )}
                                    >
                                      {spIndex + 1}
                                    </span>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-black text-slate-900">{sp.label}</span>
                                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                                          {sp.durationSeconds.toFixed(1)}s
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                  {isConfirmed ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">
                                      <CheckCircle2 className="size-3" />
                                      已确认
                                    </span>
                                  ) : isSelected ? (
                                    <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-black text-rose-700">
                                      当前选中
                                    </span>
                                  ) : null}
                                </div>
                                {sp.sampleText && (
                                  <p className="mt-2 line-clamp-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] italic text-slate-500">
                                    “{sp.sampleText}”
                                  </p>
                                )}
                                <audio
                                  controls
                                  src={sp.vocalUrl}
                                  onClick={(event) => event.stopPropagation()}
                                  className="mt-2.5 h-9 w-full"
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
                              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-slate-900 to-rose-950 px-4 text-xs font-black text-white shadow-md shadow-slate-900/15 transition hover:brightness-110 disabled:opacity-50"
                            >
                              <CheckCircle2 className="size-4 text-emerald-400" />
                              {text.trim()
                                ? `确认使用「${selectedSpeaker.label}」并生成 MP3`
                                : `确认使用「${selectedSpeaker.label}」`}
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-3 space-y-2.5 rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-3">
                        <div className="flex items-center justify-between gap-2 text-xs font-bold text-emerald-700">
                          <span className="inline-flex items-center gap-1.5">
                            <CheckCircle2 className="size-3.5" />
                            纯人声已就绪（单说话人）
                          </span>
                          <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-emerald-700">
                            有效 {vocal.durationSeconds.toFixed(1)} 秒
                          </span>
                        </div>
                        <audio controls src={vocal.vocalUrl} className="h-9 w-full" />
                      </div>
                    )
                  ) : (
                    <p className="mt-2.5 text-xs leading-5 text-slate-500">
                      可先点上方按钮提前分离背景音并识别说话人；也可以直接在右侧填好文案后一键生成（多音色时会自动暂停供你试听）。
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* 右栏：剧本配音与成品舱 */}
          <section className="flex flex-col rounded-[28px] border border-white/90 bg-white/90 p-5 shadow-[0_22px_55px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-black tracking-wide text-amber-700">
                  <Sparkles className="size-3" />
                  STEP 02 · 剧本配音
                </div>
                <h2 className="mt-2 text-lg font-black tracking-tight text-slate-950">目标文案与音频</h2>
                <p className="mt-0.5 text-xs text-slate-500">使用确认后的原音色朗读下方文案，生成高保真 MP3</p>
              </div>
              <div className="flex items-center gap-2">
                {estimatedSpeechSeconds > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50/80 px-2.5 py-1 font-mono text-[11px] font-bold text-amber-800">
                    <Clock className="size-3" />
                    约 {estimatedSpeechSeconds}s
                  </span>
                )}
                {text.trim() && (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setText('')}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                  >
                    清空
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-1 flex-col">
              {/* 提词器质感文案区 */}
              <div className="overflow-hidden rounded-[22px] border border-slate-200/90 bg-slate-50/60 transition focus-within:border-rose-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-rose-100/70">
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value.slice(0, MAX_TEXT_LENGTH))}
                  disabled={isBusy}
                  rows={8}
                  placeholder="在这里输入你想让这个音色朗读的新文案…&#10;&#10;小贴士：善用逗号、句号、感叹号可以自然控制停顿与情绪节奏；生成后微调文案再次生成，会自动复用当前已部署的音色，几秒内极速出新 MP3。"
                  className="min-h-[240px] w-full resize-y bg-transparent p-5 text-[15px] leading-7 text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 bg-white/80 px-4 py-2.5 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <span className="size-1.5 rounded-full bg-gradient-to-r from-rose-500 to-amber-500" />
                    阿里云声音克隆 · qwen-audio-3.1-tts-flash
                  </span>
                  <div className="flex items-center gap-2.5">
                    <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 sm:block">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-rose-400 to-amber-400 transition-all"
                        style={{ width: `${Math.min(100, (text.length / MAX_TEXT_LENGTH) * 100)}%` }}
                      />
                    </div>
                    <span className="font-mono font-bold text-slate-600">
                      {text.length} / {MAX_TEXT_LENGTH}
                    </span>
                  </div>
                </div>
              </div>

              {/* 多音色待确认提醒 */}
              {needsSpeakerConfirmation && stage === 'idle' && (
                <div className="mt-4 flex items-center gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-900">
                  <Users className="size-4 shrink-0 text-amber-600" />
                  左侧已识别出 {activeSpeakers.length} 种音色，请先试听并点击「确认使用」选定目标说话人，再继续克隆生成 MP3。
                </div>
              )}

              {/* 处理中流光进度卡 */}
              {stage !== 'idle' && (
                <div
                  className="relative mt-4 overflow-hidden rounded-[22px] border border-rose-300/20 bg-gradient-to-r from-[#251321] via-[#391829] to-[#4a221c] px-5 py-4 text-white shadow-xl shadow-rose-950/15"
                  role="status"
                  aria-live="polite"
                >
                  <div className="copy-transfer-scan pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-amber-300/15 to-transparent" />
                  <div className="relative flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-black text-rose-100">
                      <LoaderCircle className="size-4 animate-spin text-amber-300 motion-reduce:animate-none" />
                      {stage === 'separating'
                        ? '第 1/2 步 · 分离背景音并检测音色'
                        : `第 2/2 步 · 克隆${confirmedSpeaker ? `「${confirmedSpeaker.label}」` : '音色'}并生成 MP3`}
                    </div>
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-amber-200">
                      {Math.floor(Math.max(0, stageNow - stageStartedAt) / 60000)}分{String(Math.floor(Math.max(0, stageNow - stageStartedAt) / 1000) % 60).padStart(2, '0')}秒
                    </span>
                  </div>
                  <p className="relative mt-2 text-xs text-rose-200/85">
                    {stage === 'separating'
                      ? '正在等待分离服务处理；如检测到多种音色，会暂停供你试听。'
                      : '首次生成可能需要等待音色部署；再次生成会复用当前音色。'}
                  </p>
                  <div className="relative mt-4 grid grid-cols-2 gap-2 text-center text-[11px] font-bold">
                    <span
                      className={cn(
                        'rounded-xl px-2 py-2 transition',
                        stage === 'separating' ? 'bg-rose-400/25 text-white ring-1 ring-rose-300/30' : 'bg-emerald-400/20 text-emerald-200'
                      )}
                    >
                      {stage === 'synthesizing' ? '✓ ' : '● '}人声分离与识别
                    </span>
                    <span
                      className={cn(
                        'rounded-xl px-2 py-2 transition',
                        stage === 'synthesizing' ? 'bg-amber-400/25 text-white ring-1 ring-amber-300/30' : 'bg-white/10 text-slate-400'
                      )}
                    >
                      {stage === 'synthesizing' ? '● ' : ''}音色克隆与导出
                    </span>
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={isBusy || !source || !text.trim() || needsSpeakerConfirmation}
                onClick={() => void handleGenerateMp3()}
                className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 via-rose-500 to-amber-500 px-5 text-sm font-black text-white shadow-[0_14px_30px_-10px_rgba(244,63,94,0.5)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
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

              {/* 成品音轨卡 */}
              {result && (
                <div className="relative mt-5 overflow-hidden rounded-[22px] border border-emerald-200/90 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/40 p-5 shadow-md shadow-emerald-900/5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex size-7 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-200">
                        <CheckCircle2 className="size-4" />
                      </span>
                      <span className="text-sm font-black text-slate-900">MP3 生成完成</span>
                      <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-black text-rose-700">
                        {result.speakerLabel}
                      </span>
                      {result.reusedVoice && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">
                          已复用当前音色
                        </span>
                      )}
                    </div>
                    <span className="rounded-full border border-emerald-200/80 bg-white px-2.5 py-0.5 font-mono text-[11px] font-bold text-slate-600">
                      {result.durationSeconds > 0 ? `${result.durationSeconds.toFixed(1)}s · ` : ''}
                      {formatFileSize(result.size)}
                    </span>
                  </div>

                  <div className="mt-3.5 rounded-xl border border-emerald-100 bg-white/90 p-2.5">
                    <audio controls src={result.audioUrl} className="h-9 w-full" />
                  </div>

                  <div className="mt-3.5 flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-medium text-slate-500">{result.fileName}</span>
                    <a
                      href={result.audioUrl}
                      download={result.fileName}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white shadow-sm transition hover:bg-slate-700"
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
