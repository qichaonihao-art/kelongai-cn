import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronUp,
  Upload,
  Mic2,
  Play,
  Download,
  History,
  Settings2,
  CheckCircle2,
  Loader2,
  X,
  ArrowLeft,
  Wand2,
  Pause,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import SiteFooter from "@/src/components/SiteFooter";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";
import {
  type ClonedVoice,
  type GeneratedAudio,
  type VoiceConfigStatus,
  type VoicePlatform,
  createVoiceClone,
  generateSpeech,
  getVoiceConfigStatus,
} from "@/src/lib/voice";
import {
  loadActiveVoiceId,
  loadSavedVoices,
  saveActiveVoiceId,
  saveSavedVoices,
} from "@/src/lib/voiceStorage";
import { motion, AnimatePresence } from "motion/react";

interface VoiceCloningPageProps {
  onBack: () => void;
}

type VoicePlatformLabel = '智谱' | '阿里云' | '火山引擎' | 'SiliconFlow 声音克隆';

const MAX_AUDIO_SIZE = 10 * 1024 * 1024;

const EMPTY_CONFIG_STATUS: VoiceConfigStatus = {
  reachable: false,
  zhipuApiKey: false,
  aliyunApiKey: false,
  siliconFlowApiKey: false,
  volcAppKey: false,
  volcAccessKey: false,
  volcSpeakerId: false,
  mockMode: false,
};

function getPlatformLabel(provider: VoicePlatform): VoicePlatformLabel {
  if (provider === 'zhipu') {
    return '智谱';
  }

  if (provider === 'aliyun') {
    return '阿里云';
  }

  if (provider === 'siliconflow') {
    return 'SiliconFlow 声音克隆';
  }

  return '火山引擎';
}

function getProviderFromPlatformLabel(platform: VoicePlatformLabel): VoicePlatform {
  if (platform === '智谱') {
    return 'zhipu';
  }

  if (platform === '阿里云') {
    return 'aliyun';
  }

  if (platform === 'SiliconFlow 声音克隆') {
    return 'siliconflow';
  }

  return 'volcengine';
}

function buildCredentialsForPlatform(
  platform: VoicePlatform,
  values: {
    zhipuApiKey: string;
    aliyunApiKey: string;
  },
) {
  if (platform === 'zhipu') {
    return { apiKey: values.zhipuApiKey.trim() };
  }

  if (platform === 'aliyun') {
    return { apiKey: values.aliyunApiKey.trim() };
  }

  return {};
}

