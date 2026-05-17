import { useEffect, useRef, useState, type KeyboardEvent, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  Crown,
  Send,
  Loader2,
  User,
  Trash2,
  ChevronDown,
  Image as ImageIcon,
  Video,
  X,
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
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel') => void;
}

const STORAGE_KEY = 'topmodel_chat_history';
const MODEL_STORAGE_KEY = 'topmodel_selected_model';
const CONVERSATIONS_KEY = 'topmodel_conversations';
const ACTIVE_CONV_KEY = 'topmodel_active_conversation';

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

function saveConversations(map: ConversationsMap) {
  try {
    let trimmed = trimConversations(map);
    let json = JSON.stringify(trimmed);
    // If still too large, progressively trim more aggressively
    while (estimateSize(json) > LOCAL_STORAGE_SIZE_LIMIT) {
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
    }
    localStorage.setItem(CONVERSATIONS_KEY, json);
  } catch (err) {
    console.error('[TopModel] Failed to save conversations:', err);
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
    return localStorage.getItem(MODEL_STORAGE_KEY) || 'claude-opus-4-7';
  } catch {
    return 'claude-opus-4-7';
  }
}

function saveModel(model: string) {
  try {
    localStorage.setItem(MODEL_STORAGE_KEY, model);
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const currentModel = AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];
  const modelConversations = conversations[selectedModel] || [];
  const activeConversation = modelConversations.find((c) => c.id === activeConversationId) || null;
  const messages = activeConversation?.messages || [];

  function persistConversation(model: string, convId: string | null, nextConversations: ConversationsMap) {
    saveConversations(nextConversations);
    saveActiveConversationId(model, convId);
  }

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
    }
  }, [selectedModel]);

  useEffect(() => {
    saveModel(selectedModel);
  }, [selectedModel]);

  // Save before page unload to prevent data loss
  useEffect(() => {
    function handleBeforeUnload() {
      saveConversations(conversations);
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [conversations]);

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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, messages[messages.length - 1]?.content]);

  const supportsMultimodal = currentModel.supportsMultimodal ?? false;

  function handleImageSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file: File) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        setSelectedImages((prev) => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  function handleVideoSelect(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const MAX_VIDEO_SIZE_MB = 8;
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

  function updateActiveMessages(updater: (prev: ChatMessage[]) => ChatMessage[]) {
    setConversations((prevMap) => {
      if (!activeConversationId) return prevMap;
      const modelConvs = [...(prevMap[selectedModel] || [])];
      const idx = modelConvs.findIndex((c) => c.id === activeConversationId);
      if (idx === -1) return prevMap;
      const updatedMsgs = updater(modelConvs[idx].messages);
      modelConvs[idx] = {
        ...modelConvs[idx],
        messages: updatedMsgs,
        updatedAt: Date.now(),
        title: modelConvs[idx].title === '新对话' && updatedMsgs.length > 0
          ? getConversationTitle(updatedMsgs)
          : modelConvs[idx].title,
      };
      const nextMap = { ...prevMap, [selectedModel]: modelConvs };
      saveConversations(nextMap);
      return nextMap;
    });
  }

  async function handleSubmit() {
    const trimmed = input.trim();
    if ((!trimmed && selectedImages.length === 0 && selectedVideos.length === 0) || isLoading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      images: selectedImages.length > 0 ? selectedImages : undefined,
      videos: selectedVideos.length > 0 ? selectedVideos : undefined,
    };
    const newMessages = [...messages, userMsg];
    updateActiveMessages(() => newMessages);
    setInput('');
    setSelectedImages([]);
    setSelectedVideos([]);
    setError('');
    setIsLoading(true);

    let hasAddedAssistant = false;

    try {
      const options: { model: string; tools?: Array<{ type: string }> } = { model: selectedModel };
      if (selectedModel === 'doubao-seed-2-0-pro-260215' || selectedModel === 'qwen3.6-plus') {
        options.tools = [{ type: 'web_search' }];
      }
      for await (const chunk of streamChatCompletion(newMessages, options)) {
        if (!hasAddedAssistant) {
          hasAddedAssistant = true;
          flushSync(() => {
            updateActiveMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
          });
        }
        updateActiveMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + chunk },
          ];
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
      if (hasAddedAssistant) {
        updateActiveMessages((prev) => prev.slice(0, -1));
      }
    } finally {
      setIsLoading(false);
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
    setConversations((prev) => {
      const next = { ...prev, [selectedModel]: [...(prev[selectedModel] || []), newConv] };
      saveConversations(next);
      saveActiveConversationId(selectedModel, newConv.id);
      return next;
    });
    setActiveConversationId(newConv.id);
    setInput('');
    setError('');
    setSelectedImages([]);
    setSelectedVideos([]);
  }

  function handleSelectConversation(convId: string) {
    setActiveConversationId(convId);
    saveActiveConversationId(selectedModel, convId);
  }

  function handleDeleteConversation(convId: string, e: React.MouseEvent) {
    e.stopPropagation();
    setConversations((prev) => {
      const modelConvs = (prev[selectedModel] || []).filter((c) => c.id !== convId);
      const next = { ...prev, [selectedModel]: modelConvs };
      saveConversations(next);
      if (activeConversationId === convId) {
        if (modelConvs.length > 0) {
          const nextId = modelConvs[modelConvs.length - 1].id;
          setActiveConversationId(nextId);
          saveActiveConversationId(selectedModel, nextId);
        } else {
          const newConv = createConversation(selectedModel);
          next[selectedModel] = [newConv];
          saveConversations(next);
          setActiveConversationId(newConv.id);
          saveActiveConversationId(selectedModel, newConv.id);
        }
      }
      return next;
    });
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
                  selectedModel === 'doubao-seed-2-0-pro-260215' ? 'text-blue-500' : 'text-fuchsia-500'
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
                      ? selectedModel === 'doubao-seed-2-0-pro-260215'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-fuchsia-100 text-fuchsia-700'
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
                <Trash2 className="size-3.5" />
                <span className="hidden sm:inline">历史</span>
              </button>
            )}
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white">
                <Crown className="size-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-900">顶级模型</h1>
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
                            setSelectedModel(m.id);
                            setShowModelMenu(false);
                          }}
                          className={cn(
                            'w-full px-3 py-2 text-left text-xs transition-colors hover:bg-slate-50',
                            selectedModel === m.id
                              ? m.id === 'doubao-seed-2-0-pro-260215'
                                ? 'font-bold text-blue-600'
                                : 'font-bold text-fuchsia-600'
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
          <button
            onClick={handleNewChat}
            className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100"
            title="新建对话"
          >
            <Trash2 className="size-3.5" />
            <span className="hidden sm:inline">新对话</span>
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
              selectedModel === 'doubao-seed-2-0-pro-260215'
                ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                : 'bg-gradient-to-br from-fuchsia-500 to-purple-600'
            )}>
              {selectedModel === 'doubao-seed-2-0-pro-260215' ? (
                <DoubaoLogo className="size-8" />
              ) : (
                <AnthropicLogo className="size-8" />
              )}
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
                    selectedModel === 'doubao-seed-2-0-pro-260215'
                      ? 'hover:border-blue-300'
                      : 'hover:border-fuchsia-300'
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-6">
            {messages.map((msg, idx) => (
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
                    selectedModel === 'doubao-seed-2-0-pro-260215'
                      ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                      : 'bg-gradient-to-br from-fuchsia-500 to-purple-600'
                  )}>
                    {selectedModel === 'doubao-seed-2-0-pro-260215' ? (
                      <DoubaoLogo className="size-3.5" />
                    ) : (
                      <AnthropicLogo className="size-3.5" />
                    )}
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
                        {normalizeMarkdown(msg.content)}
                      </ReactMarkdown>
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
            ))}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex justify-start">
                <div className={cn(
                  "mr-3 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-white",
                  selectedModel === 'doubao-seed-2-0-pro-260215'
                    ? 'bg-gradient-to-br from-blue-500 to-cyan-500'
                    : 'bg-gradient-to-br from-fuchsia-500 to-purple-600'
                )}>
                  {selectedModel === 'doubao-seed-2-0-pro-260215' ? (
                    <DoubaoLogo className="size-3.5" />
                  ) : (
                    <AnthropicLogo className="size-3.5" />
                  )}
                </div>
                <div className="flex items-center gap-3 rounded-2xl bg-slate-50 px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        className="size-3 rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600"
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
              accept="image/*"
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
              disabled={isLoading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              title="上传图片"
            >
              <ImageIcon className="size-4" />
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
              disabled={isLoading || (!input.trim() && selectedImages.length === 0 && selectedVideos.length === 0)}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                isLoading || (!input.trim() && selectedImages.length === 0 && selectedVideos.length === 0)
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
            按 Enter 发送，Shift + Enter 换行
          </p>
        </div>
      </div>
    </div>
  </div>
);
}
