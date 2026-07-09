import { memo, useEffect, useRef, useState, type KeyboardEvent, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  Crown,
  Send,
  Loader2,
  User,
  Trash2,
  Plus,
  History,
  ChevronDown,
  Image as ImageIcon,
  Video,
  X,
  Sparkles,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

function AnthropicLogo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="currentColor" className={className}>
      <ellipse cx="50" cy="18" rx="5.5" ry="16" transform="rotate(0 50 50)" />
      <ellipse cx="50" cy="18" rx="5.5" ry="16" transform="rotate(51.4 50 50)" />
      <ellipse cx="50" cy="18" rx="5.5" ry="16" transform="rotate(102.8 50 50)" />
      <ellipse cx="50" cy="18" rx="5.5" ry="16" transform="rotate(154.2 50 50)" />
      <ellipse cx="50" cy="18" rx="5.5" ry="16" transform="rotate(205.6 50 50)" />
      <ellipse cx="50" cy="18" rx="5.5" ry="16" transform="rotate(257 50 50)" />
      <ellipse cx="50" cy="18" rx="5.5" ry="16" transform="rotate(308.4 50 50)" />
    </svg>
  );
}

function DoubaoLogo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z" />
    </svg>
  );
}
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import { cn } from "@/src/lib/utils";
import { streamChatCompletion, type ChatMessage, AVAILABLE_MODELS } from "@/src/lib/topmodel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TopModelPageProps {
  onBack: () => void;
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel' | 'feeding') => void;
}

const STORAGE_KEY = 'topmodel_chat_history';
const MODEL_STORAGE_KEY = 'topmodel_selected_model';
const CONVERSATIONS_KEY = 'topmodel_conversations';
const ACTIVE_CONV_KEY = 'topmodel_active_conversation';
const MODEL_PROMPT_DATE_KEY = 'topmodel_model_prompt_date';
const DOUBAO_THINKING_KEY = 'topmodel_doubao_thinking_enabled';

function getTodayStr() {
  return new Date().toLocaleDateString('zh-CN');
}

function shouldAutoPromptModel() {
  try {
    return localStorage.getItem(MODEL_PROMPT_DATE_KEY) !== getTodayStr();
  } catch {
    return true;
  }
}

function markModelPrompted() {
  try {
    localStorage.setItem(MODEL_PROMPT_DATE_KEY, getTodayStr());
  } catch {
    // ignore
  }
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

type ConversationsMap = Record<string, Conversation[]>;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadConversations(): ConversationsMap {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const MAX_CONVERSATIONS_PER_MODEL = 30;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const LOCAL_STORAGE_SIZE_LIMIT = 4.5 * 1024 * 1024; // 4.5MB safety limit
const MAX_IMAGE_UPLOAD_BYTES = 50 * 1024 * 1024;
const LARGE_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024;
const TARGET_IMAGE_BYTES = 2.5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2048;
const MAX_VIDEO_SIZE_MB = 8;
const MEDIA_LIMIT_TEXT = '图片小于 50MB，大图自动压缩；视频小于 8MB';
const STREAM_RENDER_THROTTLE_MS = 90;
const DOUBAO_MODEL_ID = 'doubao-seed-2-1-pro-260628';
const QWEN_MODEL_ID = 'qwen3.7-plus';
const OPENAI_MODEL_ID = 'gpt-5';

function getModelTone(modelId: string) {
  if (modelId === DOUBAO_MODEL_ID) {
    return {
      text: 'text-blue-500',
      activeBg: 'bg-blue-100 text-blue-700',
      selectedText: 'font-bold text-blue-600',
      gradient: 'bg-gradient-to-br from-blue-500 to-cyan-500',
      hoverBorder: 'hover:border-blue-300',
    };
  }
  if (modelId === OPENAI_MODEL_ID) {
    return {
      text: 'text-emerald-500',
      activeBg: 'bg-emerald-100 text-emerald-700',
      selectedText: 'font-bold text-emerald-600',
      gradient: 'bg-gradient-to-br from-emerald-500 to-teal-500',
      hoverBorder: 'hover:border-emerald-300',
    };
  }
  return {
    text: 'text-fuchsia-500',
    activeBg: 'bg-fuchsia-100 text-fuchsia-700',
    selectedText: 'font-bold text-fuchsia-600',
    gradient: 'bg-gradient-to-br from-fuchsia-500 to-purple-600',
    hoverBorder: 'hover:border-fuchsia-300',
  };
}

function ModelLogo({ modelId, className }: { modelId: string; className?: string }) {
  if (modelId === DOUBAO_MODEL_ID) return <DoubaoLogo className={className} />;
  if (modelId === OPENAI_MODEL_ID) return <Sparkles className={className} />;
  return <AnthropicLogo className={className} />;
}

function estimateSize(str: string): number {
  // UTF-8 approximate byte count
  let size = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) size += 1;
    else if (code <= 0x7ff) size += 2;
    else size += 3;
  }
  return size;
}

