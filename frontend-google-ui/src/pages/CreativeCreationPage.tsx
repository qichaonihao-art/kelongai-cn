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
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
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
}

const MAX_VIDEO_SIZE_BYTES = 150 * 1024 * 1024;
const MAX_SAVED_CREATIVE_SESSIONS = 8;
const MAX_SEEDANCE_HISTORY_ITEMS = 20;
const SEEDANCE_POLL_INTERVAL_MS = 15000;
const CREATIVE_SESSIONS_STORAGE_KEY = 'kelongai.creativeSessions';
const SEEDANCE_HISTORY_STORAGE_KEY = 'kelongai.seedanceHistory';
const VIDEO_REVERSE_PROMPT = '请分析这个视频，并反推出可以用于文生视频模型的高质量提示词。请按以下结构输出：一、画面主体；二、场景环境；三、镜头语言；四、动作节奏；五、光影色彩；六、情绪氛围；七、完整视频生成提示词。';
const VIDEO_REVERSE_FORMAT_SUFFIX = '\n\n请严格按照以上七个部分输出，每个部分之间必须空一行（即每个部分结束后换两行再开始下一个部分）。';
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

function getSeedanceElapsedSeconds(task: SeedanceTaskResult | null, nowMs = Date.now()) {
  if (!task) return 0;
  if (task.createdAt && task.createdAt > 0) {
    return Math.max(0, Math.floor(nowMs / 1000) - task.createdAt);
  }
  return 0;
}

function getSeedanceEstimatedText(task: SeedanceTaskResult | null, selectedDuration: number, generateAudio: boolean, referenceCount: number, nowMs = Date.now()) {
  if (!task || task.videoUrl) return '';
  const elapsed = getSeedanceElapsedSeconds(task, nowMs);
  const baseMin = selectedDuration <= 4 ? 4 : selectedDuration <= 8 ? 6 : 8;
  const audioExtra = generateAudio ? 3 : 0;
  const referenceExtra = referenceCount > 0 ? Math.min(6, Math.ceil(referenceCount / 2) * 2) : 0;
  const low = baseMin + audioExtra + referenceExtra;
  const high = low + 8;

  if (!task.status || ['queued', 'pending', 'created'].includes(String(task.status).toLowerCase())) {
    return `官方未返回排队 ETA，当前已等待 ${formatSeedanceWait(elapsed)}，通常可能需要 ${low}-${high} 分钟。`;
  }

  return `官方未返回剩余时间，当前已等待 ${formatSeedanceWait(elapsed)}，同类任务通常可能需要 ${low}-${high} 分钟。`;
}

