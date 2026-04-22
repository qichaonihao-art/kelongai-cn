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
interface TextInputHistoryItem {
  id: string;
  text: string;
  createdAt: string;
}
interface TextHistoryPreview {
  item: TextInputHistoryItem;
  top: number;
  left: number;
  width: number;
  maxBodyHeight: number;
  height: number;
}

const MAX_AUDIO_SIZE = 10 * 1024 * 1024;
const ALIYUN_MAX_AUDIO_DURATION_SECONDS = 60;
const TEXT_HISTORY_STORAGE_KEY = 'voice-cloning-text-history';
const MAX_TEXT_HISTORY_ITEMS = 100;
const VOICE_PROVIDER_ORDER: VoicePlatform[] = ['aliyun', 'volcengine', 'zhipu', 'siliconflow'];
const VOICE_PROVIDER_META: Record<VoicePlatform, {
  title: string;
  shortTitle: string;
  dotClassName: string;
  countClassName: string;
  activeClassName: string;
  gradient: string;
  textColor: string;
}> = {
  aliyun: {
    title: '阿里云',
    shortTitle: '阿里云',
    dotClassName: 'bg-sky-500',
    countClassName: 'bg-sky-50 text-sky-700 ring-sky-100',
    activeClassName: 'border-sky-400 bg-sky-100 shadow-lg shadow-sky-200/40 ring-2 ring-sky-200/60',
    gradient: 'from-sky-400 to-blue-500',
    textColor: 'text-sky-600',
  },
  siliconflow: {
    title: 'SiliconFlow 声音克隆',
    shortTitle: 'SiliconFlow',
    dotClassName: 'bg-fuchsia-500',
    countClassName: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100',
    activeClassName: 'border-fuchsia-400 bg-fuchsia-100 shadow-lg shadow-fuchsia-200/40 ring-2 ring-fuchsia-200/60',
    gradient: 'from-fuchsia-400 to-purple-500',
    textColor: 'text-fuchsia-600',
  },
  volcengine: {
    title: '火山引擎',
    shortTitle: '火山',
    dotClassName: 'bg-amber-500',
    countClassName: 'bg-amber-50 text-amber-700 ring-amber-100',
    activeClassName: 'border-amber-400 bg-amber-100 shadow-lg shadow-amber-200/40 ring-2 ring-amber-200/60',
    gradient: 'from-amber-400 to-orange-500',
    textColor: 'text-amber-600',
  },
  zhipu: {
    title: '智谱',
    shortTitle: '智谱',
    dotClassName: 'bg-emerald-500',
    countClassName: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    activeClassName: 'border-emerald-400 bg-emerald-100 shadow-lg shadow-emerald-200/40 ring-2 ring-emerald-200/60',
    gradient: 'from-emerald-400 to-teal-500',
    textColor: 'text-emerald-600',
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

function loadTextInputHistory(): TextInputHistoryItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(TEXT_HISTORY_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : [];

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(
        (item): item is TextInputHistoryItem =>
          typeof item?.id === 'string' &&
          typeof item?.text === 'string' &&
          typeof item?.createdAt === 'string' &&
          item.text.trim().length > 0,
      )
      .slice(0, MAX_TEXT_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function saveTextInputHistory(items: TextInputHistoryItem[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(TEXT_HISTORY_STORAGE_KEY, JSON.stringify(items.slice(0, MAX_TEXT_HISTORY_ITEMS)));
  } catch {
    // Ignore storage failures; text generation should keep working.
  }
}

export default function VoiceCloningPage({ onBack }: VoiceCloningPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textToSpeechSectionRef = useRef<HTMLElement>(null);
  const inputTextRef = useRef<HTMLTextAreaElement>(null);
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
  const [textHistory, setTextHistory] = useState<TextInputHistoryItem[]>(loadTextInputHistory);
  const [textHistoryPreview, setTextHistoryPreview] = useState<TextHistoryPreview | null>(null);
  const [isTextHistoryOpen, setIsTextHistoryOpen] = useState(false);
  const [isTextCountLit, setIsTextCountLit] = useState(false);
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
    saveTextInputHistory(textHistory);
  }, [textHistory]);

  useEffect(() => {
    setIsTextCountLit(true);
    const timeoutId = window.setTimeout(() => {
      setIsTextCountLit(false);
    }, 360);

    return () => window.clearTimeout(timeoutId);
  }, [inputText.length]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = inputTextRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(600, textarea.scrollHeight)}px`;
  }, [inputText]);

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

  function rememberInputText(value = inputText) {
    const trimmedText = value.trim();
    if (!trimmedText) {
      return;
    }

    setTextHistory((previous) => {
      if (previous.some((item) => item.text.trim() === trimmedText)) {
        return previous;
      }

      return [
        {
          id: `text_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          text: trimmedText,
          createdAt: new Date().toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
        ...previous,
      ].slice(0, MAX_TEXT_HISTORY_ITEMS);
    });
  }

  function useHistoryText(item: TextInputHistoryItem) {
    setInputText(item.text);
    setTextHistoryPreview(null);
    setIsTextHistoryOpen(false);
    window.setTimeout(() => {
      inputTextRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  function deleteHistoryText(itemId: string) {
    setTextHistory((previous) => previous.filter((item) => item.id !== itemId));
    setTextHistoryPreview((preview) => (preview?.item.id === itemId ? null : preview));
  }

  function showTextHistoryPreview(item: TextInputHistoryItem, element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const preferredPreviewWidth = 360;
    const minPreviewWidth = 260;
    const viewportPadding = 16;
    const rightSideLeft = rect.right + 12;
    const availableRightWidth = Math.max(minPreviewWidth, window.innerWidth - rightSideLeft - viewportPadding);
    const previewWidth = Math.min(preferredPreviewWidth, availableRightWidth);
    const left = rightSideLeft;
    const charsPerLine = Math.max(14, Math.floor((previewWidth - 40) / 15));
    const estimatedLineCount = Math.ceil(item.text.length / charsPerLine);
    const estimatedBodyHeight = Math.min(
      Math.max(112, estimatedLineCount * 28),
      Math.max(240, window.innerHeight - viewportPadding * 2 - 86),
    );
    const previewHeight = estimatedBodyHeight + 86;
    const targetCenterY = rect.top + rect.height / 2;
    const top = Math.min(
      Math.max(viewportPadding, targetCenterY - previewHeight / 2),
      Math.max(viewportPadding, window.innerHeight - previewHeight - viewportPadding),
    );

    setTextHistoryPreview({
      item,
      left,
      top,
      width: previewWidth,
      maxBodyHeight: estimatedBodyHeight,
      height: previewHeight,
    });
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
    rememberInputText(inputText);

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

  function scrollToTextInputAfterVoiceSelect() {
    window.setTimeout(() => {
      textToSpeechSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });

      window.setTimeout(() => {
        inputTextRef.current?.focus({ preventScroll: true });
      }, 320);
    }, 420);
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

      <header className="h-16 border-b border-slate-200/60 bg-white/50 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-30">
        <button
          onClick={onBack}
          className="flex items-center gap-2.5 h-9 rounded-full pl-1 pr-4 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300 group"
        >
          <div className="size-7 rounded-full bg-slate-900 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
            <ArrowLeft className="size-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-700">返回</span>
        </button>
        <button
          onClick={() => setIsMyVoicesOpen(true)}
          className="flex items-center gap-2 h-9 rounded-full px-4 text-xs font-bold text-slate-600 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300"
        >
          <History className="size-3.5" />
          我的音色
        </button>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full p-6 space-y-6 pb-24">
        {/* Config Panel */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-3xl border-white/80 overflow-hidden shadow-glass"
        >
          <button
            onClick={() => setIsApiConfigOpen(!isApiConfigOpen)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/40 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                <Settings2 className="size-4" />
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold text-slate-800">配置</span>
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                  </span>
                  {selectedPlatform}
                </span>
              </div>
            </div>
            {isApiConfigOpen ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}
          </button>
          <AnimatePresence>
            {isApiConfigOpen && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                className="overflow-hidden"
              >
                <div className="px-6 pb-6 pt-2 grid grid-cols-1 md:grid-cols-2 gap-5 border-t border-slate-100">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">平台 / 服务</Label>
                    <select
                      value={selectedPlatform}
                      onChange={(event) => {
                        const nextPlatform = event.target.value as VoicePlatformLabel;
                        setSelectedPlatform(nextPlatform);
                        setCloneStatus('idle');
                        setCloneError("");
                        setGenerateError("");
                      }}
                      className="w-full h-10 rounded-xl border border-slate-200 bg-white/60 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                    >
                      <option value="智谱">智谱</option>
                      <option value="阿里云">阿里云</option>
                      <option value="火山引擎">火山引擎</option>
                      <option value="SiliconFlow 声音克隆">SiliconFlow 声音克隆</option>
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{configInputLabel}</Label>
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
                      className="h-10 rounded-xl border-slate-200 bg-white/60"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <p className="text-xs text-slate-500 leading-relaxed">{platformHint}</p>
                    {isConfigLoading && <p className="text-xs text-slate-400">正在读取服务端语音配置...</p>}
                    {configError && <p className="text-xs text-red-500">{configError}</p>}
                    {ownershipError && <p className="text-xs text-red-500">{ownershipError}</p>}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        <div className="space-y-6">
          {/* Upload Audio */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-card rounded-3xl border-white/80 shadow-glass overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2"
            >
              <div className="size-6 rounded-lg bg-indigo-50 flex items-center justify-center"
              >
                <span className="text-[10px] font-black text-indigo-600"
                >01</span>
              </div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider"
              >上传音频</span>
            </div>
            <div className="p-6 space-y-4"
            >
              <div
                className={cn(
                  "border-2 border-dashed rounded-2xl p-10 flex flex-col items-center justify-center transition-all duration-300",
                  uploadStatus === 'done'
                    ? "border-emerald-200 bg-emerald-50/30"
                    : "border-indigo-300 bg-indigo-50/20",
                )}
              >
                {uploadStatus === 'idle' && (
                  <>
                    <div className="size-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-4"
                    >
                      <Upload className="size-6 text-slate-400" />
                    </div>
                    <p className="text-sm font-bold text-slate-800"
                    >点击上传或拖拽文件</p>
                    <p className="text-xs text-slate-400 mt-1"
                    >MP3, WAV, M4A · 最大 10MB</p>
                    <p className="text-[11px] text-slate-400 mt-2 text-center max-w-sm leading-5"
                    >{platformAudioGuide}</p>
                    <button
                      className="mt-5 h-9 rounded-full px-6 text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 shadow-md transition-all"
                      onClick={() =>
                        fileInputRef.current?.click()}
                    >
                      选择文件
                    </button>
                  </>
                )}
                {uploadStatus === 'uploading' && (
                  <div className="flex flex-col items-center py-4"
                  >
                    <Loader2 className="size-8 text-indigo-600 animate-spin mb-3" />
                    <p className="text-sm font-medium text-slate-600"
                    >正在读取音频...</p>
                  </div>
                )}
                {uploadStatus === 'done' && uploadedFile && (
                  <div className="flex flex-col items-center"
                  >
                    <div className="size-8 rounded-full bg-emerald-100 flex items-center justify-center mb-2"
                    >
                      <CheckCircle2 className="size-4 text-emerald-600" />
                    </div>
                    <p className="text-sm font-bold text-slate-900 text-center break-all max-w-xs"
                    >{uploadedFile.name}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5"
                    >
                      {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                      {uploadedAudioDurationSeconds !== null ? ` · ${formatDurationLabel(uploadedAudioDurationSeconds)}` : ''}
                    </p>
                    {uploadedAudioUrl && (
                      <div className="mt-3 w-full max-w-[240px] rounded-xl border border-slate-200 bg-white px-3 py-2"
                      >
                        <audio controls src={uploadedAudioUrl} className="w-full h-8"
                        >
                          您的浏览器暂不支持音频试听。
                        </audio>
                      </div>
                    )}
                    <button
                      className="mt-2 text-[11px] font-bold text-slate-400 hover:text-slate-700 transition-colors"
                      onClick={resetUploadState}
                    >
                      重新上传
                    </button>
                  </div>
                )}
              </div>
              {uploadError && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-500"
                >
                  {uploadError}
                </div>
              )}
            </div>
          </motion.section>

          {/* Clone Voice */}
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-card rounded-3xl border-white/80 shadow-glass overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2"
            >
              <div className="size-6 rounded-lg bg-emerald-50 flex items-center justify-center"
              >
                <span className="text-[10px] font-black text-emerald-600"
                >02</span>
              </div>
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider"
              >克隆音色</span>
            </div>
            <div className="p-6 space-y-4"
            >
              <div className="space-y-2"
              >
                <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                >音色名称</Label>
                <Input
                  placeholder="给您的新音色起个名字"
                  className="h-10 rounded-xl border-slate-200 bg-white/60"
                  value={voiceName}
                  onChange={(event) =>
                    setVoiceName(event.target.value)}
                />
              </div>
              {selectedPlatform === '火山引擎' && (
                <p className="text-[11px] leading-5 text-slate-400"
                >
                  火山引擎会从服务端已配置的真实 speaker_id 槽位池里自动分配一个未使用槽位。
                </p>
              )}
              <button
                className="w-full h-11 rounded-full text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/15 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                disabled={uploadStatus !== 'done' || cloneStatus === 'processing'}
                onClick={handleCloneVoice}
              >
                {cloneStatus === 'processing' ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    正在克隆...
                  </>
                ) : (
                  <>
                    <Mic2 className="size-4" />
                    开始克隆
                  </>
                )}
              </button>
              {cloneStatus === 'done' && activeReadyVoice && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 text-xs text-emerald-700 font-bold bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-100"
                >
                  <CheckCircle2 className="size-3.5" />
                  克隆成功：{activeReadyVoice.name}
                </motion.div>
              )}
              {cloneError && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-500"
                >
                  {cloneError}
                </div>
              )}
            </div>
          </motion.section>

          {/* Text to Speech */}
          <motion.section
            ref={textToSpeechSectionRef}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card rounded-3xl border-white/80 shadow-glass overflow-hidden"
          >
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2"
              >
                <div className="size-6 rounded-lg bg-sky-50 flex items-center justify-center"
                >
                  <span className="text-[10px] font-black text-sky-600"
                  >03</span>
                </div>
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider"
                >文本转语音</span>
                <span className="text-[10px] font-bold text-indigo-500">
                  {inputText.length} 字
                </span>
              </div>
              <button
                className={cn(
                  "h-8 rounded-full px-3 text-[11px] font-bold border transition-all",
                  isTextHistoryOpen
                    ? "border-sky-200 bg-sky-50 text-sky-700"
                    : "border-slate-200 bg-white/60 text-slate-500 hover:bg-slate-50",
                )}
                onClick={() =>
                  setIsTextHistoryOpen((previous) => {
                    if (previous) {
                      setTextHistoryPreview(null);
                    }
                    return !previous;
                  })}
              >
                <History className="inline-block size-3 mr-1" />
                {isTextHistoryOpen ? '收起' : `记录 ${textHistory.length}`}
              </button>
            </div>
            <div className="p-6 space-y-4"
            >
              <div
                className={cn(
                  "grid items-start gap-4",
                  isTextHistoryOpen && "lg:grid-cols-[minmax(0,1fr)_280px]",
                )}
              >
                <div className="space-y-2"
                >
                  <textarea
                    ref={inputTextRef}
                    className={cn(
                      "w-full min-h-[160px] max-h-[600px] rounded-2xl border p-4 text-sm leading-6 outline-none transition-all resize-none",
                      isVoiceReady
                        ? "border-slate-200 bg-white/60 focus:ring-2 focus:ring-indigo-500/10"
                        : "border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed",
                    )}
                    placeholder={isVoiceReady ? "请输入您想转换成语音的文本内容..." : "请先完成音色准备"}
                    value={inputText}
                    onBlur={() =>
                      rememberInputText()}
                    onChange={(event) =>
                      setInputText(event.target.value)}
                    disabled={!isVoiceReady}
                  />
                </div>

                {isTextHistoryOpen && (
                  <aside>
                    <div className="space-y-1.5 overflow-y-auto rounded-2xl border border-slate-200 bg-white/55 p-2.5 max-h-[600px]"
                    >
                      {textHistory.length === 0 ? (
                        <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-center text-[11px] text-slate-400"
                        >
                          生成或离开输入框后自动保存
                        </div>
                      ) : (
                        textHistory.map((item, index) => (
                          <div
                            key={item.id}
                            className="group flex items-start gap-1.5 rounded-xl border border-slate-100 bg-white p-1.5 transition-colors hover:border-sky-200 hover:bg-sky-50/50"
                            onMouseEnter={(event) =>
                              showTextHistoryPreview(item, event.currentTarget)}
                            onMouseLeave={() =>
                              setTextHistoryPreview(null)}
                          >
                            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-slate-50 text-[9px] font-black text-slate-400"
                            >
                              {index + 1}
                            </span>
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() =>
                                useHistoryText(item)}
                            >
                              <p className="max-h-6 overflow-hidden text-[11px] leading-3 text-slate-700"
                              >
                                {item.text}
                              </p>
                              <p className="mt-0.5 text-[9px] text-slate-400"
                              >
                                {item.createdAt}
                              </p>
                            </button>
                            <button
                              className="shrink-0 h-5 px-1 rounded text-[9px] text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                              onClick={() =>
                                deleteHistoryText(item.id)}
                            >
                              删除
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </aside>
                )}
              </div>

              {/* Voice status */}
              <div
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-xs transition-all",
                  isVoiceReady
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-slate-100 bg-slate-50 text-slate-400",
                )}
              >
                {isVoiceReady ? (
                  <div className="flex items-center gap-2"
                  >
                    <span className="relative flex size-2"
                    >
                      <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                      <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                    </span>
                    <span className="font-bold"
                    >
                      {activeReadyVoice?.name} · {activeReadyVoice?.providerLabel}
                    </span>
                  </div>
                ) : (
                  isSiliconFlowSelected ? "请上传参考音频" : "请先完成音色准备"
                )}
                {isUsingSiliconFlowVoice && hasSiliconFlowVoiceUri && (
                  <p className="mt-1 break-all text-[10px] text-emerald-600/70 font-mono"
                  >{siliconFlowVoiceUri}</p>
                )}
                {isUsingVolcVoice && activeVolcAliasCount > 1 && (
                  <p className="mt-1 text-[10px] text-amber-600 leading-4"
                  >
                    该音色与另外 {activeVolcAliasCount - 1} 条记录共用同一个 speaker_id
                  </p>
                )}
              </div>

              {/* Generate button */}
              <button
                className="w-full h-11 rounded-full text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                disabled={!isVoiceReady || generateStatus === 'generating' || !inputText.trim()}
                onClick={handleGenerateAudio}
              >
                {generateStatus === 'generating' ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    正在生成...
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4" />
                    生成语音
                  </>
                )}
              </button>

              {generateError && (
                <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-500"
                >
                  {generateError}
                </div>
              )}

              {/* Generated audios */}
              <AnimatePresence>
                {generatedAudios.map((audio) => (
                  <motion.div
                    key={audio.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"
                  >
                    <div className="flex items-center gap-3"
                    >
                      <div className="flex-1 space-y-2"
                      >
                        <div className="flex items-center justify-between"
                        >
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                          >{audio.providerLabel}</span>
                          <span className="text-[10px] font-mono text-slate-400"
                          >{audio.timestamp}</span>
                        </div>
                        <button
                          type="button"
                          className="group relative block h-4 w-full cursor-pointer"
                          onClick={(event) =>
                            void handleSeekAudio(audio, event)}
                        >
                          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-slate-100 overflow-hidden"
                          >
                            <motion.div
                              initial={false}
                              animate={{ width: `${playbackProgress[audio.id] ?? 0}%` }}
                              transition={{ ease: "linear", duration: 0.1 }}
                              className="absolute inset-y-0 left-0 bg-indigo-500 rounded-full"
                            />
                          </div>
                        </button>
                      </div>
                      <div className="flex gap-1.5"
                      >
                        <button
                          className="size-8 rounded-full flex items-center justify-center border border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                          onClick={() =>
                            handlePlayAudio(audio)}
                        >
                          {playingAudioId === audio.id ? <Pause className="size-4" /> : <Play className="size-4" />}
                        </button>
                        <button
                          className="size-8 rounded-full flex items-center justify-center border border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                          onClick={() =>
                            handleDownloadAudio(audio)}
                        >
                          <Download className="size-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-center pt-2 border-t border-slate-50"
                    >
                      <button
                        className="text-[11px] font-bold text-slate-300 hover:text-red-500 transition-colors"
                        onClick={() =>
                          handleDeleteAudio(audio.id)}
                      >
                        删除
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.section>
        </div>
      </main>

      <SiteFooter className="px-6 pb-6 pt-2" />

      <AnimatePresence>
        {textHistoryPreview && (
          <motion.div
            key={textHistoryPreview.item.id}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="pointer-events-none fixed z-[70] rounded-[1.5rem] border border-white/70 bg-white/55 p-5 text-slate-900 shadow-[0_24px_70px_rgba(15,23,42,0.24),inset_0_1px_0_rgba(255,255,255,0.82)] ring-1 ring-emerald-100/60 backdrop-blur-3xl"
            style={{
              left: textHistoryPreview.left,
              top: textHistoryPreview.top,
              width: textHistoryPreview.width,
              maxHeight: textHistoryPreview.height,
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/60 pb-3">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(34,197,94,0.95)]" />
                <span className="text-xs font-black uppercase tracking-wider text-emerald-700">文案预览</span>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-slate-400">{textHistoryPreview.item.createdAt}</span>
            </div>
            <div
              className="overflow-y-auto pr-1 text-sm font-medium leading-7 text-slate-800"
              style={{ maxHeight: textHistoryPreview.maxBodyHeight }}
            >
              {textHistoryPreview.item.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
              {/* Header */}
              <div className="flex items-center justify-between gap-4 px-6 py-5 bg-white border-b border-slate-200">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-md">
                    <History className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900">我的音色</h2>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      共 {voices.length} 个音色 · {selectedVoice ? (
                        <span className="inline-flex items-center gap-1.5">
                          当前使用
                          <span className="relative flex size-1.5">
                            <span className="absolute inline-flex size-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                            <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                          </span>
                          <span className="font-bold text-slate-700">{selectedVoice.name}</span>
                        </span>
                      ) : '未选择'}
                    </p>
                  </div>
                </div>
                <button
                  className="size-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors border border-slate-200"
                  onClick={() => setIsMyVoicesOpen(false)}
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Platform Filter */}
              <div className="px-6 py-4 bg-white border-b border-slate-200">
                <div className="grid grid-cols-4 gap-2">
                  {VOICE_PROVIDER_ORDER.map((provider) => {
                    const meta = VOICE_PROVIDER_META[provider];
                    const isSelected = voiceProviderFilter === provider;
                    const count = voicesByProvider[provider].length;

                    return (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => setVoiceProviderFilter(provider)}
                        className={cn(
                          "relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-2xl text-xs font-bold transition-all overflow-hidden border",
                          isSelected
                            ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-500/25"
                            : "bg-white text-slate-500 border-slate-200 hover:border-slate-300",
                        )}
                      >
                        <span className={cn(
                          "size-2 rounded-full",
                          isSelected ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]" : meta.dotClassName,
                        )} />
                        <span className="truncate">{meta.shortTitle}</span>
                        <span className={cn(
                          "text-[10px] font-black px-2 py-0.5 rounded-full",
                          isSelected ? "bg-white/20 text-white" : "bg-slate-50 text-slate-400 ring-1 ring-slate-100",
                        )}>
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Voice List */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
                {voices.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center shadow-sm">
                    <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-300 mb-4">
                      <Mic2 className="size-7" />
                    </div>
                    <p className="text-base font-black text-slate-800">还没有创建好的音色</p>
                    <p className="mt-2 text-sm text-slate-400">上传音频样本并完成克隆后会出现在这里</p>
                  </div>
                ) : filteredVoices.length === 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
                    <p className="text-base font-black text-slate-800">暂无该模型音色</p>
                    <p className="mt-2 text-sm text-slate-400">切换到其他模型看看</p>
                  </div>
                ) : (
                  filteredVoices.map((voice) => {
                    const isActive = activeVoiceId === voice.id;
                    const meta = VOICE_PROVIDER_META[voice.provider];

                    return (
                      <div
                        key={voice.id}
                        className={cn(
                          "group relative rounded-2xl border transition-all duration-200 overflow-hidden cursor-pointer shadow-sm",
                          isActive
                            ? cn("shadow-md ring-1", meta.activeClassName)
                            : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-md",
                        )}
                        onClick={() => {
                          if (isActive) return;
                          setActiveVoiceId(voice.id);
                          setCloneStatus('idle');
                          setCloneError("");
                          setGenerateError("");
                          setIsMyVoicesOpen(false);
                          scrollToTextInputAfterVoiceSelect();
                        }}
                      >
                        {/* Active left glow bar */}
                        {isActive && (
                          <div className={cn("absolute left-0 top-0 bottom-0 w-2.5 bg-gradient-to-b", meta.gradient)} />
                        )}

                        <div className={cn("flex items-center gap-4 p-4", isActive ? "pl-5" : "")}>
                          {/* Avatar */}
                          <div className={cn(
                            "shrink-0 size-11 rounded-xl flex items-center justify-center border transition-colors",
                            isActive
                              ? "bg-white text-slate-700 border-white/60 shadow-sm"
                              : "bg-slate-50 text-slate-400 border-slate-100",
                          )}>
                            <Mic2 className="size-5" />
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[15px] font-black truncate",
                                isActive ? "text-slate-900" : "text-slate-900",
                              )}>
                                {voice.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1">
                              <span className={cn("font-bold", meta.textColor)}>{voice.providerLabel}</span>
                              <span className="text-slate-300">|</span>
                              <span>{voice.createdAt}</span>
                            </div>
                          </div>

                          {/* Delete */}
                          <button
                            className={cn(
                              "shrink-0 size-9 rounded-xl flex items-center justify-center border transition-all opacity-0 group-hover:opacity-100",
                              isActive
                                ? "text-slate-400 hover:text-red-500 hover:bg-white hover:border-red-100 bg-white/60 border-white/40"
                                : "text-slate-300 hover:text-red-500 hover:bg-red-50 border-transparent hover:border-red-100",
                            )}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteVoice(voice.id);
                            }}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
