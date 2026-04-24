import { useState, useRef, useEffect } from "react";
import {
  Send,
  Film,
  Sparkles,
  ArrowLeft,
  Loader2,
  LogOut,
  X,
  History,
  Plus,
  Image as ImageIcon,
  Music,
  Download,
  SlidersHorizontal,
  Volume2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Replace,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import SiteFooter from "@/src/components/SiteFooter";
import { cn } from "@/src/lib/utils";
import {
  createMediaPreviewUrl,
  createSeedanceTask,
  getCreativeConfigStatus,
  querySeedanceTask,
  sendCreativeMessage,
  type CreativeHistoryItem,
  type SeedanceReferenceFile,
  type SeedanceTaskResult,
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
  onNavigate: (page: 'voice' | 'creative' | 'douyin') => void;
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

interface SeedanceHistoryItem {
  id: string;
  taskId: string;
  prompt: string;
  status?: string;
  videoUrl?: string;
  createdAt?: number;
  updatedAt?: number;
  savedAt: string;
  ratio: string;
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
  elapsedSeconds?: number;
}

const MAX_VIDEO_SIZE_BYTES = 150 * 1024 * 1024;
const MAX_SAVED_CREATIVE_SESSIONS = 8;
const MAX_SEEDANCE_HISTORY_ITEMS = 20;
const SEEDANCE_HISTORY_MAX_AGE_HOURS = 24;
const SEEDANCE_POLL_INTERVAL_MS = 15000;
const CREATIVE_SESSIONS_STORAGE_KEY = 'kelongai.creativeSessions';
const SEEDANCE_HISTORY_STORAGE_KEY = 'kelongai.seedanceHistory';
const VIDEO_REVERSE_FORMAT_SUFFIX = '\n\n请严格按照以上七个部分输出，每个部分之间必须空一行（即每个部分结束后换两行再开始下一个部分）。';
const VIDEO_REVERSE_PROMPT = (additionalChange?: string) => {
  const base = `请把这个视频当作”待复刻样片”来分析，不要只做普通内容描述，而要尽量提取出所有会影响视频复刻结果的关键信息。目标是让我把你输出的提示词交给图生视频/文生视频模型后，最大程度复刻原视频的主体、构图、镜头、动作、节奏、光影和氛围。\n\n请严格按以下结构输出：\n\n一、核心主体信息\n二、场景与背景环境\n三、构图与机位\n四、镜头运动\n五、动作设计与时间顺序\n六、节奏与动态风格\n七、光影与色彩\n八、情绪与气质\n九、复刻关键约束（提炼 8 条最关键因素）\n十、负面约束（列出应避免的问题）\n十一、最终可直接用于视频生成模型的完整复刻提示词\n十二、负面提示词\n\n要求：\n1. 描述必须具体，避免空泛词语。\n2. 尽量写出主体在画面中的位置、景别、角度、运动方式、动作先后顺序。\n3. 如果视频里有明显的服装、道具、背景装饰、灯光方向、色温、节奏变化，必须写出来。\n4. 最终提示词要以”生成指令”的方式输出，不要写成分析说明。\n5. 目标不是”风格相似”，而是”尽量复刻接近原视频”。\n6. 对于画面中的挂画、海报、装饰画、屏幕显示内容等平面元素，必须严格保持其原始比例（宽高比）和尺寸关系，不得出现拉伸、压扁或变形。替换或修改后的元素在画面中的空间占比和边界框大小必须与原元素一致。\n7. 如果原视频中存在水印、平台标识、AI生成标记（如”豆包AI生成”等文字或Logo），必须在复刻时去除，不得保留任何水印信息。`;
  if (!additionalChange?.trim()) return base;
  return `${base}\n\n另外，在复刻时还需要做以下调整：${additionalChange.trim()}`;
};
const VIDEO_REPLACE_PROMPT = (target: string, replacement: string, additionalChange?: string) => {
  const base = `我上传了一个视频和一个参考图片。请你完成以下任务：

1. 先像分析”待复刻样片”一样，完整分析这个视频，提取所有影响复刻结果的关键信息（主体、构图、镜头、动作、节奏、光影、氛围等）。
2. 同时参考我上传的图片，把视频中的【${target}】替换成【${replacement}】。
3. 替换时，${replacement}的外观、风格、质感要与我上传的参考图片保持一致。
4. 除了被替换的元素外，视频中其他所有内容（场景、人物、动作、镜头运动、光影、色彩、节奏等）必须与原视频完全一致，不能有任何改变。

请严格按以下结构输出：

一、核心主体信息
二、场景与背景环境
三、构图与机位
四、镜头运动
五、动作设计与时间顺序
六、节奏与动态风格
七、光影与色彩
八、情绪与气质
九、复刻关键约束（提炼 8 条最关键因素，并明确指出”${target}”已替换为”${replacement}”）
十、负面约束（列出应避免的问题）
十一、最终可直接用于视频生成模型的完整复刻提示词（其中已包含替换后的元素描述）
十二、负面提示词

要求：
1. 描述必须具体，避免空泛词语。
2. 尽量写出主体在画面中的位置、景别、角度、运动方式、动作先后顺序。
3. 如果视频里有明显的服装、道具、背景装饰、灯光方向、色温、节奏变化，必须写出来。
4. 最终提示词要以”生成指令”的方式输出，不要写成分析说明。
5. 目标不是”风格相似”，而是”尽量复刻接近原视频，同时仅替换指定元素”。
6. 被替换的元素（如挂画、海报、装饰画、屏幕显示内容等平面元素）必须严格保持其原始比例（宽高比）和尺寸关系，不得出现拉伸、压扁或变形。替换后的新元素在画面中的空间占比、边界框大小和透视关系必须与原元素完全一致。
7. 如果原视频中存在水印、平台标识、AI生成标记（如"豆包AI生成"等文字或Logo），必须在复刻时去除，不得保留任何水印信息。`;
  if (!additionalChange?.trim()) return base;
  return `${base}\n\n另外，在复刻时还需要做以下调整：${additionalChange.trim()}`;
};
const SEEDANCE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] as const;
const SEEDANCE_DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

function createMessageId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSessionId() {
  return `creative_session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getSeedanceReferenceKind(file: File): SeedanceReferenceFile['kind'] | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

function getSeedanceRatioLabel(ratio: string) {
  return ratio === 'adaptive' ? '智能比例' : ratio;
}

function isSeedanceTerminalStatus(status?: string) {
  const normalized = String(status || '').toLowerCase();
  return ['succeeded', 'success', 'completed', 'done', 'failed', 'error', 'cancelled', 'canceled', 'expired'].includes(normalized);
}

function isSeedanceFailureStatus(status?: string) {
  const normalized = String(status || '').toLowerCase();
  return ['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(normalized);
}

function getSeedanceStatusLabel(status?: string, hasVideo?: boolean) {
  if (hasVideo) return '生成完成';
  const normalized = String(status || '').toLowerCase();
  if (['queued', 'pending', 'created'].includes(normalized)) return '排队中';
  if (['running', 'processing', 'in_progress'].includes(normalized)) return '生成中';
  if (['succeeded', 'success', 'completed', 'done'].includes(normalized)) return '生成完成';
  if (['failed', 'error'].includes(normalized)) return '生成失败';
  if (['cancelled', 'canceled'].includes(normalized)) return '已取消';
  if (normalized === 'expired') return '已过期';
  return status || '等待查询';
}

function formatSeedanceWait(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes <= 0) return `${remainder} 秒`;
  if (remainder === 0) return `${minutes} 分钟`;
  return `${minutes} 分 ${remainder} 秒`;
}

function formatElapsedDuration(seconds?: number) {
  if (!seconds || seconds <= 0) return '';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) return `${hrs}小时${mins}分${secs}秒`;
  if (mins > 0) return `${mins}分${secs}秒`;
  return `${secs}秒`;
}

function getSeedanceElapsedSeconds(task: SeedanceTaskResult | null, nowMs = Date.now()) {
  if (!task) return 0;
  if (task.createdAt && task.createdAt > 0) {
    return Math.max(0, Math.floor(nowMs / 1000) - task.createdAt);
  }
  return 0;
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

function getSeedanceTaskTime(task: SeedanceTaskResult) {
  return task.createdAt && task.createdAt > 0 ? task.createdAt : Math.floor(Date.now() / 1000);
}

function createSeedanceHistoryItem(
  task: SeedanceTaskResult,
  options: {
    prompt: string;
    ratio: string;
    duration: number;
    generateAudio: boolean;
    watermark: boolean;
    elapsedSeconds?: number;
  }
): SeedanceHistoryItem {
  const createdAt = getSeedanceTaskTime(task);

  return {
    id: task.taskId || createMessageId('seedance_history'),
    taskId: task.taskId,
    prompt: options.prompt,
    status: task.status,
    videoUrl: task.videoUrl,
    createdAt,
    updatedAt: task.updatedAt,
    savedAt: new Date().toISOString(),
    ratio: options.ratio,
    duration: options.duration,
    generateAudio: options.generateAudio,
    watermark: options.watermark,
    elapsedSeconds: options.elapsedSeconds,
  };
}

function mergeSeedanceHistoryItem(
  previous: SeedanceHistoryItem[],
  item: SeedanceHistoryItem
) {
  const next = [
    item,
    ...previous.filter((historyItem) => historyItem.taskId !== item.taskId),
  ];
  return next
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    .slice(0, MAX_SEEDANCE_HISTORY_ITEMS);
}

function loadSeedanceHistory() {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(SEEDANCE_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const maxAgeMs = SEEDANCE_HISTORY_MAX_AGE_HOURS * 60 * 60 * 1000;
    const now = Date.now();

    const filtered = parsed
      .filter((item): item is SeedanceHistoryItem => (
        item &&
        typeof item === 'object' &&
        typeof item.taskId === 'string' &&
        typeof item.prompt === 'string'
      ))
      .filter((item) => {
        const savedTime = new Date(item.savedAt).getTime();
        return now - savedTime < maxAgeMs;
      });

    // 如果有被清理掉的记录，同步更新 localStorage
    if (filtered.length < parsed.length) {
      window.localStorage.setItem(SEEDANCE_HISTORY_STORAGE_KEY, JSON.stringify(filtered));
    }

    return filtered.slice(0, MAX_SEEDANCE_HISTORY_ITEMS);
  } catch {
    window.localStorage.removeItem(SEEDANCE_HISTORY_STORAGE_KEY);
    return [];
  }
}

function seedanceTaskToHistoryPatch(task: SeedanceTaskResult) {
  return {
    status: task.status,
    videoUrl: task.videoUrl,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    savedAt: new Date().toISOString(),
  };
}

function stripMarkdownMarks(value: string) {
  return value
    .replace(/^#{1,6}\s+/, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function renderInlineContent(value: string) {
  const parts = value.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g);

  return parts.map((part, index) => {
    if (!part) return null;

    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return (
        <strong key={index} className="font-bold text-slate-950">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[0.92em] font-semibold text-slate-700">
          {part.slice(1, -1)}
        </code>
      );
    }

    return part;
  });
}

function renderListItemContent(value: string) {
  const titleMatch = value.match(/^([^：:，,。；;]{2,18}[：:])\s*(.*)$/);

  if (!titleMatch) {
    return renderInlineContent(value);
  }

  return (
    <>
      <strong className="font-bold text-slate-950">{stripMarkdownMarks(titleMatch[1])}</strong>
      {titleMatch[2] ? renderInlineContent(titleMatch[2]) : null}
    </>
  );
}

function getInlineNumberedParts(block: string) {
  const markerPattern = /(\d{1,2}[.、]\s*|[一二三四五六七八九十]{1,3}[、.]\s*)/g;
  const matches = Array.from(block.matchAll(markerPattern));

  if (matches.length < 2) {
    return null;
  }

  const markers = matches.map((match) => {
    const raw = match[0];
    const start = match.index || 0;
    const marker = raw.trim();

    return {
      start,
      contentStart: start + raw.length,
      marker,
      isChinese: /^[一二三四五六七八九十]/.test(marker),
    };
  });
  const intro = block.slice(0, markers[0].start).trim();
  const items = markers
    .map((marker, index) => ({
      marker: marker.marker.replace(/\s+$/g, ''),
      isChinese: marker.isChinese,
      text: block.slice(marker.contentStart, markers[index + 1]?.start ?? block.length).trim(),
    }))
    .filter((item) => item.text);

  if (items.length < 2) {
    return null;
  }

  return { intro, items };
}

function renderAssistantMessageContent(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').trim();

  if (!normalized) {
    return null;
  }

  let rawBlocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);

  // 合并相邻的中文序号段落，否则 split 后每个 block 只有一个序号，
  // getInlineNumberedParts 无法跨 block 匹配，导致中文序号内容变成一整段。
  const chineseNumberPattern = /^[一二三四五六七八九十]+[、.]\s*/;
  const mergedBlocks: string[] = [];
  for (const block of rawBlocks) {
    const lastBlock = mergedBlocks[mergedBlocks.length - 1];
    if (lastBlock && chineseNumberPattern.test(block)) {
      mergedBlocks[mergedBlocks.length - 1] = lastBlock + '\n' + block;
    } else {
      mergedBlocks.push(block);
    }
  }
  const blocks = mergedBlocks;

  return (
    <div className="creative-answer">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
        const firstLine = lines[0] || '';
        const orderedLines = lines.filter((line) => /^\d+[.、]\s+/.test(line));
        const unorderedLines = lines.filter((line) => /^[-*]\s+/.test(line));
        const inlineNumberedParts = getInlineNumberedParts(lines.join(' '));

        if (/^#{1,6}\s+/.test(firstLine)) {
          return (
            <div key={blockIndex} className="creative-answer-section">
              <h3>{renderInlineContent(stripMarkdownMarks(firstLine))}</h3>
              {lines.slice(1).map((line, lineIndex) => (
                <p key={lineIndex}>{renderInlineContent(line)}</p>
              ))}
            </div>
          );
        }

        if (/^[一二三四五六七八九十]+[、.]\s*/.test(firstLine) && lines.length === 1) {
          // 如果单行文本里包含多个中文序号，不要在这里提前返回，
          // 让后续 inlineNumberedParts / fallback 做分段卡片渲染。
          const chineseMarkerCount = (lines.join(' ').match(/[一二三四五六七八九十]{1,3}[、.]/g) || []).length;
          if (chineseMarkerCount < 2) {
            return <h3 key={blockIndex}>{renderInlineContent(stripMarkdownMarks(firstLine))}</h3>;
          }
        }

        if (inlineNumberedParts) {
          const hasChineseMarkers = inlineNumberedParts.items.some((item) => item.isChinese);

          return (
            <div key={blockIndex} className="creative-answer-section">
              {inlineNumberedParts.intro ? <p>{renderInlineContent(inlineNumberedParts.intro)}</p> : null}
              {hasChineseMarkers ? (
                <div className="creative-answer-numbered-sections">
                  {inlineNumberedParts.items.map((item, itemIndex) => {
                    const titleMatch = item.text.match(/^([^：:，,。；;]{2,18}[：:])\s*(.*)$/);
                    const titleText = titleMatch ? stripMarkdownMarks(titleMatch[1]) : '';
                    const bodyText = titleMatch ? titleMatch[2] : item.text;
                    return (
                      <section key={`${item.marker}-${itemIndex}`} className="creative-answer-item">
                        <div className="creative-answer-item-title">
                          {stripMarkdownMarks(item.marker)} {titleText}
                        </div>
                        <div className="creative-answer-item-body">
                          {renderInlineContent(bodyText)}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <ol className="creative-answer-split-list">
                  {inlineNumberedParts.items.map((item, itemIndex) => (
                    <li key={`${item.marker}-${itemIndex}`}>{renderListItemContent(item.text)}</li>
                  ))}
                </ol>
              )}
            </div>
          );
        }

        if (orderedLines.length === lines.length) {
          return (
            <ol key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderListItemContent(stripMarkdownMarks(line.replace(/^\d+[.、]\s+/, '')))}</li>
              ))}
            </ol>
          );
        }

        if (unorderedLines.length === lines.length) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInlineContent(line.replace(/^[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }

        const fallbackChinesePattern = /([一二三四五六七八九十]{1,3}[、.]\s*)/g;
        const fallbackMatches = Array.from(block.matchAll(fallbackChinesePattern));
        if (fallbackMatches.length >= 2) {
          const intro = block.slice(0, fallbackMatches[0].index || 0).trim();
          const parts = fallbackMatches.map((match, index) => {
            const start = match.index || 0;
            const end = fallbackMatches[index + 1]?.index ?? block.length;
            const partText = block.slice(start, end).trim();
            const markerMatch = partText.match(/^([一二三四五六七八九十]{1,3}[、.]\s*)/);
            const marker = markerMatch ? markerMatch[1].trim() : '';
            const content = partText.slice(marker.length).trim();
            const titleMatch = content.match(/^([^：:，,。；;]{2,18}[：:])\s*(.*)$/);
            const titleText = titleMatch ? stripMarkdownMarks(titleMatch[1]) : '';
            const bodyText = titleMatch ? titleMatch[2] : content;
            return { marker, titleText, bodyText };
          }).filter((p) => p.marker && p.bodyText);

          if (parts.length >= 2) {
            return (
              <div key={blockIndex} className="creative-answer-section">
                {intro ? <p>{renderInlineContent(intro)}</p> : null}
                <div className="creative-answer-numbered-sections">
                  {parts.map((part, partIndex) => (
                    <section key={partIndex} className="creative-answer-item">
                      <div className="creative-answer-item-title">
                        {part.marker} {part.titleText}
                      </div>
                      <div className="creative-answer-item-body">
                        {renderInlineContent(part.bodyText)}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            );
          }
        }

        return (
          <p key={blockIndex}>
            {renderInlineContent(lines.join('\n'))}
          </p>
        );
      })}
    </div>
  );
}

export default function CreativeCreationPage({ onBack, onNavigate, onLogout }: CreativeCreationPageProps) {
  const [savedSessions, setSavedSessions] = useState<SavedCreativeSession[]>(loadSavedCreativeSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => loadSavedCreativeSessions()[0]?.id || createSessionId());
  const [messages, setMessages] = useState<Message[]>(() => {
    const savedSessions = loadSavedCreativeSessions();
    return savedSessions[0] ? inflateSavedMessages(savedSessions[0].messages) : getDefaultMessages();
  });
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [configReachable, setConfigReachable] = useState(true);
  const [arkApiConfigured, setArkApiConfigured] = useState(true);
  const [seedanceApiConfigured, setSeedanceApiConfigured] = useState(true);
  const [publicBaseUrlConfigured, setPublicBaseUrlConfigured] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<SelectedCreativeMedia | null>(null);
  const [seedancePrompt, setSeedancePrompt] = useState("");
  const [seedanceRatio, setSeedanceRatio] = useState("9:16");
  const [seedanceDuration, setSeedanceDuration] = useState(5);
  const [seedanceGenerateAudio, setSeedanceGenerateAudio] = useState(false);
  const [seedanceWatermark, setSeedanceWatermark] = useState(false);
  const [seedanceReferences, setSeedanceReferences] = useState<SeedanceReferenceFile[]>([]);
  const [isSeedanceLoading, setIsSeedanceLoading] = useState(false);
  const [isSeedancePolling, setIsSeedancePolling] = useState(false);
  const [seedanceError, setSeedanceError] = useState("");
  const [seedanceTask, setSeedanceTask] = useState<SeedanceTaskResult | null>(null);
  const [seedanceHistory, setSeedanceHistory] = useState<SeedanceHistoryItem[]>(loadSeedanceHistory);
  const [showSeedanceSettings, setShowSeedanceSettings] = useState(false);
  const [seedanceClock, setSeedanceClock] = useState(Date.now());
  const [seedanceVideoModal, setSeedanceVideoModal] = useState(false);
  const [seedanceModalItem, setSeedanceModalItem] = useState<SeedanceHistoryItem | null>(null);
  const [isHistoryFolded, setIsHistoryFolded] = useState(true);
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [reverseMode, setReverseMode] = useState<'direct' | 'replace'>('direct');
  const [replaceImage, setReplaceImage] = useState<SelectedCreativeMedia | null>(null);
  const [replaceTarget, setReplaceTarget] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [additionalChange, setAdditionalChange] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const analysisScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const seedanceFileInputRef = useRef<HTMLInputElement>(null);
  const seedanceSettingsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seedancePromptRef = useRef<HTMLTextAreaElement>(null);

  function scrollAnalysisToBottom() {
    requestAnimationFrame(() => {
      if (analysisScrollRef.current) {
        analysisScrollRef.current.scrollTop = analysisScrollRef.current.scrollHeight;
      }
    });
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CREATIVE_SESSIONS_STORAGE_KEY, JSON.stringify(savedSessions));
  }, [savedSessions]);

  useEffect(() => {
    scrollAnalysisToBottom();
  }, [messages.length]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SEEDANCE_HISTORY_STORAGE_KEY, JSON.stringify(seedanceHistory));
  }, [seedanceHistory]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!showAtMenu) return;
      const target = event.target as HTMLElement;
      if (seedancePromptRef.current && seedancePromptRef.current.contains(target)) return;
      const menuEl = seedancePromptRef.current?.parentElement?.querySelector('[data-at-menu]');
      if (menuEl && menuEl.contains(target)) return;
      setShowAtMenu(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAtMenu]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      const status = await getCreativeConfigStatus();
      if (cancelled) return;
      setConfigReachable(status.reachable);
      setArkApiConfigured(status.arkApiKey);
      setSeedanceApiConfigured(status.seedanceApiKey);
      setPublicBaseUrlConfigured(status.publicBaseUrl);
    }

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!showSeedanceSettings) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (seedanceSettingsRef.current?.contains(target)) return;
      setShowSeedanceSettings(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowSeedanceSettings(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showSeedanceSettings]);

  useEffect(() => {
    if (!seedanceVideoModal) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSeedanceVideoModal(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [seedanceVideoModal]);

  useEffect(() => {
    const taskId = seedanceTask?.taskId;
    if (!taskId || seedanceTask?.videoUrl || isSeedanceTerminalStatus(seedanceTask?.status)) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    async function pollTask() {
      setIsSeedancePolling(true);
      try {
        const nextTask = await querySeedanceTask(taskId);
        if (cancelled) return;
        updateSeedanceHistoryTask(nextTask);

        setSeedanceTask((previous) =>
          previous?.taskId === taskId
            ? {
                ...previous,
                ...nextTask,
              }
            : previous
        );

        if (nextTask.videoUrl || isSeedanceTerminalStatus(nextTask.status)) {
          return;
        }
      } catch (error) {
        if (!cancelled) {
          setSeedanceError(error instanceof Error ? error.message : 'Seedance 查询任务失败');
        }
      } finally {
        if (!cancelled) {
          setIsSeedancePolling(false);
        }
      }

      if (!cancelled) {
        timer = window.setTimeout(pollTask, SEEDANCE_POLL_INTERVAL_MS);
      }
    }

    timer = window.setTimeout(pollTask, 1500);

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [seedanceTask?.taskId, seedanceTask?.status, seedanceTask?.videoUrl]);

  useEffect(() => {
    if (!seedanceTask?.taskId || seedanceTask.videoUrl || isSeedanceTerminalStatus(seedanceTask.status)) {
      return;
    }

    const timer = window.setInterval(() => setSeedanceClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [seedanceTask?.taskId, seedanceTask?.status, seedanceTask?.videoUrl]);

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
    setIsSeedancePolling(false);
    setSeedancePrompt("");
    setSeedanceError("");
    setSeedanceTask(null);
    setSeedanceReferences((previous) => {
      previous.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
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
    setIsSeedancePolling(false);
    setSeedancePrompt("");
    setSeedanceError("");
    setSeedanceTask(null);
    setSeedanceReferences((previous) => {
      previous.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setActiveSessionId(sessionId);
    setMessages(inflateSavedMessages(targetSession.messages));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    scrollAnalysisToBottom();
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
    setIsSeedancePolling(false);
    setSeedancePrompt("");
    setSeedanceError("");
    setSeedanceTask(null);
    setSeedanceReferences((previous) => {
      previous.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });

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
  const latestAssistantText = [...messages]
    .reverse()
    .find((message) => message.id !== 'creative_welcome' && message.role === 'assistant' && message.type === 'text' && !message.pending && message.content.trim())
    ?.content.trim() || '';

  function updateSeedanceHistoryTask(task: SeedanceTaskResult) {
    if (!task.taskId) return;
    setSeedanceHistory((previous) =>
      previous.map((item) => {
        if (item.taskId !== task.taskId) return item;
        const isNowTerminal = !!task.videoUrl || isSeedanceTerminalStatus(task.status);
        const wasAlreadyTerminal = !!item.videoUrl || isSeedanceTerminalStatus(item.status);
        const elapsedSeconds =
          isNowTerminal && !wasAlreadyTerminal && item.createdAt
            ? Math.max(0, Math.floor(Date.now() / 1000) - item.createdAt)
            : item.elapsedSeconds;
        return {
          ...item,
          ...seedanceTaskToHistoryPatch(task),
          elapsedSeconds,
        };
      })
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

  function validateMediaFile(file: File) {
    if (!file.type.startsWith('video/')) {
      throw new Error('这里请上传视频文件，用来反推 Seedance 视频提示词。');
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new Error('视频请控制在 150MB 以内，方便稳定上传和分析。');
    }
  }

  function prepareVideoReversePrompt() {
    if (reverseMode === 'replace') {
      if (!replaceTarget.trim() || !replaceWith.trim()) {
        setRequestError('请填写需要替换的元素和目标元素');
        return;
      }
      const prompt = VIDEO_REPLACE_PROMPT(replaceTarget.trim(), replaceWith.trim(), additionalChange);
      setInput(prompt);
      setRequestError("");
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(prompt.length, prompt.length);
      });
    } else {
      const prompt = VIDEO_REVERSE_PROMPT(additionalChange);
      setInput(prompt);
      setRequestError("");
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(VIDEO_REVERSE_PROMPT.length, VIDEO_REVERSE_PROMPT.length);
      });
    }
  }

  function syncLatestPromptToSeedance() {
    if (!latestAssistantText) {
      setRequestError('请先让创意助手完成一次视频提示词反推。');
      return;
    }

    // 格式化：在每个章节标题前插入一个空行，标题后紧跟正文不空行
    const formatted = latestAssistantText
      .replace(/\n{2,}/g, '\n')
      .replace(/(\d+[.、]\s*|第?[一二三四五六七八九十]+[、.]?\s*)(核心主体信息|场景与背景环境|构图与机位|镜头运动|动作设计与时间顺序|节奏与动态风格|光影与色彩|情绪与气质|复刻关键约束|负面约束|最终可直接用于|负面提示词)/g, '\n\n$1$2')
      .replace(/(最终可直接用于[^\n]*)/g, '\n\n$1')
      .replace(/(负面提示词[^\n]*)/g, '\n\n$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    setSeedancePrompt(formatted);
    setRequestError("");
  }

  function getAtReferenceLabel(ref: SeedanceReferenceFile, index: number) {
    const kindPrefix = ref.kind === 'image' ? 'img' : ref.kind === 'video' ? 'vid' : 'aud';
    const kindIndex = seedanceReferences.filter((r, i) => r.kind === ref.kind && i <= index).length;
    return `@${kindPrefix}${kindIndex}`;
  }

  function handleSeedancePromptChange(event: { target: { value: string; selectionStart: number | null } }) {
    const value = event.target.value;
    setSeedancePrompt(value);

    const cursorPosition = event.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPosition);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setShowAtMenu(true);
        return;
      }
    }

    setShowAtMenu(false);
  }

  function insertAtReference(index: number) {
    const ref = seedanceReferences[index];
    if (!ref || !seedancePromptRef.current) return;

    const cursorPosition = seedancePromptRef.current.selectionStart;
    const value = seedancePrompt;

    const textBeforeCursor = value.slice(0, cursorPosition);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    if (atIndex === -1) return;

    const placeholder = getAtReferenceLabel(ref, index);
    const before = value.slice(0, atIndex);
    const after = value.slice(cursorPosition);
    const newValue = before + placeholder + after;

    setSeedancePrompt(newValue);
    setShowAtMenu(false);

    requestAnimationFrame(() => {
      if (seedancePromptRef.current) {
        const newCursorPos = atIndex + placeholder.length;
        seedancePromptRef.current.selectionStart = newCursorPos;
        seedancePromptRef.current.selectionEnd = newCursorPos;
        seedancePromptRef.current.focus();
      }
    });
  }

  async function handleCreateSeedanceVideo() {
    const prompt = seedancePrompt.trim();
    if (!prompt || isSeedanceLoading) return;

    if (seedanceReferences.length === 0) {
      const confirmed = window.confirm('当前未添加任何参考图片或视频，确定只使用文本提示词生成视频吗？');
      if (!confirmed) return;
    }

    const lastPrompt = seedanceHistory[0]?.prompt;
    if (lastPrompt && lastPrompt.trim() === prompt) {
      const confirmed = window.confirm('检测到本次提示词与上次完全相同，确定要再次生成一模一样的内容吗？');
      if (!confirmed) return;
    }

    setIsSeedanceLoading(true);
    setSeedanceError("");
    setSeedanceTask(null);

    try {
      const task = await createSeedanceTask({
        prompt,
        ratio: seedanceRatio,
        duration: seedanceDuration,
        generateAudio: seedanceGenerateAudio,
        watermark: seedanceWatermark,
        references: seedanceReferences,
      });
      setSeedanceTask({
        ...task,
        createdAt: task.createdAt || Math.floor(Date.now() / 1000),
      });
      setSeedanceHistory((previous) =>
        mergeSeedanceHistoryItem(
          previous,
          createSeedanceHistoryItem(
            {
              ...task,
              createdAt: task.createdAt || Math.floor(Date.now() / 1000),
            },
            {
              prompt,
              ratio: seedanceRatio,
              duration: seedanceDuration,
              generateAudio: seedanceGenerateAudio,
              watermark: seedanceWatermark,
            }
          )
        )
      );
    } catch (error) {
      setSeedanceError(error instanceof Error ? error.message : 'Seedance 创建任务失败');
    } finally {
      setIsSeedanceLoading(false);
    }
  }

  async function handleRefreshSeedanceTask() {
    const taskId = seedanceTask?.taskId;
    if (!taskId || isSeedancePolling) return;

    setIsSeedancePolling(true);
    setSeedanceError("");

    try {
      const nextTask = await querySeedanceTask(taskId);
      updateSeedanceHistoryTask(nextTask);
      setSeedanceTask((previous) =>
        previous?.taskId === taskId
          ? {
              ...previous,
              ...nextTask,
            }
          : previous
      );
    } catch (error) {
      setSeedanceError(error instanceof Error ? error.message : 'Seedance 查询任务失败');
    } finally {
      setIsSeedancePolling(false);
    }
  }

  async function handleRefreshSeedanceHistoryItem(item: SeedanceHistoryItem) {
    if (!item.taskId || isSeedancePolling) return;

    setIsSeedancePolling(true);
    setSeedanceError("");

    try {
      const nextTask = await querySeedanceTask(item.taskId);
      updateSeedanceHistoryTask(nextTask);
      setSeedanceTask((previous) =>
        previous?.taskId === item.taskId
          ? {
              ...previous,
              ...nextTask,
            }
          : previous
      );
    } catch (error) {
      setSeedanceError(error instanceof Error ? error.message : 'Seedance 查询任务失败');
    } finally {
      setIsSeedancePolling(false);
    }
  }

  function handleViewSeedanceHistoryItem(item: SeedanceHistoryItem) {
    if (item.videoUrl) {
      setSeedanceModalItem(item);
      setSeedanceVideoModal(true);
      return;
    }
    setSeedanceTask({
      ok: true,
      taskId: item.taskId,
      status: item.status,
      videoUrl: item.videoUrl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      response: {
        id: item.taskId,
        status: item.status,
        content: item.videoUrl ? { video_url: item.videoUrl } : undefined,
      },
    });
    setSeedancePrompt(item.prompt);
    setSeedanceRatio(item.ratio);
    setSeedanceDuration(item.duration);
    setSeedanceGenerateAudio(item.generateAudio);
    setSeedanceWatermark(item.watermark);
  }

  function removeSeedanceHistoryItem(taskId: string) {
    setSeedanceHistory((previous) => previous.filter((item) => item.taskId !== taskId));
    setSeedanceTask((previous) => previous?.taskId === taskId ? null : previous);
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

  function handleSeedanceReferenceChange(files: FileList | null) {
    setSeedanceError("");
    if (!files?.length) return;

    const nextReferences: SeedanceReferenceFile[] = [];
    let imageCount = seedanceReferences.filter((item) => item.kind === 'image').length;
    let videoCount = seedanceReferences.filter((item) => item.kind === 'video').length;
    let audioCount = seedanceReferences.filter((item) => item.kind === 'audio').length;

    for (const file of Array.from(files)) {
      const kind = getSeedanceReferenceKind(file);
      if (!kind) {
        setSeedanceError(`不支持的素材格式：${file.name}`);
        continue;
      }

      if (kind === 'image') {
        imageCount += 1;
        if (imageCount > 9) {
          setSeedanceError('参考图片最多上传 9 张。');
          continue;
        }
      }

      if (kind === 'video') {
        if (!publicBaseUrlConfigured) {
          setSeedanceError('视频参考功能仅线上环境可用，本地开发不支持上传视频参考素材。');
          continue;
        }
        videoCount += 1;
        if (videoCount > 3) {
          setSeedanceError('参考视频最多上传 3 个。');
          continue;
        }
        if (file.size > 50 * 1024 * 1024) {
          setSeedanceError('参考视频单个文件不能超过 50MB。');
          continue;
        }
      }

      if (kind === 'audio') {
        audioCount += 1;
        if (audioCount > 3) {
          setSeedanceError('参考音频最多上传 3 段。');
          continue;
        }
        if (file.size > 15 * 1024 * 1024) {
          setSeedanceError('参考音频单个文件不能超过 15MB。');
          continue;
        }
      }

      nextReferences.push({
        id: createMessageId('seedance_ref'),
        kind,
        file,
        previewUrl: kind === 'audio' ? undefined : createMediaPreviewUrl(file),
        fileName: file.name,
      });
    }

    if (nextReferences.length) {
      setSeedanceReferences((previous) => [...previous, ...nextReferences]);
    }

    if (seedanceFileInputRef.current) {
      seedanceFileInputRef.current.value = '';
    }
  }

  function removeSeedanceReference(referenceId: string) {
    setSeedanceReferences((previous) => {
      const target = previous.find((item) => item.id === referenceId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return previous.filter((item) => item.id !== referenceId);
    });
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

  async function handleReplaceImageChange(file: File | null) {
    setRequestError("");
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) {
        setRequestError('替换参考图必须是图片格式');
        return;
      }
      if (file.size > MAX_VIDEO_SIZE_BYTES) {
        setRequestError('图片请控制在 150MB 以内。');
        return;
      }
      const previewUrl = createMediaPreviewUrl(file);
      if (replaceImage) {
        URL.revokeObjectURL(replaceImage.previewUrl);
      }
      setReplaceImage({
        kind: 'image',
        file,
        previewUrl,
        fileName: file.name,
      });
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '图片读取失败，请换一张再试。');
    } finally {
      if (replaceImageInputRef.current) {
        replaceImageInputRef.current.value = '';
      }
    }
  }

  function clearReplaceImage() {
    if (replaceImage) {
      URL.revokeObjectURL(replaceImage.previewUrl);
    }
    setReplaceImage(null);
    setRequestError("");
    if (replaceImageInputRef.current) {
      replaceImageInputRef.current.value = '';
    }
  }

  async function copyMessageContent(id: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId((current) => (current === id ? null : current)), 2000);
    } catch {
      // Fallback for environments without clipboard API
    }
  }

  async function handleSend() {
    if (!input.trim() || isLoading) return;

    const rawQuestion = input.trim();
    // If the user is sending the video reverse prompt, silently append format
    // instructions so Doubao returns each section on its own line without
    // cluttering the input box.
    const isReversePrompt = rawQuestion.includes('待复刻样片') && rawQuestion.includes('核心主体信息');
    const question = isReversePrompt ? rawQuestion + VIDEO_REVERSE_FORMAT_SUFFIX : rawQuestion;
    const isReplaceMode = reverseMode === 'replace' && selectedMedia?.kind === 'video' && replaceImage;
    const mediaToSend: SelectedCreativeMedia | SelectedCreativeMedia[] | null = isReplaceMode
      ? [selectedMedia!, replaceImage!]
      : selectedMedia;
    const mediaMessages: Message[] = [];
    if (isReplaceMode) {
      if (selectedMedia) {
        mediaMessages.push({
          id: createMessageId(`creative_${selectedMedia.kind}`),
          role: 'user',
          type: selectedMedia.kind,
          content: '',
          mediaUrl: selectedMedia.previewUrl,
          mediaKind: selectedMedia.kind,
          fileName: selectedMedia.fileName,
          timestamp: new Date(),
        });
      }
      if (replaceImage) {
        mediaMessages.push({
          id: createMessageId(`creative_${replaceImage.kind}`),
          role: 'user',
          type: replaceImage.kind,
          content: '',
          mediaUrl: replaceImage.previewUrl,
          mediaKind: replaceImage.kind,
          fileName: replaceImage.fileName,
          timestamp: new Date(),
        });
      }
    } else if (selectedMedia) {
      mediaMessages.push({
        id: createMessageId(`creative_${selectedMedia.kind}`),
        role: 'user',
        type: selectedMedia.kind,
        content: '',
        mediaUrl: selectedMedia.previewUrl,
        mediaKind: selectedMedia.kind,
        fileName: selectedMedia.fileName,
        timestamp: new Date(),
      });
    }
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
      ...mediaMessages,
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
    setReplaceImage(null);
    setIsLoading(true);
    setRequestError("");
    scrollAnalysisToBottom();

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
          scrollAnalysisToBottom();
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

  const seedanceElapsedText = seedanceTask && !seedanceTask.videoUrl
    ? formatSeedanceWait(getSeedanceElapsedSeconds(seedanceTask, seedanceClock))
    : '';

  return (
    <div className="h-screen bg-slate-200 flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => handleMediaChange(event.target.files?.[0] || null)}
      />
      <input
        ref={seedanceFileInputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={(event) => handleSeedanceReferenceChange(event.target.files)}
      />
      <input
        ref={replaceImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleReplaceImageChange(event.target.files?.[0] || null)}
      />

      <header className="h-14 border-b border-slate-300 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2.5 h-9 rounded-full pl-1 pr-4 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300 group"
          >
            <div className="size-7 rounded-full bg-slate-900 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
              <ArrowLeft className="size-3.5" />
            </div>
            <span className="text-xs font-bold text-slate-700">返回</span>
          </button>
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
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
            <button
              type="button"
              onClick={handleCreateNewSession}
              disabled={isLoading}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="size-3.5" />
              新建会话
            </button>
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
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-xs font-bold text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500"
          >
            <LogOut className="size-3.5" />
            退出登录
          </button>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 scroll-smooth"
      >
        <div className="max-w-6xl mx-auto w-full space-y-6">
          <section className="grid gap-6 lg:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
            <div className="rounded-[22px] border border-slate-300 bg-white p-4 shadow-[0_10px_40px_rgba(15,23,42,0.1)] md:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">
                    <Film className="size-3.5" />
                    模块一
                  </div>
                  <h2 className="text-base font-black text-slate-900">视频反推提示词</h2>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wider text-emerald-600">
                  已接入豆包多模态
                </span>
              </div>

              <div className="mb-4 flex rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setReverseMode('direct')}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                    reverseMode === 'direct'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Sparkles className="size-3.5" />
                    直接反推
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setReverseMode('replace')}
                  className={cn(
                    'flex-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-all',
                    reverseMode === 'replace'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Replace className="size-3.5" />
                    元素替换
                  </span>
                </button>
              </div>

              <div className="min-h-[190px] rounded-2xl border border-slate-300 bg-slate-100 p-3">
                {selectedMedia ? (
                  <div className="space-y-3">
                    {selectedMedia.kind === 'video' ? (
                      <video
                        src={selectedMedia.previewUrl}
                        controls
                        preload="metadata"
                        className="aspect-video w-full rounded-xl bg-slate-950 object-contain"
                      />
                    ) : (
                      <img
                        src={selectedMedia.previewUrl}
                        alt={selectedMedia.fileName}
                        className="aspect-video w-full rounded-xl bg-slate-950 object-contain"
                      />
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-xs font-semibold text-slate-500">
                        <span className="block truncate">{selectedMedia.fileName}</span>
                        <span className="text-slate-400">
                          {reverseMode === 'replace' ? '待分析的原视频' : '将随下一条消息发送给 AI 助手'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={clearSelectedMedia}
                        className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
                        aria-label="移除媒体"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isLoading}
                    className="flex min-h-[160px] w-full flex-col items-center justify-center gap-3 rounded-xl text-center transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex size-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                      <Plus className="size-5" />
                    </span>
                    <span className="text-sm font-bold text-slate-700">
                      {reverseMode === 'replace' ? '上传原视频' : '上传视频'}
                    </span>
                    <span className="max-w-xs text-xs leading-5 text-slate-400">
                      支持常见视频格式，当前上限 150MB。
                    </span>
                  </button>
                )}
              </div>

              {reverseMode === 'replace' && (
                <div className="mt-3 space-y-3">
                  <div className="rounded-2xl border border-slate-300 bg-slate-100 p-3">
                    {replaceImage ? (
                      <div className="space-y-3">
                        <img
                          src={replaceImage.previewUrl}
                          alt={replaceImage.fileName}
                          className="aspect-video w-full rounded-xl bg-slate-950 object-contain"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 text-xs font-semibold text-slate-500">
                            <span className="block truncate">{replaceImage.fileName}</span>
                            <span className="text-slate-400">替换参考图</span>
                          </div>
                          <button
                            type="button"
                            onClick={clearReplaceImage}
                            className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
                            aria-label="移除参考图"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => replaceImageInputRef.current?.click()}
                        disabled={isLoading}
                        className="flex min-h-[120px] w-full flex-col items-center justify-center gap-3 rounded-xl text-center transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex size-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                          <ImageIcon className="size-4" />
                        </span>
                        <span className="text-sm font-bold text-slate-700">上传替换参考图</span>
                        <span className="max-w-xs text-xs leading-5 text-slate-400">
                          上传你想替换成的元素图片
                        </span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-600">替换目标</label>
                      <input
                        type="text"
                        value={replaceTarget}
                        onChange={(e) => setReplaceTarget(e.target.value)}
                        placeholder="如：书架"
                        disabled={isLoading}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-300 focus:border-indigo-400 disabled:opacity-60"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-600">替换成</label>
                      <input
                        type="text"
                        value={replaceWith}
                        onChange={(e) => setReplaceWith(e.target.value)}
                        placeholder="如：书桌"
                        disabled={isLoading}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-300 focus:border-indigo-400 disabled:opacity-60"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 space-y-1.5">
                <label className="text-[11px] font-bold text-slate-600">额外调整（可选）</label>
                <input
                  type="text"
                  value={additionalChange}
                  onChange={(e) => setAdditionalChange(e.target.value)}
                  placeholder="如：把模特的衣服换成红色"
                  disabled={isLoading}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-300 focus:border-indigo-400 disabled:opacity-60"
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={prepareVideoReversePrompt}
                  disabled={
                    isLoading ||
                    selectedMedia?.kind !== 'video' ||
                    (reverseMode === 'replace' && (!replaceImage || !replaceTarget.trim() || !replaceWith.trim()))
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className="size-3.5" />
                  {reverseMode === 'replace' ? '填入替换指令' : '填入反推指令'}
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Film className="size-3.5" />
                  更换视频
                </button>
                {reverseMode === 'replace' && (
                  <button
                    type="button"
                    onClick={() => replaceImageInputRef.current?.click()}
                    disabled={isLoading}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <ImageIcon className="size-3.5" />
                    更换参考图
                  </button>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-slate-300 bg-slate-100">
                <div className="flex items-center justify-between gap-3 border-b border-slate-300 px-4 py-3">
                  <div>
                    <div className="text-xs font-black text-slate-900">豆包分析记录</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">反推结果会显示在这里，并可同步到右侧</div>
                  </div>
                  {isLoading && (
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-indigo-600">
                      <Loader2 className="size-3.5 animate-spin" />
                      分析中
                    </span>
                  )}
                </div>

                <div ref={analysisScrollRef} className="max-h-[440px] overflow-y-auto p-3">
                  {messages.filter((msg) => msg.id !== 'creative_welcome').length === 0 ? (
                    <div className="grid min-h-[130px] place-items-center rounded-xl bg-white text-center">
                      <div>
                        <div className="text-sm font-bold text-slate-600">上传视频后开始反推</div>
                        <div className="mt-1 text-xs text-slate-400">点击"填入反推指令"，再开始反推。</div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <AnimatePresence initial={false}>
                        {messages.filter((msg) => msg.id !== 'creative_welcome').map((msg) => (
                          <motion.div
                            key={msg.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className={cn("flex flex-col", msg.role === 'user' ? "items-end" : "items-start")}
                          >
                            <div className="mb-1.5 flex items-center gap-2 px-1">
                              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                                {msg.role === 'user' ? '学生' : 'AI 助手'}
                              </span>
                              <span className="text-[10px] text-slate-300">•</span>
                              <span className="text-[10px] font-bold text-slate-400">
                                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {msg.role === 'assistant' && msg.content && (
                                <button
                                  type="button"
                                  onClick={() => copyMessageContent(msg.id, msg.content)}
                                  className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                                  aria-label="复制消息"
                                >
                                  {copiedMessageId === msg.id ? (
                                    <>
                                      <Check className="size-3 text-emerald-500" />
                                      已复制
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="size-3" />
                                      复制
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                            <div className={cn(
                              "border transition-all duration-300",
                              msg.role === 'user'
                                ? "max-w-[86%] rounded-2xl rounded-tr-sm border-slate-800 bg-slate-900 px-4 py-3 text-sm leading-7 text-white shadow-sm whitespace-pre-wrap"
                                : "w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-slate-700 shadow-sm"
                            )}>
                              {msg.type === 'video' && msg.mediaUrl ? (
                                <div className="space-y-2">
                                  <video
                                    src={msg.mediaUrl}
                                    controls
                                    preload="metadata"
                                    className="max-h-52 w-full rounded-xl bg-slate-950 object-contain"
                                  />
                                  <div className="truncate text-xs text-slate-400">{msg.fileName || '已加入当前会话视频上下文'}</div>
                                </div>
                              ) : msg.pending && !msg.content ? (
                                <Loader2 className="size-4 animate-spin text-indigo-600" />
                              ) : (
                                msg.role === 'assistant' ? renderAssistantMessageContent(msg.content) : msg.content
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-300 bg-white p-3 shadow-sm focus-within:border-indigo-300">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="填写反推提示词指令，或让豆包按你的要求分析视频..."
                  className="min-h-[104px] w-full resize-none border-none bg-transparent p-1 pr-14 text-sm leading-7 text-slate-700 outline-none"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ImageIcon className="size-3.5" />
                      上传图片
                    </button>
                    <span className="text-[11px] font-medium text-slate-300">|</span>
                    <span className="text-[11px] font-medium text-slate-400">Enter 发送，Shift + Enter 换行</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    开始反推
                  </button>
                </div>
              </div>

              {(requestError || !configReachable || !arkApiConfigured) && (
                <div className="mt-3 space-y-1 text-[11px] font-medium leading-5 text-red-500">
                  {!configReachable && <div>无法读取服务端配置，请确认后端已启动。</div>}
                  {configReachable && !arkApiConfigured && <div>服务端缺少 ARK_API_KEY，创意创作暂时不可用。</div>}
                  {requestError && <div>{requestError}</div>}
                </div>
              )}
            </div>

            <div className="rounded-[22px] border border-slate-300 bg-white p-4 shadow-[0_10px_40px_rgba(15,23,42,0.1)] md:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-violet-500">
                    <Sparkles className="size-3.5" />
                    模块二
                  </div>
                  <h2 className="text-base font-black text-slate-900">Seedance 2.0 生成视频</h2>
                </div>
                <span className={cn(
                  "rounded-full px-3 py-1 text-[10px] font-black tracking-wider",
                  seedanceApiConfigured ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
                )}>
                  {seedanceApiConfigured ? '已接入 Seedance 2.0' : '待配置'}
                </span>
              </div>

              <div className="rounded-2xl border border-slate-300 bg-slate-100 p-3 relative">
                {/* 提示词输入框 */}
                <textarea
                  ref={seedancePromptRef}
                  value={seedancePrompt}
                  onChange={handleSeedancePromptChange}
                  placeholder="等待模块一反推出视频提示词..."
                  className="min-h-[280px] w-full resize-none rounded-xl border border-slate-300 bg-white p-4 text-sm leading-7 text-slate-700 outline-none transition-colors focus:border-violet-300 whitespace-pre-wrap"
                />

                {/* @ 引用下拉菜单 */}
                {showAtMenu && (
                  <div data-at-menu className="absolute left-3 right-3 top-[calc(100%-8px)] z-10 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                    {seedanceReferences.length === 0 ? (
                      <div className="px-3 py-3 text-center text-xs text-slate-400">
                        暂无参考素材，请先点击下方“添加参考素材”上传
                      </div>
                    ) : (
                      <>
                        <div className="px-3 py-2 text-[10px] font-bold text-slate-400 border-b border-slate-100">
                          选择参考素材插入到提示词中
                        </div>
                        {seedanceReferences.map((reference, index) => {
                          const label = getAtReferenceLabel(reference, index);
                          return (
                            <button
                              key={reference.id}
                              type="button"
                              onClick={() => insertAtReference(index)}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-violet-50"
                            >
                              <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-400">
                                {reference.kind === 'image' && reference.previewUrl ? (
                                  <img src={reference.previewUrl} alt={reference.fileName} className="size-full object-cover" />
                                ) : reference.kind === 'video' && reference.previewUrl ? (
                                  <video src={reference.previewUrl} className="size-full object-cover" muted />
                                ) : (
                                  <Music className="size-3.5" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-bold text-slate-700">
                                  {label} <span className="text-slate-400 font-medium">{reference.fileName}</span>
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {reference.kind === 'image' ? '参考图片' : reference.kind === 'video' ? '参考视频' : '参考音频'}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}

                {/* 已上传的参考素材列表 */}
                {seedanceReferences.length > 0 && (
                  <div className="mt-3 grid gap-2">
                    {seedanceReferences.map((reference) => (
                      <div key={reference.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2">
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-slate-400">
                          {reference.kind === 'image' && reference.previewUrl ? (
                            <img src={reference.previewUrl} alt={reference.fileName} className="size-full object-cover" />
                          ) : reference.kind === 'video' && reference.previewUrl ? (
                            <video src={reference.previewUrl} className="size-full object-cover" muted />
                          ) : (
                            <Music className="size-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-bold text-slate-700">{reference.fileName}</div>
                          <div className="text-[11px] text-slate-400">
                            {reference.kind === 'image' ? '参考图片' : reference.kind === 'video' ? '参考视频' : '参考音频'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSeedanceReference(reference.id)}
                          className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-red-500"
                          aria-label="移除参考素材"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* 底部工具栏：添加素材 + 设置 */}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => seedanceFileInputRef.current?.click()}
                    disabled={isSeedanceLoading}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="size-3.5" />
                    添加素材
                  </button>
                  <div ref={seedanceSettingsRef} className="relative flex-1">
                    <button
                      type="button"
                      onClick={() => setShowSeedanceSettings((value) => !value)}
                      className="flex h-9 w-full flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-left text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <SlidersHorizontal className="size-3.5 text-slate-500" />
                      <span>{getSeedanceRatioLabel(seedanceRatio)}</span>
                      <span className="h-3.5 w-px bg-slate-200" />
                      <span>{seedanceDuration} 秒</span>
                      <span className="h-3.5 w-px bg-slate-200" />
                      <span className="inline-flex items-center gap-1">
                        <Volume2 className="size-3" />
                        {seedanceGenerateAudio ? '声音' : '静音'}
                      </span>
                      <span className="h-3.5 w-px bg-slate-200" />
                      <span>{seedanceWatermark ? '水印' : '无水印'}</span>
                    </button>

                    {showSeedanceSettings && (
                      <div className="absolute left-0 right-0 z-20 mt-2 rounded-2xl border border-slate-300 bg-white p-3 shadow-[0_18px_45px_rgba(15,23,42,0.14)]">
                        <div>
                          <div className="mb-2 text-xs font-black text-slate-700">视频比例</div>
                          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                            {SEEDANCE_RATIOS.map((ratio) => (
                              <button
                                key={ratio}
                                type="button"
                                onClick={() => setSeedanceRatio(ratio)}
                                className={cn(
                                  "rounded-xl border px-2 py-2 text-xs font-black transition-colors",
                                  seedanceRatio === ratio
                                    ? "border-violet-300 bg-violet-50 text-violet-700"
                                    : "border-slate-200 bg-slate-50 text-slate-500 hover:border-violet-200 hover:bg-white"
                                )}
                              >
                                {getSeedanceRatioLabel(ratio)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4">
                          <div className="mb-2 text-xs font-black text-slate-700">视频时长</div>
                          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                            {SEEDANCE_DURATIONS.map((duration) => (
                              <button
                                key={duration}
                                type="button"
                                onClick={() => setSeedanceDuration(duration)}
                                className={cn(
                                  "rounded-xl border px-2 py-2 text-xs font-black transition-colors",
                                  seedanceDuration === duration
                                    ? "border-violet-300 bg-violet-50 text-violet-700"
                                    : "border-slate-200 bg-slate-50 text-slate-500 hover:border-violet-200 hover:bg-white"
                                )}
                              >
                                {duration} 秒
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setSeedanceGenerateAudio((value) => !value)}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-xs font-black transition-colors",
                              seedanceGenerateAudio
                                ? "border-violet-300 bg-violet-50 text-violet-700"
                                : "border-slate-200 bg-slate-50 text-slate-500 hover:border-violet-200 hover:bg-white"
                            )}
                          >
                            {seedanceGenerateAudio ? '生成声音' : '不生成声音'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setSeedanceWatermark((value) => !value)}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-xs font-black transition-colors",
                              seedanceWatermark
                                ? "border-violet-300 bg-violet-50 text-violet-700"
                                : "border-slate-200 bg-slate-50 text-slate-500 hover:border-violet-200 hover:bg-white"
                            )}
                          >
                            {seedanceWatermark ? '添加水印' : '无水印'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={syncLatestPromptToSeedance}
                  disabled={!latestAssistantText}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="size-3.5" />
                  同步最新提示词
                </button>
                <button
                  type="button"
                  onClick={handleCreateSeedanceVideo}
                  disabled={!seedancePrompt.trim() || isSeedanceLoading || !seedanceApiConfigured}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSeedanceLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  开始生成视频
                </button>
                <button
                  type="button"
                  onClick={() => setSeedancePrompt("")}
                  disabled={!seedancePrompt.trim() || isSeedanceLoading}
                  className={cn(
                    "ml-auto inline-flex items-center rounded-full px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed",
                    seedancePrompt.trim()
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "border border-slate-100 bg-slate-50 text-slate-300 opacity-60"
                  )}
                >
                  清空提示词
                </button>
              </div>

              {/* 生成任务预览区域 */}
              <div className="mt-3">
                {isSeedanceLoading ? (
                  <div className="flex min-h-[180px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white p-3 text-xs font-bold text-violet-600">
                    <Loader2 className="size-4 animate-spin" />
                    正在创建 Seedance 任务
                  </div>
                ) : seedanceTask ? (
                  <div className="space-y-2">
                    {/* 等待中：科技感深色卡片 */}
                    {!seedanceTask.videoUrl && !isSeedanceFailureStatus(seedanceTask.status) && (
                      <div className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 px-5 py-8 text-center shadow-xl">
                        {/* 网格背景 */}
                        <div
                          className="pointer-events-none absolute inset-0 opacity-10"
                          style={{
                            backgroundImage: 'linear-gradient(rgba(99,102,241,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.4) 1px, transparent 1px)',
                            backgroundSize: '24px 24px',
                          }}
                        />
                        {/* 扫描线 */}
                        <div
                          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-60"
                          style={{ animation: 'tech-scan 2.5s linear infinite' }}
                        />
                        {/* 顶部光晕 */}
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-cyan-500/10 to-transparent" />

                        <div className="relative">
                          <div className="mb-5 flex justify-center gap-2">
                            {[0, 1, 2].map((i) => (
                              <span
                                key={i}
                                className="inline-block h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]"
                                style={{
                                  animation: `tech-pulse 1.6s infinite ease-in-out both`,
                                  animationDelay: `${i * 0.2}s`,
                                }}
                              />
                            ))}
                          </div>
                          <div className="text-sm font-black tracking-wider text-white">
                            任务处理中
                          </div>
                          <div className="mt-1.5 text-xs font-semibold text-cyan-300/80">
                            已等待 {seedanceElapsedText}
                          </div>
                          <div className="mt-3 text-[11px] text-slate-500">
                            视频生成中，完成后将在此自动展示
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 成功：内联视频播放 */}
                    {seedanceTask.videoUrl && (
                      <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex items-center justify-between gap-2 px-1">
                          <div className="flex items-center gap-2">
                            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
                            <span className="text-xs font-black text-emerald-600">
                              {getSeedanceStatusLabel(seedanceTask.status, true)}
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            {seedanceRatio} · {seedanceDuration}秒
                          </span>
                        </div>
                        <div className="relative mx-auto w-full overflow-hidden rounded-xl bg-slate-950">
                          <video
                            src={seedanceTask.videoUrl}
                            controls
                            autoPlay
                            loop
                            playsInline
                            className="mx-auto aspect-[9/16] w-full max-h-[480px] object-contain"
                          />
                        </div>
                        <div className="flex flex-wrap gap-2 px-1 pt-1">
                          <a
                            href={seedanceTask.videoUrl}
                            download={`seedance-${seedanceTask.taskId || 'video'}.mp4`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-[11px] font-bold text-white hover:bg-emerald-700"
                          >
                            <Download className="size-3.5" />
                            下载视频
                          </a>
                        </div>
                      </div>
                    )}

                    {/* 失败 */}
                    {isSeedanceFailureStatus(seedanceTask.status) && !seedanceTask.videoUrl && (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                        <div className="text-sm font-black text-red-600">
                          {getSeedanceStatusLabel(seedanceTask.status, false)}
                        </div>
                        <div className="mt-1 text-xs text-red-400">
                          任务执行失败，请检查提示词或参考素材后重试
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid min-h-[200px] place-items-center rounded-xl border border-dashed border-slate-300 bg-white p-3 text-center">
                    <div>
                      <div className="text-xs font-bold text-slate-400">视频生成预览区</div>
                      <div className="mt-1 text-[11px] text-slate-400">创建任务后，生成视频将在此展示</div>
                    </div>
                  </div>
                )}

                {seedanceError && (
                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium leading-5 text-red-500">
                    {seedanceError}
                  </div>
                )}
              </div>

              {/* 生成历史 — 底部全宽区域 */}
              <div className="mt-6 rounded-2xl border border-slate-300 bg-slate-100 p-3 md:p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-slate-800">生成历史</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">保存最近 {MAX_SEEDANCE_HISTORY_ITEMS} 个 Seedance 任务</div>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-400 ring-1 ring-slate-200">
                    {seedanceHistory.length} 条
                  </span>
                </div>

                {seedanceHistory.length === 0 ? (
                  <div className="grid min-h-[84px] place-items-center rounded-xl border border-slate-300 bg-white text-center">
                    <div>
                      <div className="text-xs font-bold text-slate-500">暂无生成记录</div>
                      <div className="mt-1 text-[11px] text-slate-400">提交视频任务后会自动保存到这里</div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* 最近一条始终展开 */}
                    {(() => {
                      const latest = seedanceHistory[0];
                      return (
                        <div key={latest.taskId} className="rounded-xl border border-slate-300 bg-white p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-black text-slate-700">
                                {latest.prompt.replace(/\s+/g, ' ').slice(0, 48) || 'Seedance 视频任务'}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-slate-400">
                                <span>{formatSessionTime(latest.savedAt)}</span>
                                <span>{latest.ratio}</span>
                                <span>{latest.duration} 秒</span>
                                <span>{getSeedanceStatusLabel(latest.status, !!latest.videoUrl)}</span>
                                {latest.elapsedSeconds !== undefined && latest.elapsedSeconds > 0 && (
                                  <span className="text-emerald-600">
                                    生成耗时 {formatElapsedDuration(latest.elapsedSeconds)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(latest.prompt);
                                    setCopiedMessageId(latest.taskId);
                                    setTimeout(() => setCopiedMessageId((current) => (current === latest.taskId ? null : current)), 2000);
                                  } catch {}
                                }}
                                className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                                aria-label="复制提示词"
                                title="复制提示词"
                              >
                                {copiedMessageId === latest.taskId ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSeedanceHistoryItem(latest.taskId)}
                                className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                                aria-label="删除生成记录"
                              >
                                <X className="size-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleViewSeedanceHistoryItem(latest)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800"
                            >
                              {latest.videoUrl ? (
                                <>
                                  <Sparkles className="size-3.5" />
                                  查看视频
                                </>
                              ) : (
                                '查看'
                              )}
                            </button>
                            {latest.videoUrl && (
                              <a
                                href={latest.videoUrl}
                                download={`seedance-${latest.taskId}.mp4`}
                                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
                              >
                                <Download className="size-3.5" />
                                下载
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* 折叠的 older records */}
                    {seedanceHistory.length > 1 && (
                      <AnimatePresence initial={false} mode="wait">
                        {isHistoryFolded ? (
                          <motion.button
                            key="expand"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            type="button"
                            onClick={() => setIsHistoryFolded(false)}
                            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-2.5 text-xs font-bold text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700"
                          >
                            <ChevronDown className="size-4" />
                            展开更多 ({seedanceHistory.length - 1} 条)
                          </motion.button>
                        ) : (
                          <motion.div
                            key="collapse"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="space-y-2 overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() => setIsHistoryFolded(true)}
                              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white py-2.5 text-xs font-bold text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700"
                            >
                              <ChevronUp className="size-4" />
                              收起
                            </button>
                            {seedanceHistory.slice(1).map((item) => (
                              <div key={item.taskId} className="rounded-xl border border-slate-300 bg-white p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-black text-slate-700">
                                      {item.prompt.replace(/\s+/g, ' ').slice(0, 48) || 'Seedance 视频任务'}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-slate-400">
                                      <span>{formatSessionTime(item.savedAt)}</span>
                                      <span>{item.ratio}</span>
                                      <span>{item.duration} 秒</span>
                                      <span>{getSeedanceStatusLabel(item.status, !!item.videoUrl)}</span>
                                      {item.elapsedSeconds !== undefined && item.elapsedSeconds > 0 && (
                                        <span className="text-emerald-600">
                                          生成耗时 {formatElapsedDuration(item.elapsedSeconds)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-0.5">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await navigator.clipboard.writeText(item.prompt);
                                          setCopiedMessageId(item.taskId);
                                          setTimeout(() => setCopiedMessageId((current) => (current === item.taskId ? null : current)), 2000);
                                        } catch {}
                                      }}
                                      className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                                      aria-label="复制提示词"
                                      title="复制提示词"
                                    >
                                      {copiedMessageId === item.taskId ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeSeedanceHistoryItem(item.taskId)}
                                      className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                                      aria-label="删除生成记录"
                                    >
                                      <X className="size-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleViewSeedanceHistoryItem(item)}
                                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800"
                                  >
                                    {item.videoUrl ? (
                                      <>
                                        <Sparkles className="size-3.5" />
                                        查看视频
                                      </>
                                    ) : (
                                      '查看'
                                    )}
                                  </button>
                                  {item.videoUrl && (
                                    <a
                                      href={item.videoUrl}
                                      download={`seedance-${item.taskId}.mp4`}
                                      className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
                                    >
                                      <Download className="size-3.5" />
                                      下载
                                    </a>
                                  )}
                                </div>
                              </div>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>


          <SiteFooter className="mt-3 pb-1" />
        </div>
      </div>

      <AnimatePresence>
        {seedanceVideoModal && seedanceModalItem?.videoUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm"
            onClick={() => setSeedanceVideoModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="relative mx-4 w-full max-w-5xl rounded-3xl border border-white/10 bg-slate-950 p-2 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute -top-12 left-0 right-0 flex items-center justify-between px-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-white">
                    {seedanceModalItem.prompt.replace(/\s+/g, ' ').slice(0, 60) || 'Seedance 视频'}
                  </div>
                  <div className="mt-0.5 flex gap-3 text-xs text-slate-400">
                    <span>{seedanceModalItem.ratio}</span>
                    <span>{seedanceModalItem.duration} 秒</span>
                    <span>{getSeedanceStatusLabel(seedanceModalItem.status, true)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSeedanceVideoModal(false)}
                  className="ml-4 flex size-9 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="关闭弹窗"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="overflow-hidden rounded-2xl bg-black">
                <video
                  src={seedanceModalItem.videoUrl}
                  className="max-h-[78vh] w-full object-contain"
                  controls
                  playsInline
                  autoPlay
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
