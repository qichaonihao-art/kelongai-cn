import { useState, useRef, useEffect } from "react";
import {
  Send,
  Image as ImageIcon,
  Film,
  Sparkles,
  ArrowLeft,
  Loader2,
  LogOut,
  X,
  History,
  Plus,
  Pencil,
  Trash2,
  Check,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import {
  createMediaPreviewUrl,
  getCreativeConfigStatus,
  sendCreativeMessage,
  type CreativeHistoryItem,
  type SelectedCreativeMedia,
} from "@/src/lib/creative";
import { motion, AnimatePresence } from "motion/react";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  type: 'text' | 'image' | 'video';
  content: string;
  timestamp: Date;
  pending?: boolean;
  mediaUrl?: string;
  mediaKind?: 'image' | 'video';
  fileName?: string;
}

interface CreativeCreationPageProps {
  onBack: () => void;
  onLogout: () => void;
}

interface PersistedCreativeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface SavedCreativeSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: PersistedCreativeMessage[];
  customTitle?: boolean;
}

const MAX_VIDEO_SIZE_BYTES = 150 * 1024 * 1024;
const MAX_SAVED_CREATIVE_SESSIONS = 8;
const CREATIVE_SESSIONS_STORAGE_KEY = 'kelongai.creativeSessions';
const QUICK_PROMPTS = {
  image: [
    '请描述这张图片的核心内容，并提炼 3 个可延展的创意方向。',
    '请根据这张图片生成一段适合社交媒体发布的文案。',
    '请从构图、情绪和色彩三个角度分析这张图片。'
  ],
  video: [
    '请帮我总结这个视频的主要内容，并提炼 3 个重点。',
    '请按时间顺序拆解这个视频的镜头和画面变化。',
    '请从这个视频里提取适合短视频平台的标题和文案。'
  ]
} as const;

