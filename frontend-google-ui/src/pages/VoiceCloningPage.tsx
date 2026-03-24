import { useEffect, useMemo, useRef, useState } from "react";
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
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";
import {
  type ClonedVoice,
  type GeneratedAudio,
  type VoiceConfigStatus,
  createVoiceClone,
  generateSpeech,
  getVoiceConfigStatus,
} from "@/src/lib/voice";
import { motion, AnimatePresence } from "motion/react";

interface VoiceCloningPageProps {
  onBack: () => void;
}

const MAX_AUDIO_SIZE = 10 * 1024 * 1024;

const EMPTY_CONFIG_STATUS: VoiceConfigStatus = {
  reachable: false,
  zhipuApiKey: false,
  aliyunApiKey: false,
  volcAppKey: false,
  volcAccessKey: false,
  volcSpeakerId: false,
  mockMode: false,
};

export default function VoiceCloningPage({ onBack }: VoiceCloningPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const generatedAudiosRef = useRef<GeneratedAudio[]>([]);
  const [isApiConfigOpen, setIsApiConfigOpen] = useState(false);
  const [isMyVoicesOpen, setIsMyVoicesOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<'智谱' | '阿里云' | '火山引擎'>('阿里云');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'done'>('idle');
  const [cloneStatus, setCloneStatus] = useState<'idle' | 'processing' | 'done'>('idle');
  const [generateStatus, setGenerateStatus] = useState<'idle' | 'generating'>('idle');
  const [generatedAudios, setGeneratedAudios] = useState<GeneratedAudio[]>([]);
  const [inputText, setInputText] = useState("");
  const [voiceName, setVoiceName] = useState("");
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
  const [volcSpeakerId, setVolcSpeakerId] = useState("");
  const [voices, setVoices] = useState<ClonedVoice[]>([]);
  const [activeVoiceId, setActiveVoiceId] = useState<string | null>(null);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.id === activeVoiceId) || null,
    [activeVoiceId, voices],
  );

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
    configStatus.volcAppKey && configStatus.volcAccessKey && configStatus.volcSpeakerId;

  const platformHint = useMemo(() => {
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
      return "服务端已托管火山引擎密钥和 Speaker ID，这里可以选填覆盖 Speaker ID。";
    }
    return "火山引擎最小版本依赖服务端配置 VOLCENGINE_APP_KEY、VOLCENGINE_ACCESS_KEY 和 VOLCENGINE_SPEAKER_ID。";
  }, [configStatus, hasVolcServerSupport, selectedPlatform]);

  const configInputLabel =
    selectedPlatform === '智谱'
      ? '智谱 API Key（可选）'
      : selectedPlatform === '阿里云'
        ? '阿里云 API Key（可选）'
        : '火山 Speaker ID（可选覆盖）';

  const configInputPlaceholder =
    selectedPlatform === '智谱'
      ? (configStatus.zhipuApiKey
          ? '服务端已托管，可留空'
          : '请输入您的智谱 API Key')
      : selectedPlatform === '阿里云'
      ? (configStatus.aliyunApiKey
          ? '服务端已托管，可留空'
          : '请输入您的阿里云 API Key')
      : (hasVolcServerSupport
          ? '服务端已托管，可留空'
          : '请输入可用的火山 Speaker ID');

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

    if (selectedPlatform === '火山引擎' && !configStatus.mockMode && !hasVolcServerSupport && !volcSpeakerId.trim()) {
      setCloneError("当前火山引擎缺少可用 Speaker ID，请先在服务端配置或在配置界面填写。");
      return;
    }

    setCloneStatus('processing');
    setCloneError("");
    setGenerateError("");

    try {
      const voice = await createVoiceClone({
        platform:
          selectedPlatform === '智谱'
            ? 'zhipu'
            : selectedPlatform === '阿里云'
              ? 'aliyun'
              : 'volcengine',
        file: uploadedFile,
        preferredName: voiceName.trim(),
        credentials: {
          apiKey: selectedPlatform === '智谱' ? zhipuApiKey.trim() : aliyunApiKey.trim(),
          speakerId: volcSpeakerId.trim(),
        },
        mockMode: configStatus.mockMode,
      });

      setVoices((previous) => [voice, ...previous]);
      setActiveVoiceId(voice.id);
      setCloneStatus('done');
    } catch (error) {
      setCloneStatus('idle');
      setCloneError(error instanceof Error ? error.message : "音色创建失败，请稍后重试。");
    }
  }

  async function handleGenerateAudio() {
    if (!selectedVoice) {
      setGenerateError("请先创建并选择一个可用音色。");
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
        voice: selectedVoice,
        text: inputText.trim(),
        credentials: {
          apiKey: selectedVoice.provider === 'zhipu' ? zhipuApiKey.trim() : aliyunApiKey.trim(),
          speakerId: volcSpeakerId.trim(),
        },
        mockMode: configStatus.mockMode,
      });

      setGeneratedAudios((previous) => [audio, ...previous]);
      setInputText("");
      setGenerateStatus('idle');
    } catch (error) {
      setGenerateStatus('idle');
      setGenerateError(error instanceof Error ? error.message : "语音生成失败，请稍后重试。");
    }
  }

  async function handlePlayAudio(audio: GeneratedAudio) {
    if (playingAudioId === audio.id && activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
      setPlayingAudioId(null);
      return;
    }

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }

    const player = new Audio(audio.audioUrl);
    activeAudioRef.current = player;
    setPlayingAudioId(audio.id);

    player.onended = () => {
      setPlayingAudioId(null);
      activeAudioRef.current = null;
    };

    player.onerror = () => {
      setPlayingAudioId(null);
      activeAudioRef.current = null;
    };

    try {
      await player.play();
    } catch {
      setPlayingAudioId(null);
      activeAudioRef.current = null;
      setGenerateError("音频播放失败，请重新生成或下载后播放。");
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

    if (playingAudioId === audioId && activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
      setPlayingAudioId(null);
    }
  }

  function handleDeleteVoice(voiceId: string) {
    setVoices((previous) => {
      const nextVoices = previous.filter((voice) => voice.id !== voiceId);
      if (activeVoiceId === voiceId) {
        setActiveVoiceId(nextVoices[0]?.id || null);
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
          <h1 className="text-sm font-black text-slate-900 tracking-tight">新建工作台</h1>
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
                        setSelectedPlatform(event.target.value as '智谱' | '阿里云' | '火山引擎');
                        setCloneError("");
                        setGenerateError("");
                      }}
                      className="w-full h-12 rounded-2xl border border-slate-300 bg-white/50 px-4 py-2 text-sm focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                    >
                      <option value="智谱">智谱</option>
                      <option value="阿里云">阿里云</option>
                      <option value="火山引擎">火山引擎</option>
                    </select>
                  </div>
                  <div className="space-y-2 md:col-span-1">
                    <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{configInputLabel}</Label>
                    <Input
                      type={selectedPlatform === '火山引擎' ? 'text' : 'password'}
                      placeholder={configInputPlaceholder}
                      value={
                        selectedPlatform === '智谱'
                          ? zhipuApiKey
                          : selectedPlatform === '阿里云'
                            ? aliyunApiKey
                            : volcSpeakerId
                      }
                      onChange={(event) => {
                        if (selectedPlatform === '智谱') {
                          setZhipuApiKey(event.target.value);
                        } else if (selectedPlatform === '阿里云') {
                          setAliyunApiKey(event.target.value);
                        } else {
                          setVolcSpeakerId(event.target.value);
                        }
                      }}
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
            {cloneStatus === 'done' && selectedVoice && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 text-xs text-emerald-600 font-bold bg-emerald-50/60 backdrop-blur-sm p-3 rounded-xl border border-emerald-100/50"
              >
                <CheckCircle2 className="size-4" />
                声音克隆成功，当前音色为 {selectedVoice.name}。
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
                className="w-full h-40 rounded-[2rem] border border-slate-300 bg-white/50 p-6 text-base focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all resize-none"
                placeholder="请输入您想转换成语音的文本内容..."
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
              />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-500">
              {selectedVoice
                ? `当前使用音色：${selectedVoice.name} (${selectedVoice.providerLabel})`
                : "当前还没有可用音色，请先完成上方的声音克隆。"}
            </div>
            <div className="flex flex-col gap-4">
              <Button
                className="w-full h-14 rounded-2xl text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98]"
                disabled={!selectedVoice || generateStatus === 'generating' || !inputText.trim()}
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
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden relative">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: playingAudioId === audio.id ? '100%' : '40%' }}
                          className="absolute inset-y-0 left-0 bg-indigo-600"
                        />
                      </div>
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
                  voices.map((voice) => (
                    <div
                      key={voice.id}
                      className={cn(
                        "p-4 rounded-xl border transition-all group",
                        activeVoiceId === voice.id
                          ? "border-indigo-200 bg-indigo-50/20"
                          : "border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/10"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2 gap-4">
                        <div>
                          <div className="font-medium text-slate-900">{voice.name}</div>
                          <div className="text-[10px] text-slate-400 mt-1">{voice.providerLabel} · {voice.createdAt}</div>
                        </div>
                        {activeVoiceId === voice.id && (
                          <span className="text-[10px] font-bold text-indigo-600">当前使用</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => {
                            setActiveVoiceId(voice.id);
                            setSelectedPlatform(
                              voice.provider === 'zhipu'
                                ? '智谱'
                                : voice.provider === 'aliyun'
                                  ? '阿里云'
                                  : '火山引擎'
                            );
                            setIsMyVoicesOpen(false);
                          }}
                        >
                          使用此音色
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs text-red-500"
                          onClick={() => handleDeleteVoice(voice.id)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
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
