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
  Trash2,
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
  releaseVolcVoiceOwnership,
  syncVolcVoiceOwnership,
} from "@/src/lib/voice";
import {
  loadActiveVoiceId,
  loadOrCreateDeviceId,
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
const ALIYUN_MAX_AUDIO_DURATION_SECONDS = 60;
const VOICE_PROVIDER_ORDER: VoicePlatform[] = ['aliyun', 'volcengine', 'zhipu', 'siliconflow'];
const VOICE_PROVIDER_META: Record<VoicePlatform, {
  title: string;
  shortTitle: string;
  dotClassName: string;
  countClassName: string;
  activeClassName: string;
}> = {
  aliyun: {
    title: '阿里云',
    shortTitle: '阿里云',
    dotClassName: 'bg-sky-500',
    countClassName: 'bg-sky-50 text-sky-700 ring-sky-100',
    activeClassName: 'border-sky-300 bg-sky-50/80 ring-sky-100',
  },
  siliconflow: {
    title: 'SiliconFlow 声音克隆',
    shortTitle: 'SiliconFlow',
    dotClassName: 'bg-fuchsia-500',
    countClassName: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100',
    activeClassName: 'border-fuchsia-300 bg-fuchsia-50/80 ring-fuchsia-100',
  },
  volcengine: {
    title: '火山引擎',
    shortTitle: '火山',
    dotClassName: 'bg-amber-500',
    countClassName: 'bg-amber-50 text-amber-700 ring-amber-100',
    activeClassName: 'border-amber-300 bg-amber-50/80 ring-amber-100',
  },
  zhipu: {
    title: '智谱',
    shortTitle: '智谱',
    dotClassName: 'bg-emerald-500',
    countClassName: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    activeClassName: 'border-emerald-300 bg-emerald-50/80 ring-emerald-100',
  },
};

const EMPTY_CONFIG_STATUS: VoiceConfigStatus = {
  reachable: false,
  zhipuApiKey: false,
  aliyunApiKey: false,
  siliconFlowApiKey: false,
  volcAppKey: false,
  volcAccessKey: false,
  volcSpeakerId: false,
  volcSpeakerSlotTotal: 0,
  volcSpeakerSlotUsed: 0,
  volcSpeakerSlotAvailable: 0,
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

function formatDurationLabel(totalSeconds: number) {
  const safeSeconds = Math.max(1, Math.round(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;
}

function readAudioDurationSeconds(file: File) {
  return new Promise<number | null>((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = new Audio();

    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };

    audio.onloadedmetadata = () => {
      const durationSeconds =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : null;
      cleanup();
      resolve(durationSeconds);
    };

    audio.onerror = () => {
      cleanup();
      resolve(null);
    };

    audio.preload = 'metadata';
    audio.src = objectUrl;
  });
}

function getPlatformAudioGuide(platform: VoicePlatformLabel) {
  if (platform === '智谱') {
    return '智谱官方建议参考音频 3 到 30 秒，文件大小不超过 10MB。';
  }

  if (platform === '阿里云') {
    return '阿里云官方推荐 10 到 20 秒，最长不超过 60 秒，文件大小不超过 10MB。';
  }

  if (platform === 'SiliconFlow 声音克隆') {
    return 'SiliconFlow 官方建议参考音频控制在 30 秒以内，8 到 10 秒通常更稳。';
  }

  return '火山引擎官方更建议使用较短、清晰的参考音频；实践上以 10 到 30 秒更稳，超长音频容易被截断或导致效果下降。';
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
  const [uploadedAudioDurationSeconds, setUploadedAudioDurationSeconds] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [cloneError, setCloneError] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [configError, setConfigError] = useState("");
  const [ownershipError, setOwnershipError] = useState("");
  const [configStatus, setConfigStatus] = useState<VoiceConfigStatus>(EMPTY_CONFIG_STATUS);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [zhipuApiKey, setZhipuApiKey] = useState("");
  const [aliyunApiKey, setAliyunApiKey] = useState("");
  const [voices, setVoices] = useState<ClonedVoice[]>(loadSavedVoices);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(loadActiveVoiceId);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [playbackProgress, setPlaybackProgress] = useState<Record<string, number>>({});
  const [deviceId] = useState(loadOrCreateDeviceId);
  const [voiceProviderFilter, setVoiceProviderFilter] = useState<VoicePlatform>('aliyun');

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
  const filteredVoices = voicesByProvider[voiceProviderFilter];
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
  const activeVolcAliasCount = useMemo(() => {
    if (!activeReadyVoice || activeReadyVoice.provider !== 'volcengine') {
      return 0;
    }

    return voices.filter(
      (voice) => voice.provider === 'volcengine' && voice.remoteVoiceId === activeReadyVoice.remoteVoiceId,
    ).length;
  }, [activeReadyVoice, voices]);
  const localVolcSpeakerIds = useMemo(
    () => Array.from(new Set(
      voices
        .filter((voice) => voice.provider === 'volcengine')
        .map((voice) => voice.remoteVoiceId)
        .filter(Boolean),
    )),
    [voices],
  );
  const hasVolcServerSupport =
    configStatus.volcAppKey && configStatus.volcAccessKey;

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
    if (!deviceId || configStatus.mockMode || !hasVolcServerSupport) {
      return;
    }

    let cancelled = false;

    async function syncOwnership() {
      try {
        const result = await syncVolcVoiceOwnership({
          deviceId,
          speakerIds: localVolcSpeakerIds,
        });

        if (cancelled) {
          return;
        }

        if (Array.isArray(result?.conflicts) && result.conflicts.length > 0) {
          setOwnershipError("当前浏览器里有火山历史音色对应的 speaker_id 已被其他设备占用，请删除冲突记录后重新克隆。");
          return;
        }

        setOwnershipError("");
      } catch (error) {
        if (cancelled) {
          return;
        }

        setOwnershipError(error instanceof Error ? error.message : "火山音色槽位同步失败，请稍后重试。");
      }
    }

    void syncOwnership();

    return () => {
      cancelled = true;
    };
  }, [configStatus.mockMode, deviceId, hasVolcServerSupport, localVolcSpeakerIds]);

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

  const platformAudioGuide = useMemo(
    () => getPlatformAudioGuide(selectedPlatform),
    [selectedPlatform],
  );

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
      const slotSummary = configStatus.volcSpeakerSlotTotal > 0
        ? `当前槽位 ${configStatus.volcSpeakerSlotAvailable}/${configStatus.volcSpeakerSlotTotal} 可用。`
        : '';
      return `服务端已托管火山引擎密钥，并会从已配置的真实 speaker_id 槽位池里自动分配一个未使用槽位给新音色；后续生成会继续使用该历史音色自己的 speaker_id。${slotSummary ? ` ${slotSummary}` : ''}`;
    }
    return "火山引擎最小版本依赖服务端配置 VOLCENGINE_APP_KEY、VOLCENGINE_ACCESS_KEY，以及至少一个真实可用的 speaker_id 槽位。";
  }, [configStatus, hasVolcServerSupport, selectedPlatform]);

  const configInputLabel =
    selectedPlatform === '智谱'
      ? '智谱 API Key（可选）'
      : selectedPlatform === '阿里云'
        ? '阿里云 API Key（可选）'
        : selectedPlatform === 'SiliconFlow 声音克隆'
          ? 'SiliconFlow API Key（服务端托管）'
        : 'Speaker ID（系统自动分配）';

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
      : '创建火山音色时从服务端已配置的真实 speaker_id 槽位池中自动分配';

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
    setUploadedAudioDurationSeconds(null);
    setUploadStatus('idle');
    setVoiceName("");
    setUploadError("");
    setCloneError("");
    setCloneStatus('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleFileSelect(file: File | null) {
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
    setUploadedAudioDurationSeconds(null);

    const durationSeconds = await readAudioDurationSeconds(file);

    if (
      selectedPlatformProvider === 'aliyun' &&
      durationSeconds !== null &&
      durationSeconds > ALIYUN_MAX_AUDIO_DURATION_SECONDS
    ) {
      setUploadError(`阿里云官方要求参考音频最长 60 秒，当前音频约 ${formatDurationLabel(durationSeconds)}，请裁剪后再试。`);
      setUploadStatus('idle');
      setUploadedFile(null);
      return;
    }

    setTimeout(() => {
      setUploadedFile(file);
      setUploadedAudioUrl(URL.createObjectURL(file));
      setUploadedAudioDurationSeconds(durationSeconds);
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
        deviceId,
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

  async function handleDeleteVoice(voiceId: string) {
    const targetVoice = voices.find((voice) => voice.id === voiceId) || null;
    const nextVoices = voices.filter((voice) => voice.id !== voiceId);

    setVoices(nextVoices);
    if (activeVoiceId === voiceId) {
      setActiveVoiceId(null);
    }

    if (
      !targetVoice ||
      targetVoice.provider !== 'volcengine' ||
      configStatus.mockMode ||
      !hasVolcServerSupport ||
      !deviceId
    ) {
      return;
    }

    const hasSameSpeakerRemaining = nextVoices.some(
      (voice) => voice.provider === 'volcengine' && voice.remoteVoiceId === targetVoice.remoteVoiceId,
    );

    if (hasSameSpeakerRemaining) {
      return;
    }

    try {
      await releaseVolcVoiceOwnership({
        deviceId,
        speakerId: targetVoice.remoteVoiceId,
      });
      setOwnershipError("");
    } catch (error) {
      setOwnershipError(error instanceof Error ? error.message : "火山音色槽位释放失败，请稍后重试。");
    }
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
                    {ownershipError && <p className="mt-2 text-xs text-red-500">{ownershipError}</p>}
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
                  <p className="text-sm text-slate-400 mt-2">支持 MP3, WAV 或 M4A (最大 10MB、最长 60 秒)</p>
                  <p className="text-xs text-slate-500 mt-3 text-center max-w-md leading-6">{platformAudioGuide}</p>
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
                    {uploadedAudioDurationSeconds !== null ? ` | 约 ${formatDurationLabel(uploadedAudioDurationSeconds)}` : ''}
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500 text-center max-w-md">
                    {platformAudioGuide}
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
                火山引擎会从服务端已配置的真实 speaker_id 槽位池里自动分配一个未使用槽位，并把它绑定到这条历史音色上。
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
            <div
              className={cn(
                "rounded-2xl border px-4 py-3 text-sm transition-all",
                isVoiceReady
                  ? "border-emerald-300 bg-emerald-50/90 text-emerald-950 shadow-[0_0_22px_rgba(16,185,129,0.22),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-emerald-200"
                  : "border-slate-200 bg-white/50 text-slate-500",
              )}
            >
              {isVoiceReady ? (
                <div className="flex items-center gap-3">
                  <span className="size-2.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(34,197,94,0.95)]" />
                  <span className="min-w-0 font-bold">
                    当前使用音色：{activeReadyVoice?.name || ''} ({activeReadyVoice?.providerLabel || ''})
                  </span>
                </div>
              ) : (
                isSiliconFlowSelected
                  ? "请上传参考音频"
                  : "当前还没有准备好的音色，请先完成声音克隆或从我的音色中启用一个音色。"
              )}
              {isUsingSiliconFlowVoice && hasSiliconFlowVoiceUri && (
                <p className="mt-2 break-all text-xs text-emerald-700/75">voice uri：{siliconFlowVoiceUri}</p>
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
              transition={{ type: 'tween', ease: 'easeInOut', duration: 0.38 }}
              className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col border-l border-slate-200 bg-slate-50 shadow-2xl"
            >
              <div className="border-b border-slate-200 bg-white px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                      <History className="size-5" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-xl font-black tracking-tight text-slate-950">我的音色</h2>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 shrink-0 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    onClick={() => setIsMyVoicesOpen(false)}
                    aria-label="关闭我的音色"
                  >
                    <X className="size-5" />
                  </Button>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">全部音色</div>
                    <div className="mt-1 text-2xl font-black text-slate-950">{voices.length}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">当前使用</div>
                    <div className="mt-1 truncate text-sm font-bold text-slate-900">
                      {selectedVoice ? selectedVoice.name : '未选择'}
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-400">
                      {selectedVoice ? selectedVoice.providerLabel : '从列表中启用'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-b border-slate-200 bg-white px-5 py-4">
                <div className="grid grid-cols-4 gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
                    {VOICE_PROVIDER_ORDER.map((provider) => {
                      const meta = VOICE_PROVIDER_META[provider];
                      const isSelected = voiceProviderFilter === provider;

                      return (
                      <button
                        key={provider}
                        type="button"
                        className={cn(
                          "relative flex h-10 items-center justify-center gap-2 overflow-hidden rounded-xl px-2 text-xs font-bold text-slate-500 transition-all",
                          isSelected
                            ? "bg-emerald-50 text-emerald-950 shadow-[0_0_18px_rgba(16,185,129,0.35),inset_0_1px_0_rgba(255,255,255,0.9)] ring-2 ring-emerald-400"
                            : "hover:bg-white/70 hover:text-slate-800",
                        )}
                        onClick={() => setVoiceProviderFilter(provider)}
                      >
                        {isSelected && (
                          <span className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_50%_0%,rgba(34,197,94,0.32),transparent_70%)]" />
                        )}
                        <span
                          className={cn(
                            "relative z-10 size-2 rounded-full",
                            isSelected
                              ? "bg-emerald-500 shadow-[0_0_10px_rgba(34,197,94,0.95)]"
                              : meta.dotClassName,
                          )}
                        />
                        <span className="relative z-10 truncate">{meta.shortTitle}</span>
                        <span className={cn(
                          "relative z-10 rounded-full px-1.5 py-0.5 text-[10px] ring-1",
                          isSelected ? "bg-emerald-100 text-emerald-700 ring-emerald-200" : "bg-white text-slate-400 ring-slate-200",
                        )}>
                          {voicesByProvider[provider].length}
                        </span>
                      </button>
                      );
                    })}
                </div>
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-7">
                {voices.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                    <div className="mx-auto flex size-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-400">
                      <Mic2 className="size-7" />
                    </div>
                    <p className="mt-5 text-base font-bold text-slate-900">还没有创建好的音色</p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                      先上传一段样本音频并完成克隆，之后它会自动出现在这里。
                    </p>
                  </div>
                ) : filteredVoices.length === 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center">
                    <p className="text-base font-bold text-slate-900">
                      暂无 {VOICE_PROVIDER_META[voiceProviderFilter].title} 音色
                    </p>
                    <p className="mt-2 text-sm text-slate-500">切换到其他模型，或先创建一个该模型的音色。</p>
                  </div>
                ) : (
                  (() => {
                    const provider = voiceProviderFilter;
                    const meta = VOICE_PROVIDER_META[provider];
                    const sectionVoices = filteredVoices;

                    return (
                    <section
                      key={provider}
                      className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3.5 sm:px-5">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={cn("size-2.5 shrink-0 rounded-full", meta.dotClassName)} />
                          <h3 className="truncate text-sm font-black text-slate-950">{meta.title}</h3>
                        </div>
                        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold ring-1", meta.countClassName)}>
                          {sectionVoices.length} 个
                        </span>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {sectionVoices.map((voice) => {
                          const isActive = activeVoiceId === voice.id;

                          return (
                            <article
                              key={voice.id}
                              className={cn(
                                "grid gap-4 px-4 py-4 transition-colors sm:grid-cols-[1fr_auto] sm:items-center sm:px-5",
                                isActive ? cn("border-l-4 ring-1", meta.activeClassName) : "hover:bg-slate-50/80",
                              )}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="min-w-0 max-w-full truncate text-base font-black text-slate-950">
                                    {voice.name}
                                  </h4>
                                  {isActive && (
                                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-bold text-white">
                                      <CheckCircle2 className="size-3.5" />
                                      当前使用
                                    </span>
                                  )}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                                  <span>{voice.createdAt}</span>
                                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                                  <span>{voice.providerLabel}</span>
                                </div>
                                {voice.provider === 'volcengine' && (
                                  <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 font-mono text-[11px] leading-5 text-slate-500">
                                    speaker_id: {voice.remoteVoiceId}
                                  </div>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  variant={isActive ? "secondary" : "outline"}
                                  size="sm"
                                  className="h-9 rounded-xl border-slate-200 px-4 text-xs font-bold"
                                  onClick={() => {
                                    setActiveVoiceId(voice.id);
                                    setCloneStatus('idle');
                                    setCloneError("");
                                    setGenerateError("");
                                    setIsMyVoicesOpen(false);
                                  }}
                                >
                                  {isActive ? '使用中' : '启用'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-9 rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600"
                                  onClick={() => void handleDeleteVoice(voice.id)}
                                  aria-label={`删除 ${voice.name}`}
                                >
                                  <Trash2 className="size-4" />
                                </Button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                    );
                  })()
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
