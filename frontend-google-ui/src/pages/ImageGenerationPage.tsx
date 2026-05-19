import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import {
  ArrowLeft,
  Loader2,
  Trash2,
  Download,
  AlertCircle,
  X,
  CheckCircle2,
  Clock,
  Wand2,
  ImageIcon,
  ImagePlus,
  Plus,
  PanelLeft,
  Send,
  Sparkles,
  History,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import SiteFooter from "@/src/components/SiteFooter";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";
import {
  type ImageTask,
  createImageTask,
  getImageTaskStatus,
  getImageTasks,
  deleteImageTask,
  getImageConfigStatus,
  replaceImageTaskSnapshot,
  saveImageTaskSnapshot,
} from "@/src/lib/image";

interface ImageGenerationPageProps {
  onBack: () => void;
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel') => void;
}

const SIZE_OPTIONS = [
  { value: '1:1', label: '1:1' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '2:1', label: '2:1' },
  { value: '1:2', label: '1:2' },
  { value: '21:9', label: '21:9' },
  { value: '9:21', label: '9:21' },
];

const RESOLUTION_OPTIONS = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
];

const MAX_REFERENCE_IMAGES = 16;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const LARGE_REFERENCE_IMAGE_BYTES = 4 * 1024 * 1024;
const TARGET_REFERENCE_IMAGE_BYTES = 2.5 * 1024 * 1024;
const MAX_REFERENCE_IMAGE_EDGE = 2048;
const REFERENCE_IMAGE_LIMIT_TEXT = '支持 JPG / PNG / WebP，模型单张上限小于 50MB，大图会自动压缩，最多 16 张';
const SUPPORTED_REFERENCE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const EXAMPLE_PROMPTS = [
  '一只橘猫坐在窗台上，水彩画风格，温暖的午后阳光',
  '赛博朋克风格的城市夜景，霓虹灯，雨夜，电影感',
  '一片樱花林中的古典中式庭院，春天，粉色调',
  '未来主义的太空站内部，巨大舷窗外是地球',
];