function trimConversations(map: ConversationsMap): ConversationsMap {
  const trimmed: ConversationsMap = {};
  for (const [model, convs] of Object.entries(map)) {
    // Sort by updatedAt desc, keep most recent MAX_CONVERSATIONS_PER_MODEL
    const sorted = [...convs].sort((a, b) => b.updatedAt - a.updatedAt);
    const kept = sorted.slice(0, MAX_CONVERSATIONS_PER_MODEL).map((conv) => {
      if (conv.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
        // Keep first message (usually system/user context) and last N-1 messages
        return {
          ...conv,
          messages: conv.messages.slice(0, 1).concat(
            conv.messages.slice(-(MAX_MESSAGES_PER_CONVERSATION - 1))
          ),
        };
      }
      return conv;
    });
    // Restore original order (by createdAt asc) for display
    trimmed[model] = kept.sort((a, b) => a.createdAt - b.createdAt);
  }
  return trimmed;
}

function compactConversationMedia(map: ConversationsMap, options: { stripVideos?: boolean; stripImages?: boolean } = {}): ConversationsMap {
  const compacted: ConversationsMap = {};
  for (const [model, convs] of Object.entries(map)) {
    compacted[model] = convs.map((conv) => ({
      ...conv,
      messages: conv.messages.map((message) => ({
        ...message,
        images: options.stripImages ? message.images?.filter((image) => !image.startsWith('data:')) : message.images,
        videos: options.stripVideos ? message.videos?.filter((video) => !video.startsWith('data:')) : message.videos,
      })),
    }));
  }
  return compacted;
}

function saveConversations(map: ConversationsMap) {
  try {
    let trimmed = trimConversations(map);
    let json = JSON.stringify(trimmed);
    // If still too large, progressively trim more aggressively
    while (estimateSize(json) > LOCAL_STORAGE_SIZE_LIMIT) {
      const previousJson = json;
      const allConvs = Object.values(trimmed).flat();
      if (allConvs.length === 0) break;
      // Find model with most conversations and remove oldest one
      let maxModel = '';
      let maxCount = 0;
      for (const [model, convs] of Object.entries(trimmed)) {
        if (convs.length > maxCount) {
          maxCount = convs.length;
          maxModel = model;
        }
      }
      if (maxModel && trimmed[maxModel].length > 1) {
        const sorted = [...trimmed[maxModel]].sort((a, b) => b.updatedAt - a.updatedAt);
        trimmed = {
          ...trimmed,
          [maxModel]: sorted.slice(0, -1).sort((a, b) => a.createdAt - b.createdAt),
        };
      } else if (maxModel && trimmed[maxModel].length === 1) {
        // Only one conversation left, trim its messages
        const conv = trimmed[maxModel][0];
        const half = Math.max(10, Math.floor(conv.messages.length / 2));
        trimmed = {
          ...trimmed,
          [maxModel]: [{
            ...conv,
            messages: conv.messages.slice(0, 1).concat(conv.messages.slice(-half)),
          }],
        };
      } else {
        break;
      }
      json = JSON.stringify(trimmed);
      if (json === previousJson) break;
    }
    localStorage.setItem(CONVERSATIONS_KEY, json);
  } catch (err) {
    try {
      const withoutVideos = compactConversationMedia(trimConversations(map), { stripVideos: true });
      const json = JSON.stringify(withoutVideos);
      if (estimateSize(json) <= LOCAL_STORAGE_SIZE_LIMIT) {
        localStorage.setItem(CONVERSATIONS_KEY, json);
        return;
      }
      const textOnly = compactConversationMedia(withoutVideos, { stripImages: true, stripVideos: true });
      localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(textOnly));
    } catch (fallbackError) {
      console.error('[TopModel] Failed to save conversations:', err, fallbackError);
    }
  }
}