function getSeedanceProgressPercent(task: SeedanceTaskResult | null, selectedDuration: number, generateAudio: boolean, referenceCount: number, nowMs = Date.now()) {
  if (!task) return 0;
  if (task.videoUrl) return 100;
  if (isSeedanceFailureStatus(task.status)) return 100;
  const elapsed = getSeedanceElapsedSeconds(task, nowMs);
  const estimatedTotalSeconds = (selectedDuration <= 4 ? 8 : selectedDuration <= 8 ? 12 : 16) * 60
    + (generateAudio ? 3 * 60 : 0)
    + Math.min(6 * 60, referenceCount * 60);
  return Math.max(8, Math.min(92, Math.round((elapsed / estimatedTotalSeconds) * 100)));
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

    return parsed
      .filter((item): item is SeedanceHistoryItem => (
        item &&
        typeof item === 'object' &&
        typeof item.taskId === 'string' &&
        typeof item.prompt === 'string'
      ))
      .slice(0, MAX_SEEDANCE_HISTORY_ITEMS);
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
          return <h3 key={blockIndex}>{renderInlineContent(stripMarkdownMarks(firstLine))}</h3>;
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
  const [seedanceApiConfigured, setSeedanceApiConfigured] = useState(true);
  const [selectedMedia, setSelectedMedia] = useState<SelectedCreativeMedia | null>(null);
  const [seedancePrompt, setSeedancePrompt] = useState("");
  const [seedanceRatio, setSeedanceRatio] = useState("16:9");
  const [seedanceDuration, setSeedanceDuration] = useState(5);
  const [seedanceGenerateAudio, setSeedanceGenerateAudio] = useState(true);
  const [seedanceWatermark, setSeedanceWatermark] = useState(false);
  const [seedanceReferences, setSeedanceReferences] = useState<SeedanceReferenceFile[]>([]);
  const [isSeedanceLoading, setIsSeedanceLoading] = useState(false);
  const [isSeedancePolling, setIsSeedancePolling] = useState(false);
  const [seedanceError, setSeedanceError] = useState("");
  const [seedanceTask, setSeedanceTask] = useState<SeedanceTaskResult | null>(null);
  const [seedanceHistory, setSeedanceHistory] = useState<SeedanceHistoryItem[]>(loadSeedanceHistory);
  const [seedanceImportTaskId, setSeedanceImportTaskId] = useState("cgt-20260420210308-cjhsm");
  const [showSeedanceImport, setShowSeedanceImport] = useState(false);
  const [showSeedanceSettings, setShowSeedanceSettings] = useState(false);
  const [seedanceClock, setSeedanceClock] = useState(Date.now());
  const [seedanceVideoModal, setSeedanceVideoModal] = useState(false);
  const [seedanceModalItem, setSeedanceModalItem] = useState<SeedanceHistoryItem | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const analysisScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seedanceFileInputRef = useRef<HTMLInputElement>(null);
  const seedanceSettingsRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SEEDANCE_HISTORY_STORAGE_KEY, JSON.stringify(seedanceHistory));
  }, [seedanceHistory]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      const status = await getCreativeConfigStatus();
      if (cancelled) return;
      setConfigReachable(status.reachable);
      setArkApiConfigured(status.arkApiKey);
      setSeedanceApiConfigured(status.seedanceApiKey);
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
      previous.map((item) =>
        item.taskId === task.taskId
          ? {
              ...item,
              ...seedanceTaskToHistoryPatch(task),
            }
          : item
      )
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
    setInput(VIDEO_REVERSE_PROMPT);
    setRequestError("");
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(VIDEO_REVERSE_PROMPT.length, VIDEO_REVERSE_PROMPT.length);
    });
  }

  function syncLatestPromptToSeedance() {
    if (!latestAssistantText) {
      setRequestError('请先让创意助手完成一次视频提示词反推。');
      return;
    }

    setSeedancePrompt(latestAssistantText);
    setRequestError("");
  }

  async function handleCreateSeedanceVideo() {
    const prompt = seedancePrompt.trim();
    if (!prompt || isSeedanceLoading) return;

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

  async function handleImportSeedanceTask() {
    const taskId = seedanceImportTaskId.trim();
    if (!taskId || isSeedancePolling) return;

    setIsSeedancePolling(true);
    setSeedanceError("");

    try {
      const task = await querySeedanceTask(taskId);
      const historyItem = createSeedanceHistoryItem(task, {
        prompt: seedancePrompt.trim() || `已导入任务 ${taskId}`,
        ratio: seedanceRatio,
        duration: seedanceDuration,
        generateAudio: seedanceGenerateAudio,
        watermark: seedanceWatermark,
      });

      setSeedanceHistory((previous) => mergeSeedanceHistoryItem(previous, historyItem));
      setSeedanceTask(task);
      if (!seedancePrompt.trim()) {
        setSeedancePrompt(historyItem.prompt);
      }
    } catch (error) {
      setSeedanceError(error instanceof Error ? error.message : 'Seedance 导入任务失败');
    } finally {
      setIsSeedancePolling(false);
    }
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

  async function handleSend() {
    if (!input.trim() || isLoading) return;

    const rawQuestion = input.trim();
    // If the user is sending the video reverse prompt, silently append format
    // instructions so Doubao returns each section on its own line without
    // cluttering the input box.
    const isReversePrompt = rawQuestion.includes('请分析这个视频') && rawQuestion.includes('画面主体');
    const question = isReversePrompt ? rawQuestion + VIDEO_REVERSE_FORMAT_SUFFIX : rawQuestion;
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
  const seedanceEstimatedText = getSeedanceEstimatedText(
    seedanceTask,
    seedanceDuration,
    seedanceGenerateAudio,
    seedanceReferences.length,
    seedanceClock
  );
  const seedanceProgressPercent = getSeedanceProgressPercent(
    seedanceTask,
    seedanceDuration,
    seedanceGenerateAudio,
    seedanceReferences.length,
    seedanceClock
  );

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

      <header className="h-14 border-b border-slate-300 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
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

              <div className="min-h-[190px] rounded-2xl border border-slate-300 bg-slate-100 p-3">
                {selectedMedia?.kind === 'video' ? (
                  <div className="space-y-3">
                    <video
                      src={selectedMedia.previewUrl}
                      controls
                      preload="metadata"
                      className="aspect-video w-full rounded-xl bg-slate-950 object-contain"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-xs font-semibold text-slate-500">
                        <span className="block truncate">{selectedMedia.fileName}</span>
                        <span className="text-slate-400">将随下一条消息发送给 AI 助手</span>
                      </div>
                      <button
                        type="button"
                        onClick={clearSelectedMedia}
                        className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
                        aria-label="移除视频"
                      >
                        <X className="size-4" />
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
                    <span className="text-sm font-bold text-slate-700">上传视频</span>
                    <span className="max-w-xs text-xs leading-5 text-slate-400">
                      支持常见视频格式，当前上限 150MB。
                    </span>
                  </button>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={prepareVideoReversePrompt}
                  disabled={isLoading || selectedMedia?.kind !== 'video'}
                  className="rounded-full bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800"
                >
                  <Sparkles className="size-3.5" />
                  填入反推指令
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="rounded-full border border-slate-200 px-4 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  <Film className="size-3.5" />
                  更换视频
                </Button>
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
                        <div className="mt-1 text-xs text-slate-400">点击“填入反推指令”，再发送给豆包分析。</div>
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
                  <div className="text-[11px] font-medium text-slate-400">Enter 发送，Shift + Enter 换行</div>
                  <Button
                    size="sm"
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    className="rounded-full bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700"
                  >
                    {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                    发送给豆包
                  </Button>
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

              <div className="rounded-2xl border border-slate-300 bg-slate-100 p-3">
                <textarea
                  value={seedancePrompt}
                  onChange={(event) => setSeedancePrompt(event.target.value)}
                  placeholder="等待模块一反推出视频提示词..."
                  className="min-h-[156px] w-full resize-none rounded-xl border border-slate-300 bg-white p-3 text-sm leading-7 text-slate-700 outline-none transition-colors focus:border-violet-300"
                />

                <div className="mt-3 rounded-xl border border-slate-300 bg-white p-3">
                  <button
                    type="button"
                    onClick={() => seedanceFileInputRef.current?.click()}
                    disabled={isSeedanceLoading}
                    className="flex min-h-[82px] w-full flex-col items-center justify-center gap-2 rounded-lg text-center text-slate-400 transition-colors hover:bg-slate-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="size-5" />
                    <span className="text-sm font-bold">图片 / 视频 / 音频</span>
                    <span className="text-[11px] text-slate-400">图片最多 9 张，视频最多 3 个，音频最多 3 段</span>
                  </button>

                  {seedanceReferences.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      {seedanceReferences.map((reference) => (
                        <div key={reference.id} className="flex items-center gap-3 rounded-xl border border-slate-300 bg-white p-2">
                          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-slate-400">
                            {reference.kind === 'image' && reference.previewUrl ? (
                              <img src={reference.previewUrl} alt={reference.fileName} className="size-full object-cover" />
                            ) : reference.kind === 'video' && reference.previewUrl ? (
                              <video src={reference.previewUrl} className="size-full object-cover" muted />
                            ) : (
                              <Music className="size-5" />
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
                            className="rounded-full p-2 text-slate-400 transition-colors hover:bg-white hover:text-red-500"
                            aria-label="移除参考素材"
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div ref={seedanceSettingsRef} className="relative mt-3">
                  <button
                    type="button"
                    onClick={() => setShowSeedanceSettings((value) => !value)}
                    className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-xs font-bold text-slate-600 transition-colors hover:border-violet-200 hover:bg-violet-50/40"
                  >
                    <SlidersHorizontal className="size-4 text-violet-500" />
                    <span>{getSeedanceRatioLabel(seedanceRatio)}</span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span>{seedanceDuration} 秒</span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span className="inline-flex items-center gap-1">
                      <Volume2 className="size-3.5" />
                      {seedanceGenerateAudio ? '生成声音' : '无声音'}
                    </span>
                    <span className="h-4 w-px bg-slate-200" />
                    <span>{seedanceWatermark ? '有水印' : '无水印'}</span>
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

                <div className="mt-3 rounded-xl border border-slate-300 bg-white p-3">
                  {isSeedanceLoading ? (
                    <div className="flex min-h-[74px] items-center justify-center gap-2 text-xs font-bold text-violet-600">
                      <Loader2 className="size-4 animate-spin" />
                      正在创建 Seedance 任务
                    </div>
                  ) : seedanceTask ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className={cn(
                          "text-xs font-black",
                          seedanceTask.videoUrl ? "text-emerald-600" : isSeedanceFailureStatus(seedanceTask.status) ? "text-red-500" : "text-violet-600"
                        )}>
                          {getSeedanceStatusLabel(seedanceTask.status, !!seedanceTask.videoUrl)}
                        </div>
                        {!seedanceTask.videoUrl && !isSeedanceFailureStatus(seedanceTask.status) && (
                          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
                            {isSeedancePolling && <Loader2 className="size-3 animate-spin" />}
                            {isSeedancePolling ? '后台同步中' : `已等待 ${seedanceElapsedText}`}
                          </div>
                        )}
                      </div>
                      {seedanceTask.taskId && (
                        <div className="break-all rounded-lg bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                          任务 ID：{seedanceTask.taskId}
                        </div>
                      )}
                      {seedanceTask.videoUrl ? (
                        <div className="overflow-hidden rounded-xl border border-slate-300 bg-slate-950">
                          <video
                            src={seedanceTask.videoUrl}
                            className="aspect-video w-full bg-slate-950 object-contain"
                            controls
                            playsInline
                          />
                        </div>
                      ) : (
                        <div className="rounded-lg bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="font-bold text-slate-700">{getSeedanceStatusLabel(seedanceTask.status, false)}</span>
                            <span className="text-[11px] text-slate-400">{seedanceProgressPercent}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div
                              className="h-full rounded-full bg-violet-500 transition-all duration-700"
                              style={{ width: `${seedanceProgressPercent}%` }}
                            />
                          </div>
                          <div className="mt-2">{seedanceEstimatedText}</div>
                          <div className="mt-1 text-[11px] text-slate-400">
                            页面会每 {Math.round(SEEDANCE_POLL_INTERVAL_MS / 1000)} 秒在后台同步一次状态；官方没有提供真实倒计时或排队位置。
                          </div>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          onClick={handleRefreshSeedanceTask}
                          disabled={!seedanceTask.taskId || isSeedancePolling}
                          className="h-8 rounded-full bg-white px-3 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                        >
                          {isSeedancePolling ? <Loader2 className="size-3.5 animate-spin" /> : <History className="size-3.5" />}
                          刷新状态
                        </Button>
                        {seedanceTask.videoUrl && (
                          <a
                            href={seedanceTask.videoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-8 items-center rounded-full bg-slate-900 px-3 text-[11px] font-bold text-white hover:bg-slate-800"
                          >
                            打开视频
                          </a>
                        )}
                        {seedanceTask.videoUrl && (
                          <a
                            href={seedanceTask.videoUrl}
                            download={`seedance-${seedanceTask.taskId || 'video'}.mp4`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-[11px] font-bold text-white hover:bg-emerald-700"
                          >
                            <Download className="size-3.5" />
                            下载视频
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="grid min-h-[74px] place-items-center text-center">
                      <div>
                        <div className="text-xs font-bold text-slate-500">生成预览</div>
                        <div className="mt-1 text-[11px] text-slate-400">创建任务后会自动查询状态，成功后直接显示视频</div>
                      </div>
                    </div>
                  )}
                </div>

                {seedanceError && (
                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium leading-5 text-red-500">
                    {seedanceError}
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={syncLatestPromptToSeedance}
                  disabled={!latestAssistantText}
                  className="rounded-full bg-violet-600 px-4 text-xs font-bold text-white hover:bg-violet-700"
                >
                  <Send className="size-3.5" />
                  同步最新提示词
                </Button>
                <Button
                  type="button"
                  onClick={handleCreateSeedanceVideo}
                  disabled={!seedancePrompt.trim() || isSeedanceLoading || !seedanceApiConfigured}
                  className="rounded-full bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800"
                >
                  {isSeedanceLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  生成类似视频
                </Button>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-300 bg-slate-100 p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-slate-800">生成历史</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">保存最近 {MAX_SEEDANCE_HISTORY_ITEMS} 个 Seedance 任务</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowSeedanceImport((value) => !value)}
                      className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-400 ring-1 ring-slate-200 transition-colors hover:text-violet-600"
                    >
                      导入旧任务
                    </button>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-slate-400 ring-1 ring-slate-200">
                      {seedanceHistory.length} 条
                    </span>
                  </div>
                </div>

                {showSeedanceImport && (
                  <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-300 bg-white p-2 sm:flex-row">
                    <input
                      value={seedanceImportTaskId}
                      onChange={(event) => setSeedanceImportTaskId(event.target.value)}
                      placeholder="输入任务 ID，例如 cgt-..."
                      className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 outline-none focus:border-violet-300"
                    />
                    <Button
                      type="button"
                      onClick={handleImportSeedanceTask}
                      disabled={!seedanceImportTaskId.trim() || isSeedancePolling}
                      className="h-9 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white hover:bg-violet-700"
                    >
                      {isSeedancePolling ? <Loader2 className="size-3.5 animate-spin" /> : <History className="size-3.5" />}
                      导入
                    </Button>
                  </div>
                )}

                {seedanceHistory.length === 0 ? (
                  <div className="grid min-h-[84px] place-items-center rounded-xl border border-slate-300 bg-white text-center">
                    <div>
                      <div className="text-xs font-bold text-slate-500">暂无生成记录</div>
                      <div className="mt-1 text-[11px] text-slate-400">提交视频任务后会自动保存到这里</div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {seedanceHistory.map((item) => (
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
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeSeedanceHistoryItem(item.taskId)}
                            className="rounded-full p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                            aria-label="删除生成记录"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            onClick={() => handleViewSeedanceHistoryItem(item)}
                            className="h-8 rounded-full bg-slate-900 px-3 text-[11px] font-bold text-white hover:bg-slate-800"
                          >
                            查看
                          </Button>
                          <Button
                            type="button"
                            onClick={() => handleRefreshSeedanceHistoryItem(item)}
                            disabled={isSeedancePolling}
                            className="h-8 rounded-full bg-white px-3 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                          >
                            {isSeedancePolling ? <Loader2 className="size-3.5 animate-spin" /> : <History className="size-3.5" />}
                            更新状态
                          </Button>
                          {item.videoUrl && (
                            <a
                              href={item.videoUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center rounded-full bg-white px-3 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                            >
                              打开
                            </a>
                          )}
                          {item.videoUrl && (
                            <a
                              href={item.videoUrl}
                              download={`seedance-${item.taskId}.mp4`}
                              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-[11px] font-bold text-white hover:bg-emerald-700"
                            >
                              <Download className="size-3.5" />
                              下载
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
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
                  className="ml-4 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
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