function createMessageId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSessionId() {
  return `creative_session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createWelcomeMessage(): Message {
  return {
    id: 'creative_welcome',
    role: 'assistant',
    type: 'text',
    content: '你好！我是您的创意助手。今天我能帮您进行头脑风暴或生成内容吗？',
    timestamp: new Date(),
  };
}

function getDefaultMessages() {
  return [createWelcomeMessage()];
}

function buildSessionTitle(messages: PersistedCreativeMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim());
  if (!firstUserMessage) {
    return '新会话';
  }

  const compact = firstUserMessage.content.replace(/\s+/g, ' ').trim();
  return compact.length > 18 ? `${compact.slice(0, 18)}...` : compact;
}

function serializeMessagesForStorage(messages: Message[]): PersistedCreativeMessage[] {
  return messages
    .filter((message) => message.type === 'text' && !message.pending && message.content.trim())
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: message.timestamp.toISOString(),
    }));
}

function inflateSavedMessages(messages: PersistedCreativeMessage[]): Message[] {
  if (!messages.length) {
    return getDefaultMessages();
  }

  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    type: 'text',
    content: message.content,
    timestamp: new Date(message.timestamp),
  }));
}

function loadSavedCreativeSessions(): SavedCreativeSession[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(CREATIVE_SESSIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as SavedCreativeSession[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((session) =>
        session &&
        typeof session.id === 'string' &&
        typeof session.title === 'string' &&
        typeof session.updatedAt === 'string' &&
        Array.isArray(session.messages)
      )
      .slice(0, MAX_SAVED_CREATIVE_SESSIONS);
  } catch {
    window.localStorage.removeItem(CREATIVE_SESSIONS_STORAGE_KEY);
    return [];
  }
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CreativeCreationPage({ onBack, onLogout }: CreativeCreationPageProps) {
  const [savedSessions, setSavedSessions] = useState<SavedCreativeSession[]>(loadSavedCreativeSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => loadSavedCreativeSessions()[0]?.id || createSessionId());
  const [messages, setMessages] = useState<Message[]>(() => {
    const savedSessions = loadSavedCreativeSessions();
    return savedSessions[0] ? inflateSavedMessages(savedSessions[0].messages) : getDefaultMessages();
  });
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [configReachable, setConfigReachable] = useState(true);
  const [arkApiConfigured, setArkApiConfigured] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<SelectedCreativeMedia | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CREATIVE_SESSIONS_STORAGE_KEY, JSON.stringify(savedSessions));
  }, [savedSessions]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      const status = await getCreativeConfigStatus();
      if (cancelled) return;
      setConfigReachable(status.reachable);
      setArkApiConfigured(status.arkApiKey);
    }

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const persistedMessages = serializeMessagesForStorage(messages);

    setSavedSessions((previous) => {
      const existingSession = previous.find((session) => session.id === activeSessionId) || null;
      const filtered = previous.filter((session) => session.id !== activeSessionId);

      if (persistedMessages.length <= 1) {
        return filtered;
      }

      const nextSession: SavedCreativeSession = {
        id: activeSessionId,
        title: existingSession?.customTitle ? existingSession.title : buildSessionTitle(persistedMessages),
        updatedAt: new Date().toISOString(),
        messages: persistedMessages,
        customTitle: existingSession?.customTitle === true,
      };

      return [nextSession, ...filtered]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, MAX_SAVED_CREATIVE_SESSIONS);
    });
  }, [activeSessionId, messages]);

  function updateMessage(messageId: string, updater: (message: Message) => Message) {
    setMessages((previous) =>
      previous.map((message) => (message.id === messageId ? updater(message) : message))
    );
  }

  function handleCreateNewSession() {
    if (selectedMedia) {
      URL.revokeObjectURL(selectedMedia.previewUrl);
    }

    setSelectedMedia(null);
    setInput("");
    setEditingSessionId(null);
    setEditingTitle("");
    setRequestError("");
    setIsLoading(false);
    setActiveSessionId(createSessionId());
    setMessages(getDefaultMessages());

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleSwitchSession(sessionId: string) {
    if (sessionId === activeSessionId) {
      return;
    }

    const targetSession = savedSessions.find((session) => session.id === sessionId);
    if (!targetSession) {
      return;
    }

    if (selectedMedia) {
      URL.revokeObjectURL(selectedMedia.previewUrl);
    }

    setSelectedMedia(null);
    setInput("");
    setEditingSessionId(null);
    setEditingTitle("");
    setRequestError("");
    setIsLoading(false);
    setActiveSessionId(sessionId);
    setMessages(inflateSavedMessages(targetSession.messages));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleStartRenameSession() {
    const currentSession = savedSessions.find((session) => session.id === activeSessionId);
    if (!currentSession) {
      return;
    }

    setEditingSessionId(currentSession.id);
    setEditingTitle(currentSession.title);
  }

  function handleSaveSessionTitle() {
    const nextTitle = editingTitle.trim();
    if (!editingSessionId || !nextTitle) {
      setEditingSessionId(null);
      setEditingTitle("");
      return;
    }

    setSavedSessions((previous) =>
      previous.map((session) =>
        session.id === editingSessionId
          ? {
              ...session,
              title: nextTitle,
              customTitle: true,
              updatedAt: session.id === activeSessionId ? new Date().toISOString() : session.updatedAt,
            }
          : session
      )
    );
    setEditingSessionId(null);
    setEditingTitle("");
  }

  function handleDeleteSession(sessionId: string) {
    const remainingSessions = savedSessions.filter((session) => session.id !== sessionId);
    setSavedSessions(remainingSessions);

    if (editingSessionId === sessionId) {
      setEditingSessionId(null);
      setEditingTitle("");
    }

    if (sessionId !== activeSessionId) {
      return;
    }

    const fallbackSession = remainingSessions[0] || null;

    if (selectedMedia) {
      URL.revokeObjectURL(selectedMedia.previewUrl);
    }

    setSelectedMedia(null);
    setInput("");
    setRequestError("");
    setIsLoading(false);

    if (fallbackSession) {
      setActiveSessionId(fallbackSession.id);
      setMessages(inflateSavedMessages(fallbackSession.messages));
    } else {
      setActiveSessionId(createSessionId());
      setMessages(getDefaultMessages());
    }
  }

  const activeSavedSession = savedSessions.find((session) => session.id === activeSessionId) || null;
  const isEditingActiveSession = editingSessionId === activeSessionId;

  function buildHistory(): CreativeHistoryItem[] {
    return messages
      .filter((message) => message.type === 'text' && !message.pending && message.content.trim())
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
  }

  function validateMediaFile(file: File) {
    if (!file.type.startsWith('video/')) return;

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new Error('视频请控制在 150MB 以内，方便稳定上传和分析。');
    }
  }

  function applyQuickPrompt(prompt: string) {
    setInput(prompt);
    setRequestError("");
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  async function handleMediaChange(file: File | null) {
    setRequestError("");

    if (!file) {
      return;
    }

    try {
      validateMediaFile(file);
      const isVideo = file.type.startsWith('video/');
      const kind: 'image' | 'video' = isVideo ? 'video' : 'image';
      const previewUrl = createMediaPreviewUrl(file);
      const nextFileName = file.name;

      if (selectedMedia) {
        URL.revokeObjectURL(selectedMedia.previewUrl);
        setSelectedMedia({
          kind,
          file,
          previewUrl,
          fileName: nextFileName,
        });
        return;
      }

      setSelectedMedia({
        kind,
        file,
        previewUrl,
        fileName: nextFileName,
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '媒体文件读取失败，请换一个文件再试。');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function clearSelectedMedia() {
    if (selectedMedia) {
      URL.revokeObjectURL(selectedMedia.previewUrl);
    }
    setSelectedMedia(null);
    setRequestError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleSend() {
    if (!input.trim() || isLoading) return;

    const question = input.trim();
    const mediaToSend = selectedMedia;
    const mediaMessage = mediaToSend ? {
      id: createMessageId(`creative_${mediaToSend.kind}`),
      role: 'user' as const,
      type: mediaToSend.kind,
      content: '',
      mediaUrl: mediaToSend.previewUrl,
      mediaKind: mediaToSend.kind,
      fileName: mediaToSend.fileName,
      timestamp: new Date(),
    } : null;
    const userMessage: Message = {
      id: createMessageId('creative_user'),
      role: 'user',
      type: 'text',
      content: question,
      timestamp: new Date(),
    };
    const assistantMessageId = createMessageId('creative_assistant');
    const history = buildHistory();

    setMessages((previous) => [
      ...previous,
      ...(mediaMessage ? [mediaMessage] : []),
      userMessage,
      {
        id: assistantMessageId,
        role: 'assistant',
        type: 'text',
        content: '',
        timestamp: new Date(),
        pending: true,
      }
    ]);
    setInput("");
    setSelectedMedia(null);
    setIsLoading(true);
    setRequestError("");

    try {
      const answer = await sendCreativeMessage({
        question,
        media: mediaToSend,
        history,
        onDelta: (text) => {
          updateMessage(assistantMessageId, (message) => ({
            ...message,
            content: text,
            pending: true,
          }));
        },
      });

      updateMessage(assistantMessageId, (message) => ({
        ...message,
        content: answer,
        pending: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '豆包回答失败';
      updateMessage(assistantMessageId, (message) => ({
        ...message,
        content: `生成失败：${errorMessage}`,
        pending: false,
      }));
      setRequestError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="h-screen bg-slate-50 flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => handleMediaChange(event.target.files?.[0] || null)}
      />

      <header className="h-14 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full h-8 w-8">
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-xs font-bold text-slate-900">创意创作</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2">
            <div className="relative">
              <History className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <select
                value={activeSessionId}
                onChange={(event) => handleSwitchSession(event.target.value)}
                disabled={isLoading || savedSessions.length === 0}
                className="h-9 min-w-[220px] rounded-full border border-slate-200 bg-white pl-9 pr-8 text-xs font-medium text-slate-600 outline-none transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {!savedSessions.some((session) => session.id === activeSessionId) && (
                  <option value={activeSessionId}>当前新会话</option>
                )}
                {savedSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title} · {formatSessionTime(session.updatedAt)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreateNewSession}
              disabled={isLoading}
              className="rounded-full border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <Plus className="size-3.5" />
              新建会话
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn(
              "size-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.6)]",
              configReachable && arkApiConfigured ? "bg-emerald-500 animate-pulse" : "bg-amber-400"
            )} />
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              configReachable && arkApiConfigured ? "text-emerald-600" : "text-amber-600"
            )}>
              {configReachable && arkApiConfigured ? 'AI 在线' : '待配置'}
            </span>
          </div>
          <div className="w-px h-4 bg-slate-300 mx-2" />
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            className="text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors gap-2 rounded-full px-4"
          >
            <LogOut className="size-4" />
            <span className="text-xs font-bold">退出登录</span>
          </Button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 scroll-smooth"
      >
        <div className="max-w-6xl mx-auto w-full space-y-6">
          {activeSavedSession && (
            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                    当前会话
                  </div>
                  {isEditingActiveSession ? (
                    <input
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleSaveSessionTitle();
                        }
                        if (event.key === 'Escape') {
                          setEditingSessionId(null);
                          setEditingTitle("");
                        }
                      }}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-300"
                      maxLength={40}
                      autoFocus
                    />
                  ) : (
                    <div className="truncate text-sm font-semibold text-slate-700">
                      {activeSavedSession.title}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isEditingActiveSession ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSaveSessionTitle}
                      className="rounded-full border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      <Check className="size-3.5" />
                      保存
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleStartRenameSession}
                      disabled={isLoading}
                      className="rounded-full border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      <Pencil className="size-3.5" />
                      重命名
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteSession(activeSessionId)}
                    disabled={isLoading}
                    className="rounded-full border border-red-100 px-3 text-xs font-bold text-red-500 hover:bg-red-50"
                  >
                    <Trash2 className="size-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "flex flex-col",
                  msg.role === 'user' ? "items-end" : "items-start"
                )}
              >
                <div className="flex items-center gap-2 mb-2 px-4">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                    {msg.role === 'user' ? '您' : 'AI 助手'}
                  </span>
                  <span className="text-[10px] text-slate-300">•</span>
                  <span className="text-[10px] text-slate-400 font-bold">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className={cn(
                  "max-w-[92%] p-3 md:p-4 rounded-3xl text-base leading-relaxed shadow-sm border transition-all duration-500 whitespace-pre-wrap",
                  msg.role === 'user'
                    ? "bg-slate-900 text-white rounded-tr-none border-slate-800"
                    : "bg-white text-slate-700 rounded-tl-none border-slate-200"
                )}>
                  {(msg.type === 'image' || msg.type === 'video') && msg.mediaUrl ? (
                    <div className="space-y-3">
                      {msg.type === 'image' ? (
                        <img
                          src={msg.mediaUrl}
                          alt={msg.fileName || '用户上传图片'}
                          className="max-w-[280px] rounded-2xl border border-white/20 object-cover"
                        />
                      ) : (
                        <video
                          src={msg.mediaUrl}
                          controls
                          preload="metadata"
                          className="max-w-[320px] rounded-2xl border border-white/20 bg-slate-950"
                        />
                      )}
                      <div className={cn(
                        "text-xs",
                        msg.role === 'user' ? "text-slate-300" : "text-slate-400"
                      )}>
                        {msg.fileName || '已加入当前会话图片上下文'}
                      </div>
                    </div>
                  ) : msg.pending && !msg.content ? (
                    <Loader2 className="size-4 animate-spin text-indigo-600" />
                  ) : (
                    msg.content
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="p-3 md:p-4 border-t border-slate-200 shrink-0 bg-white/50 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto w-full relative">
          <div className="mb-3 flex items-center gap-2 md:hidden">
            <div className="relative flex-1">
              <History className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
              <select
                value={activeSessionId}
                onChange={(event) => handleSwitchSession(event.target.value)}
                disabled={isLoading || savedSessions.length === 0}
                className="h-10 w-full rounded-full border border-slate-200 bg-white pl-9 pr-8 text-xs font-medium text-slate-600 outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              >
                {!savedSessions.some((session) => session.id === activeSessionId) && (
                  <option value={activeSessionId}>当前新会话</option>
                )}
                {savedSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.title} · {formatSessionTime(session.updatedAt)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreateNewSession}
              disabled={isLoading}
              className="rounded-full border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              <Plus className="size-3.5" />
              新建
            </Button>
          </div>

          <div className="relative bg-white rounded-2xl border border-slate-200 shadow-sm focus-within:border-indigo-500/50 focus-within:ring-4 focus-within:ring-indigo-500/5 transition-all duration-300">
            {selectedMedia && (
              <div className="px-4 pt-4">
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2 text-indigo-600">
                      {selectedMedia.kind === 'video' ? <Film className="size-4 shrink-0" /> : <ImageIcon className="size-4 shrink-0" />}
                      <span className="truncate text-sm font-medium">{selectedMedia.fileName}</span>
                    </div>
                    <button
                      type="button"
                      onClick={clearSelectedMedia}
                      className="text-indigo-400 transition-colors hover:text-indigo-600"
                      aria-label={selectedMedia.kind === 'video' ? '移除视频' : '移除图片'}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                  <div className="mt-3">
                    {selectedMedia.kind === 'image' ? (
                      <img
                        src={selectedMedia.previewUrl}
                        alt={selectedMedia.fileName}
                        className="max-h-48 rounded-2xl border border-white/70 object-cover"
                      />
                    ) : (
                      <video
                        src={selectedMedia.previewUrl}
                        controls
                        preload="metadata"
                        className="max-h-56 rounded-2xl border border-white/70 bg-slate-950"
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="在此输入您的消息..."
              className="w-full p-4 pr-28 min-h-[140px] max-h-[400px] bg-transparent border-none focus:ring-0 resize-none text-base leading-relaxed outline-none"
            />
            <div className="absolute right-4 bottom-4 flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-10 rounded-full",
                  selectedMedia
                    ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                    : "text-slate-400 hover:text-slate-600"
                )}
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                title="上传图片或视频"
              >
                {selectedMedia?.kind === 'video' ? <Film className="size-5" /> : <ImageIcon className="size-5" />}
              </Button>
              <Button
                size="icon"
                className="size-10 bg-indigo-600 hover:bg-indigo-700 rounded-full shadow-lg shadow-indigo-200"
                onClick={handleSend}
                disabled={!input.trim() || isLoading}
              >
                <Send className="size-5" />
              </Button>
            </div>
          </div>

          {(selectedMedia || requestError || !configReachable || !arkApiConfigured) && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[10px] tracking-wider font-medium">
              {selectedMedia?.kind === 'video' && (
                <span className="text-slate-500">当前前端上限 150MB，建议优先使用常见视频格式。</span>
              )}
              {!configReachable && (
                <span className="text-red-500">无法读取服务端配置，请确认后端已启动。</span>
              )}
              {configReachable && !arkApiConfigured && (
                <span className="text-red-500">服务端缺少 ARK_API_KEY，创意创作暂时不可用。</span>
              )}
              {requestError && (
                <span className="text-red-500">{requestError}</span>
              )}
            </div>
          )}

          {selectedMedia && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {QUICK_PROMPTS[selectedMedia.kind].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => applyQuickPrompt(prompt)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                  disabled={isLoading}
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-center gap-6 text-[10px] text-slate-400 tracking-wider font-medium">
            <span className="flex items-center gap-1.5 text-transparent bg-clip-text bg-gradient-to-r from-slate-400 via-indigo-500 to-slate-400 animate-shimmer">
              <Sparkles className="size-3 text-indigo-500" /> 创意模式
            </span>
            <span className="text-slate-200">•</span>
            <span>最近自动保存 {MAX_SAVED_CREATIVE_SESSIONS} 个文本会话</span>
            <span className="text-slate-200">•</span>
            <span>Shift + Enter 换行</span>
          </div>
        </div>
      </div>
    </div>
  );
}