const STATUS_META: Record<string, { label: string; color: string; icon: typeof Loader2 }> = {
  submitted: { label: '已提交', color: 'text-slate-400', icon: Clock },
  processing: { label: '生成中', color: 'text-amber-500', icon: Loader2 },
  completed: { label: '已完成', color: 'text-emerald-500', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-red-500', icon: AlertCircle },
};

export default function ImageGenerationPage({ onBack, onNavigate }: ImageGenerationPageProps) {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1:1');
  const [resolution, setResolution] = useState('1k');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tasks, setTasks] = useState<ImageTask[]>([]);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [error, setError] = useState('');
  const [configStatus, setConfigStatus] = useState<{ reachable: boolean; gptImageApiKey: boolean } | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [isProcessingImages, setIsProcessingImages] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const pollingRefs = useRef<Map<number, number>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      const status = await getImageConfigStatus();
      if (!cancelled) setConfigStatus(status);
    }
    loadConfig();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    tasks.forEach((task) => {
      if (task.status !== 'completed' && task.status !== 'failed') {
        startPolling(task.id);
      }
    });

    return () => {
      pollingRefs.current.forEach((timerId) => clearInterval(timerId));
      pollingRefs.current.clear();
    };
  }, [tasks.map((t) => `${t.id}-${t.status}`).join(',')]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [tasks.length]);


  async function loadTasks() {
    setIsLoadingTasks(true);
    try {
      const data = await getImageTasks({ limit: 100, offset: 0 });
      setTasks(data.tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载任务列表失败');
    } finally {
      setIsLoadingTasks(false);
    }
  }

  function startPolling(taskId: number) {
    if (taskId < 0) return; // skip optimistic tasks
    if (pollingRefs.current.has(taskId)) return;

    const timerId = window.setInterval(async () => {
      try {
        const task = await getImageTaskStatus(taskId);
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            // Preserve reference_images from optimistic update if backend returns empty
            const mergedRefImages = t.reference_images?.length > 0 && (!task.reference_images || task.reference_images.length === 0)
              ? t.reference_images
              : task.reference_images;
            return { ...task, reference_images: mergedRefImages };
          })
        );
        if (task.status === 'completed' || task.status === 'failed') {
          const tid = pollingRefs.current.get(taskId);
          if (tid) {
            clearInterval(tid);
            pollingRefs.current.delete(taskId);
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000);

    pollingRefs.current.set(taskId, timerId);
  }

  function readFileAsDataUrl(file: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function loadImageFromObjectUrl(url: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('图片解析失败'));
      image.src = url;
    });
  }

  async function compressReferenceImage(file: File) {
    if (file.size <= LARGE_REFERENCE_IMAGE_BYTES) {
      return readFileAsDataUrl(file);
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImageFromObjectUrl(objectUrl);
      const scale = Math.min(1, MAX_REFERENCE_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        return readFileAsDataUrl(file);
      }
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      const mimeType = 'image/jpeg';
      let quality = 0.88;
      let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
      while (blob && blob.size > TARGET_REFERENCE_IMAGE_BYTES && quality > 0.62) {
        quality -= 0.08;
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
      }
      return readFileAsDataUrl(blob || file);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files) return;

    setError('');

    const remainingSlots = MAX_REFERENCE_IMAGES - referenceImages.length;
    if (remainingSlots <= 0) {
      setError(`参考图最多上传 ${MAX_REFERENCE_IMAGES} 张`);
      event.target.value = '';
      return;
    }

    const selectedFiles = Array.from(files as Iterable<File>);
    const rejectedMessages: string[] = [];
    const toProcess = selectedFiles
      .slice(0, remainingSlots)
      .filter((file) => {
        if (!SUPPORTED_REFERENCE_IMAGE_TYPES.has(file.type)) {
          rejectedMessages.push(`${file.name} 格式不支持`);
          return false;
        }
        if (file.size >= MAX_REFERENCE_IMAGE_BYTES) {
          rejectedMessages.push(`${file.name} 超过 50MB`);
          return false;
        }
        return true;
      });

    if (selectedFiles.length > remainingSlots) {
      rejectedMessages.push(`已达到 ${MAX_REFERENCE_IMAGES} 张上限，多余图片未添加`);
    }

    setIsProcessingImages(true);
    try {
      const processedImages: string[] = [];
      for (const file of toProcess) {
        processedImages.push(await compressReferenceImage(file));
      }
      if (processedImages.length > 0) {
        setReferenceImages((prev) => [...prev, ...processedImages]);
      }
      const processedLargeImage = toProcess.some((file) => file.size > LARGE_REFERENCE_IMAGE_BYTES);
      if (processedLargeImage) {
        rejectedMessages.push('大图已自动压缩后用于参考');
      }
      if (rejectedMessages.length > 0) {
        setError(rejectedMessages.slice(0, 3).join('；'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '图片处理失败');
    } finally {
      setIsProcessingImages(false);
      event.target.value = '';
    }
  }

  function removeReferenceImage(index: number) {
    setReferenceImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed || isSubmitting || isProcessingImages) return;

    // Capture current input state before clearing
    const currentPrompt = trimmed;
    const currentSize = size;
    const currentResolution = resolution;
    const currentRefImages = [...referenceImages];

    // Optimistic task: immediately show in chat
    const optimisticId = -Date.now();
    const optimisticTask: ImageTask = {
      id: optimisticId,
      prompt: currentPrompt,
      size: currentSize,
      resolution: currentResolution,
      status: 'submitted',
      external_task_id: '',
      result_urls: [],
      reference_images: currentRefImages,
      error_message: '',
      created_at: Math.floor(Date.now() / 1000),
      completed_at: null,
    };
    saveImageTaskSnapshot(optimisticTask);

    // Clear input immediately
    setPrompt('');
    setReferenceImages([]);
    setError('');
    setIsSubmitting(true);
    setTasks((prev) => [optimisticTask, ...prev]);

    try {
      const task = await createImageTask(
        currentPrompt,
        currentSize,
        currentResolution,
        currentRefImages.length > 0 ? currentRefImages : undefined,
        optimisticId
      );

      // Replace optimistic task with real task, preserve reference_images if backend returns empty
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== optimisticId) return t;
          const mergedRefImages = t.reference_images?.length > 0 && (!task.reference_images || task.reference_images.length === 0)
            ? t.reference_images
            : task.reference_images;
          return { ...task, reference_images: mergedRefImages };
        })
      );
      startPolling(task.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : '创建任务失败';
      const failedTask: ImageTask = { ...optimisticTask, status: 'failed', error_message: message };
      replaceImageTaskSnapshot(optimisticId, failedTask);
      // Mark optimistic task as failed
      setTasks((prev) =>
        prev.map((t) =>
          t.id === optimisticId
            ? failedTask
            : t
        )
      );
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete(id: number, e?: MouseEvent<HTMLButtonElement>) {
    e?.stopPropagation();
    if (!confirm('确定要删除这个任务吗？')) return;
    const tid = pollingRefs.current.get(id);
    if (tid) {
      clearInterval(tid);
      pollingRefs.current.delete(id);
    }
    try {
      await deleteImageTask(id);
      await loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  }

  async function handleDownload(url: string) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `generated-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // fallback: open in new tab
      window.open(url, '_blank');
    }
  }

  function formatTime(timestamp: number | null) {
    if (!timestamp) return '-';
    return new Date(timestamp * 1000).toLocaleString('zh-CN');
  }

  function truncate(str: string, len: number) {
    return str.length > len ? str.slice(0, len) + '...' : str;
  }

  // ---- Render helpers ----

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Sidebar Header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <button
          onClick={() => {
            setPrompt('');
            setReferenceImages([]);
            scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
          <Plus className="size-3.5" />
          新建生成
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          历史记录
        </div>
        {isLoadingTasks ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-4 animate-spin text-slate-400" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-slate-400">暂无记录</div>
        ) : (
          <div className="space-y-0.5">
            {tasks.map((task) => {
              const meta = STATUS_META[task.status] || STATUS_META.submitted;
              const StatusIcon = meta.icon;
              return (
                <button
                  key={task.id}
                  onClick={() => {
                    const el = document.getElementById(`task-${task.id}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                  className={cn(
                    'group flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors text-slate-600 hover:bg-slate-100'
                  )}
                >
                  <StatusIcon className={cn('mt-0.5 size-3 shrink-0', meta.color, task.status === 'processing' && 'animate-spin')} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium leading-tight">{truncate(task.prompt, 40)}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={cn('text-[10px]', meta.color)}>{meta.label}</span>
                      <span className="text-[10px] text-slate-400">{task.size}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(task.id, e)}
                    className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const welcomeScreen = (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="mb-8 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg">
        <Sparkles className="size-8" />
      </div>
      <h2 className="mb-2 text-2xl font-bold text-slate-900">图片生成</h2>
      <p className="mb-8 text-sm text-slate-500">用文字描述，AI 为你创造画面</p>

      <div className="mb-8 grid w-full max-w-xl gap-3 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((p, i) => (
          <button
            key={i}
            onClick={() => {
              setPrompt(p);
              textareaRef.current?.focus();
            }}
            className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-600 shadow-sm transition-all hover:border-amber-300 hover:shadow-md"
          >
            {truncate(p, 36)}
          </button>
        ))}
      </div>
    </div>
  );

  function renderTaskMessage(task: ImageTask) {
    const meta = STATUS_META[task.status] || STATUS_META.submitted;
    const StatusIcon = meta.icon;
    return (
      <div key={task.id} id={`task-${task.id}`} className="flex flex-col gap-6 py-4">
        {/* User Prompt Bubble */}
        <div className="flex justify-end">
          <div className="max-w-[85%] sm:max-w-[70%]">
            <div className="rounded-2xl rounded-tr-sm bg-slate-900 px-5 py-3.5 text-sm leading-relaxed text-white shadow-sm">
              <p>{task.prompt}</p>
              {task.reference_images && task.reference_images.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {task.reference_images.map((img, idx) => (
                    <img
                      key={idx}
                      src={img}
                      alt=""
                      className="h-16 w-16 rounded-lg object-cover border border-white/20"
                      onClick={() => setPreviewUrl(img)}
                    />
                  ))}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px]">{task.size}</span>
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px]">{task.resolution}</span>
              </div>
            </div>
            <p className="mt-1.5 px-1 text-right text-[10px] text-slate-400">
              {formatTime(task.created_at)}
            </p>
          </div>
        </div>

        {/* AI Response */}
        <div className="flex justify-start">
          <div className="max-w-[90%] sm:max-w-[75%]">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                <Sparkles className="size-3.5" />
              </div>
              <span className="text-xs font-semibold text-slate-700">GPT Image-2</span>
              <span className={cn('text-[10px] font-medium', meta.color)}>
                <StatusIcon className={cn('mr-0.5 inline size-3', task.status === 'processing' && 'animate-spin')} />
                {meta.label}
              </span>
            </div>

            {/* Result Content */}
            {task.status === 'completed' && task.result_urls.length > 0 ? (
              <div className="space-y-3">
                <div className={cn(
                  'grid gap-3',
                  task.result_urls.length === 1 ? 'grid-cols-1 max-w-md' :
                  task.result_urls.length === 2 ? 'grid-cols-2 max-w-lg' :
                  'grid-cols-2 sm:grid-cols-3'
                )}>
                  {task.result_urls.map((url, idx) => (
                    <div
                      key={idx}
                      className="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm"
                      style={{ aspectRatio: task.size.replace(':', '/') }}
                    >
                      <img
                        src={url}
                        alt={`生成结果 ${idx + 1}`}
                        className="h-full w-full cursor-zoom-in object-cover"
                        loading="lazy"
                        onClick={() => setPreviewUrl(url)}
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(url); }}
                          className="flex h-9 w-9 scale-75 items-center justify-center rounded-full bg-white text-slate-700 opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100"
                        >
                          <Download className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                  <span>{task.size} · {task.resolution}</span>
                  {task.completed_at && (
                    <span>完成于 {formatTime(task.completed_at)}</span>
                  )}
                </div>
              </div>
            ) : task.status === 'processing' ? (
              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-5 py-3">
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="size-3 rounded-full bg-gradient-to-br from-amber-500 to-orange-600"
                      animate={{
                        scale: [1, 1.6, 1],
                        opacity: [0.4, 1, 0.4],
                      }}
                      transition={{
                        duration: 1.2,
                        repeat: Infinity,
                        delay: i * 0.2,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm font-bold text-slate-500">图片生成中，约需 30-60 秒</span>
              </div>
            ) : task.status === 'failed' ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm text-red-600">{task.error_message || '生成失败'}</p>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-5 py-3">
                <div className="flex items-center gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      className="size-3 rounded-full bg-gradient-to-br from-amber-500 to-orange-600"
                      animate={{
                        scale: [1, 1.6, 1],
                        opacity: [0.4, 1, 0.4],
                      }}
                      transition={{
                        duration: 1.2,
                        repeat: Infinity,
                        delay: i * 0.2,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}
                </div>
                <span className="text-sm font-bold text-slate-500">等待处理...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const inputArea = (
    <div className="border-t border-slate-200 bg-white px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600"
          >
            <AlertCircle className="size-3.5" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError('')} className="rounded p-0.5 hover:bg-red-100">
              <X className="size-3" />
            </button>
          </motion.div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">比例</Label>
            <div className="flex gap-1">
              {SIZE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setSize(opt.value)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    size === opt.value
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">分辨率</Label>
            <div className="flex gap-1">
              {RESOLUTION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setResolution(opt.value)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                    resolution === opt.value
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reference Images */}
          {referenceImages.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">参考图</Label>
              <div className="flex gap-1">
                {referenceImages.map((img, idx) => (
                  <div key={idx} className="group relative size-8 overflow-hidden rounded-md border border-slate-200">
                    <img src={img} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() => removeReferenceImage(idx)}
                      className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
                {referenceImages.length < MAX_REFERENCE_IMAGES && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex size-8 items-center justify-center rounded-md border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600"
                  >
                    <Plus className="size-3" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="relative flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-amber-300">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="描述你想生成的图片..."
            rows={3}
            className="min-h-[60px] max-h-32 flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-sm leading-5 text-slate-700 outline-none placeholder:text-slate-400"
          />
          <div className="flex items-center gap-1 pb-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              title="上传参考图"
            >
              {isProcessingImages ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || isProcessingImages || !prompt.trim()}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                isSubmitting || isProcessingImages || !prompt.trim()
                  ? 'bg-slate-100 text-slate-400'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              )}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          按 Enter 发送，Shift + Enter 换行 · {REFERENCE_IMAGE_LIMIT_TEXT}
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
    </div>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* Top Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2.5 h-9 rounded-full pl-1 pr-4 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300 group"
          >
            <div className="size-7 rounded-full bg-slate-900 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
              <ArrowLeft className="size-3.5" />
            </div>
            <span className="text-xs font-bold text-slate-700">返回</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors sm:hidden',
              showSidebar ? 'bg-amber-100 text-amber-600' : 'text-slate-500 hover:bg-slate-100'
            )}
          >
            <History className="size-4" />
          </button>
          <div className="hidden sm:flex">
            <ModuleQuickNav current="image" onNavigate={onNavigate} />
          </div>
        </div>
      </header>

      {/* Config Warning */}
      {configStatus && !configStatus.gptImageApiKey && (
        <div className="shrink-0 flex items-center gap-2 bg-amber-50 px-4 py-2 text-xs text-amber-700">
          <AlertCircle className="size-3.5" />
          未配置 GPT_IMAGE_API_KEY，请在服务端 .env 中设置
        </div>
      )}

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <AnimatePresence>
          {showSidebar && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="shrink-0 overflow-hidden border-r border-slate-200 bg-slate-50/50"
            >
              <div className="w-[260px]">
                {sidebarContent}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <main className="flex flex-1 flex-col overflow-hidden bg-white">
          {/* Scrollable Area */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4">
              {tasks.length === 0 ? welcomeScreen : (
                <div className="flex flex-col">
                  {[...tasks].reverse().map((task) => renderTaskMessage(task))}
                </div>
              )}
            </div>
          </div>

          {/* Bottom Input */}
          {inputArea}
        </main>
      </div>

      {/* Image Preview Lightbox */}
      <AnimatePresence>
        {previewUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
            onClick={() => setPreviewUrl(null)}
          >
            <motion.img
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              src={previewUrl}
              alt="预览"
              className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="absolute right-4 top-4 flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleDownload(previewUrl); }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <Download className="size-5" />
              </button>
              <button
                onClick={() => setPreviewUrl(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <X className="size-5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
