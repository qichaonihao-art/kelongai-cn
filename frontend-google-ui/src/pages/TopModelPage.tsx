import { useEffect, useRef, useState, type KeyboardEvent, type ChangeEvent } from "react";
import { flushSync } from "react-dom";
import {
  ArrowLeft,
  LogOut,
  Crown,
  Send,
  Loader2,
  User,
  Trash2,
  ChevronDown,
  Image as ImageIcon,
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
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import { cn } from "@/src/lib/utils";
import { streamChatCompletion, type ChatMessage, AVAILABLE_MODELS } from "@/src/lib/topmodel";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TopModelPageProps {
  onBack: () => void;
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel') => void;
  onLogout: () => void;
}

const STORAGE_KEY = 'topmodel_chat_history';
const MODEL_STORAGE_KEY = 'topmodel_selected_model';

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // ignore quota exceeded
  }
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

const WELCOME_SUGGESTIONS = [
  '用一句话解释量子计算',
  '帮我写一段 Python 快速排序代码',
  '分析一下当前 AI 行业的发展趋势',
  '给我讲一个关于程序员笑话',
];

export default function TopModelPage({ onBack, onNavigate, onLogout }: TopModelPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(loadHistory);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModel] = useState(loadModel);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentModel = AVAILABLE_MODELS.find((m) => m.id === selectedModel) || AVAILABLE_MODELS[0];

  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    saveModel(selectedModel);
  }, [selectedModel]);

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
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleRemoveImage(index: number) {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    const trimmed = input.trim();
    if ((!trimmed && selectedImages.length === 0) || isLoading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      images: selectedImages.length > 0 ? selectedImages : undefined,
    };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setSelectedImages([]);
    setError('');
    setIsLoading(true);

    let hasAddedAssistant = false;

    try {
      for await (const chunk of streamChatCompletion(newMessages, { model: selectedModel })) {
        if (!hasAddedAssistant) {
          hasAddedAssistant = true;
          flushSync(() => {
            setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
          });
        }
        setMessages((prev) => {
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
        setMessages((prev) => prev.slice(0, -1));
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
    setMessages([]);
    setInput('');
    setError('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
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
                              ? 'font-bold text-fuchsia-600'
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
          <div className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
          <button
            onClick={onLogout}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-500 transition-colors hover:bg-slate-100 hover:text-red-500"
          >
            <LogOut className="size-3.5" />
            <span className="hidden sm:inline">退出</span>
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4">
            <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white shadow-lg">
              <AnthropicLogo className="size-8" />
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
                  className="rounded-xl border border-slate-200 bg-white p-4 text-left text-sm text-slate-600 shadow-sm transition-all hover:border-fuchsia-300 hover:shadow-md"
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
                  <div className="mr-3 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white">
                    <AnthropicLogo className="size-3.5" />
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
                        }}
                      >
                        {msg.content}
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
                <div className="mr-3 mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-purple-600 text-white">
                  <AnthropicLogo className="size-3.5" />
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

          <div className="relative flex items-end gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-fuchsia-300">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
              title="上传图片"
            >
              <ImageIcon className="size-4" />
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`向 ${currentModel.name} 提问...`}
              rows={1}
              className="min-h-[40px] max-h-32 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2.5 text-sm leading-5 text-slate-700 outline-none placeholder:text-slate-400"
            />
            <button
              onClick={handleSubmit}
              disabled={isLoading || (!input.trim() && selectedImages.length === 0)}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                isLoading || (!input.trim() && selectedImages.length === 0)
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
  );
}