function loadActiveConversationId(model: string): string | null {
  try {
    const raw = localStorage.getItem(ACTIVE_CONV_KEY);
    const map = raw ? JSON.parse(raw) : {};
    return map[model] || null;
  } catch {
    return null;
  }
}

function saveActiveConversationId(model: string, id: string | null) {
  try {
    const raw = localStorage.getItem(ACTIVE_CONV_KEY);
    const map = raw ? JSON.parse(raw) : {};
    if (id) {
      map[model] = id;
    } else {
      delete map[model];
    }
    localStorage.setItem(ACTIVE_CONV_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function createConversation(model: string): Conversation {
  const now = Date.now();
  return {
    id: generateId(),
    title: '新对话',
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
}

function loadModel(): string {
  try {
    const savedModel = localStorage.getItem(MODEL_STORAGE_KEY);
    if (savedModel === 'claude-opus-4-8') return 'claude-fable-5';
    if (savedModel === 'claude-opus-4-7') return 'claude-fable-5';
    if (savedModel === 'doubao-seed-2-0-pro-260215') return DOUBAO_MODEL_ID;
    if (savedModel === 'qwen3.6-plus') return QWEN_MODEL_ID;
    return savedModel || 'claude-fable-5';
  } catch {
    return 'claude-fable-5';
  }
}

function saveModel(model: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
  } catch {
    // ignore
  }
}

function loadDoubaoThinkingEnabled(): boolean {
  try {
    return localStorage.getItem(DOUBAO_THINKING_KEY) !== 'false';
  } catch {
    return true;
  }
}

function saveDoubaoThinkingEnabled(enabled: boolean) {
  try {
    localStorage.setItem(DOUBAO_THINKING_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

function getConversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (firstUser) {
    const text = firstUser.content.trim();
    if (text) {
      return text.length > 20 ? text.slice(0, 20) + '...' : text;
    }
  }
  return '新对话';
}

function migrateOldHistory(conversations: ConversationsMap, model: string): ConversationsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return conversations;
    const messages: ChatMessage[] = JSON.parse(raw);
    if (messages.length === 0) return conversations;
    const conv = createConversation(model);
    conv.messages = messages;
    conv.title = getConversationTitle(messages);
    conv.updatedAt = Date.now();
    const updated = { ...conversations };
    updated[model] = [...(updated[model] || []), conv];
    localStorage.removeItem(STORAGE_KEY);
    return updated;
  } catch {
    return conversations;
  }
}

function normalizeMarkdown(text: string): string {
  if (!text) return text;
  // Protect valid bold markers first: **text** → placeholder
  let result = text.replace(/\*\*([^*]+?)\*\*/g, 'B$1B');
  // Remove remaining stray ** and *
  result = result.replace(/\*\*/g, '');
  // Restore valid bold markers
  result = result.replace(/B/g, '**');
  return (
    result
      // Fix headings: ###Title → ### Title (after whitespace/punctuation or start)
      .replace(/([\s:：,，;；]|^)(#{1,6})([^#\s])/g, '$1$2 $3')
      // Fix ordered lists: 1.Content → 1. Content (single digit only, to avoid dates/percentages)
      .replace(/([^\d.])(\d)\.([^\s\d.])/g, '$1$2. $3')
      // Fix unordered lists: -Content → - Content
      .replace(/([\s]|^)([-*+])([^\s\n])/g, '$1$2 $3')
      // Fix strikethrough: 25~32℃ → 25-32℃ (numbers with tilde are ranges, not strikethrough)
      .replace(/(\d)~+(\d)/g, '$1-$2')
      // Remove spurious italics: *text* → text (but preserve **bold** and * list)
      .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, '$1')
  );
}

const WELCOME_SUGGESTIONS = [
  '用一句话解释量子计算',
  '帮我写一段 Python 快速排序代码',
  '分析一下当前 AI 行业的发展趋势',
  '给我讲一个关于程序员笑话',
];

const AssistantMarkdownMessage = memo(function AssistantMarkdownMessage({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => (
          <div className="overflow-x-auto rounded-lg border border-slate-200 my-3">
            <table className="w-full text-xs border-collapse">{children}</table>
          </div>
        ),
        p: ({ children }) => (
          <p className="mb-3 last:mb-0">{children}</p>
        ),
        li: ({ children }) => (
          <li className="mb-1">{children}</li>
        ),
        h1: ({ children }) => (
          <h1 className="text-lg font-bold mt-4 mb-2">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-bold mt-3 mb-2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-bold mt-3 mb-1.5">{children}</h3>
        ),
        hr: () => (
          <hr className="my-4 border-slate-200" />
        ),
      }}
    >
      {normalizeMarkdown(content)}
    </ReactMarkdown>
  );
});

function AssistantReasoningBlock({ content, isStreaming }: { content?: string; isStreaming?: boolean }) {
  if (!content) return null;
  return (
    <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-xs leading-5 text-blue-700">
      <div className="mb-1 flex items-center gap-1.5 font-bold text-blue-600">
        <Sparkles className={cn('size-3.5', isStreaming && 'animate-pulse')} />
        <span>思考中</span>
      </div>
      <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-blue-700/85">
        {content}
      </div>
    </div>
  );
}

export default function TopModelPage({ onBack, onNavigate }: TopModelPageProps) {
  const initialModel = loadModel();
  const [conversations, setConversations] = useState<ConversationsMap>(() => {
    const map = loadConversations();
    return migrateOldHistory(map, initialModel);
  });
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => loadActiveConversationId(initialModel));
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedVideos, setSelectedVideos] = useState<string[]>([]);
  const [isProcessingMedia, setIsProcessingMedia] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [doubaoThinkingEnabled, setDoubaoThinkingEnabled] = useState(loadDoubaoThinkingEnabled);
  const [streamingAssistant, setStreamingAssistant] = useState<{ model: string; convId: string; index: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const conversationsRef = useRef(conversations);
  const selectedModelRef = useRef(selectedModel);
  const activeConversationIdRef = useRef(activeConversationId);

  const currentModel = AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];
  const modelTone = getModelTone(selectedModel);
  const modelConversations = conversations[selectedModel] || [];
  const activeConversation = modelConversations.find((c) => c.id === activeConversationId) || null;
  const messages = activeConversation?.messages || [];

  function ensureActiveConversation(model: string, currentMap: ConversationsMap): { map: ConversationsMap; convId: string } {
    const modelConvs = currentMap[model] || [];
    const existingId = loadActiveConversationId(model);
    const existing = existingId ? modelConvs.find((c) => c.id === existingId) : undefined;
    if (existing) {
      return { map: currentMap, convId: existing.id };
    }
    if (modelConvs.length > 0) {
      const id = modelConvs[modelConvs.length - 1].id;
      saveActiveConversationId(model, id);
      return { map: currentMap, convId: id };
    }
    const newConv = createConversation(model);
    const nextMap = { ...currentMap, [model]: [newConv] };
    saveActiveConversationId(model, newConv.id);
    return { map: nextMap, convId: newConv.id };
  }

  useEffect(() => {
    const { map, convId } = ensureActiveConversation(selectedModel, conversations);
    if (convId !== activeConversationId) {
      setConversations(map);
      setActiveConversationId(convId);
      activeConversationIdRef.current = convId;
      persistConversationsSnapshot(map, selectedModel, convId);
    }
  }, [selectedModel]);

  useEffect(() => {
    saveModel(selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    saveDoubaoThinkingEnabled(doubaoThinkingEnabled);
  }, [doubaoThinkingEnabled]);

  // Save before page unload to prevent data loss
  useEffect(() => {
    function saveLatestSnapshot() {
      saveConversations(conversationsRef.current);
      saveActiveConversationId(selectedModelRef.current, activeConversationIdRef.current);
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        saveLatestSnapshot();
      }
    }
    window.addEventListener('beforeunload', saveLatestSnapshot);
    window.addEventListener('pagehide', saveLatestSnapshot);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      saveLatestSnapshot();
      window.removeEventListener('beforeunload', saveLatestSnapshot);
      window.removeEventListener('pagehide', saveLatestSnapshot);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(84, el.scrollHeight)}px`;
  }, [input]);

  useEffect(() => {
    function handleClickOutside(e: globalThis.MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setShowModelMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-expand model selector on first visit each day
  useEffect(() => {
    if (shouldAutoPromptModel()) {
      setShowModelMenu(true);
      markModelPrompted();
    }
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, messages[messages.length - 1]?.content]);

  const supportsMultimodal = currentModel.supportsMultimodal ?? false;

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  function persistConversationsSnapshot(nextMap: ConversationsMap, model = selectedModelRef.current, convId = activeConversationIdRef.current) {
    conversationsRef.current = nextMap;
    saveConversations(nextMap);
    saveActiveConversationId(model, convId);
  }

  function readFileAsDataUrl(file: Blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('文件读取失败'));
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

  async function prepareImageForUpload(file: File) {
    if (file.size <= LARGE_IMAGE_UPLOAD_BYTES) {
      return readFileAsDataUrl(file);
    }

    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImageFromObjectUrl(objectUrl);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
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

      let quality = 0.88;
      let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      while (blob && blob.size > TARGET_IMAGE_BYTES && quality > 0.62) {
        quality -= 0.08;
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      }
      return readFileAsDataUrl(blob || file);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function handleImageSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const warnings: string[] = [];
    setIsProcessingMedia(true);
    try {
      const nextImages: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          warnings.push(`${file.name} 不是图片`);
          continue;
        }
        if (file.size >= MAX_IMAGE_UPLOAD_BYTES) {
          warnings.push(`${file.name} 超过 50MB`);
          continue;
        }
        nextImages.push(await prepareImageForUpload(file));
        if (file.size > LARGE_IMAGE_UPLOAD_BYTES) {
          warnings.push(`${file.name} 已自动压缩`);
        }
      }
      if (nextImages.length > 0) {
        setSelectedImages((prev) => [...prev, ...nextImages]);
      }
      if (warnings.length > 0) {
        setError(warnings.slice(0, 3).join('；'));
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : '图片处理失败');
    } finally {
      setIsProcessingMedia(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  }

  function handleVideoSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file: File) => {
      if (!file.type.startsWith('video/')) return;
      if (file.size > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
        setError(`视频过大：${(file.size / 1024 / 1024).toFixed(1)}MB，超过 ${MAX_VIDEO_SIZE_MB}MB 限制。请压缩后重试，或使用公网视频链接。`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setSelectedVideos((prev) => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });
    if (videoInputRef.current) videoInputRef.current.value = '';
  }

  function handleRemoveImage(index: number) {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }

  function handleRemoveVideo(index: number) {
    setSelectedVideos((prev) => prev.filter((_, i) => i !== index));
  }

  function updateActiveMessages(
    updater: (prev: ChatMessage[]) => ChatMessage[],
    targetModel = selectedModelRef.current,
    targetConvId = activeConversationIdRef.current,
    options: { persist?: boolean } = {}
  ) {
    const model = targetModel;
    const convId = targetConvId;
    if (!convId) return;

    const prevMap = conversationsRef.current;
    const modelConvs = [...(prevMap[model] || [])];
    const idx = modelConvs.findIndex((c) => c.id === convId);
    if (idx === -1) return;

    const updatedMsgs = updater(modelConvs[idx].messages);
    modelConvs[idx] = {
      ...modelConvs[idx],
      messages: updatedMsgs,
      updatedAt: Date.now(),
      title: modelConvs[idx].title === '新对话' && updatedMsgs.length > 0
        ? getConversationTitle(updatedMsgs)
        : modelConvs[idx].title,
    };
    const nextMap = { ...prevMap, [model]: modelConvs };
    conversationsRef.current = nextMap;
    if (options.persist !== false) {
      persistConversationsSnapshot(nextMap, model, convId);
    }
    setConversations(nextMap);
  }

  async function handleSubmit() {
    const trimmed = input.trim();
    if ((!trimmed && selectedImages.length === 0 && selectedVideos.length === 0) || isLoading || isProcessingMedia) return;

    const requestModel = selectedModelRef.current;
    const requestConvId = activeConversationIdRef.current;
    if (!requestConvId) return;
    const requestConvs = conversationsRef.current[requestModel] || [];
    const requestConversation = requestConvs.find((conv) => conv.id === requestConvId);
    const requestMessages = requestConversation?.messages || messages;

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      images: selectedImages.length > 0 ? selectedImages : undefined,
      videos: selectedVideos.length > 0 ? selectedVideos : undefined,
    };
    const newMessages = [...requestMessages, userMsg];
    updateActiveMessages(() => newMessages, requestModel, requestConvId);
    setInput('');
    setSelectedImages([]);
    setSelectedVideos([]);
    setError('');
    setIsLoading(true);

    let hasAddedAssistant = false;
    let assistantContent = '';
    let assistantReasoningContent = '';
    let lastAssistantFlushAt = 0;
    const assistantIndex = newMessages.length;
    const requestDoubaoThinkingEnabled = doubaoThinkingEnabled;

    const flushAssistantContent = (persist = false) => {
      updateActiveMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        if (last.content === assistantContent && last.reasoningContent === assistantReasoningContent) return prev;
        return [
          ...prev.slice(0, -1),
          { ...last, content: assistantContent, reasoningContent: assistantReasoningContent || undefined },
        ];
      }, requestModel, requestConvId, { persist });
    };

    try {
      const options: { model: string; tools?: Array<{ type: string }>; thinkingEnabled?: boolean } = { model: requestModel };
      if (requestModel === DOUBAO_MODEL_ID || requestModel === QWEN_MODEL_ID) {
        options.tools = [{ type: 'web_search' }];
      }
      if (requestModel === DOUBAO_MODEL_ID) {
        options.thinkingEnabled = requestDoubaoThinkingEnabled;
      }
      for await (const chunk of streamChatCompletion(newMessages, options)) {
        if (!hasAddedAssistant) {
          hasAddedAssistant = true;
          setStreamingAssistant({ model: requestModel, convId: requestConvId, index: assistantIndex });
          flushSync(() => {
            updateActiveMessages(
              (prev) => [...prev, { role: 'assistant', content: '' }],
              requestModel,
              requestConvId,
              { persist: false }
            );
          });
        }
        if (chunk.reasoningContent) {
          assistantReasoningContent += chunk.reasoningContent;
        }
        if (chunk.content) {
          assistantContent += chunk.content;
        }
        const now = Date.now();
        if (now - lastAssistantFlushAt >= STREAM_RENDER_THROTTLE_MS) {
          lastAssistantFlushAt = now;
          flushAssistantContent(false);
        }
      }
      if (hasAddedAssistant) {
        flushAssistantContent(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
      if (hasAddedAssistant) {
        flushAssistantContent(true);
      } else {
        updateActiveMessages(
          (prev) => [...prev, { role: 'assistant', content: `请求失败：${e instanceof Error ? e.message : '请求失败'}` }],
          requestModel,
          requestConvId
        );
      }
    } finally {
      setIsLoading(false);
      setTimeout(() => {
        setStreamingAssistant((current) => (
          current?.model === requestModel && current?.convId === requestConvId && current?.index === assistantIndex
            ? null
            : current
        ));
      }, 180);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleNewChat() {
    const newConv = createConversation(selectedModel);
    const next = {
      ...conversationsRef.current,
      [selectedModel]: [...(conversationsRef.current[selectedModel] || []), newConv],
    };
    persistConversationsSnapshot(next, selectedModel, newConv.id);
    setConversations(next);
    setActiveConversationId(newConv.id);
    activeConversationIdRef.current = newConv.id;
    setInput('');
    setError('');
    setSelectedImages([]);
    setSelectedVideos([]);
  }

  function handleSelectConversation(convId: string) {
    activeConversationIdRef.current = convId;
    setActiveConversationId(convId);
    saveActiveConversationId(selectedModel, convId);
  }

  function handleDeleteConversation(convId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const modelConvs = (conversationsRef.current[selectedModel] || []).filter((c) => c.id !== convId);
    const next = { ...conversationsRef.current, [selectedModel]: modelConvs };
    let nextActiveId = activeConversationIdRef.current;
    if (activeConversationIdRef.current === convId) {
      if (modelConvs.length > 0) {
        nextActiveId = modelConvs[modelConvs.length - 1].id;
      } else {
        const newConv = createConversation(selectedModel);
        next[selectedModel] = [newConv];
        nextActiveId = newConv.id;
      }
      setActiveConversationId(nextActiveId);
      activeConversationIdRef.current = nextActiveId;
    }
    persistConversationsSnapshot(next, selectedModel, nextActiveId);
    setConversations(next);
  }

  return (
    <div className="flex h-screen flex-row overflow-hidden bg-white">
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 240, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col border-r border-slate-200/80 bg-slate-50 overflow-hidden shrink-0"
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200/80">
              <span className="text-xs font-bold text-slate-600">历史对话</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2 px-2">
              <div className="mb-2 px-1">
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-wider",
                  modelTone.text
                )}>
                  {currentModel.name}
                </span>
              </div>
              {modelConversations.slice().reverse().map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => handleSelectConversation(conv.id)}
                  className={cn(
                    "w-full mb-1 rounded-lg px-2.5 py-2 text-left text-xs transition-colors group relative",
                    activeConversationId === conv.id
                      ? modelTone.activeBg
                      : 'text-slate-600 hover:bg-slate-100'
                  )}
                >
                  <div className="flex items-center gap-1.5 pr-5">
                    <span className="truncate">{conv.title}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400 truncate">
                    {conv.messages.length} 条消息 · {new Date(conv.updatedAt).toLocaleDateString()}
                  </div>
                  <button
                    onClick={(e) => handleDeleteConversation(conv.id, e)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                    title="删除"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </button>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Header */}
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
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100"
                title="展开历史对话"
              >
                <History className="size-3.5" />
                <span className="hidden sm:inline">历史</span>
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white">
                <Crown className="size-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-900">模型选择</h1>
                <div ref={modelMenuRef} className="relative">
                  <button
                    onClick={() => setShowModelMenu(!showModelMenu)}
                    className="flex items-center gap-0.5 text-[10px] text-slate-400 transition-colors hover:text-slate-600"
                  >
                    {currentModel.name}
                    <ChevronDown className={cn('size-3 transition-transform', showModelMenu && 'rotate-180')} />
                  </button>
                <AnimatePresence>
                  {showModelMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                    >
                      {AVAILABLE_MODELS.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            const { map, convId } = ensureActiveConversation(m.id, conversationsRef.current);
                            selectedModelRef.current = m.id;
                            activeConversationIdRef.current = convId;
                            persistConversationsSnapshot(map, m.id, convId);
                            setConversations(map);
                            setActiveConversationId(convId);
                            setSelectedModel(m.id);
                            setShowModelMenu(false);
                          }}
                          className={cn(
                            'w-full px-3 py-2 text-left text-xs transition-colors hover:bg-slate-50',
                            selectedModel === m.id
                              ? getModelTone(m.id).selectedText
                              : 'text-slate-600'
                          )}
                        >
                          <div className="font-bold">{m.name}</div>
                          <div className="text-[10px] text-slate-400">{m.description}</div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedModel === DOUBAO_MODEL_ID && (
            <button
              type="button"
              onClick={() => setDoubaoThinkingEnabled((prev) => !prev)}
              className={cn(
                "flex h-8 items-center gap-2 rounded-lg border px-3 text-xs font-bold shadow-sm transition-all",
                doubaoThinkingEnabled
                  ? "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              )}
              title="控制豆包 2.1 是否启用 thinking 模式"
            >
              <Sparkles className={cn("size-3.5", doubaoThinkingEnabled && "animate-pulse")} />
              <span className="hidden sm:inline">
                Thinking {doubaoThinkingEnabled ? '开' : '关'}
              </span>
            </button>
          )}
          <button
            onClick={handleNewChat}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-fuchsia-100 bg-fuchsia-50 px-3 text-xs font-bold text-fuchsia-700 shadow-sm transition-all hover:border-fuchsia-200 hover:bg-fuchsia-100 hover:shadow-md"
            title="新建对话"
          >
            <Plus className="size-3.5" />
            <span className="hidden sm:inline">新建对话</span>
          </button>
          <div className="hidden sm:flex">
            <ModuleQuickNav current="topmodel" onNavigate={onNavigate} />
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4">
            <div className={cn(
              "mb-6 flex size-16 items-center justify-center rounded-2xl text-white shadow-lg",
              modelTone.gradient
            )}>
              <ModelLogo modelId={selectedModel} className="size-8" />
            </div>
            <h2 className="mb-2 text-2xl font-bold text-slate-900">{currentModel.name}</h2>
            <p className="mb-8 text-sm text-slate-500">{currentModel.description}</p>

            <div className="grid w-full max-w-xl gap-3 sm:grid-cols-2">
              {WELCOME_SUGGESTIONS.map((text, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInput(text);
                    textareaRef.current?.focus();
                  }}
                  className={cn(
                    "rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-600 shadow-sm transition-all hover:shadow-md",
                    modelTone.hoverBorder
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.map((msg, idx) => {
              const isStreamingAssistantMessage = Boolean(
                streamingAssistant
                  && selectedModel === streamingAssistant.model
                  && activeConversationId === streamingAssistant.convId
                  && idx === streamingAssistant.index
                  && msg.role === 'assistant'
              );
              return (
              <div
                key={idx}
                className={cn(
                  'mb-6 flex',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {msg.role === 'assistant' && (
                  <div className={cn(
                    "mr-3 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-white",
                    modelTone.gradient
                  )}>
                    <ModelLogo modelId={selectedModel} className="size-3.5" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[85%] sm:max-w-[75%]',
                    msg.role === 'user'
                      ? 'rounded-2xl rounded-tr-sm bg-slate-900 px-5 py-3.5 text-sm leading-relaxed text-white shadow-sm'
                      : 'text-sm leading-relaxed text-slate-800'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <div className="markdown-body">
                      {isStreamingAssistantMessage ? (
                        <>
                          <AssistantReasoningBlock content={msg.reasoningContent} isStreaming />
                          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                        </>
                      ) : (
                        <>
                          <AssistantReasoningBlock content={msg.reasoningContent} />
                          <AssistantMarkdownMessage content={msg.content} />
                        </>
                      )}
                      {isLoading && idx === messages.length - 1 && (
                        <span className="ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 bg-slate-800 animate-pulse" />
                      )}
                    </div>
                  ) : (
                    <div>
                      {msg.content && <p>{msg.content}</p>}
                      {msg.images && msg.images.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {msg.images.map((img, i) => (
                            <img key={i} src={img} alt="" className="h-20 w-20 rounded-lg object-cover" />
                          ))}
                        </div>
                      )}
                      {msg.videos && msg.videos.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {msg.videos.map((vid, i) => (
                            <video key={i} src={vid} controls className="h-24 w-36 rounded-lg object-cover bg-slate-800" playsInline />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="ml-3 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600">
                    <User className="size-3.5" />
                  </div>
                )}
              </div>
              );
            })}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex justify-start">
                <div className={cn(
                  "mr-3 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-white",
                  modelTone.gradient
                )}>
                  <ModelLogo modelId={selectedModel} className="size-3.5" />
                </div>
                <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className={cn("size-3 rounded-full", modelTone.gradient)}
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
                  <span className="text-sm font-bold text-slate-500">正在思考...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -5 }}
                className="mb-2 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600"
              >
                <span>{error}</span>
                <button onClick={() => setError('')} className="rounded p-0.5 hover:bg-red-100">
                  <span className="text-[10px]">关闭</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Selected Image Previews */}
          <AnimatePresence>
            {selectedImages.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2 flex flex-wrap gap-2"
              >
                {selectedImages.map((img, i) => (
                  <div key={i} className="relative">
                    <img src={img} alt="" className="h-16 w-16 rounded-lg object-cover border border-slate-200" />
                    <button
                      onClick={() => handleRemoveImage(i)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-white shadow-sm hover:bg-slate-700"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Selected Video Previews */}
          <AnimatePresence>
            {selectedVideos.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-2 flex flex-wrap gap-2"
              >
                {selectedVideos.map((vid, i) => (
                  <div key={i} className="relative">
                    <video src={vid} className="h-16 w-28 rounded-lg object-cover border border-slate-200 bg-slate-900" playsInline muted />
                    <button
                      onClick={() => handleRemoveVideo(i)}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-white shadow-sm hover:bg-slate-700"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-fuchsia-300">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              onChange={handleVideoSelect}
              className="hidden"
            />
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={isLoading || isProcessingMedia}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              title="上传图片"
            >
              {isProcessingMedia ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
            </button>
            {supportsMultimodal && (
              <button
                onClick={() => videoInputRef.current?.click()}
                disabled={isLoading}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                title="上传视频"
              >
                <Video className="size-4" />
              </button>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`向 ${currentModel.name} 提问...`}
              rows={3}
              className="min-h-[84px] max-h-48 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2.5 text-sm leading-6 text-slate-700 outline-none placeholder:text-slate-400"
            />
            <button
              onClick={handleSubmit}
              disabled={isLoading || isProcessingMedia || (!input.trim() && selectedImages.length === 0 && selectedVideos.length === 0)}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                isLoading || isProcessingMedia || (!input.trim() && selectedImages.length === 0 && selectedVideos.length === 0)
                  ? 'bg-slate-100 text-slate-400'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              )}
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-slate-400">
            按 Enter 发送，Shift + Enter 换行 · {MEDIA_LIMIT_TEXT}
          </p>
        </div>
      </div>
    </div>
  </div>
);
}
