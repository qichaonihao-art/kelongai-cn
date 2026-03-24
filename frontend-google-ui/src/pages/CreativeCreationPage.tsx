import { useState, useRef, useEffect } from "react";
import {
  Send,
  Image as ImageIcon,
  Sparkles,
  ArrowLeft,
  Loader2,
  LogOut,
  X,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import {
  getCreativeConfigStatus,
  readImageAsDataUrl,
  sendCreativeMessage,
  type CreativeHistoryItem,
} from "@/src/lib/creative";
import { motion, AnimatePresence } from "motion/react";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  type: 'text' | 'image';
  content: string;
  timestamp: Date;
  pending?: boolean;
  imageUrl?: string;
  fileName?: string;
}

interface CreativeCreationPageProps {
  onBack: () => void;
  onLogout: () => void;
}

function createMessageId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function CreativeCreationPage({ onBack, onLogout }: CreativeCreationPageProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'creative_welcome',
      role: 'assistant',
      type: 'text',
      content: '你好！我是您的创意助手。今天我能帮您进行头脑风暴或生成内容吗？',
      timestamp: new Date(),
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [configReachable, setConfigReachable] = useState(true);
  const [arkApiConfigured, setArkApiConfigured] = useState(true);
  const [selectedImage, setSelectedImage] = useState<{
    dataUrl: string;
    fileName: string;
    messageId: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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

  function updateMessage(messageId: string, updater: (message: Message) => Message) {
    setMessages((previous) =>
      previous.map((message) => (message.id === messageId ? updater(message) : message))
    );
  }

  function buildHistory(): CreativeHistoryItem[] {
    return messages
      .filter((message) => message.type === 'text' && !message.pending && message.content.trim())
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
  }

  async function handleImageChange(file: File | null) {
    setRequestError("");

    if (!file) {
      return;
    }

    try {
      const dataUrl = await readImageAsDataUrl(file);
      const nextFileName = file.name;

      if (selectedImage) {
        updateMessage(selectedImage.messageId, (message) => ({
          ...message,
          imageUrl: dataUrl,
          fileName: nextFileName,
          timestamp: new Date(),
        }));
        setSelectedImage({
          dataUrl,
          fileName: nextFileName,
          messageId: selectedImage.messageId,
        });
        return;
      }

      const messageId = createMessageId('creative_image');
      setMessages((previous) => [
        ...previous,
        {
          id: messageId,
          role: 'user',
          type: 'image',
          content: '',
          imageUrl: dataUrl,
          fileName: nextFileName,
          timestamp: new Date(),
        }
      ]);
      setSelectedImage({
        dataUrl,
        fileName: nextFileName,
        messageId,
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '图片读取失败，请换一张再试。');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  function clearSelectedImage() {
    if (selectedImage) {
      setMessages((previous) => previous.filter((message) => message.id !== selectedImage.messageId));
    }
    setSelectedImage(null);
    setRequestError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleSend() {
    if (!input.trim() || isLoading) return;

    const question = input.trim();
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
    setIsLoading(true);
    setRequestError("");

    try {
      const answer = await sendCreativeMessage({
        question,
        image: selectedImage?.dataUrl || '',
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
      setSelectedImage(null);
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
        accept="image/*"
        className="hidden"
        onChange={(event) => handleImageChange(event.target.files?.[0] || null)}
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
                  {msg.type === 'image' && msg.imageUrl ? (
                    <div className="space-y-3">
                      <img
                        src={msg.imageUrl}
                        alt={msg.fileName || '用户上传图片'}
                        className="max-w-[280px] rounded-2xl border border-white/20 object-cover"
                      />
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
          <div className="relative bg-white rounded-2xl border border-slate-200 shadow-sm focus-within:border-indigo-500/50 focus-within:ring-4 focus-within:ring-indigo-500/5 transition-all duration-300">
            <textarea
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
                  selectedImage
                    ? "text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                    : "text-slate-400 hover:text-slate-600"
                )}
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                <ImageIcon className="size-5" />
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

          {(selectedImage || requestError || !configReachable || !arkApiConfigured) && (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[10px] tracking-wider font-medium">
              {selectedImage && (
                <div className="flex items-center gap-2 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-indigo-600">
                  <ImageIcon className="size-3" />
                  <span className="max-w-[220px] truncate">{selectedImage.fileName}</span>
                  <button
                    type="button"
                    onClick={clearSelectedImage}
                    className="text-indigo-400 hover:text-indigo-600"
                    aria-label="移除图片"
                  >
                    <X className="size-3" />
                  </button>
                </div>
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

          <div className="mt-3 flex items-center justify-center gap-6 text-[10px] text-slate-400 tracking-wider font-medium">
            <span className="flex items-center gap-1.5 text-transparent bg-clip-text bg-gradient-to-r from-slate-400 via-indigo-500 to-slate-400 animate-shimmer">
              <Sparkles className="size-3 text-indigo-500" /> 创意模式
            </span>
            <span className="text-slate-200">•</span>
            <span>Shift + Enter 换行</span>
          </div>
        </div>
      </div>
    </div>
  );
}