export default function VoiceCloningPage({ onBack }: VoiceCloningPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAudioIdRef = useRef<string | null>(null);
  const progressAnimationFrameRef = useRef<number | null>(null);
  const generatedAudiosRef = useRef<GeneratedAudio[]>([]);
  const [isApiConfigOpen, setIsApiConfigOpen] = useState(false);
  const [isMyVoicesOpen, setIsMyVoicesOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<VoicePlatformLabel>('阿里云');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [cloneStatus, setCloneStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [generateStatus, setGenerateStatus] = useState<'idle' | 'generating'>('idle');
  const [generatedAudios, setGeneratedAudios] = useState<GeneratedAudio[]>([]);
  const [inputText, setInputText] = useState("");
  const [voiceName, setVoiceName] = useState("");
  const [siliconFlowVoiceUri, setSiliconFlowVoiceUri] = useState("");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedAudioUrl, setUploadedAudioUrl] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [cloneError, setCloneError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [configError, setConfigError] = useState("");
  const [configStatus, setConfigStatus] = useState<VoiceConfigStatus>(EMPTY_CONFIG_STATUS);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [zhipuApiKey, setZhipuApiKey] = useState("");
  const [aliyunApiKey, setAliyunApiKey] = useState("");
  const [voices, setVoices] = useState<ClonedVoice[]>(loadSavedVoices);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(loadActiveVoiceId);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState<Record<string, number>>({});

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.id === activeVoiceId) || null,
    [activeVoiceId, voices],
  );
  const voicesByProvider = useMemo(
    () => ({
      aliyun: voices.filter((voice) => voice.provider === 'aliyun'),
      siliconflow: voices.filter((voice) => voice.provider === 'siliconflow'),
      volcengine: voices.filter((voice) => voice.provider === 'volcengine'),
      zhipu: voices.filter((voice) => voice.provider === 'zhipu'),
    }),
    [voices],
  );
  const isSiliconFlowSelected = selectedPlatform === 'SiliconFlow 声音克隆';
  const selectedPlatformProvider = getProviderFromPlatformLabel(selectedPlatform);
  const selectedSiliconFlowVoice = selectedVoice?.provider === 'siliconflow' ? selectedVoice : null;
  const currentSiliconFlowVoice =
    selectedSiliconFlowVoice ||
    voices.find((voice) => voice.provider === 'siliconflow' && voice.remoteVoiceId === siliconFlowVoiceUri) ||
    null;
  const hasSiliconFlowVoiceUri = !!siliconFlowVoiceUri.trim();
  const activeReadyVoice = selectedVoice || (isSiliconFlowSelected ? currentSiliconFlowVoice : null);
  const isUsingSiliconFlowVoice = activeReadyVoice?.provider === 'siliconflow';
  const isUsingVolcVoice = activeReadyVoice?.provider === 'volcengine';
  const isVoiceReady = !!activeReadyVoice && (!isUsingSiliconFlowVoice || hasSiliconFlowVoiceUri);
  const activeVoiceOverridesPlatform =
    !!selectedVoice && getPlatformLabel(selectedVoice.provider) !== selectedPlatform;
  const activeVolcAliasCount = useMemo(() => {
    if (!activeReadyVoice || activeReadyVoice.provider !== 'volcengine') {
      return 0;
    }

    return voices.filter(
      (voice) => voice.provider === 'volcengine' && voice.remoteVoiceId === activeReadyVoice.remoteVoiceId,
    ).length;
  }, [activeReadyVoice, voices]);

  useEffect(() => {
    saveSavedVoices(voices);
  }, [voices]);

  useEffect(() => {
    saveActiveVoiceId(activeVoiceId);
  }, [activeVoiceId]);

  useEffect(() => {
    if (voices.length === 0 || activeVoiceId === null) {
      return;
    }

    if (voices.some((voice) => voice.id === activeVoiceId)) {
      return;
    }

    setActiveVoiceId(null);
  }, [activeVoiceId, voices]);

  useEffect(() => {
    if (!selectedVoice) {
      setCloneStatus('idle');
      return;
    }

    if (selectedVoice.provider === 'siliconflow') {
      setSiliconFlowVoiceUri(selectedVoice.remoteVoiceId);
    } else {
      setSiliconFlowVoiceUri("");
    }

    setVoiceName(selectedVoice.name);
    setSelectedPlatform(getPlatformLabel(selectedVoice.provider));
    setCloneError("");
    setGenerateError("");
  }, [selectedVoice]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      setIsConfigLoading(true);
      setConfigError("");
      const status = await getVoiceConfigStatus();

      if (cancelled) return;

      setConfigStatus(status);
      setIsConfigLoading(false);

      if (!status.reachable) {
        setConfigError("无法读取服务端语音配置，请确认后端已启动且当前登录状态有效。");
      }
    }

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    generatedAudiosRef.current = generatedAudios;
  }, [generatedAudios]);

  useEffect(() => {
    if (!isApiConfigOpen) return;
    setIsApiConfigOpen(false);
  }, [selectedPlatform]);

  useEffect(() => {
    return () => {
      if (progressAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(progressAnimationFrameRef.current);
      }

      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }

      if (uploadedAudioUrl) {
        URL.revokeObjectURL(uploadedAudioUrl);
      }

      for (const audio of generatedAudiosRef.current) {
        URL.revokeObjectURL(audio.audioUrl);
      }
    };
  }, [uploadedAudioUrl]);

  const hasVolcServerSupport =
    configStatus.volcAppKey && configStatus.volcAccessKey;

  const platformHint = useMemo(() => {
    if (selectedPlatform === 'SiliconFlow 声音克隆') {
      if (configStatus.mockMode) {
        return "当前为本地 mock 模式，SiliconFlow 链路会返回演示 voice uri 和演示语音。";
      }
      if (configStatus.siliconFlowApiKey) {
        return "当前为真实模式，服务端已托管 SILICONFLOW_API_KEY。SiliconFlow 会先生成可用音色，再用于语音合成；参考音频原文由服务端自动识别。";
      }
      return "当前为真实模式。请在 legacy-project/.env 中配置 SILICONFLOW_API_KEY。SiliconFlow 声音克隆会直接复用这一个服务端密钥，参考音频原文由服务端自动识别。";
    }

    if (selectedPlatform === '智谱') {
      if (configStatus.mockMode) {
        return "当前为本地 mock 模式，智谱链路会返回演示音色和演示语音。";
      }
      if (configStatus.zhipuApiKey) {
        return "当前为真实模式，服务端已托管智谱 API Key。留空即可直接调用真实音色创建和真实语音生成，也可以在这里临时覆盖。";
      }
      return "当前为真实模式。请填写智谱 API Key，或在 legacy-project/.env 中配置 ZHIPU_API_KEY。";
    }

    if (selectedPlatform === '阿里云') {
      if (configStatus.mockMode) {
        return "当前为本地 mock 模式，阿里云链路会返回演示音色和演示语音。";
      }
      if (configStatus.aliyunApiKey) {
        return "当前为真实模式，服务端已托管阿里云 API Key。留空即可直接调用真实音色创建和真实语音生成，也可以在这里临时覆盖。";
      }
      return "当前为真实模式。请填写阿里云 API Key，或在 legacy-project/.env 中配置 ALIYUN_API_KEY。";
    }

    if (configStatus.mockMode) {
      return "当前为本地 mock 模式，火山链路会返回演示音色和演示语音。";
    }
    if (hasVolcServerSupport) {
      return "服务端已托管火山引擎密钥。新建火山音色时会自动生成独立的 speaker_id，并和历史音色一起保存；后续生成会继续使用该历史音色自己的 speaker_id。";
    }
    return "火山引擎最小版本依赖服务端配置 VOLCENGINE_APP_KEY、VOLCENGINE_ACCESS_KEY。新建火山音色时系统会自动生成唯一 speaker_id，无需手动填写。";
  }, [configStatus, hasVolcServerSupport, selectedPlatform]);

  const configInputLabel =
    selectedPlatform === '智谱'
      ? '智谱 API Key（可选）'
      : selectedPlatform === '阿里云'
        ? '阿里云 API Key（可选）'
        : selectedPlatform === 'SiliconFlow 声音克隆'
          ? 'SiliconFlow API Key（服务端托管）'
        : 'Speaker ID（自动生成）';

  const configInputPlaceholder =
    selectedPlatform === '智谱'
      ? (configStatus.zhipuApiKey
          ? '服务端已托管，可留空'
          : '请输入您的智谱 API Key')
      : selectedPlatform === '阿里云'
      ? (configStatus.aliyunApiKey
          ? '服务端已托管，可留空'
          : '请输入您的阿里云 API Key')
      : selectedPlatform === 'SiliconFlow 声音克隆'
        ? (configStatus.siliconFlowApiKey
            ? '服务端已托管，无需前端填写'
            : '请先在服务端配置 SILICONFLOW_API_KEY')
      : '创建火山音色时自动生成，无需填写';

  const configInputValue =
    selectedPlatform === '智谱'
      ? zhipuApiKey
      : selectedPlatform === '阿里云'
        ? aliyunApiKey
        : '';

  function resetUploadState() {
    if (uploadedAudioUrl) {
      URL.revokeObjectURL(uploadedAudioUrl);
    }
    setUploadedFile(null);
    setUploadedAudioUrl("");
    setUploadStatus('idle');
    setVoiceName("");
    setUploadError("");
    setCloneError("");
    setCloneStatus('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleFileSelect(file: File | null) {
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isValidFormat = ['.mp3', '.wav', '.m4a'].some((extension) => lowerName.endsWith(extension));

    if (!isValidFormat) {
      setUploadError("仅支持 MP3、WAV 或 M4A 音频文件。");
      setUploadStatus('idle');
      setUploadedFile(null);
      return;
    }

    if (file.size > MAX_AUDIO_SIZE) {
      setUploadError("音频文件不能超过 10MB，请压缩后再试。");
      setUploadStatus('idle');
      setUploadedFile(null);
      return;
    }

    setUploadError("");
    setCloneError("");
    setCloneStatus('idle');
    if (uploadedAudioUrl) {
      URL.revokeObjectURL(uploadedAudioUrl);
    }
    setUploadStatus('uploading');
    setTimeout(() => {
      setUploadedFile(file);
      setUploadedAudioUrl(URL.createObjectURL(file));
      setVoiceName(file.name.replace(/\.[^.]+$/, ""));
      setUploadStatus('done');
    }, 500);
  }

  async function handleCloneVoice() {
    if (!uploadedFile) {
      setCloneError("请先上传音频样本。");
      return;
    }

    if (!voiceName.trim()) {
      setCloneError("请先填写音色名称。");
      return;
    }

    setCloneStatus('processing');
    setCloneError("");
    setGenerateError("");

    try {
      const voice = await createVoiceClone({
        platform: selectedPlatformProvider,
        file: uploadedFile,
        preferredName: voiceName.trim(),
        credentials: buildCredentialsForPlatform(selectedPlatformProvider, { zhipuApiKey, aliyunApiKey }),
        mockMode: configStatus.mockMode,
      });

      if (voice.provider === 'siliconflow') {
        setSiliconFlowVoiceUri(voice.remoteVoiceId);
      }
      setVoices((previous) => [voice, ...previous]);
      setActiveVoiceId(voice.id);
      setCloneStatus('done');
    } catch (error) {
      setCloneStatus('idle');
      setCloneError(error instanceof Error ? error.message : "音色创建失败，请稍后重试。");
    }
  }

  async function handleGenerateAudio() {
    const voiceForGeneration = activeReadyVoice;

    if (!voiceForGeneration) {
      setGenerateError("请先创建并选择一个可用音色。");
      return;
    }

    if (voiceForGeneration.provider === 'siliconflow' && !hasSiliconFlowVoiceUri) {
      setGenerateError("请先上传参考音频，拿到可用的 voice uri。");
      return;
    }

    if (!inputText.trim()) {
      setGenerateError("请输入要合成的文本内容。");
      return;
    }

    setGenerateStatus('generating');
    setGenerateError("");

    try {
      const audio = await generateSpeech({
        voice: voiceForGeneration,
        text: inputText.trim(),
        credentials: buildCredentialsForPlatform(voiceForGeneration.provider, {
          zhipuApiKey,
          aliyunApiKey,
        }),
        mockMode: configStatus.mockMode,
      });

      setGeneratedAudios((previous) => [audio, ...previous]);
      setGenerateStatus('idle');
    } catch (error) {
      setGenerateStatus('idle');
      setGenerateError(error instanceof Error ? error.message : "语音生成失败，请稍后重试。");
    }
  }

  function syncPlaybackProgress(audioId: string, player: HTMLAudioElement) {
    const nextProgress =
      Number.isFinite(player.duration) && player.duration > 0
        ? Math.min(100, (player.currentTime / player.duration) * 100)
        : 0;

    setPlaybackProgress((previous) => {
      if (previous[audioId] === nextProgress) {
        return previous;
      }

      return { ...previous, [audioId]: nextProgress };
    });
  }

  function stopProgressLoop() {
    if (progressAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(progressAnimationFrameRef.current);
      progressAnimationFrameRef.current = null;
    }
  }

  function startProgressLoop(audioId: string, player: HTMLAudioElement) {
    stopProgressLoop();

    const step = () => {
      if (activeAudioRef.current !== player || activeAudioIdRef.current !== audioId || player.paused) {
        progressAnimationFrameRef.current = null;
        return;
      }

      syncPlaybackProgress(audioId, player);
      progressAnimationFrameRef.current = window.requestAnimationFrame(step);
    };

    syncPlaybackProgress(audioId, player);
    progressAnimationFrameRef.current = window.requestAnimationFrame(step);
  }

  function attachAudioPlayerEvents(player: HTMLAudioElement, audioId: string) {
    player.onplay = () => {
      setPlayingAudioId(audioId);
      startProgressLoop(audioId, player);
    };

    player.onloadedmetadata = () => {
      syncPlaybackProgress(audioId, player);
    };

    player.onpause = () => {
      stopProgressLoop();
      syncPlaybackProgress(audioId, player);
      setPlayingAudioId((current) => (current === audioId ? null : current));
    };

    player.onended = () => {
      stopProgressLoop();
      setPlaybackProgress((previous) => ({ ...previous, [audioId]: 0 }));
      setPlayingAudioId(null);
      activeAudioRef.current = null;
      activeAudioIdRef.current = null;
    };

    player.onerror = () => {
      stopProgressLoop();
      setPlaybackProgress((previous) => ({ ...previous, [audioId]: 0 }));
      setPlayingAudioId(null);
      activeAudioRef.current = null;
      activeAudioIdRef.current = null;
    };
  }

  function getOrCreateAudioPlayer(audio: GeneratedAudio) {
    const currentPlayer =
      activeAudioRef.current && activeAudioIdRef.current === audio.id
        ? activeAudioRef.current
        : null;

    if (currentPlayer) {
      return currentPlayer;
    }

    const player = new Audio(audio.audioUrl);
    attachAudioPlayerEvents(player, audio.id);
    activeAudioRef.current = player;
    activeAudioIdRef.current = audio.id;
    return player;
  }

  async function handlePlayAudio(audio: GeneratedAudio) {
    if (playingAudioId === audio.id && activeAudioRef.current) {
      activeAudioRef.current.pause();
      setPlayingAudioId(null);
      return;
    }

    if (activeAudioRef.current && activeAudioIdRef.current !== audio.id) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
      activeAudioIdRef.current = null;
    }

    const player = getOrCreateAudioPlayer(audio);

    try {
      await player.play();
    } catch {
      setPlayingAudioId(null);
      activeAudioRef.current = null;
      activeAudioIdRef.current = null;
      setGenerateError("音频播放失败，请重新生成或下载后播放。");
    }
  }

  async function handleSeekAudio(audio: GeneratedAudio, event: MouseEvent<HTMLButtonElement>) {
    const bar = event.currentTarget;
    const rect = bar.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const clampedRatio = Math.min(1, Math.max(0, ratio));
    const previousPlayer =
      activeAudioRef.current && activeAudioIdRef.current !== audio.id
        ? activeAudioRef.current
        : null;

    if (previousPlayer) {
      previousPlayer.pause();
      activeAudioRef.current = null;
      activeAudioIdRef.current = null;
    }

    const player = getOrCreateAudioPlayer(audio);

    if (Number.isFinite(player.duration) && player.duration > 0) {
      player.currentTime = player.duration * clampedRatio;
      syncPlaybackProgress(audio.id, player);
    } else {
      const previousOnLoadedMetadata = player.onloadedmetadata;
      player.onloadedmetadata = () => {
        previousOnLoadedMetadata?.call(player, new Event('loadedmetadata'));
        const nextTime =
          Number.isFinite(player.duration) && player.duration > 0
            ? player.duration * clampedRatio
            : 0;

        player.currentTime = nextTime;
        syncPlaybackProgress(audio.id, player);
        player.onloadedmetadata = previousOnLoadedMetadata;
      };
    }

    try {
      await player.play();
    } catch {
      setPlayingAudioId(null);
      activeAudioRef.current = null;
      activeAudioIdRef.current = null;
      setGenerateError("音频跳转失败，请重新播放后再试。");
    }
  }

  function handleDownloadAudio(audio: GeneratedAudio) {
    const link = document.createElement('a');
    link.href = audio.audioUrl;
    link.download = `${audio.voiceName || 'voice'}-${audio.id}.wav`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handleDeleteAudio(audioId: string) {
    setGeneratedAudios((previous) => {
      const target = previous.find((item) => item.id === audioId);
      if (target) {
        URL.revokeObjectURL(target.audioUrl);
      }
      return previous.filter((item) => item.id !== audioId);
    });

    setPlaybackProgress((previous) => {
      if (!(audioId in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[audioId];
      return next;
    });

    if (playingAudioId === audioId && activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
      activeAudioIdRef.current = null;
      setPlayingAudioId(null);
    }
  }

  function handleDeleteVoice(voiceId: string) {
    setVoices((previous) => {
      const nextVoices = previous.filter((voice) => voice.id !== voiceId);
      if (activeVoiceId === voiceId) {
        setActiveVoiceId(null);
      }
      return nextVoices;
    });
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.wav,.m4a,audio/mp3,audio/wav,audio/x-wav,audio/m4a,audio/mp4"
        className="hidden"
        onChange={(event) => handleFileSelect(event.target.files?.[0] || null)}
      />

      <header className="h-20 border-b border-slate-200 bg-white/40 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-30">
        <div
          className="glass-card flex items-center gap-3 p-1.5 pr-6 rounded-2xl border-white/60 shadow-glass hover:shadow-glass-hover transition-all cursor-pointer group"
          onClick={onBack}
        >
          <div className="size-10 rounded-xl bg-slate-900 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
            <ArrowLeft className="size-5" />
          </div>
          <h1 className="text-sm font-black text-slate-900 tracking-tight">退回主界面</h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-full px-4"
          onClick={() => setIsMyVoicesOpen(true)}
        >
          <History className="size-4" />
          我的音色
        </Button>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full p-8 space-y-8 pb-24">
        <section className="glass-card rounded-[2.5rem] border-white/80 overflow-hidden shadow-glass">
          <button
            onClick={() => setIsApiConfigOpen(!isApiConfigOpen)}
            className="w-full px-8 py-5 flex items-center justify-between hover:bg-white/40 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="size-10 rounded-xl bg-slate-200 flex items-center justify-center text-slate-500">
                <Settings2 className="size-5" />
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-slate-800">配置界面</span>
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-50/60 border border-emerald-100/50">
                  <div className="size-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                    {selectedPlatform} 已启用
                  </span>
                </div>
              </div>
            </div>
            {isApiConfigOpen ? <ChevronUp className="size-5 text-slate-400" /> : <ChevronDown className="size-5 text-slate-400" />}
          </button>
          <AnimatePresence>
            {isApiConfigOpen && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                className="overflow-hidden"
              >
                <div className="px-8 pb-8 pt-2 grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-slate-200/60">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">平台 / 服务</Label>
                    <select
                      value={selectedPlatform}
                      onChange={(event) => {
                        const nextPlatform = event.target.value as VoicePlatformLabel;
                        setSelectedPlatform(nextPlatform);
                        setCloneStatus('idle');
                        setCloneError("");
                        setGenerateError("");
                      }}
                      className="w-full h-12 rounded-2xl border border-slate-300 bg-white/50 px-4 py-2 text-sm focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                    >
                      <option value="智谱">智谱</option>
                      <option value="阿里云">阿里云</option>
                      <option value="火山引擎">火山引擎</option>
                      <option value="SiliconFlow 声音克隆">SiliconFlow 声音克隆</option>
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{configInputLabel}</Label>
                    <Input
                      type={selectedPlatform === '火山引擎' || selectedPlatform === 'SiliconFlow 声音克隆' ? 'text' : 'password'}
                      placeholder={configInputPlaceholder}
                      value={configInputValue}
                      onChange={(event) => {
                        if (selectedPlatform === '智谱') {
                          setZhipuApiKey(event.target.value);
                        } else if (selectedPlatform === '阿里云') {
                          setAliyunApiKey(event.target.value);
                        }
                      }}
                      disabled={selectedPlatform === 'SiliconFlow 声音克隆' || selectedPlatform === '火山引擎'}
                      className="h-12 rounded-2xl border-slate-300 bg-white/50"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <p className="text-xs text-slate-500 leading-6">{platformHint}</p>
                    {isConfigLoading && <p className="mt-2 text-xs text-slate-400">正在读取服务端语音配置...</p>}
                    {configError && <p className="mt-2 text-xs text-red-500">{configError}</p>}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <div className="grid grid-cols-1 gap-8">
          <section className="glass-card p-10 rounded-[2.5rem] border-white/80 shadow-glass space-y-6">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">1. 上传音频</h2>
            <div
              className={cn(
                "border-2 border-dashed rounded-[2rem] p-12 flex flex-col items-center justify-center transition-all duration-500",
                uploadStatus === 'done'
                  ? "border-emerald-200 bg-emerald-50/40 backdrop-blur-md"
                  : "border-slate-300/60 hover:border-indigo-400 hover:bg-indigo-50/40 hover:backdrop-blur-md"
              )}
            >
              {uploadStatus === 'idle' && (
                <>
                  <div className="size-14 rounded-3xl bg-slate-200 flex items-center justify-center mb-6 shadow-inner">
                    <Upload className="size-7 text-slate-500" />
                  </div>
                  <p className="text-base font-bold text-slate-800">点击上传或拖拽文件至此</p>
                  <p className="text-sm text-slate-400 mt-2">支持 MP3, WAV 或 M4A (最大 10MB)</p>
                  <Button
                    variant="outline"
                    size="lg"
                    className="mt-8 rounded-2xl px-8 border-slate-300"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    选择文件
                  </Button>
                </>
              )}
              {uploadStatus === 'uploading' && (
                <div className="flex flex-col items-center py-8">
                  <Loader2 className="size-10 text-indigo-600 animate-spin mb-6" />
                  <p className="text-base font-medium text-slate-600">正在读取音频样本...</p>
                </div>
              )}
              {uploadStatus === 'done' && uploadedFile && (
                <div className="flex flex-col items-center py-1">
                  <div className="size-10 rounded-full bg-emerald-100 flex items-center justify-center mb-3 shadow-[0_0_16px_rgba(16,185,129,0.18)]">
                    <CheckCircle2 className="size-6 text-emerald-500" />
                  </div>
                  <p className="text-sm font-bold text-slate-900 text-center break-all max-w-xs">{uploadedFile.name} 已上传</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  {uploadedAudioUrl && (
                    <div className="mt-3 w-full max-w-[260px] rounded-[1rem] border border-slate-200 bg-white/70 px-3 py-2">
                      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        点击下方音频试听样本
                      </p>
                      <audio
                        controls
                        src={uploadedAudioUrl}
                        className="w-full h-9"
                      >
                        您的浏览器暂不支持音频试听。
                      </audio>
                    </div>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-slate-400 hover:text-slate-600 rounded-full h-8 px-3 text-xs"
                    onClick={resetUploadState}
                  >
                    重新上传
                  </Button>
                </div>
              )}
            </div>
            {uploadError && (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-500">
                {uploadError}
              </div>
            )}
          </section>

          <section className="glass-card p-10 rounded-[2.5rem] border-white/80 shadow-glass space-y-6">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">2. 克隆音色</h2>
            <div className="space-y-4">
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">音色名称</Label>
              <Input
                placeholder="给您的新音色起个名字"
                className="h-12 rounded-2xl border-slate-300 bg-white/50"
                value={voiceName}
                onChange={(event) => setVoiceName(event.target.value)}
              />
            </div>
            {selectedPlatform === '火山引擎' && (
              <p className="text-xs leading-6 text-slate-400">
                火山引擎会为本次新建音色自动生成唯一 speaker_id，并把它绑定到这条历史音色上。
              </p>
            )}
            <Button
              className="w-full h-14 rounded-2xl text-lg font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-xl shadow-slate-900/20 transition-all active:scale-[0.98]"
              disabled={uploadStatus !== 'done' || cloneStatus === 'processing'}
              onClick={handleCloneVoice}
            >
              {cloneStatus === 'processing' ? (
                <span className="flex items-center gap-3">
                  <Loader2 className="size-6 animate-spin" />
                  正在克隆音色...
                </span>
              ) : (
                <span className="flex items-center gap-3">
                  <Mic2 className="size-6" />
                  开始克隆
                </span>
              )}
            </Button>
            {cloneStatus === 'done' && activeReadyVoice && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 text-xs text-indigo-600 font-bold bg-indigo-50/80 backdrop-blur-sm p-3 rounded-xl border border-indigo-100"
              >
                <CheckCircle2 className="size-4" />
                声音克隆成功，当前音色为 {activeReadyVoice.name}。
              </motion.div>
            )}
            {cloneError && (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-500">
                {cloneError}
              </div>
            )}
          </section>

          <section className="glass-card p-10 rounded-[2.5rem] border-white/80 shadow-glass space-y-6">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">3. 文本转语音</h2>
            <div className="space-y-4">
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">输入文本</Label>
              <textarea
                className={cn(
                  "w-full h-40 rounded-[2rem] border p-6 text-base outline-none transition-all resize-none",
                  isVoiceReady
                    ? "border-slate-300 bg-white/50 focus:ring-4 focus:ring-indigo-500/10"
                    : "border-slate-200 bg-slate-100/80 text-slate-400 cursor-not-allowed"
                )}
                placeholder={isVoiceReady ? "请输入您想转换成语音的文本内容..." : "请先完成音色准备，再输入文案内容"}
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                disabled={!isVoiceReady}
              />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-500">
              {isVoiceReady
                ? `当前使用音色：${activeReadyVoice?.name || ''} (${activeReadyVoice?.providerLabel || ''})`
                : isSiliconFlowSelected
                  ? "请上传参考音频"
                  : "当前还没有准备好的音色，请先完成声音克隆或从我的音色中启用一个音色。"}
              {activeVoiceOverridesPlatform && (
                <p className="mt-2 text-xs text-slate-400">
                  当前已启用历史音色，后续生成会继续走 {activeReadyVoice?.providerLabel}；
                  上方平台切换只影响下一次新建音色，不会覆盖这个已选音色。
                </p>
              )}
              {isUsingSiliconFlowVoice && hasSiliconFlowVoiceUri && (
                <p className="mt-2 break-all text-xs text-slate-400">voice uri：{siliconFlowVoiceUri}</p>
              )}
              {isUsingVolcVoice && (
                <p className="mt-2 break-all text-xs text-slate-400">speaker_id：{activeReadyVoice?.remoteVoiceId}</p>
              )}
              {isUsingVolcVoice && activeVolcAliasCount > 1 && (
                <p className="mt-2 text-xs text-amber-600">
                  当前这条火山历史音色和另外 {activeVolcAliasCount - 1} 条记录共用了同一个 speaker_id，
                  所以切换名称不会改变底层实际发音人。要得到不同的火山音色，需要使用不同的 speaker_id 重新克隆。
                </p>
              )}
            </div>
            <div className="flex flex-col gap-4">
              <Button
                className="w-full h-14 rounded-2xl text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98]"
                disabled={!isVoiceReady || generateStatus === 'generating' || !inputText.trim()}
                onClick={handleGenerateAudio}
              >
                {generateStatus === 'generating' ? (
                  <span className="flex items-center gap-3">
                    <Loader2 className="size-6 animate-spin" />
                    正在生成...
                  </span>
                ) : (
                  <span className="flex items-center gap-3">
                    <Wand2 className="size-6" />
                    生成语音
                  </span>
                )}
              </Button>
            </div>

            {generateError && (
              <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-500">
                {generateError}
              </div>
            )}

            <AnimatePresence>
              {generatedAudios.map((audio) => (
                <motion.div
                  key={audio.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="w-full bg-white/40 backdrop-blur-md p-6 rounded-[2rem] border border-white/60 space-y-4"
                >
                  <div className="flex items-center gap-6">
                    <div className="flex-1 space-y-2">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        模型：{audio.providerLabel}
                      </div>
                      <div className="flex items-center justify-end text-[10px] font-bold text-slate-400 uppercase tracking-wider gap-4">
                        <span className="font-mono">{audio.timestamp} | {audio.duration}</span>
                      </div>
                      <button
                        type="button"
                        className="group relative block h-5 w-full cursor-pointer"
                        onClick={(event) => void handleSeekAudio(audio, event)}
                        aria-label={`跳转 ${audio.voiceName || '音频'} 的播放进度`}
                      >
                        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200 overflow-hidden">
                        <motion.div
                          initial={false}
                          animate={{ width: `${playbackProgress[audio.id] ?? 0}%` }}
                          transition={{ ease: "linear", duration: 0.12 }}
                          className="absolute inset-y-0 left-0 bg-indigo-600"
                        />
                        </div>
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-10 rounded-xl border-slate-300 bg-white/50 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                        onClick={() => handlePlayAudio(audio)}
                      >
                        {playingAudioId === audio.id ? <Pause className="size-5" /> : <Play className="size-5" />}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-10 rounded-xl border-slate-300 bg-white/50 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                        onClick={() => handleDownloadAudio(audio)}
                      >
                        <Download className="size-5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex justify-center border-t border-slate-100 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-400 hover:text-red-500 rounded-full h-8 text-xs"
                      onClick={() => handleDeleteAudio(audio.id)}
                    >
                      删除记录
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </section>
        </div>
      </main>

      <SiteFooter className="px-8 pb-8 pt-2" />

      <AnimatePresence>
        {isMyVoicesOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMyVoicesOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', ease: 'easeInOut', duration: 0.5 }}
              className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <History className="size-5 text-indigo-600" />
                  <h2 className="text-lg font-semibold">我的音色</h2>
                </div>
                <Button variant="ghost" size="icon" onClick={() => setIsMyVoicesOpen(false)}>
                  <X className="size-5" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {voices.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-400">
                    还没有创建好的音色。先上传一段样本音频并完成克隆吧。
                  </div>
                ) : (
                  ([
                    {
                      key: 'aliyun',
                      title: '阿里云',
                      voices: voicesByProvider.aliyun,
                      sectionClassName: 'overflow-hidden rounded-[1.4rem] border-2 border-sky-300 bg-[linear-gradient(165deg,rgba(240,249,255,0.96)_0%,rgba(224,242,254,0.92)_55%,rgba(255,255,255,0.98)_100%)] shadow-[0_12px_24px_rgba(14,165,233,0.12)]',
                      heroClassName: 'border-b-2 border-sky-300 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.18),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(240,249,255,0.9))]',
                      titleClassName: 'text-sky-950',
                      listPanelClassName: 'border-t border-sky-200/90 bg-white/84',
                      emptyClassName: 'border-sky-300 bg-sky-50/75 text-sky-700/80',
                      activeCardClassName: 'border-sky-400 bg-sky-50/95 shadow-[0_8px_18px_rgba(14,165,233,0.10)]',
                      activeBadgeClassName: 'bg-sky-100 text-sky-700',
                      buttonClassName: 'hover:text-sky-700 hover:border-sky-300 hover:bg-sky-50',
                    },
                    {
                      key: 'siliconflow',
                      title: 'SiliconFlow 声音克隆',
                      voices: voicesByProvider.siliconflow,
                      sectionClassName: 'overflow-hidden rounded-[1.4rem] border-2 border-fuchsia-300 bg-[linear-gradient(165deg,rgba(253,244,255,0.96)_0%,rgba(250,232,255,0.92)_55%,rgba(255,255,255,0.98)_100%)] shadow-[0_12px_24px_rgba(192,38,211,0.12)]',
                      heroClassName: 'border-b-2 border-fuchsia-300 bg-[radial-gradient(circle_at_top_left,rgba(217,70,239,0.18),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(253,244,255,0.9))]',
                      titleClassName: 'text-fuchsia-950',
                      listPanelClassName: 'border-t border-fuchsia-200/90 bg-white/84',
                      emptyClassName: 'border-fuchsia-300 bg-fuchsia-50/75 text-fuchsia-700/80',
                      activeCardClassName: 'border-fuchsia-400 bg-fuchsia-50/95 shadow-[0_8px_18px_rgba(192,38,211,0.10)]',
                      activeBadgeClassName: 'bg-fuchsia-100 text-fuchsia-700',
                      buttonClassName: 'hover:text-fuchsia-700 hover:border-fuchsia-300 hover:bg-fuchsia-50',
                    },
                    {
                      key: 'volcengine',
                      title: '火山引擎',
                      voices: voicesByProvider.volcengine,
                      sectionClassName: 'overflow-hidden rounded-[1.4rem] border-2 border-amber-300 bg-[linear-gradient(165deg,rgba(255,251,235,0.97)_0%,rgba(254,243,199,0.92)_55%,rgba(255,255,255,0.98)_100%)] shadow-[0_12px_24px_rgba(245,158,11,0.12)]',
                      heroClassName: 'border-b-2 border-amber-300 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.18),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,251,235,0.9))]',
                      titleClassName: 'text-amber-950',
                      listPanelClassName: 'border-t border-amber-200/90 bg-white/84',
                      emptyClassName: 'border-amber-300 bg-amber-50/75 text-amber-700/80',
                      activeCardClassName: 'border-amber-400 bg-amber-50/95 shadow-[0_8px_18px_rgba(245,158,11,0.10)]',
                      activeBadgeClassName: 'bg-amber-100 text-amber-700',
                      buttonClassName: 'hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50',
                    },
                    {
                      key: 'zhipu',
                      title: '智谱',
                      voices: voicesByProvider.zhipu,
                      sectionClassName: 'overflow-hidden rounded-[1.4rem] border-2 border-emerald-300 bg-[linear-gradient(165deg,rgba(236,253,245,0.97)_0%,rgba(209,250,229,0.92)_55%,rgba(255,255,255,0.98)_100%)] shadow-[0_12px_24px_rgba(16,185,129,0.12)]',
                      heroClassName: 'border-b-2 border-emerald-300 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_48%),linear-gradient(135deg,rgba(255,255,255,0.96),rgba(236,253,245,0.9))]',
                      titleClassName: 'text-emerald-950',
                      listPanelClassName: 'border-t border-emerald-200/90 bg-white/84',
                      emptyClassName: 'border-emerald-300 bg-emerald-50/75 text-emerald-700/80',
                      activeCardClassName: 'border-emerald-400 bg-emerald-50/95 shadow-[0_8px_18px_rgba(16,185,129,0.10)]',
                      activeBadgeClassName: 'bg-emerald-100 text-emerald-700',
                      buttonClassName: 'hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50',
                    },
                  ] as const).map((section) => (
                    <section
                      key={section.key}
                      className={cn(
                        "space-y-0",
                        section.sectionClassName,
                      )}
                    >
                      <div
                        className={cn(
                          "px-3.5 py-3",
                          section.heroClassName,
                        )}
                      >
                        <h3 className={cn("text-[15px] font-black tracking-tight", section.titleClassName)}>
                          {section.title}
                        </h3>
                      </div>

                      <div className={cn("p-2.5", section.listPanelClassName)}>
                        {section.voices.length === 0 ? (
                          <div className={cn("rounded-[1rem] border-2 border-dashed px-4 py-5 text-center text-xs", section.emptyClassName)}>
                            暂无 {section.title} 音色
                          </div>
                        ) : (
                          <div className="space-y-2">
                          {section.voices.map((voice) => (
                            <div
                              key={voice.id}
                              className={cn(
                                "flex items-center justify-between gap-3 rounded-[1rem] border-2 px-3 py-2.5 transition-all group bg-white/96 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]",
                                activeVoiceId === voice.id
                                  ? section.activeCardClassName
                                  : "border-slate-300/90 hover:border-slate-400 hover:bg-white"
                              )}
                            >
                              <div className="min-w-0 flex-1 flex items-center gap-3">
                                {activeVoiceId === voice.id && (
                                  <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold", section.activeBadgeClassName)}>
                                    当前使用
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-semibold text-slate-900">{voice.name}</div>
                                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-400">
                                    <span className="truncate">{voice.createdAt}</span>
                                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                                    <span className="truncate">{voice.providerLabel}</span>
                                  </div>
                                  {voice.provider === 'volcengine' && (
                                    <div className="mt-1 truncate text-[10px] text-slate-500">
                                      speaker_id: {voice.remoteVoiceId}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="shrink-0 flex items-center gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={cn(
                                    "h-8 rounded-lg px-3 text-[11px] font-bold text-slate-700 bg-white border-2 border-slate-300 transition-all",
                                    section.buttonClassName,
                                  )}
                                  onClick={() => {
                                    setActiveVoiceId(voice.id);
                                    setCloneStatus('idle');
                                    setCloneError("");
                                    setGenerateError("");
                                    setIsMyVoicesOpen(false);
                                  }}
                                >
                                  使用此音色
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 rounded-lg px-2 text-[11px] text-red-500"
                                  onClick={() => handleDeleteVoice(voice.id)}
                                >
                                  删除
                                </Button>
                              </div>
                            </div>
                          ))}
                          </div>
                        )}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
