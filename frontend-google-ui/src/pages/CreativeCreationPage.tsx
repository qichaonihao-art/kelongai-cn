import { useState, useRef, useEffect, useMemo, type KeyboardEvent, type RefObject } from "react";
import {
  Send,
  Film,
  Sparkles,
  Loader2,
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
  Trash2,
  BookText,
  Search,
  Clock,
  FolderOpen,
  Pause,
  Play,
  Square,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/src/components/ui/button";
import ModuleQuickNav, { type ModuleId } from "@/src/components/ModuleQuickNav";
import HomeBackButton from "@/src/components/HomeBackButton";
import CreativeSubNav from "@/src/components/CreativeSubNav";
import SiteFooter from "@/src/components/SiteFooter";
import { cn } from "@/src/lib/utils";
import {
  createMediaPreviewUrl,
  createSeedanceTask,
  getCreativeConfigStatus,
  querySeedanceTask,
  sendCreativeMessage,
  analyzePainting,
  generatePaintingIdeas,
  generatePaintingIdeaPrompt,
  createPaintingBatchRun,
  getPaintingBatchRun,
  getPaintingBatchRunByRequest,
  listPaintingBatchRuns,
  pausePaintingBatchRun,
  resumePaintingBatchRun,
  stopPaintingBatchRun,
  retryPaintingBatchTask,
  resubmitPaintingBatchTask,
  describePaintingNetworkError,
  generatePaintingRequestId,
  isPaintingCreationOutcomeUnknown,
  getSeedanceRatePerSecond,
  SEEDANCE_BATCH_MODEL,
  SEEDANCE_BATCH_MODEL_LABEL,
  SEEDANCE_BATCH_RESOLUTION,
  SEEDANCE_PRICING_NOTE,
  getPaintingFolderBinding,
  getPaintingUsedDirections,
  sha256File,
  type CreativeReverseModel,
  type CreativeHistoryItem,
  type SeedanceReferenceFile,
  type SeedanceTaskResult,
  type SelectedCreativeMedia,
  type PaintingProfile,
  type PaintingIdeaSummary,
  type PaintingMaterialPlan,
  type PaintingBatchRun,
  type PaintingBatchRunDetail,
  type PaintingBatchTask,
  type PaintingBatchTaskStatus,
} from "@/src/lib/creative";
import { motion, AnimatePresence } from "motion/react";
import {
  saveUploadHistory,
  loadUploadHistorySummaries,
  getUploadHistoryItem,
  deleteUploadHistory,
  blobToFile,
  formatHistoryTime,
} from "@/src/lib/uploadHistory";
import {
  getVideoLibraryFolders,
  markVideoLibraryItemsRead,
  saveSeedanceVideoToLibrary,
} from "@/src/lib/videoLibrary";

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
  onNavigate: (page: ModuleId) => void;
  onSwitchToCopy?: () => void;
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
  model: SeedanceModelId;
  taskMode?: SeedanceTaskMode;
  prompt: string;
  status?: string;
  videoUrl?: string;
  createdAt?: number;
  updatedAt?: number;
  savedAt: string;
  resolution?: SeedanceResolution;
  ratio: string;
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
  elapsedSeconds?: number;
  isGood?: boolean;
  libraryFolder?: string;
}

interface SeedanceLibrarySaveTarget {
  taskId: string;
  createdAt?: number;
}

interface PaintingHistoryItem {
  id: string;
  savedAt: string;
  title: string;
  profile: PaintingProfile;
  ideas: PaintingIdeaSummary[];
  fullPrompt: string;
  thumbnail?: string;
  uploadHistoryId?: number;
  imageFileName?: string;
  ratio: string;
  duration: number;
  stylePreset?: string;
  plan?: PaintingMaterialPlan;
  ideaBatchCache?: Record<string, PaintingIdeaSummary[]>;
  ideaUsageCounts?: Record<string, number>;
  ideaLastPrompts?: Record<string, string>;
  frameworkBatch?: number;
  totalBatches?: number;
  variationRound?: number;
}

interface UploadHistoryPreviewItem {
  id: number;
  name: string;
  timestamp: number;
  previewUrl: string;
  duration?: number;
}

interface AdditionalChangeHistoryItem {
  text: string;
  createdAt: number;
}

interface TextHighlightState {
  text: string;
  ranges: Array<{ start: number; end: number }>;
}

type HistoryPreviewItem = UploadHistoryPreviewItem & {
  kind: 'video' | 'image';
  source: 'video' | 'image-creative' | 'image-seedance' | 'video-edit-video' | 'video-edit-image';
  ownedPreviewUrl?: boolean;
};

const MAX_VIDEO_SIZE_BYTES = 150 * 1024 * 1024;
const MAX_SAVED_CREATIVE_SESSIONS = 8;
const MAX_SEEDANCE_HISTORY_ITEMS = 120;
const SEEDANCE_HISTORY_MAX_AGE_DAYS = 30;
const SEEDANCE_HISTORY_MAX_AGE_MS = SEEDANCE_HISTORY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const SEEDANCE_POLL_INTERVAL_MS = 15000;
const CREATIVE_SESSIONS_STORAGE_KEY = 'kelongai.creativeSessions';
const SEEDANCE_HISTORY_STORAGE_KEY = 'kelongai.seedanceHistory';
const SEEDANCE_COST_KEY = 'kelongai.seedanceCost';
const PAINTING_HISTORY_STORAGE_KEY = 'kelongai.paintingHistory';
const PAINTING_HISTORY_MAX_AGE_DAYS = 30;
const PAINTING_HISTORY_MAX_AGE_MS = PAINTING_HISTORY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
const MAX_PAINTING_HISTORY_ITEMS = 100;
const PAINTING_STYLE_OPTIONS = [
  { value: 'new-chinese', label: '新中式雅致', description: '实木、茶席与东方文化感' },
  { value: 'modern-minimal', label: '现代简约', description: '简洁家具、自然生活感' },
  { value: 'modern-luxury', label: '现代轻奢', description: '石材、金属与高级样板间' },
  { value: 'cream-warm', label: '奶油温馨', description: '柔和布艺与家庭氛围' },
  { value: 'natural-wood', label: '原木自然', description: '浅木、棉麻与绿植' },
  { value: 'nordic-fresh', label: '北欧清新', description: '明快配色与轻盈空间' },
  { value: 'vintage-home', label: '复古雅居', description: '深木、皮质与故事感' },
  { value: 'gallery-display', label: '高端展陈', description: '展厅、酒店与艺术灯光' },
  { value: 'everyday-life', label: '烟火生活', description: '真实住宅与自然日常' },
] as const;

function getPaintingStyleLabel(stylePreset?: string): string {
  const option = PAINTING_STYLE_OPTIONS.find((item) => item.value === stylePreset);
  return option ? option.label : (stylePreset || '未设置');
}
const ADDITIONAL_CHANGE_HISTORY_KEY = 'kelongai.additionalChangeHistory';
const ADDITIONAL_CHANGE_HISTORY_RETENTION_DAYS = 180;
const ADDITIONAL_CHANGE_HISTORY_RETENTION_MS = ADDITIONAL_CHANGE_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const NOTEBOOK_STORAGE_KEY = 'kelongai.notebook';
const VIDEO_LIBRARY_LAST_FOLDER_KEY = 'kelongai.videoLibraryLastFolder';

function getPaintingIdeaUsageKey(batch: number, variationRound: number, ideaId: string) {
  return `round:${variationRound}:batch:${batch}:idea:${ideaId}`;
}

const PAINTING_BATCH_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  generating_prompt: '生成提示词',
  prompt_ready: '提示词就绪',
  submitting_seedance: '提交生成',
  seedance_submitted: '生成中',
  rendering: '渲染中',
  video_succeeded: '生成完成',
  saving_to_library: '存入素材库',
  completed: '已完成',
  retry_waiting: '重试等待',
  failed: '失败',
  paused: '已暂停',
  stopped: '已停止',
  needs_review: '待复核',
  running: '运行中',
  stopping: '停止中',
};

const PAINTING_BATCH_TERMINAL_STATUSES = ['completed', 'failed', 'stopped', 'needs_review'];

function getPaintingBatchStatusLabel(status?: string): string {
  if (!status) return '未知';
  return PAINTING_BATCH_STATUS_LABELS[status] || status;
}

function getPaintingBatchStatusTone(status?: string): string {
  if (status === 'completed' || status === 'video_succeeded') return 'bg-emerald-50 text-emerald-600';
  if (status === 'failed') return 'bg-red-50 text-red-600';
  if (status === 'needs_review') return 'bg-amber-50 text-amber-600';
  if (status === 'stopped' || status === 'paused') return 'bg-slate-100 text-slate-500';
  return 'bg-blue-50 text-blue-600';
}

function loadLastVideoLibraryFolder(): string {
  if (typeof window === 'undefined') return '通用素材';
  try {
    return window.localStorage.getItem(VIDEO_LIBRARY_LAST_FOLDER_KEY)?.trim() || '通用素材';
  } catch {
    return '通用素材';
  }
}

function saveLastVideoLibraryFolder(folder: string) {
  if (typeof window === 'undefined' || !folder.trim()) return;
  try {
    window.localStorage.setItem(VIDEO_LIBRARY_LAST_FOLDER_KEY, folder.trim());
  } catch {
    // 浏览器禁止本地存储时，仍允许本次保存流程正常进行。
  }
}

function formatDoubaoMultimodalModelName(modelId: string): string {
  if (modelId === 'doubao-seed-2-1-pro-260628') return '豆包 Seed 2.1 Pro';
  if (modelId === 'doubao-seed-2-0-pro-260215') return '豆包 Seed 2.0 Pro';
  if (!modelId) return '豆包多模态';
  return modelId;
}

function formatVideoDuration(seconds?: number): string {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return '未知时长';
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const restSeconds = totalSeconds % 60;
  if (minutes <= 0) return `${restSeconds}秒`;
  return `${minutes}分${String(restSeconds).padStart(2, '0')}秒`;
}

function HistoryVideoThumbnail({
  src,
  name,
}: {
  src: string;
  name: string;
}) {
  return (
    <div className="aspect-video w-full bg-slate-950">
      {src ? (
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-slate-900 text-white/50">
          <Film className="size-5" />
        </div>
      )}
    </div>
  );
}

function HistoryImageThumbnail({
  src,
  name,
}: {
  src: string;
  name: string;
}) {
  return src ? (
    <img
      src={src}
      alt={name}
      className="aspect-square w-full object-cover"
    />
  ) : (
    <div className="flex aspect-square w-full items-center justify-center bg-slate-900 text-white/50">
      <ImageIcon className="size-5" />
    </div>
  );
}

interface NotebookItem {
  id: string;
  content: string;
  createdAt: number;
}

function loadNotebookItems(): NotebookItem[] {
  try {
    const raw = window.localStorage.getItem(NOTEBOOK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // ignore
  }
  return [];
}

function saveNotebookItems(items: NotebookItem[]) {
  try {
    window.localStorage.setItem(NOTEBOOK_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore storage errors
  }
}

function normalizeAdditionalChangeHistory(rawItems: unknown): AdditionalChangeHistoryItem[] {
  if (!Array.isArray(rawItems)) return [];
  const now = Date.now();
  const oldestAllowed = now - ADDITIONAL_CHANGE_HISTORY_RETENTION_MS;
  const seen = new Set<string>();
  const normalized: AdditionalChangeHistoryItem[] = [];

  for (const item of rawItems) {
    const text = typeof item === 'string'
      ? item.trim()
      : item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
        ? String((item as { text: string }).text).trim()
        : '';
    if (!text || seen.has(text)) continue;

    const createdAt = item && typeof item === 'object' && Number.isFinite((item as { createdAt?: unknown }).createdAt)
      ? Number((item as { createdAt: number }).createdAt)
      : now;
    if (createdAt < oldestAllowed) continue;

    seen.add(text);
    normalized.push({ text, createdAt });
  }

  return normalized.sort((a, b) => b.createdAt - a.createdAt);
}

function persistAdditionalChangeHistory(items: AdditionalChangeHistoryItem[]) {
  const normalized = normalizeAdditionalChangeHistory(items);
  try {
    window.localStorage.setItem(ADDITIONAL_CHANGE_HISTORY_KEY, JSON.stringify(normalized));
  } catch {
    // ignore storage errors
  }
  return normalized;
}

function replaceAllWithHighlightRanges(source: string, search: string, replacement: string) {
  if (!search) return { text: source, count: 0, ranges: [] as TextHighlightState['ranges'] };

  let cursor = 0;
  let count = 0;
  let text = '';
  const ranges: TextHighlightState['ranges'] = [];

  while (cursor < source.length) {
    const index = source.indexOf(search, cursor);
    if (index === -1) {
      text += source.slice(cursor);
      break;
    }

    text += source.slice(cursor, index);
    const start = text.length;
    text += replacement;
    if (replacement) {
      ranges.push({ start, end: start + replacement.length });
    }
    count += 1;
    cursor = index + search.length;
  }

  if (cursor >= source.length && source.endsWith(search)) {
    // The loop already appended the final replacement; this branch only keeps
    // the intent explicit for exact trailing matches.
  }

  return { text, count, ranges };
}

function renderHighlightedText(state: TextHighlightState | null) {
  if (!state) return null;
  if (state.ranges.length === 0) return state.text;

  const parts: Array<{ text: string; highlighted: boolean; key: string }> = [];
  let cursor = 0;
  state.ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push({ text: state.text.slice(cursor, range.start), highlighted: false, key: `plain_${index}` });
    }
    parts.push({ text: state.text.slice(range.start, range.end), highlighted: true, key: `hit_${index}` });
    cursor = range.end;
  });
  if (cursor < state.text.length) {
    parts.push({ text: state.text.slice(cursor), highlighted: false, key: 'plain_tail' });
  }

  return parts.map((part) => (
    part.highlighted ? (
      <mark key={part.key} className="rounded bg-emerald-200/80 px-0.5 font-bold text-emerald-900 ring-1 ring-emerald-300/70">
        {part.text}
      </mark>
    ) : (
      <span key={part.key}>{part.text}</span>
    )
  ));
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getYearKey() {
  return String(new Date().getFullYear());
}

function roundCost(value: number) {
  return Math.round((value || 0) * 100) / 100;
}

function recordSeedanceCost(durationSeconds: number, model: SeedanceModelId, resolution = '720p') {
  // 单价按 720P 档位估算（元/秒），复用统一的按秒价格来源，仅用于右上角本地消耗统计。
  // 非 720P 分辨率价格尚未确认，getSeedanceRatePerSecond 返回 null 时跳过记录。
  const ratePerSecond = getSeedanceRatePerSecond(model, resolution);
  if (ratePerSecond == null) return;
  const cost = roundCost(Math.max(0, durationSeconds) * ratePerSecond);
  const today = getTodayKey();
  const month = getMonthKey();
  const year = getYearKey();
  try {
    const raw = window.localStorage.getItem(SEEDANCE_COST_KEY);
    const data: Record<string, number> = raw ? JSON.parse(raw) : {};
    data[today] = roundCost((data[today] || 0) + cost);
    data[month] = roundCost((data[month] || 0) + cost);
    data[year] = roundCost((data[year] || 0) + cost);
    window.localStorage.setItem(SEEDANCE_COST_KEY, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

function getSeedanceCostStats(): { daily: number; monthly: number; yearly: number } {
  try {
    const raw = window.localStorage.getItem(SEEDANCE_COST_KEY);
    const data: Record<string, number> = raw ? JSON.parse(raw) : {};
    return {
      daily: roundCost(data[getTodayKey()] || 0),
      monthly: roundCost(data[getMonthKey()] || 0),
      yearly: roundCost(data[getYearKey()] || 0),
    };
  } catch {
    return { daily: 0, monthly: 0, yearly: 0 };
  }
}

const VIDEO_REVERSE_FORMAT_SUFFIX = '\n\n请严格按照以上十二个部分输出，每个部分之间必须空一行（即每个部分结束后换两行再开始下一个部分）。';
const VIDEO_CONTEXT_ISOLATION_RULE = '本次任务是完全独立的一次视频分析。只能基于当前上传的视频、当前上传的参考图片（如有）、本条指令中的替换要求、额外调整、人物改造要求和字幕选项进行判断。不得引用、继承、延续或假设任何历史会话、上一次视频、上一次替换目标、上一次参考图、旧提示词中的主体、道具、场景、动作、挂画、海报、装饰物、文字内容或风格要求。所有主体、道具、动作和场景元素必须来自当前视频可见内容或当前指令明确要求；如果当前视频中没有明确出现某元素，不得写入分析和最终提示词。';
const VIDEO_LIVE_EYE_GAZE_RULE = '如果视频中出现人物，且正面或偏正面机位能明显看到人物眼神，必须重点描述人物眼神的真人感：眼睛不能一直僵硬睁着不动，需根据原视频状态写出自然眨眼、视线轻微移动、眼神聚焦变化、看向镜头或看向道具/画面的真实互动感，避免眼珠固定、空洞呆滞、假人感和 AI 式凝视。';
const PAINTING_WOOD_BAR_RULE = '挂画上下两端的木条、挂轴或压杆必须严格以当前视频和参考图片中实际可见的结构为准，完整保持其形状、颜色、材质、粗细、长度、截面和两端轮廓，不得重新设计。滚动展开只改变画布的卷起与释放状态，不得把原有扁平或方形木条改成传统圆柱形卷轴、圆杆或转轴；不得在木条左右两端擅自增加圆球、葫芦头、轴头、端帽、把手或任何参考素材中不存在的圆柱形及装饰性构件。';
const PAINTING_WOOD_BAR_OUTPUT_RULE = `${PAINTING_WOOD_BAR_RULE} 如果当前素材涉及挂画或卷轴，必须把这项要求同时写入“复刻关键约束”“负面约束”“最终完整提示词”和“负面提示词”，不能只在分析部分提到。`;

function buildCharacterRemixClause(characterRemix?: string) {
  const text = characterRemix?.trim();
  if (!text) return '';
  return `\n\n人物改造要求：${text}\n如果启用了人物改造要求，只允许改变人物设定本身，不得改变原视频中的场景、道具、构图、镜头运动、动作流程、光影、节奏、卷轴/挂画等非人物元素。必须在保持原视频镜头、构图、动作节奏和场景关系不变的前提下，根据用户指定的人物年龄、性别或身份重新设计人物设定。不能只替换年龄或性别标签，也不能机械保留原人物的服装、发型、妆容和气质。必须根据新人物的年龄、性别、身份气质以及当前视频场景，重新合理设计服装、发型、体态、配饰和整体气质；服装要与场景协调，例如书房、客厅、茶室、办公室、展厅、讲台、家居环境等，应选择符合人物年龄身份和场景氛围的自然着装。最终提示词中必须明确写出改造后人物的年龄段、性别、气质、服装、发型、体态，以及这些人物设定如何与当前场景协调，同时保留原视频中可复刻的镜头语言、动作流程、构图、光影和节奏。`;
}

const VIDEO_REVERSE_PROMPT = (options?: { additionalChange?: string; includeSubtitles?: boolean; characterRemix?: string }) => {
  const additionalChange = options?.additionalChange;
  const includeSubtitles = options?.includeSubtitles ?? false;
  const characterRemixClause = buildCharacterRemixClause(options?.characterRemix);
  const subtitleClause = includeSubtitles
    ? '12. 如果视频中有人物口播或旁白字幕，必须逐字提取并完整保留在最终提示词中，字幕内容不得遗漏、省略或改写。'
    : '12. 视频中的字幕、文字叠加、人物口播字幕、旁白字幕等所有文字元素均不得保留，必须在复刻时彻底去除，确保输出画面不含任何字幕或文字叠加。';
  const base = `请把这个视频当作”待复刻样片”来分析，不要只做普通内容描述，而要尽量提取出所有会影响视频复刻结果的关键信息。目标是让我把你输出的提示词交给图生视频/文生视频模型后，最大程度复刻原视频的主体、构图、镜头、动作、节奏、光影和氛围。\n\n${VIDEO_CONTEXT_ISOLATION_RULE}\n\n请严格按以下结构输出：\n\n一、核心主体信息\n二、场景与背景环境\n三、构图与机位\n四、镜头运动\n五、动作设计与时间顺序\n六、节奏与动态风格\n七、光影与色彩\n八、情绪与气质\n九、复刻关键约束（提炼 8 条最关键因素）\n十、负面约束（列出应避免的问题）\n十一、最终可直接用于视频生成模型的完整复刻提示词\n十二、负面提示词\n\n要求：\n1. 描述必须具体，避免空泛词语。\n2. 尽量写出主体在画面中的位置、景别、角度、运动方式、动作先后顺序。\n3. 如果视频里有明显的服装、道具、背景装饰、灯光方向、色温、节奏变化，必须写出来。\n4. 最终提示词要以”生成指令”的方式输出，不要写成分析说明。\n5. 目标不是”风格相似”，而是”尽量复刻接近原视频”。\n6. 对于画面中的挂画、海报、装饰画、屏幕显示内容等平面元素，必须严格保持其原始比例（宽高比）和尺寸关系，不得出现拉伸、压扁或变形。替换或修改后的元素在画面中的空间占比和边界框大小必须与原元素一致。\n7. 如果原视频中存在水印、平台标识、AI生成标记（如”豆包AI生成”等文字或Logo），必须在复刻时去除，不得保留任何水印信息。\n8. 复刻的视频要尽量减少 AI 感，人物、动作、镜头、光影、材质和环境细节都要更自然、更真实，避免塑料感、过度磨皮、虚假光泽、异常肢体、过度电影化和明显的 AI 生成痕迹。\n9. 如果视频中出现人物，必须重点观察并详细描述人物手部动作，包括手指、手腕、手掌与道具或挂画的接触方式、拿取方式、展开方式、扶持位置、发力方向和动作先后顺序，不得只笼统描述为”展示”或”操作”。\n10. 如果视频中出现卷轴式挂画、卷筒挂画或被卷起后展开的画作，必须明确描述其展开方式为”滚动展开”：卷轴或卷筒沿轴向旋转，画布从卷筒中逐步释放并展开；不得描述成普通平面图片的滑动、平移或直接展开。${PAINTING_WOOD_BAR_OUTPUT_RULE}\n${subtitleClause}${characterRemixClause}`;
  const enhancedBase = base.replace(
    '\n10. 如果视频中出现卷轴式挂画、卷筒挂画或被卷起后展开的画作，必须明确描述其展开方式为”滚动展开”：',
    `\n10. ${VIDEO_LIVE_EYE_GAZE_RULE}\n11. 如果视频中出现卷轴式挂画、卷筒挂画或被卷起后展开的画作，必须明确描述其展开方式为”滚动展开”：`
  );
  if (!additionalChange?.trim()) return enhancedBase;
  return `${enhancedBase}\n\n另外，在复刻时还需要做以下调整：${additionalChange.trim()}`;
};
const VIDEO_REPLACE_PROMPT = (target: string, replacement: string, options?: { additionalChange?: string; includeSubtitles?: boolean; characterRemix?: string }) => {
  const additionalChange = options?.additionalChange;
  const includeSubtitles = options?.includeSubtitles ?? false;
  const characterRemixClause = buildCharacterRemixClause(options?.characterRemix);
  const subtitleClause = includeSubtitles
    ? '12. 如果视频中有人物口播或旁白字幕，必须逐字提取并完整保留在最终提示词中，字幕内容不得遗漏、省略或改写。'
    : '12. 视频中的字幕、文字叠加、人物口播字幕、旁白字幕等所有文字元素均不得保留，必须在复刻时彻底去除，确保输出画面不含任何字幕或文字叠加。';
  const base = `我上传了一个视频和一个参考图片。请你完成以下任务：

1. 先像分析”待复刻样片”一样，完整分析这个视频，提取所有影响复刻结果的关键信息（主体、构图、镜头、动作、节奏、光影、氛围等）。
2. 同时参考我上传的图片，把视频中的【${target}】替换成【${replacement}】。
3. 替换时，${replacement}的外观、风格、质感要与我上传的参考图片保持一致。
4. 除了被替换的元素外，视频中其他所有内容（场景、人物、动作、镜头运动、光影、色彩、节奏等）必须与原视频完全一致，不能有任何改变。

${VIDEO_CONTEXT_ISOLATION_RULE}

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
7. 如果原视频中存在水印、平台标识、AI生成标记（如”豆包AI生成”等文字或Logo），必须在复刻时去除，不得保留任何水印信息。
8. 复刻的视频要尽量减少 AI 感，人物、动作、镜头、光影、材质和环境细节都要更自然、更真实，避免塑料感、过度磨皮、虚假光泽、异常肢体、过度电影化和明显的 AI 生成痕迹。
9. 如果视频中出现人物，必须重点观察并详细描述人物手部动作，包括手指、手腕、手掌与道具或挂画的接触方式、拿取方式、展开方式、扶持位置、发力方向和动作先后顺序，不得只笼统描述为”展示”或”操作”。
10. 如果视频中出现卷轴式挂画、卷筒挂画或被卷起后展开的画作，必须明确描述其展开方式为”滚动展开”：卷轴或卷筒沿轴向旋转，画布从卷筒中逐步释放并展开；不得描述成普通平面图片的滑动、平移或直接展开。${PAINTING_WOOD_BAR_OUTPUT_RULE}
${subtitleClause}${characterRemixClause}`;
  const enhancedBase = base.replace(
    '\n10. 如果视频中出现卷轴式挂画、卷筒挂画或被卷起后展开的画作，必须明确描述其展开方式为”滚动展开”：',
    `\n10. ${VIDEO_LIVE_EYE_GAZE_RULE}\n11. 如果视频中出现卷轴式挂画、卷筒挂画或被卷起后展开的画作，必须明确描述其展开方式为”滚动展开”：`
  );
  if (!additionalChange?.trim()) return enhancedBase;
  return `${enhancedBase}\n\n另外，在复刻时还需要做以下调整：${additionalChange.trim()}`;
};

const IMAGE_TO_VIDEO_PROMPT = (options: {
  durationSeconds: number;
  addPainting?: boolean;
  paintingPlacement?: string;
  additionalChange?: string;
  includeSubtitles?: boolean;
}) => {
  const durationSeconds = options.durationSeconds;
  const addPainting = options?.addPainting ?? false;
  const paintingPlacement = options?.paintingPlacement?.trim();
  const additionalChange = options?.additionalChange?.trim();
  const subtitleRule = options?.includeSubtitles
    ? '保留画面中需要呈现的字幕或文字内容；如果图片中存在文字，先准确识别，再在视频提示词中说明其位置、内容和保持清晰的要求。'
    : '不得添加字幕、标题、贴纸、水印、平台标识或额外文字叠加；图片中原本存在的文字也只能在用户明确要求保留时出现。';
  const optionalRules = [
    addPainting
      ? `我上传的第二张图片是要插入的挂画/装饰画参考图。${paintingPlacement ? `请将它放置在：${paintingPlacement}。` : '请根据基础图片中适合的墙面或空间位置合理放置。'} 在不破坏原图片主体、构图和场景关系的前提下，加入这幅挂画；必须保持参考图的画面内容、宽高比、材质和主要颜色，并自然融入墙面透视、光影和空间比例。${PAINTING_WOOD_BAR_RULE}`
      : '',
    additionalChange ? `其他调整要求：${additionalChange}` : '',
  ].filter(Boolean).join('\n');

  const imageIsolationRule = `本次任务只基于当前上传的图片${addPainting ? '和当前上传的挂画参考图片' : ''}以及本条指令进行判断。不得引用、继承、延续或假设任何历史会话、旧图片、旧提示词中的主体、道具、场景、挂画、装饰物、文字内容或风格要求；如果图片中没有明确出现某元素，除非用户在本条指令中明确要求，否则不得写入分析和最终提示词。`;
  return `请把我上传的这张图片作为唯一的视觉基准，生成一份可以直接交给 Seedance 图生视频模型使用的完整视频提示词。目标视频总时长必须严格为 ${durationSeconds} 秒。不是简单描述图片，而是要在尽量保持图片内容一致的基础上，补全合理、真实、可执行的视频动作、镜头、时间顺序和动态细节。\n\n${imageIsolationRule}\n\n请严格按以下结构输出：\n\n一、核心主体信息\n二、场景与背景环境\n三、构图与机位\n四、镜头运动\n五、动作设计与时间顺序\n六、节奏与动态风格\n七、光影与色彩\n八、情绪与气质\n九、图片生视频关键约束（提炼 8 条最关键因素）\n十、负面约束（列出应避免的问题）\n十一、最终可直接用于视频生成模型的完整提示词\n十二、负面提示词\n\n必须遵守以下规则：\n1. 先完整识别图片中的主体、人物年龄和性别（仅在确实可判断时）、服装、发型、姿态、道具、背景、空间层次、构图、景别、光线方向和色彩，再设计动态；不确定的内容不要臆造。\n2. 图片是本次唯一基准。除用户明确提出的调整外，主体身份、人物外观、场景、道具、画面布局、空间比例、色彩和氛围都要保持一致，不得凭借历史对话增加以前出现过的挂画、家具、人物或其他元素。\n3. 生成的视频动作必须从静态图片自然延伸出来，并围绕 ${durationSeconds} 秒总时长设计。所有时间段必须从 0 秒开始，连续且不重叠，按先后顺序排列，最后一个时间段必须准确结束于 ${durationSeconds} 秒；禁止时间倒置、区间交叉、时间断层或超过总时长。\n4. 镜头运动要克制、真实并服务于主体，不要凭空添加复杂运镜；同时明确固定机位、推近、横移、跟拍或轻微环绕等动作的起止时间。\n5. 如果有人物，正面或偏正面能看见眼睛时，必须表现出真人感：适当自然眨眼、视线轻微移动和真实聚焦变化，避免眼睛一直睁着、眼珠固定、空洞凝视和 AI 呆滞感。人物手部可见时，重点描述手指、手腕、手掌的自然动作、接触位置、发力方向和动作先后，避免手部畸形和穿模。\n6. 如果出现卷轴式挂画、卷筒挂画或挂画需要打开，必须明确写成沿轴向旋转的滚动展开，画布从卷筒中逐步释放；禁止滑动、平移、平铺或直接弹开。挂画、海报和其他平面元素必须保持原始宽高比、透视、边界和文字内容，不得拉伸变形。${PAINTING_WOOD_BAR_OUTPUT_RULE}\n7. ${subtitleRule}\n8. 画面要减少 AI 感，保持自然的动作惯性、真实材质、合理接触、柔和光影和生活化节奏，避免塑料感、过度磨皮、虚假高光、僵硬表情、异常肢体和过度电影化。\n${optionalRules ? `\n本次可选调整：\n${optionalRules}\n` : ''}\n最终提示词必须以“生成指令”开头，明确写出总时长 ${durationSeconds} 秒，内容完整、具体、可直接复制使用；不要把分析过程写成空泛建议。`;
};
const SEEDANCE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] as const;
const SEEDANCE_RESOLUTIONS_2_0 = ['480p', '720p', '1080p', '4k'] as const;
const SEEDANCE_RESOLUTIONS_2_0_MINI = ['480p', '720p'] as const;
const SEEDANCE_RESOLUTIONS_2_5 = ['480p', '720p'] as const;
const SEEDANCE_DURATIONS = Array.from({ length: 12 }, (_, index) => index + 4);
const SEEDANCE_DURATIONS_2_5 = Array.from({ length: 27 }, (_, index) => index + 4);
type SeedanceModelId = 'doubao-seedance-2-0-260128' | 'doubao-seedance-2-0-mini-260615' | 'doubao-seedance-2-5-260628';
type SeedanceTaskMode = 'generate' | 'video-edit-painting';
type SeedanceResolution = '480p' | '720p' | '1080p' | '4k';
type ReverseMode = 'direct' | 'replace' | 'image' | 'painting';

interface ReverseSeedanceSyncSnapshot {
  mode: Exclude<ReverseMode, 'painting'>;
  sourceVideo: SelectedCreativeMedia | null;
  referenceImages: SelectedCreativeMedia[];
  requestedDuration?: number;
  durationPromise?: Promise<number | null>;
}

function getSeedanceModelLabel(model: SeedanceModelId) {
  if (model === 'doubao-seedance-2-5-260628') return 'Seedance 2.5 测试版';
  if (model === 'doubao-seedance-2-0-mini-260615') return 'Seedance 2.0 mini';
  return 'Seedance 2.0 稳定版';
}

function getSeedanceResolutions(model: SeedanceModelId) {
  if (model === 'doubao-seedance-2-5-260628') return SEEDANCE_RESOLUTIONS_2_5;
  if (model === 'doubao-seedance-2-0-mini-260615') return SEEDANCE_RESOLUTIONS_2_0_MINI;
  return SEEDANCE_RESOLUTIONS_2_0;
}

function getSeedanceHistoryModeLabel(item: SeedanceHistoryItem) {
  return item.taskMode === 'video-edit-painting' ? '2.5 视频编辑' : getSeedanceModelLabel(item.model);
}

function getSeedanceHistoryDurationLabel(item: SeedanceHistoryItem) {
  return item.taskMode === 'video-edit-painting' || item.duration === -1 ? '原视频时长' : `${item.duration} 秒`;
}

function getSeedanceHistoryRatioLabel(item: SeedanceHistoryItem) {
  return item.taskMode === 'video-edit-painting' ? '原视频比例' : item.ratio;
}

function buildVideoEditPaintingPrompt(target: string, adjustments: string) {
  const targetDescription = target.trim() || '原视频中出现的挂画或装饰画';
  const adjustmentText = adjustments.trim();
  return `视频编辑：自动识别 @视频1 中的${targetDescription}，并将其完整替换为 @图片1 中的目标挂画或装饰画。

严格保留 @视频1 的镜头角度、构图、人物姿态、手部动作、动作顺序、运镜、场景布局、光影、声音和整体节奏。除目标挂画以及下方明确写出的额外调整外，不得修改其他人物、道具和场景元素。

严格保持 @图片1 中挂画的画面内容、文字、颜色、宽高比例、挂轴、边框和材质，不得改字、拉伸、变形、模糊或重新设计。替换后的挂画必须逐帧自然跟随原视频中的透视、遮挡、手部接触、运动轨迹、光影和运动模糊，不能漂浮、穿模或与人物手部脱离。

${PAINTING_WOOD_BAR_RULE}

先逐帧识别原挂画在整个视频中的位置、形态、状态和变化过程，再让替换后的挂画严格复刻同样的状态与动作。原挂画静止时，替换后的挂画保持相同位置和静止状态；原挂画被拿起、移动、悬挂、卷起、展开、翻转或遮挡时，替换后的挂画必须复刻相同的动作轨迹、时间节奏、形态变化、手部接触和先后顺序。如果原挂画是卷轴结构并发生展开，必须按照原视频中的动作沿卷轴轴向旋转并滚动展开，禁止滑动展开、平铺、直接弹开或擅自增加原视频没有的动作。

如果人物仅为背影或侧面，必须保持原朝向，不得主动转向镜头，不得凭空生成清晰正脸。人物可见的手部动作必须自然、稳定并与挂画正确接触。整体保持真人实拍质感，减少 AI 感。

${adjustmentText ? `本次额外调整：${adjustmentText}` : '本次没有额外调整，除替换挂画外，其余内容严格保持原视频。'}`;
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const previewUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    const cleanup = () => URL.revokeObjectURL(previewUrl);
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      if (Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error('无法读取原视频时长，请更换视频后重试。'));
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('无法读取原视频，请确认文件可以正常播放。'));
    };
    video.src = previewUrl;
  });
}

function extractVideoDurationFromPrompt(prompt: string): number | null {
  const matches = Array.from(String(prompt || '').matchAll(
    /(?:总时长|视频时长|目标视频总时长)\s*(?:必须严格为|约为|为|是|[：:])?\s*(\d{1,3})\s*秒/gi,
  ));
  const value = Number(matches.at(-1)?.[1]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

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
  return ['succeeded', 'success', 'completed', 'done', 'failed', 'error', 'cancelled', 'canceled', 'expired', 'creating', 'creation_interrupted'].includes(normalized);
}

function isSeedanceFailureStatus(status?: string) {
  const normalized = String(status || '').toLowerCase();
  return ['failed', 'error', 'cancelled', 'canceled', 'expired', 'creation_interrupted'].includes(normalized);
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
  if (normalized === 'creation_interrupted') return '任务创建中断';
  if (normalized === 'creating') return '正在创建任务';
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

function toISODate(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatHistoryDate(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;

  const now = new Date();
  const today = toISODate(now);
  const yesterday = toISODate(new Date(now.getTime() - 86400000));

  if (dateString === today) return '今天';
  if (dateString === yesterday) return '昨天';

  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getSeedanceHistoryByDate(items: SeedanceHistoryItem[]) {
  const groups = new Map<string, SeedanceHistoryItem[]>();
  items.forEach((item) => {
    const date = toISODate(item.savedAt);
    if (!date) return;
    const existing = groups.get(date) || [];
    existing.push(item);
    groups.set(date, existing);
  });
  groups.forEach((list) => {
    list.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  });
  return groups;
}

function getLast30Days(): { date: string; label: string; dayName: string; dayNumber: number }[] {
  const days: { date: string; label: string; dayName: string; dayNumber: number }[] = [];
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const date = new Date(now.getTime() - i * 86400000);
    const dateString = toISODate(date);
    days.push({
      date: dateString,
      label: formatHistoryDate(dateString),
      dayName: dayNames[date.getDay()],
      dayNumber: date.getDate(),
    });
  }
  return days;
}

function isSeedanceVideoExpired(savedAt: string): boolean {
  const savedTime = new Date(savedAt).getTime();
  return Date.now() - savedTime > 24 * 60 * 60 * 1000;
}

function getSeedanceTaskTime(task: SeedanceTaskResult) {
  return task.createdAt && task.createdAt > 0 ? task.createdAt : Math.floor(Date.now() / 1000);
}

function formatSeedanceLibraryFileName(createdAt?: number) {
  const timestampMs = createdAt && createdAt > 1e12 ? createdAt : Number(createdAt || 0) * 1000;
  const date = new Date(timestampMs > 0 ? timestampMs : Date.now());
  const month = date.toLocaleString('zh-CN', { month: 'numeric', timeZone: 'Asia/Shanghai' });
  const day = date.toLocaleString('zh-CN', { day: 'numeric', timeZone: 'Asia/Shanghai' });
  const time = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    timeZone: 'Asia/Shanghai',
  }).replace(':', '-');
  return `${month}${day} ${time}.mp4`;
}

function createSeedanceHistoryItem(
  task: SeedanceTaskResult,
  options: {
    prompt: string;
    model: SeedanceModelId;
    taskMode?: SeedanceTaskMode;
    resolution: SeedanceResolution;
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
    model: options.model,
    taskMode: options.taskMode || 'generate',
    prompt: options.prompt,
    status: task.status,
    videoUrl: task.videoUrl,
    createdAt,
    updatedAt: task.updatedAt,
    savedAt: new Date().toISOString(),
    resolution: options.resolution,
    ratio: options.ratio,
    duration: options.duration,
    generateAudio: options.generateAudio,
    watermark: options.watermark,
    elapsedSeconds: options.elapsedSeconds,
    isGood: false,
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

function compactStoredPaintingHistoryForQuota() {
  try {
    const raw = window.localStorage.getItem(PAINTING_HISTORY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    const seenAssets = new Set<string>();
    const compacted = parsed
      .filter((item) => item && typeof item === 'object')
      .filter((item) => {
        const assetKey = item.uploadHistoryId
          ? `upload:${item.uploadHistoryId}`
          : item.thumbnail
            ? `legacy:${String(item.thumbnail).slice(0, 160)}`
            : `record:${item.id}`;
        if (seenAssets.has(assetKey)) return false;
        seenAssets.add(assetKey);
        return true;
      })
      .slice(0, MAX_PAINTING_HISTORY_ITEMS)
      .map((item) => {
        if (!item.uploadHistoryId || !item.thumbnail) return item;
        const { thumbnail: _duplicateThumbnail, ...rest } = item;
        return rest;
      });
    window.localStorage.setItem(PAINTING_HISTORY_STORAGE_KEY, JSON.stringify(compacted));
  } catch {
    // 只做容量释放；失败时交给 Seedance 历史自身继续裁剪。
  }
}

function persistSeedanceHistorySafely(items: SeedanceHistoryItem[]): SeedanceHistoryItem[] {
  let candidates = items.slice(0, MAX_SEEDANCE_HISTORY_ITEMS);
  const tryWrite = () => {
    try {
      window.localStorage.setItem(SEEDANCE_HISTORY_STORAGE_KEY, JSON.stringify(candidates));
      return true;
    } catch {
      return false;
    }
  };

  if (tryWrite()) return candidates;
  compactStoredPaintingHistoryForQuota();
  if (tryWrite()) return candidates;

  // 容量仍不足时始终保留最新记录，分批丢弃最旧记录，绝不把异常抛给页面。
  while (candidates.length > 1) {
    candidates = candidates.slice(0, Math.max(1, candidates.length - 10));
    if (tryWrite()) return candidates;
  }

  // 最后只清理本模块自己的旧 Seedance 历史，并立即重写最新一条。
  try {
    window.localStorage.removeItem(SEEDANCE_HISTORY_STORAGE_KEY);
    candidates = items.slice(0, 1);
    if (tryWrite()) return candidates;
  } catch {
    // 浏览器完全禁用本地存储时，仅放弃持久化，不影响当前页面运行。
  }

  return [];
}

function loadSeedanceHistory() {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(SEEDANCE_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const maxAgeMs = SEEDANCE_HISTORY_MAX_AGE_MS;
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

    const normalized = filtered
      .map((item) => ({
        ...item,
        // Records created before model switching were all Seedance 2.0.
        model: item.model === 'doubao-seedance-2-5-260628' || item.model === 'doubao-seedance-2-0-mini-260615'
          ? item.model as SeedanceModelId
          : 'doubao-seedance-2-0-260128' as SeedanceModelId,
        taskMode: item.taskMode === 'video-edit-painting'
          ? 'video-edit-painting' as SeedanceTaskMode
          : 'generate' as SeedanceTaskMode,
        status: item.status === 'creating' ? 'creation_interrupted' : item.status,
      }))
      .slice(0, MAX_SEEDANCE_HISTORY_ITEMS);
    if (filtered.length < parsed.length || normalized.some((item) => item.status === 'creation_interrupted')) {
      persistSeedanceHistorySafely(normalized);
    }
    return normalized;
  } catch {
    return [];
  }
}

function thumbnailDataUrlToFile(dataUrl: string, fileName: string): File | null {
  try {
    const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) return null;
    const bytes = window.atob(match[2]);
    const buffer = new Uint8Array(bytes.length);
    for (let index = 0; index < bytes.length; index += 1) {
      buffer[index] = bytes.charCodeAt(index);
    }
    return new File([buffer], fileName, { type: match[1] || 'image/jpeg' });
  } catch {
    return null;
  }
}

function loadPaintingHistory() {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(PAINTING_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const maxAgeMs = PAINTING_HISTORY_MAX_AGE_MS;
    const now = Date.now();

    const filtered = parsed
      .filter((item): item is PaintingHistoryItem => (
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.savedAt === 'string' &&
        item.profile &&
        typeof item.profile === 'object'
      ))
      .filter((item) => {
        const savedTime = new Date(item.savedAt).getTime();
        return now - savedTime < maxAgeMs;
      })
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
      .slice(0, MAX_PAINTING_HISTORY_ITEMS);

    const seenAssets = new Set<string>();
    const compacted = filtered
      .filter((item) => {
        const assetKey = item.uploadHistoryId
          ? `upload:${item.uploadHistoryId}`
          : item.thumbnail
            ? `legacy:${item.thumbnail.slice(0, 160)}`
            : `record:${item.id}`;
        if (seenAssets.has(assetKey)) return false;
        seenAssets.add(assetKey);
        return true;
      })
      .map((item) => item.uploadHistoryId && item.thumbnail
        ? { ...item, thumbnail: undefined }
        : item);

    if (compacted.length < parsed.length || compacted.some((item, index) => item !== filtered[index])) {
      persistPaintingHistory(compacted);
    }

    return compacted;
  } catch {
    window.localStorage.removeItem(PAINTING_HISTORY_STORAGE_KEY);
    return [];
  }
}

function mergePaintingHistoryItem(previous: PaintingHistoryItem[], item: PaintingHistoryItem) {
  const next = [
    item,
    ...previous.filter((historyItem) => (
      historyItem.id !== item.id
      && (!item.uploadHistoryId || historyItem.uploadHistoryId !== item.uploadHistoryId)
    )),
  ];
  return next
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
    .slice(0, MAX_PAINTING_HISTORY_ITEMS);
}

function persistPaintingHistory(items: PaintingHistoryItem[]) {
  if (typeof window === 'undefined') return;
  try {
    const compacted = items.map((item) => item.uploadHistoryId && item.thumbnail
      ? { ...item, thumbnail: undefined }
      : item);
    window.localStorage.setItem(PAINTING_HISTORY_STORAGE_KEY, JSON.stringify(compacted));
  } catch {
    // 浏览器禁止本地存储时，仍允许本次流程正常进行。
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

function seedanceHistoryItemToTask(item: SeedanceHistoryItem): SeedanceTaskResult {
  return {
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
  };
}

function findLatestActiveSeedanceHistoryItem(items: SeedanceHistoryItem[]) {
  return items.find((item) => item.taskId && !item.videoUrl && !isSeedanceTerminalStatus(item.status)) || null;
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

export default function CreativeCreationPage({ onBack, onNavigate, onSwitchToCopy }: CreativeCreationPageProps) {
  const initialSessionState = useMemo(() => {
    const sessions = loadSavedCreativeSessions();
    return {
      sessions,
      activeSessionId: sessions[0]?.id || createSessionId(),
      messages: sessions[0] ? inflateSavedMessages(sessions[0].messages) : getDefaultMessages(),
    };
  }, []);
  const [savedSessions, setSavedSessions] = useState<SavedCreativeSession[]>(initialSessionState.sessions);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionState.activeSessionId);
  const [messages, setMessages] = useState<Message[]>(initialSessionState.messages);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [configReachable, setConfigReachable] = useState(true);
  const [arkApiConfigured, setArkApiConfigured] = useState(true);
  const [dashscopeApiConfigured, setDashscopeApiConfigured] = useState(true);
  const [seedanceApiConfigured, setSeedanceApiConfigured] = useState(true);
  const [publicBaseUrlConfigured, setPublicBaseUrlConfigured] = useState(false);
  const [doubaoMultimodalModel, setDoubaoMultimodalModel] = useState('doubao-seed-2-1-pro-260628');
  const [qwenMultimodalModel, setQwenMultimodalModel] = useState('qwen3.8-max');
  const [reverseModel, setReverseModel] = useState<CreativeReverseModel>('doubao');
  const [selectedMedia, setSelectedMedia] = useState<SelectedCreativeMedia | null>(null);
  const [seedanceTaskMode, setSeedanceTaskMode] = useState<SeedanceTaskMode>('generate');
  const [seedanceModel, setSeedanceModel] = useState<SeedanceModelId>('doubao-seedance-2-0-260128');
  const [seedancePrompt, setSeedancePrompt] = useState("");
  const [seedanceResolution, setSeedanceResolution] = useState<SeedanceResolution>('720p');
  const [seedanceRatio, setSeedanceRatio] = useState("9:16");
  const [seedanceDuration, setSeedanceDuration] = useState(5);
  const [seedanceGenerateAudio, setSeedanceGenerateAudio] = useState(false);
  const [seedanceWatermark, setSeedanceWatermark] = useState(false);
  const [seedanceReferences, setSeedanceReferences] = useState<SeedanceReferenceFile[]>([]);
  const [videoEditTarget, setVideoEditTarget] = useState('人物手中或场景中出现的原挂画/装饰画');
  const [videoEditAdjustments, setVideoEditAdjustments] = useState('');
  const [videoEditSourceDuration, setVideoEditSourceDuration] = useState<number | null>(null);
  const [isSeedanceLoading, setIsSeedanceLoading] = useState(false);
  const [isSeedancePolling, setIsSeedancePolling] = useState(false);
  const [seedanceError, setSeedanceError] = useState("");
  const [seedanceTask, setSeedanceTask] = useState<SeedanceTaskResult | null>(null);
  const [seedanceHistory, setSeedanceHistory] = useState<SeedanceHistoryItem[]>([]);
  const seedanceHistoryHydratedRef = useRef(false);
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string>(() => toISODate(new Date()));
  const [showSeedanceSettings, setShowSeedanceSettings] = useState(false);
  const [seedanceClock, setSeedanceClock] = useState(Date.now());
  const [seedanceVideoModal, setSeedanceVideoModal] = useState(false);
  const [seedanceModalItem, setSeedanceModalItem] = useState<SeedanceHistoryItem | null>(null);
  const [seedanceLibrarySaveTarget, setSeedanceLibrarySaveTarget] = useState<SeedanceLibrarySaveTarget | null>(null);
  const [videoLibraryFolders, setVideoLibraryFolders] = useState<string[]>([]);
  const [selectedVideoLibraryFolder, setSelectedVideoLibraryFolder] = useState(loadLastVideoLibraryFolder);
  const [isVideoLibraryFolderLoading, setIsVideoLibraryFolderLoading] = useState(false);
  const [isSavingToVideoLibrary, setIsSavingToVideoLibrary] = useState(false);
  const [videoLibrarySaveError, setVideoLibrarySaveError] = useState('');
  const [videoLibrarySaveNotice, setVideoLibrarySaveNotice] = useState('');
  const [showAtMenu, setShowAtMenu] = useState(false);
  const [atMenuFilter, setAtMenuFilter] = useState("");
  const [atMenuSelectedIndex, setAtMenuSelectedIndex] = useState(0);
  const [reverseMode, setReverseMode] = useState<ReverseMode>('direct');
  const [paintingImage, setPaintingImage] = useState<SelectedCreativeMedia | null>(null);
  const [paintingUploadHistoryId, setPaintingUploadHistoryId] = useState<number | null>(null);
  const [paintingProfile, setPaintingProfile] = useState<PaintingProfile | null>(null);
  const [paintingPlan, setPaintingPlan] = useState<PaintingMaterialPlan>({
    count: 10,
    durationMin: 5,
    durationMax: 10,
    stylePreset: 'modern-minimal',
    character: '',
    audio: '',
    ratio: '9:16',
    scene: '',
    extraRequirements: '',
  });
  const [paintingIdeas, setPaintingIdeas] = useState<PaintingIdeaSummary[]>([]);
  const [paintingIdeaBatchCache, setPaintingIdeaBatchCache] = useState<Record<string, PaintingIdeaSummary[]>>({});
  const [paintingSelectedIdea, setPaintingSelectedIdea] = useState<PaintingIdeaSummary | null>(null);
  const [paintingIdeaUsageCounts, setPaintingIdeaUsageCounts] = useState<Record<string, number>>({});
  const [paintingIdeaLastPrompts, setPaintingIdeaLastPrompts] = useState<Record<string, string>>({});
  const [paintingFrameworkBatch, setPaintingFrameworkBatch] = useState(0);
  const [paintingTotalBatches, setPaintingTotalBatches] = useState(4);
  const [paintingVariationRound, setPaintingVariationRound] = useState(0);
  const [paintingFullPrompt, setPaintingFullPrompt] = useState('');
  const [paintingLoading, setPaintingLoading] = useState<'idle' | 'analyze' | 'ideas' | 'prompt'>('idle');
  const [paintingHistory, setPaintingHistory] = useState<PaintingHistoryItem[]>([]);
  const [paintingError, setPaintingError] = useState('');
  const paintingFileInputRef = useRef<HTMLInputElement>(null);

  // 挂画全自动批量生成状态
  const [paintingBatchConfirmOpen, setPaintingBatchConfirmOpen] = useState(false);
  const [paintingBatchPreparing, setPaintingBatchPreparing] = useState(false);
  const [paintingBatchIdeas, setPaintingBatchIdeas] = useState<PaintingIdeaSummary[]>([]);
  const [paintingBatchOnlyUnused, setPaintingBatchOnlyUnused] = useState(true);
  const [paintingBatchFolder, setPaintingBatchFolder] = useState(loadLastVideoLibraryFolder);
  const [paintingBatchFolderId, setPaintingBatchFolderId] = useState<number | null>(null);
  const [paintingBatchFolderList, setPaintingBatchFolderList] = useState<string[]>([]);
  const [paintingUsedDirections, setPaintingUsedDirections] = useState<number[]>([]);
  const [paintingBatchActiveRunId, setPaintingBatchActiveRunId] = useState<string | null>(null);
  const [paintingBatchDetail, setPaintingBatchDetail] = useState<PaintingBatchRunDetail | null>(null);
  const [paintingBatchRuns, setPaintingBatchRuns] = useState<PaintingBatchRun[]>([]);
  const [paintingBatchListError, setPaintingBatchListError] = useState('');
  const [paintingBatchActionLoading, setPaintingBatchActionLoading] = useState<'pause' | 'resume' | 'stop' | null>(null);
  const [paintingBatchCreating, setPaintingBatchCreating] = useState(false);
  const paintingBatchPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paintingBatchModuleRef = useRef<HTMLDivElement | null>(null);
  const paintingBatchScrollRequestedRef = useRef(false);
  const [paintingBatchClock, setPaintingBatchClock] = useState(Date.now());
  // 断点继续：创意方案实时工作缓存（不依赖 React setState 异步生效）+ 每个“轮次+批次”稳定的幂等请求编号。
  const paintingIdeaBatchCacheRef = useRef<Record<string, PaintingIdeaSummary[]>>({});
  const paintingIdeaClientRequestIdsRef = useRef<Record<string, string>>({});
  // 正式付费批次的创建幂等编号：同一次确认操作的所有重试复用，只有用户主动取消/改图/换轮/换方向才重新生成。
  const batchCreationRequestIdRef = useRef<string | null>(null);
  // 分阶段状态 + 断点继续错误。
  const [paintingBatchPrepareStage, setPaintingBatchPrepareStage] = useState('');
  const [paintingBatchPreparedBatches, setPaintingBatchPreparedBatches] = useState(0);
  const [paintingBatchPrepareFailed, setPaintingBatchPrepareFailed] = useState(false);
  const [paintingBatchPrepareError, setPaintingBatchPrepareError] = useState('');
  const [paintingBatchConfirming, setPaintingBatchConfirming] = useState(false);
  const [paintingBatchUnconfirmed, setPaintingBatchUnconfirmed] = useState(false);
  const [replaceImage, setReplaceImage] = useState<SelectedCreativeMedia | null>(null);
  const [replaceTarget, setReplaceTarget] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [imageToVideoAddPainting, setImageToVideoAddPainting] = useState(false);
  const [imageToVideoDuration, setImageToVideoDuration] = useState('');
  const [imageToVideoPainting, setImageToVideoPainting] = useState<SelectedCreativeMedia | null>(null);
  const [imageToVideoPaintingPlacement, setImageToVideoPaintingPlacement] = useState('');
  const [additionalChange, setAdditionalChange] = useState('');
  const [enableCharacterRemix, setEnableCharacterRemix] = useState(false);
  const [characterRemix, setCharacterRemix] = useState('');
  const [includeSubtitles, setIncludeSubtitles] = useState(false);
  const [additionalChangeHistory, setAdditionalChangeHistory] = useState<AdditionalChangeHistoryItem[]>([]);
  const [videoHistory, setVideoHistory] = useState<UploadHistoryPreviewItem[]>([]);
  const [imageHistory, setImageHistory] = useState<UploadHistoryPreviewItem[]>([]);
  const videoHistoryRef = useRef<UploadHistoryPreviewItem[]>([]);
  const imageHistoryRef = useRef<UploadHistoryPreviewItem[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyModalKind, setHistoryModalKind] = useState<'video' | 'image-creative' | 'image-seedance' | 'video-edit-video' | 'video-edit-image'>('video');
  const [historyPreviewItem, setHistoryPreviewItem] = useState<HistoryPreviewItem | null>(null);
  const [historyVideoDurations, setHistoryVideoDurations] = useState<Record<number, number>>({});
  const [isUploadHistoryLoading, setIsUploadHistoryLoading] = useState(true);
  const uploadHistoryLoadedRef = useRef(false);
  const uploadHistoryLoadPromiseRef = useRef<Promise<void> | null>(null);
  const ownedHistoryPreviewUrlRef = useRef<string | null>(null);
  const hoverPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seedanceCostStats = getSeedanceCostStats();
  const currentSeedanceLibraryFolder = seedanceTask?.taskId
    ? seedanceHistory.find((item) => item.taskId === seedanceTask.taskId)?.libraryFolder || ''
    : '';
  const [notebookItems, setNotebookItems] = useState<NotebookItem[]>(loadNotebookItems);
  const [isNotebookOpen, setIsNotebookOpen] = useState(false);
  const [notebookDraft, setNotebookDraft] = useState("");
  const [copiedNotebookId, setCopiedNotebookId] = useState<string | null>(null);
  const [isAdditionalHistoryOpen, setIsAdditionalHistoryOpen] = useState(false);
  const [copiedAdditionalId, setCopiedAdditionalId] = useState<string | null>(null);
  const [additionalHistorySearch, setAdditionalHistorySearch] = useState("");
  const [seedancePromptHighlight, setSeedancePromptHighlight] = useState(false);
  const [isManualInputOpen, setIsManualInputOpen] = useState(false);
  const [showSearchReplaceModal, setShowSearchReplaceModal] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [replaceResult, setReplaceResult] = useState<string | null>(null);
  const [seedanceReplaceHighlight, setSeedanceReplaceHighlight] = useState<TextHighlightState | null>(null);
  const [seedancePromptScrollTop, setSeedancePromptScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const analysisScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const imageToVideoPaintingInputRef = useRef<HTMLInputElement>(null);
  const seedanceFileInputRef = useRef<HTMLInputElement>(null);
  const videoEditVideoInputRef = useRef<HTMLInputElement>(null);
  const videoEditImageInputRef = useRef<HTMLInputElement>(null);
  const seedanceSettingsRef = useRef<HTMLDivElement>(null);
  const seedancePanelRef = useRef<HTMLDivElement>(null);
  const seedanceTaskStatusRef = useRef<HTMLDivElement>(null);
  const paintingPlanRef = useRef<HTMLDivElement>(null);
  const paintingIdeasRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seedancePromptRef = useRef<HTMLTextAreaElement>(null);
  const additionalChangeRef = useRef<HTMLTextAreaElement>(null);
  const videoEditTargetRef = useRef<HTMLTextAreaElement>(null);
  const videoEditAdjustmentsRef = useRef<HTMLTextAreaElement>(null);
  const notebookRef = useRef<HTMLDivElement>(null);
  const additionalHistoryRef = useRef<HTMLDivElement>(null);
  const autoSyncToSeedanceRef = useRef(false);
  const pendingReverseSeedanceSyncRef = useRef<ReverseSeedanceSyncSnapshot | null>(null);
  const normalSeedanceSettingsRef = useRef({
    model: 'doubao-seedance-2-0-260128' as SeedanceModelId,
    resolution: '720p' as SeedanceResolution,
    ratio: '9:16',
    duration: 5,
    generateAudio: false,
    watermark: false,
  });

  const filteredAdditionalChangeHistory = useMemo(() => {
    const keyword = additionalHistorySearch.trim().toLowerCase();
    return additionalChangeHistory
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !keyword || item.text.toLowerCase().includes(keyword));
  }, [additionalChangeHistory, additionalHistorySearch]);

  function scrollToRef(ref: RefObject<HTMLElement | null>) {
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  useEffect(() => {
    const textarea = additionalChangeRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [additionalChange]);

  useEffect(() => {
    const textareas = [videoEditTargetRef.current, videoEditAdjustmentsRef.current];
    textareas.forEach((textarea) => {
      if (!textarea) return;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(40, textarea.scrollHeight)}px`;
    });
  }, [videoEditTarget, videoEditAdjustments, seedanceTaskMode]);

  useEffect(() => {
    if (seedanceReplaceHighlight && seedanceReplaceHighlight.text !== seedancePrompt) {
      setSeedanceReplaceHighlight(null);
    }
  }, [seedancePrompt, seedanceReplaceHighlight]);

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
    try {
      window.localStorage.setItem(CREATIVE_SESSIONS_STORAGE_KEY, JSON.stringify(savedSessions));
    } catch {
      // 对话历史空间不足不能影响视频任务页面继续运行。
    }
  }, [savedSessions]);

  useEffect(() => {
    scrollAnalysisToBottom();
  }, [messages.length]);

  async function refreshUploadHistories() {
    const [videos, images] = await Promise.all([
      loadUploadHistorySummaries('video'),
      loadUploadHistorySummaries('image'),
    ]);

    setVideoHistory((previous) => {
      previous.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return videos.map((item) => ({
        id: item.id,
        name: item.name,
        timestamp: item.timestamp,
        previewUrl: item.previewBlob ? URL.createObjectURL(item.previewBlob) : '',
        duration: item.duration,
      }));
    });
    setHistoryVideoDurations((previous) => {
      const next = { ...previous };
      videos.forEach((item) => {
        if (Number.isFinite(item.duration) && item.duration && item.duration > 0) {
          next[item.id] = item.duration;
        }
      });
      return next;
    });
    setImageHistory((previous) => {
      previous.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return images.map((item) => ({
        id: item.id,
        name: item.name,
        timestamp: item.timestamp,
        previewUrl: item.previewBlob ? URL.createObjectURL(item.previewBlob) : '',
      }));
    });
    uploadHistoryLoadedRef.current = true;
  }

  function ensureUploadHistoriesLoaded() {
    if (uploadHistoryLoadedRef.current) return Promise.resolve();
    if (uploadHistoryLoadPromiseRef.current) return uploadHistoryLoadPromiseRef.current;

    setIsUploadHistoryLoading(true);
    const loadingPromise = refreshUploadHistories()
      .catch(() => undefined)
      .finally(() => {
        setIsUploadHistoryLoading(false);
        uploadHistoryLoadPromiseRef.current = null;
      });
    uploadHistoryLoadPromiseRef.current = loadingPromise;
    return loadingPromise;
  }

  useEffect(() => {
    void ensureUploadHistoriesLoaded();
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(ADDITIONAL_CHANGE_HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const normalized = persistAdditionalChangeHistory(parsed);
        setAdditionalChangeHistory(normalized);
      }
    } catch {
      // ignore parse errors
    }

  }, []);

  useEffect(() => {
    if (showHistoryModal) void ensureUploadHistoriesLoaded();
  }, [showHistoryModal]);

  useEffect(() => {
    videoHistoryRef.current = videoHistory;
  }, [videoHistory]);

  useEffect(() => {
    imageHistoryRef.current = imageHistory;
  }, [imageHistory]);

  useEffect(() => {
    if (!showHistoryModal) {
      setHistoryPreviewItem(null);
    }
  }, [showHistoryModal]);

  useEffect(() => {
    const ownedUrl = historyPreviewItem?.ownedPreviewUrl ? historyPreviewItem.previewUrl : null;
    if (ownedHistoryPreviewUrlRef.current && ownedHistoryPreviewUrlRef.current !== ownedUrl) {
      URL.revokeObjectURL(ownedHistoryPreviewUrlRef.current);
    }
    ownedHistoryPreviewUrlRef.current = ownedUrl;
    return () => {
      if (ownedHistoryPreviewUrlRef.current) {
        URL.revokeObjectURL(ownedHistoryPreviewUrlRef.current);
        ownedHistoryPreviewUrlRef.current = null;
      }
    };
  }, [historyPreviewItem]);

  useEffect(() => {
    return () => {
      videoHistoryRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      imageHistoryRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const history = loadSeedanceHistory();
      seedanceHistoryHydratedRef.current = true;
      if (!cancelled) setSeedanceHistory(history);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const history = loadPaintingHistory();
      if (!cancelled) setPaintingHistory(history);
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (!seedanceHistoryHydratedRef.current) return;

    const persisted = persistSeedanceHistorySafely(seedanceHistory);
    if (persisted.length !== seedanceHistory.length) {
      setSeedanceHistory(persisted);
      setSeedanceError('浏览器历史空间接近上限，系统已自动清理最旧的视频记录，当前任务不受影响。');
    }
  }, [seedanceHistory]);

  useEffect(() => {
    if (seedanceTask?.taskId) return;
    const activeItem = findLatestActiveSeedanceHistoryItem(seedanceHistory);
    if (!activeItem) return;

    setSeedanceTask(seedanceHistoryItemToTask(activeItem));
    setSeedanceTaskMode(activeItem.taskMode || 'generate');
    setSeedanceModel(activeItem.model);
    setSeedancePrompt(activeItem.prompt);
    setSeedanceResolution(activeItem.resolution || '720p');
    setSeedanceRatio(activeItem.ratio);
    setSeedanceDuration(activeItem.duration);
    setSeedanceGenerateAudio(activeItem.generateAudio);
    setSeedanceWatermark(activeItem.watermark);
  }, [seedanceHistory, seedanceTask?.taskId]);

  useEffect(() => {
    if (selectedHistoryDate) return;
    const grouped = getSeedanceHistoryByDate(seedanceHistory);
    const firstDate = Array.from(grouped.keys())[0];
    if (firstDate) {
      setSelectedHistoryDate(firstDate);
    }
  }, [seedanceHistory, selectedHistoryDate]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    saveNotebookItems(notebookItems);
  }, [notebookItems]);

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
    function handleNotebookClickOutside(event: MouseEvent) {
      if (!isNotebookOpen) return;
      const target = event.target as HTMLElement;
      if (notebookRef.current && notebookRef.current.contains(target)) return;
      if (notebookDraft.trim()) {
        addNotebookItem();
      }
      setIsNotebookOpen(false);
    }
    document.addEventListener('mousedown', handleNotebookClickOutside);
    return () => document.removeEventListener('mousedown', handleNotebookClickOutside);
  }, [isNotebookOpen, notebookDraft]);

  useEffect(() => {
    function handleAdditionalHistoryClickOutside(event: MouseEvent) {
      if (!isAdditionalHistoryOpen) return;
      const target = event.target as HTMLElement;
      if (additionalHistoryRef.current && additionalHistoryRef.current.contains(target)) return;
      setIsAdditionalHistoryOpen(false);
    }
    document.addEventListener('mousedown', handleAdditionalHistoryClickOutside);
    return () => document.removeEventListener('mousedown', handleAdditionalHistoryClickOutside);
  }, [isAdditionalHistoryOpen]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      const status = await getCreativeConfigStatus();
      if (cancelled) return;
      setConfigReachable(status.reachable);
      setArkApiConfigured(status.arkApiKey);
      setDashscopeApiConfigured(status.dashscopeApiKey);
      setSeedanceApiConfigured(status.seedanceApiKey);
      setPublicBaseUrlConfigured(status.publicBaseUrl);
      setDoubaoMultimodalModel(status.doubaoMultimodalModel || '');
      setQwenMultimodalModel(status.qwenMultimodalModel || 'qwen3.8-max');
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

  // 批量生成运行中每秒刷新计时，用于显示「已运行多久」。
  useEffect(() => {
    const status = paintingBatchDetail?.run.status;
    if (!status || PAINTING_BATCH_TERMINAL_STATUSES.includes(status)) {
      return;
    }
    setPaintingBatchClock(Date.now());
    const timer = window.setInterval(() => setPaintingBatchClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [paintingBatchDetail?.run.status]);

  // 点击「确认生成」创建批次后，自动下滑到全自动批量生成模块。
  useEffect(() => {
    if (paintingBatchScrollRequestedRef.current && paintingBatchDetail && paintingBatchModuleRef.current) {
      paintingBatchScrollRequestedRef.current = false;
      window.setTimeout(() => {
        paintingBatchModuleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  }, [paintingBatchDetail]);

  // 图片 / 方案 / 轮次 / 方向集合发生变化后，废弃旧创建幂等编号，避免把新批次错误恢复到旧批次。
  useEffect(() => {
    batchCreationRequestIdRef.current = null;
  }, [paintingImage, paintingVariationRound, paintingBatchOnlyUnused, paintingPlan, paintingBatchIdeas]);

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
    setSeedanceReplaceHighlight(null);
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
    setSeedanceReplaceHighlight(null);
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
    setSeedanceReplaceHighlight(null);
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

  useEffect(() => {
    if (!isLoading && autoSyncToSeedanceRef.current && latestAssistantText) {
      autoSyncToSeedanceRef.current = false;
      if (latestAssistantText.startsWith('生成失败：')) {
        pendingReverseSeedanceSyncRef.current = null;
        return;
      }
      syncLatestPromptToSeedance();
      scrollToRef(seedancePromptRef);
    }
  }, [isLoading, latestAssistantText]);

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
    const isImageMode = reverseMode === 'image';
    if (isImageMode && !file.type.startsWith('image/')) {
      throw new Error('图片生视频提示词模式请上传图片文件。');
    }
    if (!isImageMode && !file.type.startsWith('video/')) {
      throw new Error('这里请上传视频文件，用来反推 Seedance 视频提示词。');
    }

    if (file.size > MAX_VIDEO_SIZE_BYTES) {
      throw new Error(`${isImageMode ? '图片' : '视频'}请控制在 150MB 以内，方便稳定上传和分析。`);
    }
  }

  function saveAdditionalChangeHistory(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setAdditionalChangeHistory((previous) => {
      const next = persistAdditionalChangeHistory([
        { text: trimmed, createdAt: Date.now() },
        ...previous.filter((item) => item.text !== trimmed),
      ]);
      return next;
    });
  }

  function deleteAdditionalChangeHistory(text: string) {
    setAdditionalChangeHistory((previous) => {
      const next = persistAdditionalChangeHistory(previous.filter((item) => item.text !== text));
      return next;
    });
  }

  function prepareVideoReversePrompt() {
    if (reverseMode === 'image') {
      if (selectedMedia?.kind !== 'image') {
        setRequestError('请先上传一张图片，作为生成视频提示词的视觉基准。');
        return;
      }
      const durationSeconds = Number(imageToVideoDuration);
      const maxDuration = seedanceModel === 'doubao-seedance-2-5-260628' ? 30 : 15;
      if (!imageToVideoDuration.trim()) {
        setRequestError('请填写图片生成视频的时长。');
        return;
      }
      if (!Number.isInteger(durationSeconds) || durationSeconds < 4 || durationSeconds > maxDuration) {
        setRequestError(`请输入 4-${maxDuration} 之间的整数秒数。`);
        return;
      }
      if (imageToVideoAddPainting && !imageToVideoPainting) {
        setRequestError('勾选加入挂画后，请先上传一张挂画或装饰画参考图。');
        return;
      }
      if (imageToVideoAddPainting && !imageToVideoPaintingPlacement.trim()) {
        setRequestError('请填写挂画或装饰画要插入的位置。');
        return;
      }
      const prompt = IMAGE_TO_VIDEO_PROMPT({
        durationSeconds,
        addPainting: imageToVideoAddPainting,
        paintingPlacement: imageToVideoPaintingPlacement,
        additionalChange,
        includeSubtitles,
      });
      setInput(prompt);
      setSeedanceDuration(durationSeconds);
      setRequestError("");
      saveAdditionalChangeHistory(additionalChange);
      pendingReverseSeedanceSyncRef.current = {
        mode: 'image',
        sourceVideo: null,
        referenceImages: [selectedMedia, imageToVideoAddPainting ? imageToVideoPainting : null]
          .filter((media): media is SelectedCreativeMedia => Boolean(media?.kind === 'image')),
        requestedDuration: durationSeconds,
      };
      autoSyncToSeedanceRef.current = true;
      scrollToRef(textareaRef);
      handleSend(prompt);
      return;
    }

    const characterRemixText = enableCharacterRemix ? characterRemix.trim() : '';
    if (enableCharacterRemix && !characterRemixText) {
      setRequestError('请填写人物改造要求，例如：把人物改成80岁左右的女性，服装要符合茶室环境。');
      return;
    }

    const sourceVideo = selectedMedia?.kind === 'video' ? selectedMedia : null;
    pendingReverseSeedanceSyncRef.current = {
      mode: reverseMode === 'replace' ? 'replace' : 'direct',
      sourceVideo,
      referenceImages: reverseMode === 'replace' && replaceImage ? [replaceImage] : [],
      durationPromise: sourceVideo
        ? readVideoDuration(sourceVideo.file).catch(() => null)
        : undefined,
    };

    if (reverseMode === 'replace') {
      if (!replaceTarget.trim() || !replaceWith.trim()) {
        setRequestError('请填写需要替换的元素和目标元素');
        return;
      }
      const prompt = VIDEO_REPLACE_PROMPT(replaceTarget.trim(), replaceWith.trim(), { additionalChange, includeSubtitles, characterRemix: characterRemixText });
      setInput(prompt);
      setRequestError("");
      saveAdditionalChangeHistory(additionalChange);
      autoSyncToSeedanceRef.current = true;
      scrollToRef(textareaRef);
      handleSend(prompt);
    } else {
      const prompt = VIDEO_REVERSE_PROMPT({ additionalChange, includeSubtitles, characterRemix: characterRemixText });
      setInput(prompt);
      setRequestError("");
      saveAdditionalChangeHistory(additionalChange);
      autoSyncToSeedanceRef.current = true;
      scrollToRef(textareaRef);
      handleSend(prompt);
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
    setSeedanceReplaceHighlight(null);
    setSeedancePromptScrollTop(0);
    setRequestError("");
    setSeedancePromptHighlight(true);
    setTimeout(() => setSeedancePromptHighlight(false), 2000);

    // 反推完成自动带出：时长（源视频真实时长向上取整）+ 参考图（元素替换 / 图片生视频）。
    syncReverseMediaToSeedance();
  }

  function syncReverseMediaToSeedance() {
    const snapshot = pendingReverseSeedanceSyncRef.current;
    pendingReverseSeedanceSyncRef.current = null;
    const activeMode = snapshot?.mode || reverseMode;

    // 挂画创意素材走自己的自动填充流程，这里不处理。
    if (activeMode === 'painting') return;

    // 使用提交分析前保存的素材快照，避免 AI 返回时上传区已被清空。
    const referenceImages = snapshot?.referenceImages || (
      activeMode === 'replace'
        ? (replaceImage ? [replaceImage] : [])
        : activeMode === 'image' && selectedMedia?.kind === 'image'
          ? [selectedMedia]
          : []
    );
    if (referenceImages.length > 0) {
      setSeedanceReferences(computeSeedanceReferencesWithImages(referenceImages));
    }

    const maxDuration = seedanceModel === 'doubao-seedance-2-5-260628' ? 30 : 15;
    const promptDuration = extractVideoDurationFromPrompt(latestAssistantText);
    const applyDuration = (duration: number | null | undefined) => {
      if (!duration || !Number.isFinite(duration)) return false;
      setSeedanceDuration(Math.min(maxDuration, Math.max(4, Math.ceil(duration))));
      return true;
    };

    if (snapshot?.requestedDuration) {
      applyDuration(snapshot.requestedDuration);
      return;
    }

    // 直接反推 / 元素替换优先使用源视频真实时长；读取失败时再从完整提示词提取。
    const durationPromise = snapshot?.durationPromise
      || (selectedMedia?.kind === 'video' ? readVideoDuration(selectedMedia.file).catch(() => null) : null);
    if (durationPromise) {
      void durationPromise.then((duration) => {
        if (!applyDuration(duration) && !applyDuration(promptDuration)) {
          setRequestError('提示词和参考图片已自动同步，但没有识别到有效视频时长，请手动选择时长。');
        }
      });
    } else if (!applyDuration(promptDuration) && (activeMode === 'direct' || activeMode === 'replace')) {
      setRequestError('提示词和参考图片已自动同步，但没有识别到有效视频时长，请手动选择时长。');
    }
  }

  function getAtReferenceLabel(ref: SeedanceReferenceFile, index: number) {
    const kindPrefix = ref.kind === 'image' ? '图片' : ref.kind === 'video' ? '视频' : '音频';
    const kindIndex = seedanceReferences.filter((r, i) => r.kind === ref.kind && i <= index).length;
    return `@${kindPrefix}${kindIndex}`;
  }

  function handleSeedancePromptChange(event: { target: { value: string; selectionStart: number | null } }) {
    const value = event.target.value;
    setSeedancePrompt(value);
    setSeedanceReplaceHighlight(null);

    const cursorPosition = event.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPosition);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(atIndex + 1);
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setAtMenuFilter(textAfterAt.toLowerCase());
        setAtMenuSelectedIndex(0);
        setShowAtMenu(true);
        return;
      }
    }

    setShowAtMenu(false);
    setAtMenuFilter("");
    setAtMenuSelectedIndex(0);
  }

  function handleSearchReplace() {
    if (!searchText) return;
    const { text: newText, count, ranges } = replaceAllWithHighlightRanges(seedancePrompt, searchText, replaceText);
    if (count === 0) {
      setReplaceResult(`未找到 "${searchText}"`);
      setTimeout(() => {
        setReplaceResult(null);
        setShowSearchReplaceModal(false);
      }, 1200);
      return;
    }
    setSeedancePrompt(newText);
    setSeedanceReplaceHighlight(ranges.length > 0 ? { text: newText, ranges } : null);
    setReplaceResult(`成功替换 ${count} 处`);
    setTimeout(() => {
      setReplaceResult(null);
      setShowSearchReplaceModal(false);
    }, 1200);
  }

  function handleSeedanceKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!showAtMenu) return;

    const filtered = seedanceReferences
      .map((ref, i) => ({ ref, index: i, label: getAtReferenceLabel(ref, i) }))
      .filter(({ label }) => label.toLowerCase().includes(atMenuFilter));

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAtMenuSelectedIndex((prev) => (prev + 1) % filtered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAtMenuSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = filtered[atMenuSelectedIndex];
      if (item) insertAtReference(item.index);
    } else if (event.key === 'Escape') {
      setShowAtMenu(false);
      setAtMenuFilter("");
      setAtMenuSelectedIndex(0);
    }
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
    setSeedanceReplaceHighlight(null);
    setShowAtMenu(false);
    setAtMenuFilter("");
    setAtMenuSelectedIndex(0);

    requestAnimationFrame(() => {
      if (seedancePromptRef.current) {
        const newCursorPos = atIndex + placeholder.length;
        seedancePromptRef.current.selectionStart = newCursorPos;
        seedancePromptRef.current.selectionEnd = newCursorPos;
        seedancePromptRef.current.focus();
      }
    });
  }

  function clearSeedanceReferences() {
    setSeedanceReferences((previous) => {
      previous.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setVideoEditSourceDuration(null);
  }

  function switchSeedanceTaskMode(nextMode: SeedanceTaskMode) {
    if (nextMode === seedanceTaskMode || isSeedanceLoading) return;
    if ((seedancePrompt.trim() || seedanceReferences.length > 0) && !window.confirm('切换模式会清空当前提示词和参考素材，确定继续吗？')) {
      return;
    }

    clearSeedanceReferences();
    setSeedanceTask(null);
    setSeedanceError('');
    setSeedanceReplaceHighlight(null);
    setShowAtMenu(false);
    setSeedanceTaskMode(nextMode);

    if (nextMode === 'video-edit-painting') {
      normalSeedanceSettingsRef.current = {
        model: seedanceModel,
        resolution: seedanceResolution,
        ratio: seedanceRatio,
        duration: seedanceDuration,
        generateAudio: seedanceGenerateAudio,
        watermark: seedanceWatermark,
      };
      setSeedanceModel('doubao-seedance-2-5-260628');
      setSeedanceResolution('720p');
      setSeedanceRatio('adaptive');
      setSeedanceDuration(-1);
      setSeedanceGenerateAudio(true);
      setSeedanceWatermark(false);
      setSeedancePrompt(buildVideoEditPaintingPrompt(videoEditTarget, videoEditAdjustments));
      return;
    }

    const previous = normalSeedanceSettingsRef.current;
    setSeedanceModel(previous.model);
    setSeedanceResolution(previous.resolution);
    setSeedanceRatio(previous.ratio);
    setSeedanceDuration(previous.duration);
    setSeedanceGenerateAudio(previous.generateAudio);
    setSeedanceWatermark(previous.watermark);
    setSeedancePrompt('');
  }

  async function handleVideoEditReference(file: File | null, expectedKind: 'video' | 'image') {
    if (!file) return;
    setSeedanceError('');

    const actualKind = getSeedanceReferenceKind(file);
    if (actualKind !== expectedKind) {
      setSeedanceError(expectedKind === 'video' ? '这里请上传原视频文件。' : '这里请上传目标挂画图片。');
      return;
    }
    if (expectedKind === 'video') {
      if (!/\.(mp4|mov)$/i.test(file.name) && !['video/mp4', 'video/quicktime'].includes(file.type)) {
        setSeedanceError('Seedance 2.5 视频编辑仅支持 MP4 或 MOV 原视频。');
        return;
      }
      if (!publicBaseUrlConfigured) {
        setSeedanceError('视频直接换画仅线上环境可提交，本地预览环境没有公网素材地址。');
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        setSeedanceError('原视频不能超过 50MB。');
        return;
      }
      try {
        const duration = await readVideoDuration(file);
        if (duration < 4 || duration > 30) {
          setSeedanceError(`原视频时长为 ${duration.toFixed(1)} 秒，Seedance 2.5 视频编辑只支持 4-30 秒。`);
          return;
        }
        setVideoEditSourceDuration(duration);
      } catch (error) {
        setSeedanceError(error instanceof Error ? error.message : '无法读取原视频时长。');
        return;
      }
    }

    const nextReference: SeedanceReferenceFile = {
      id: createMessageId('seedance_edit_ref'),
      kind: expectedKind,
      file,
      previewUrl: createMediaPreviewUrl(file),
      fileName: file.name,
    };
    setSeedanceReferences((previous) => {
      previous.forEach((item) => {
        if (item.kind === expectedKind && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      const retained = previous.filter((item) => item.kind !== expectedKind && (item.kind === 'video' || item.kind === 'image'));
      const combined = [...retained, nextReference];
      return combined.sort((left, right) => (left.kind === 'video' ? -1 : right.kind === 'video' ? 1 : 0));
    });
    try {
      await saveUploadHistory(file, expectedKind);
      await refreshUploadHistories();
    } catch {
      // The selected file remains usable even if local upload history cannot be updated.
    }
  }

  async function handleCreateSeedanceVideo(overrides?: {
    prompt?: string;
    duration?: number;
    references?: SeedanceReferenceFile[];
    focusTaskStatus?: boolean;
    imageHash?: string;
    directionNumber?: number;
    variationRound?: number;
  }) {
    const isVideoEdit = seedanceTaskMode === 'video-edit-painting';
    const prompt = isVideoEdit
      ? buildVideoEditPaintingPrompt(videoEditTarget, videoEditAdjustments)
      : (overrides?.prompt ?? seedancePrompt.trim());
    if (!prompt || isSeedanceLoading) return;

    const references = overrides?.references ?? seedanceReferences;
    const duration = overrides?.duration ?? seedanceDuration;

    if (isVideoEdit) {
      const videoReferences = references.filter((item) => item.kind === 'video');
      const imageReferences = references.filter((item) => item.kind === 'image');
      if (videoReferences.length !== 1 || imageReferences.length !== 1 || references.length !== 2) {
        setSeedanceError('请分别上传 1 个原视频和 1 张目标挂画图片后再提交。');
        return;
      }
      if (!videoEditSourceDuration || videoEditSourceDuration < 4 || videoEditSourceDuration > 30) {
        setSeedanceError('原视频时长必须在 4-30 秒之间。');
        return;
      }
      if (!videoEditTarget.trim()) {
        setSeedanceError('请写清楚原视频中需要被替换的挂画位置。');
        return;
      }
      setSeedancePrompt(prompt);
    }

    if (!isVideoEdit && references.length === 0) {
      const confirmed = window.confirm('当前未添加任何参考图片或视频，确定只使用文本提示词生成视频吗？');
      if (!confirmed) return;
    }

    const lastPrompt = seedanceHistory[0]?.prompt;
    if (lastPrompt && lastPrompt.trim() === prompt) {
      const confirmed = window.confirm('检测到本次提示词与上次完全相同，确定要再次生成一模一样的内容吗？');
      if (!confirmed) return;
    }

    const pendingTaskId = createMessageId('seedance_creating');
    const pendingCreatedAt = Math.floor(Date.now() / 1000);
    const pendingHistoryItem = createSeedanceHistoryItem(
      {
        ok: true,
        taskId: pendingTaskId,
        status: 'creating',
        createdAt: pendingCreatedAt,
        response: { id: pendingTaskId, status: 'creating' },
      },
      {
        model: isVideoEdit ? 'doubao-seedance-2-5-260628' : seedanceModel,
        taskMode: seedanceTaskMode,
        prompt,
        resolution: seedanceResolution,
        ratio: isVideoEdit ? 'adaptive' : seedanceRatio,
        duration: isVideoEdit ? -1 : duration,
        generateAudio: seedanceGenerateAudio,
        watermark: seedanceWatermark,
      }
    );
    const historyWithPendingTask = mergeSeedanceHistoryItem(seedanceHistory, pendingHistoryItem);
    setSeedanceHistory(historyWithPendingTask);
    persistSeedanceHistorySafely(historyWithPendingTask);

    setIsSeedanceLoading(true);
    setSeedanceError("");
    setSeedanceTask(null);
    if (overrides?.focusTaskStatus) {
      setTimeout(() => scrollToRef(seedanceTaskStatusRef), 50);
    }

    try {
      const task = await createSeedanceTask({
        model: isVideoEdit ? 'doubao-seedance-2-5-260628' : seedanceModel,
        taskMode: isVideoEdit ? 'video_edit' : 'generate',
        prompt,
        resolution: seedanceResolution,
        ratio: isVideoEdit ? 'adaptive' : seedanceRatio,
        duration: isVideoEdit ? -1 : duration,
        generateAudio: seedanceGenerateAudio,
        watermark: seedanceWatermark,
        references,
        imageHash: overrides?.imageHash,
        directionNumber: overrides?.directionNumber,
        variationRound: overrides?.variationRound,
      });
      setSeedanceTask({
        ...task,
        createdAt: task.createdAt || Math.floor(Date.now() / 1000),
      });
      if (overrides?.focusTaskStatus) {
        setTimeout(() => scrollToRef(seedanceTaskStatusRef), 50);
      }
      setSeedanceHistory((previous) => {
        const withoutPendingTask = previous.filter((item) => item.taskId !== pendingTaskId);
        return mergeSeedanceHistoryItem(
          withoutPendingTask,
          createSeedanceHistoryItem(
            {
              ...task,
              createdAt: task.createdAt || Math.floor(Date.now() / 1000),
            },
            {
              model: isVideoEdit ? 'doubao-seedance-2-5-260628' : seedanceModel,
              taskMode: seedanceTaskMode,
              prompt,
              resolution: seedanceResolution,
              ratio: isVideoEdit ? 'adaptive' : seedanceRatio,
              duration: isVideoEdit ? -1 : duration,
              generateAudio: seedanceGenerateAudio,
              watermark: seedanceWatermark,
            }
          )
        );
      });
      recordSeedanceCost(
        isVideoEdit ? Math.ceil(videoEditSourceDuration || 0) : duration,
        isVideoEdit ? 'doubao-seedance-2-5-260628' : seedanceModel,
        seedanceResolution
      );
    } catch (error) {
      setSeedanceError(error instanceof Error ? error.message : 'Seedance 创建任务失败');
      setSeedanceHistory((previous) => previous.map((item) => item.taskId === pendingTaskId
        ? { ...item, status: 'creation_interrupted', savedAt: new Date().toISOString() }
        : item));
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
    }
    setSeedanceTask(seedanceHistoryItemToTask(item));
    setSeedanceTaskMode(item.taskMode || 'generate');
    setSeedancePrompt(item.prompt);
    setSeedanceReplaceHighlight(null);
    setSeedanceModel(item.model);
    setSeedanceResolution(item.resolution || '720p');
    setSeedanceRatio(item.ratio);
    setSeedanceDuration(item.duration);
    setSeedanceGenerateAudio(item.generateAudio);
    setSeedanceWatermark(item.watermark);
  }

  async function openSeedanceLibrarySave(target: SeedanceLibrarySaveTarget) {
    setSeedanceLibrarySaveTarget(target);
    setVideoLibrarySaveError('');
    setVideoLibrarySaveNotice('');
    setIsVideoLibraryFolderLoading(true);
    try {
      const folders = await getVideoLibraryFolders();
      const availableFolders = folders.length ? folders : ['通用素材'];
      const lastFolder = loadLastVideoLibraryFolder();
      const nextFolder = availableFolders.includes(lastFolder)
        ? lastFolder
        : availableFolders.includes('通用素材')
          ? '通用素材'
          : availableFolders[0];
      setVideoLibraryFolders(availableFolders);
      setSelectedVideoLibraryFolder(nextFolder);
      saveLastVideoLibraryFolder(nextFolder);
    } catch (error) {
      setVideoLibrarySaveError(error instanceof Error ? error.message : '读取视频素材库文件夹失败');
    } finally {
      setIsVideoLibraryFolderLoading(false);
    }
  }

  async function handleSaveSeedanceToLibrary() {
    const target = seedanceLibrarySaveTarget;
    if (!target || isSavingToVideoLibrary || !selectedVideoLibraryFolder) return;
    setIsSavingToVideoLibrary(true);
    setVideoLibrarySaveError('');
    try {
      const result = await saveSeedanceVideoToLibrary({
        taskId: target.taskId,
        folderName: selectedVideoLibraryFolder,
        createdAt: target.createdAt,
      });
      if (result.sourceBytes !== result.savedBytes) {
        throw new Error('保存后文件大小校验失败，请重试');
      }
      if (result.item?.id) markVideoLibraryItemsRead([result.item.id]);
      setSeedanceHistory((previous) => previous.map((item) => (
        item.taskId === target.taskId
          ? { ...item, libraryFolder: result.item.folderName }
          : item
      )));
      setVideoLibrarySaveNotice(`${result.message}：${result.item.originalName}`);
      setSeedanceLibrarySaveTarget(null);
    } catch (error) {
      setVideoLibrarySaveError(error instanceof Error ? error.message : '保存到视频素材库失败');
    } finally {
      setIsSavingToVideoLibrary(false);
    }
  }

  function removeSeedanceHistoryItem(taskId: string) {
    setSeedanceHistory((previous) => previous.filter((item) => item.taskId !== taskId));
    setSeedanceTask((previous) => previous?.taskId === taskId ? null : previous);
  }

  function toggleSeedanceHistoryGood(taskId: string) {
    setSeedanceHistory((previous) =>
      previous.map((item) =>
        item.taskId === taskId
          ? { ...item, isGood: !item.isGood }
          : item
      )
    );
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

      await saveUploadHistory(file, kind);
      await refreshUploadHistories();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '媒体文件读取失败，请换一个文件再试。');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleSeedanceReferenceChange(files: FileList | null) {
    setSeedanceError("");
    if (!files?.length) return;

    const nextReferences: SeedanceReferenceFile[] = [];
    let imageCount = seedanceReferences.filter((item) => item.kind === 'image').length;
    let videoCount = seedanceReferences.filter((item) => item.kind === 'video').length;
    let audioCount = seedanceReferences.filter((item) => item.kind === 'audio').length;
    const isSeedance25 = seedanceModel === 'doubao-seedance-2-5-260628';
    const maxImageCount = isSeedance25 ? 30 : 9;
    const maxVideoCount = isSeedance25 ? 10 : 3;
    const maxAudioCount = isSeedance25 ? 10 : 3;
    const maxReferenceCount = isSeedance25 ? 50 : 13;

    for (const file of Array.from(files)) {
      const kind = getSeedanceReferenceKind(file);
      if (!kind) {
        setSeedanceError(`不支持的素材格式：${file.name}`);
        continue;
      }
      if (imageCount + videoCount + audioCount >= maxReferenceCount) {
        setSeedanceError(`${getSeedanceModelLabel(seedanceModel)}最多添加 ${maxReferenceCount} 个参考素材。`);
        continue;
      }

      if (kind === 'image') {
        imageCount += 1;
        if (imageCount > maxImageCount) {
          imageCount -= 1;
          setSeedanceError(`参考图片最多上传 ${maxImageCount} 张。`);
          continue;
        }
      }

      if (kind === 'video') {
        if (!publicBaseUrlConfigured) {
          setSeedanceError('视频参考功能仅线上环境可用，本地开发不支持上传视频参考素材。');
          continue;
        }
        videoCount += 1;
        if (videoCount > maxVideoCount) {
          videoCount -= 1;
          setSeedanceError(`参考视频最多上传 ${maxVideoCount} 个。`);
          continue;
        }
        if (file.size > 50 * 1024 * 1024) {
          videoCount -= 1;
          setSeedanceError('参考视频单个文件不能超过 50MB。');
          continue;
        }
      }

      if (kind === 'audio') {
        audioCount += 1;
        if (audioCount > maxAudioCount) {
          audioCount -= 1;
          setSeedanceError(`参考音频最多上传 ${maxAudioCount} 段。`);
          continue;
        }
        if (file.size > 15 * 1024 * 1024) {
          audioCount -= 1;
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
      for (const ref of nextReferences) {
        await saveUploadHistory(ref.file, ref.kind);
      }
      await refreshUploadHistories();
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
      if (target?.kind === 'video' && seedanceTaskMode === 'video-edit-painting') {
        setVideoEditSourceDuration(null);
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

  function switchReverseMode(nextMode: ReverseMode) {
    if (nextMode === reverseMode) return;
    clearSelectedMedia();
    clearReplaceImage();
    clearImageToVideoPainting();
    clearPaintingImage();
    setRequestError('');
    setPaintingError('');
    setReverseMode(nextMode);
    if (nextMode === 'painting') {
      setSeedanceModel('doubao-seedance-2-0-mini-260615');
    }
  }

  function clearPaintingImage() {
    if (paintingImage) {
      URL.revokeObjectURL(paintingImage.previewUrl);
    }
    setPaintingImage(null);
    setPaintingUploadHistoryId(null);
    if (paintingFileInputRef.current) {
      paintingFileInputRef.current.value = '';
    }
  }

  async function handlePaintingImageChange(file: File | null) {
    setPaintingError('');
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('挂画创意素材必须是图片格式。');
      }
      if (file.size > MAX_VIDEO_SIZE_BYTES) {
        throw new Error('挂画图片请控制在 150MB 以内。');
      }
      const previewUrl = createMediaPreviewUrl(file);
      if (paintingImage) {
        URL.revokeObjectURL(paintingImage.previewUrl);
      }
      setPaintingImage({ kind: 'image', file, previewUrl, fileName: file.name });
      setPaintingProfile(null);
      setPaintingIdeas([]);
      setPaintingIdeaBatchCache({});
      setPaintingSelectedIdea(null);
      setPaintingFullPrompt('');
      setPaintingIdeaUsageCounts({});
      setPaintingIdeaLastPrompts({});
      setPaintingVariationRound(0);
      const savedHistoryId = await saveUploadHistory(file, 'image');
      setPaintingUploadHistoryId(savedHistoryId || null);
      await refreshUploadHistories();
    } catch (error) {
      setPaintingError(error instanceof Error ? error.message : '挂画图片读取失败，请换一张再试。');
    } finally {
      if (paintingFileInputRef.current) {
        paintingFileInputRef.current.value = '';
      }
    }
  }

  async function handlePaintingAnalyze() {
    if (!paintingImage) {
      setPaintingError('请先上传一张挂画图片。');
      return;
    }
    setPaintingError('');
    setPaintingLoading('analyze');
    try {
      const profile = await analyzePainting(paintingImage.file);
      setPaintingProfile(profile);
      setPaintingIdeas([]);
      setPaintingIdeaBatchCache({});
      setPaintingSelectedIdea(null);
      setPaintingFullPrompt('');
      setPaintingIdeaUsageCounts({});
      setPaintingIdeaLastPrompts({});
      setPaintingVariationRound(0);
      setTimeout(() => scrollToRef(paintingPlanRef), 80);
    } catch (error) {
      setPaintingError(error instanceof Error ? error.message : '挂画分析失败，请稍后重试。');
    } finally {
      setPaintingLoading('idle');
    }
  }

  function getRecentPaintingIdeasToAvoid() {
    const currentName = String(paintingProfile?.name || '').trim();
    const historicalIdeas = paintingHistory
      .filter((item) => !currentName || String(item.profile?.name || '').trim() === currentName)
      .slice(0, 8)
      .flatMap((item) => item.ideas || []);
    return Array.from(new Set(
      [...paintingIdeas, ...historicalIdeas]
        .map((idea) => [idea.title, idea.summary].filter(Boolean).join('：').trim())
        .filter(Boolean)
    )).slice(0, 12);
  }

  function getPaintingBatchCacheKey(batch: number, variationRound: number) {
    return JSON.stringify({
      batch,
      variationRound,
      profile: {
        name: paintingProfile?.name || '',
        style: paintingProfile?.style || '',
        subject: paintingProfile?.subject || '',
      },
      plan: paintingPlan,
      // 图片变化后不得复用旧缓存：用文件标识（名称+大小+修改时间）区分。
      image: paintingImage
        ? `${paintingImage.file.name}:${paintingImage.file.size}:${paintingImage.file.lastModified}`
        : '',
    });
  }

  // 创意方案工作缓存：同时写入实时 ref（供断点继续同步读取）与 React state（供界面展示）。
  function cachePaintingIdeaBatch(cacheKey: string, ideas: PaintingIdeaSummary[]) {
    paintingIdeaBatchCacheRef.current = { ...paintingIdeaBatchCacheRef.current, [cacheKey]: ideas };
    setPaintingIdeaBatchCache((previous) => ({ ...previous, [cacheKey]: ideas }));
  }

  // 每个“轮次+批次”的稳定幂等请求编号：同一次准备操作重试时复用，不会重复创建豆包后台任务。
  function getPaintingIdeaClientRequestId(cacheKey: string): string {
    const existing = paintingIdeaClientRequestIdsRef.current[cacheKey];
    if (existing) return existing;
    const id = generatePaintingRequestId('idea');
    paintingIdeaClientRequestIdsRef.current = { ...paintingIdeaClientRequestIdsRef.current, [cacheKey]: id };
    return id;
  }

  async function runPaintingIdeas(batch: number, variationRound = paintingVariationRound) {
    if (!paintingProfile) {
      setPaintingError('请先完成产品分析。');
      return;
    }
    const cacheKey = getPaintingBatchCacheKey(batch, variationRound);
    const cachedIdeas = paintingIdeaBatchCacheRef.current[cacheKey];
    if (cachedIdeas?.length) {
      setPaintingIdeas(cachedIdeas);
      setPaintingFrameworkBatch(batch);
      setPaintingSelectedIdea(null);
      setPaintingFullPrompt('');
      setPaintingError('');
      setTimeout(() => scrollToRef(paintingIdeasRef), 80);
      return;
    }
    setPaintingError('');
    setPaintingLoading('ideas');
    try {
      const result = await generatePaintingIdeas(paintingProfile, paintingPlan, batch, {
        variationRound,
        avoidIdeas: getRecentPaintingIdeasToAvoid(),
        clientRequestId: getPaintingIdeaClientRequestId(cacheKey),
      });
      setPaintingIdeas(result.ideas);
      cachePaintingIdeaBatch(cacheKey, result.ideas);
      setPaintingFrameworkBatch(result.batch);
      if (result.totalBatches > 0) setPaintingTotalBatches(result.totalBatches);
      setPaintingSelectedIdea(null);
      setPaintingFullPrompt('');
      setTimeout(() => scrollToRef(paintingIdeasRef), 80);
    } catch (error) {
      setPaintingError(error instanceof Error ? error.message : '创意方案生成失败，请稍后重试。');
    } finally {
      setPaintingLoading('idle');
    }
  }

  // 生成创意方案：从第一批框架开始。
  async function handlePaintingGenerateIdeas() {
    const nextRound = paintingIdeas.length > 0 ? paintingVariationRound + 1 : paintingVariationRound;
    setPaintingVariationRound(nextRound);
    setPaintingFrameworkBatch(0);
    await runPaintingIdeas(0, nextRound);
  }

  // 重新生成一批：轮换到下一批框架（循环）。
  async function handlePaintingRegenerateIdeas() {
    const next = (paintingFrameworkBatch + 1) % Math.max(1, paintingTotalBatches);
    const nextRound = next === 0 ? paintingVariationRound + 1 : paintingVariationRound;
    if (nextRound !== paintingVariationRound) setPaintingVariationRound(nextRound);
    setPaintingFrameworkBatch(next);
    await runPaintingIdeas(next, nextRound);
  }

  async function handlePaintingPreviousIdeas() {
    if (paintingFrameworkBatch <= 0) return;
    const previous = paintingFrameworkBatch - 1;
    setPaintingFrameworkBatch(previous);
    await runPaintingIdeas(previous, paintingVariationRound);
  }

  async function handlePaintingGeneratePrompt(
    idea: PaintingIdeaSummary,
    options?: { skipSeedanceScroll?: boolean; remixElements?: boolean }
  ) {
    if (!paintingProfile) return;
    const usageKey = getPaintingIdeaUsageKey(paintingFrameworkBatch, paintingVariationRound, idea.id);
    const previousUsageCount = paintingIdeaUsageCounts[usageKey] || 0;
    setPaintingError('');
    setPaintingSelectedIdea(idea);
    setPaintingFullPrompt('');
    setPaintingLoading('prompt');
    try {
      const { prompt, duration } = await generatePaintingIdeaPrompt(paintingProfile, idea, {
        durationMin: idea.durationMin || paintingPlan.durationMin,
        durationMax: idea.durationMax || paintingPlan.durationMax,
        ratio: paintingPlan.ratio,
        stylePreset: paintingPlan.stylePreset,
        character: paintingPlan.character,
        audio: paintingPlan.audio,
        scene: paintingPlan.scene,
        extraRequirements: paintingPlan.extraRequirements,
        elementVariationIndex: options?.remixElements ? previousUsageCount + 1 : 0,
        previousPrompt: options?.remixElements ? paintingIdeaLastPrompts[usageKey] || '' : '',
      });
      setPaintingFullPrompt(prompt);
      const nextUsageCounts = {
        ...paintingIdeaUsageCounts,
        [usageKey]: previousUsageCount + 1,
      };
      const nextLastPrompts = {
        ...paintingIdeaLastPrompts,
        [usageKey]: prompt,
      };
      setPaintingIdeaUsageCounts(nextUsageCounts);
      setPaintingIdeaLastPrompts(nextLastPrompts);

      // 生成后自动填入右侧 Seedance 面板：提示词、时长、比例、挂画参考图。
      const ratio = paintingPlan.ratio || '9:16';
      const maxDuration = seedanceModel === 'doubao-seedance-2-5-260628' ? 30 : 15;
      const durationSeconds = Math.min(maxDuration, Math.max(4, Math.round(duration)));
      setSeedancePrompt(prompt.trim());
      setSeedanceRatio(ratio);
      setSeedanceDuration(durationSeconds);
      const nextReferences = computeNextSeedanceReferencesWithPainting();
      setSeedanceReferences(nextReferences);
      setSeedancePromptHighlight(true);
      setTimeout(() => setSeedancePromptHighlight(false), 2000);
      if (!options?.skipSeedanceScroll) scrollToRef(seedancePromptRef);

      const historyItem: PaintingHistoryItem = {
        id: createMessageId('painting_history'),
        savedAt: new Date().toISOString(),
        title: [paintingProfile.name, idea.title].filter(Boolean).join(' · ') || idea.title,
        profile: paintingProfile,
        ideas: paintingIdeas,
        fullPrompt: prompt,
        uploadHistoryId: paintingUploadHistoryId || undefined,
        imageFileName: paintingImage?.fileName,
        ratio,
        duration: durationSeconds,
        stylePreset: paintingPlan.stylePreset,
        plan: paintingPlan,
        ideaBatchCache: paintingIdeaBatchCache,
        ideaUsageCounts: nextUsageCounts,
        ideaLastPrompts: nextLastPrompts,
        frameworkBatch: paintingFrameworkBatch,
        totalBatches: paintingTotalBatches,
        variationRound: paintingVariationRound,
      };
      setPaintingHistory((previous) => {
        const next = mergePaintingHistoryItem(previous, historyItem);
        persistPaintingHistory(next);
        return next;
      });

      return { prompt: prompt.trim(), duration: durationSeconds, references: nextReferences };
    } catch (error) {
      setPaintingError(error instanceof Error ? error.message : '完整提示词生成失败，请稍后重试。');
    } finally {
      setPaintingLoading('idle');
    }
  }

  async function handlePaintingAutoGenerateVideo(
    idea: PaintingIdeaSummary,
    options?: { remixElements?: boolean }
  ) {
    if (paintingLoading !== 'idle' || isSeedanceLoading) return;
    const result = await handlePaintingGeneratePrompt(idea, {
      skipSeedanceScroll: true,
      remixElements: options?.remixElements,
    });
    if (!result) return;
    // 全自动流程必须带挂画参考图：无图直接终止，避免生成无画面的视频。
    const hasImage = result.references.some((ref) => ref.kind === 'image');
    if (!hasImage) {
      window.alert('提示词没有包含图片，已终止自动生成视频，请先加载挂画参考图。');
      return;
    }
    // 手动生成 / 换元素再生成也写入方向使用记录，供“仅生成未使用方向”服务端持久化识别。
    let imageHash: string | undefined;
    if (paintingImage?.file) {
      try {
        imageHash = await sha256File(paintingImage.file);
      } catch {
        imageHash = undefined;
      }
    }
    await handleCreateSeedanceVideo({
      prompt: result.prompt,
      duration: result.duration,
      references: result.references,
      focusTaskStatus: true,
      imageHash,
      directionNumber: idea.directionNumber ? Number(idea.directionNumber) : undefined,
      variationRound: paintingVariationRound,
    });
  }

  // ---- 挂画全自动批量生成 ----

  function isPaintingBatchIdeaUsed(idea: PaintingIdeaSummary, variationRound: number): boolean {
    const directionNumber = Number(idea.directionNumber) > 0 ? Number(idea.directionNumber) : 0;
    return directionNumber > 0 && paintingUsedDirections.includes(directionNumber);
  }

  async function collectPaintingBatchIdeas(variationRound: number): Promise<PaintingIdeaSummary[]> {
    if (!paintingProfile) return [];
    const collected: PaintingIdeaSummary[] = [];
    const avoidIdeas = getRecentPaintingIdeasToAvoid();
    for (let batch = 0; batch < paintingTotalBatches; batch += 1) {
      setPaintingBatchPrepareStage(`正在准备第 ${batch + 1}/${paintingTotalBatches} 批`);
      const cacheKey = getPaintingBatchCacheKey(batch, variationRound);
      // 实时工作缓存：已成功的批次绝不重新调用豆包。
      let ideas = paintingIdeaBatchCacheRef.current[cacheKey];
      if (!ideas?.length) {
        const clientRequestId = getPaintingIdeaClientRequestId(cacheKey);
        try {
          const result = await generatePaintingIdeas(paintingProfile, paintingPlan, batch, {
            variationRound,
            avoidIdeas,
            clientRequestId,
          });
          ideas = result.ideas;
          cachePaintingIdeaBatch(cacheKey, ideas);
          if (result.totalBatches > 0) setPaintingTotalBatches(result.totalBatches);
        } catch (error) {
          if (error instanceof Error && error.message.includes('任务已失效')) {
            // 幂等编号对应后台任务已失效：丢弃旧编号与旧缓存，下次“继续准备”重新生成当前批次。
            delete paintingIdeaClientRequestIdsRef.current[cacheKey];
            delete paintingIdeaBatchCacheRef.current[cacheKey];
          }
          setPaintingBatchPreparedBatches(batch);
          throw error;
        }
      }
      collected.push(...ideas);
      setPaintingBatchPreparedBatches(batch + 1);
    }
    // 校验方向编号完整且不重复：每条都有编号，且编号无重复。
    const directionNumbers = collected.map((idea) => Number(idea.directionNumber));
    const unique = new Set(directionNumbers);
    if (directionNumbers.some((n) => !Number.isFinite(n) || n <= 0) || unique.size !== directionNumbers.length) {
      throw new Error('创意方向编号不完整或存在重复，请重新准备创意方案。');
    }
    return collected;
  }

  function clearPaintingBatchPoll() {
    if (paintingBatchPollTimerRef.current) {
      clearTimeout(paintingBatchPollTimerRef.current);
      paintingBatchPollTimerRef.current = null;
    }
  }

  async function pollPaintingBatch(runId: string) {
    clearPaintingBatchPoll();
    try {
      const detail = await getPaintingBatchRun(runId);
      setPaintingBatchDetail(detail);
      setPaintingBatchActiveRunId(runId);
      setPaintingBatchListError('');
      if (!PAINTING_BATCH_TERMINAL_STATUSES.includes(detail.run.status)) {
        paintingBatchPollTimerRef.current = setTimeout(() => void pollPaintingBatch(runId), 3000);
      }
    } catch (error) {
      setPaintingBatchListError(error instanceof Error ? error.message : '读取批量任务进度失败');
      paintingBatchPollTimerRef.current = setTimeout(() => void pollPaintingBatch(runId), 5000);
    }
  }

  async function loadPaintingBatchRuns() {
    try {
      const runs = await listPaintingBatchRuns();
      setPaintingBatchRuns(runs);
      setPaintingBatchListError('');
      const active = runs.find((run) => ['running', 'paused', 'stopping'].includes(run.status));
      if (active && !paintingBatchActiveRunId) {
        setPaintingBatchActiveRunId(active.batchRunId);
        void pollPaintingBatch(active.batchRunId);
      }
    } catch (error) {
      setPaintingBatchListError(error instanceof Error ? error.message : '读取批量任务历史失败');
    }
  }

  async function handlePaintingOpenBatchConfirm() {
    if (!paintingProfile) {
      setPaintingError('请先完成产品分析。');
      return;
    }
    if (!paintingImage) {
      setPaintingError('请先上传挂画图片。');
      return;
    }
    setPaintingError('');
    setPaintingBatchPrepareFailed(false);
    setPaintingBatchPrepareError('');
    setPaintingBatchPreparing(true);
    setPaintingBatchPrepareStage('正在检查已有创意方向');
    try {
      const variationRound = paintingVariationRound;
      const ideas = await collectPaintingBatchIdeas(variationRound);
      if (ideas.length < 40) {
        throw new Error(`创意方向数量不足，已获取 ${ideas.length} 条，需要 40 条。请先分批生成创意方案。`);
      }
      setPaintingBatchIdeas(ideas);
      setPaintingVariationRound(variationRound);

      setPaintingBatchPrepareStage('正在读取素材库文件夹');
      const folders = await getVideoLibraryFolders().catch(() => [] as string[]);
      const availableFolders = folders.length ? folders : ['通用素材'];
      setPaintingBatchFolderList(availableFolders);
      let prefillFolder = loadLastVideoLibraryFolder();
      let prefillFolderId: number | null = null;
      let imageHash = '';
      try {
        imageHash = await sha256File(paintingImage.file);
        const binding = await getPaintingFolderBinding(imageHash);
        if (binding && availableFolders.includes(binding.folderName)) {
          prefillFolder = binding.folderName;
          prefillFolderId = binding.folderId;
        }
      } catch {
        // 图片哈希计算失败或尚未绑定文件夹时，保留默认文件夹。
      }
      setPaintingBatchPrepareStage('正在读取已使用方向');
      if (imageHash) {
        try {
          const used = await getPaintingUsedDirections(imageHash, variationRound);
          setPaintingUsedDirections(Array.isArray(used) ? used : []);
        } catch {
          setPaintingUsedDirections([]);
        }
      } else {
        setPaintingUsedDirections([]);
      }
      setPaintingBatchFolder(prefillFolder);
      setPaintingBatchFolderId(prefillFolderId);
      setPaintingBatchPrepareStage('');
      setPaintingBatchConfirmOpen(true);
    } catch (error) {
      const friendly = describePaintingNetworkError(error, '准备批量生成失败，请稍后重试。');
      setPaintingError(friendly);
      setPaintingBatchPrepareError(friendly);
      setPaintingBatchPrepareFailed(true);
    } finally {
      setPaintingBatchPreparing(false);
      setPaintingBatchPrepareStage('');
    }
  }

  function buildPaintingBatchCreateOptions(ideas: PaintingIdeaSummary[], creationRequestId: string) {
    return {
      file: paintingImage!.file,
      profile: paintingProfile!,
      plan: paintingPlan,
      ideas,
      totalDirections: ideas.length,
      model: SEEDANCE_BATCH_MODEL,
      resolution: SEEDANCE_BATCH_RESOLUTION,
      ratio: paintingPlan.ratio || seedanceRatio,
      variationRound: paintingVariationRound,
      generateAudio: seedanceGenerateAudio,
      watermark: seedanceWatermark,
      stylePreset: paintingPlan.stylePreset,
      uploadHistoryId: paintingUploadHistoryId,
      targetFolderId: paintingBatchFolderId,
      targetFolderName: paintingBatchFolder,
      onlyUnused: paintingBatchOnlyUnused,
      creationRequestId,
    };
  }

  function enterPaintingBatchProgress(batchRunId: string, recovered = false) {
    // 已明确拿到批次编号，本次幂等请求已完成；下一次主动创建必须使用新编号。
    batchCreationRequestIdRef.current = null;
    setPaintingBatchConfirmOpen(false);
    setPaintingBatchCreating(false);
    setPaintingBatchConfirming(false);
    setPaintingBatchUnconfirmed(false);
    setPaintingBatchPrepareStage('');
    setPaintingBatchDetail(null);
    setPaintingBatchActiveRunId(batchRunId);
    setPaintingBatchListError('');
    if (recovered) {
      setPaintingError('批次已创建，已恢复进度。');
    }
    paintingBatchScrollRequestedRef.current = true;
    void pollPaintingBatch(batchRunId);
  }

  // 创建批次 POST 响应丢失后的自动确认：保留同一幂等编号，先用 by-request 查询，查不到再用同一编号重试创建。
  async function confirmPaintingBatchCreation(ideas: PaintingIdeaSummary[], creationRequestId: string) {
    setPaintingBatchConfirming(true);
    setPaintingBatchPrepareStage('正在确认批次是否已经创建');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
      try {
        const found = await getPaintingBatchRunByRequest(creationRequestId);
        if (found.found && found.detail) {
          setPaintingBatchDetail(found.detail);
          enterPaintingBatchProgress(found.detail.run.batchRunId, true);
          return;
        }
      } catch {
        // 查询失败继续下一轮。
      }
      // 暂未查到：用同一个幂等编号安全重试创建 POST（后端幂等，不会重复扣费）。
      try {
        const result = await createPaintingBatchRun(buildPaintingBatchCreateOptions(ideas, creationRequestId));
        enterPaintingBatchProgress(result.batchRunId);
        return;
      } catch (error) {
        if (!isPaintingCreationOutcomeUnknown(error)) {
          // 明确的业务/鉴权错误不再盲试。
          setPaintingError(describePaintingNetworkError(error, '创建批量任务失败，请稍后重试。'));
          setPaintingBatchConfirming(false);
          setPaintingBatchPrepareStage('');
          return;
        }
      }
    }
    // 仍无法确认：绝不自动生成新编号再次创建 40 条。
    setPaintingBatchConfirming(false);
    setPaintingBatchPrepareStage('');
    setPaintingBatchUnconfirmed(true);
    setPaintingError('暂时无法确认批次是否创建成功。请先查看批量生成历史，系统不会自动创建第二个批次。');
  }

  async function handlePaintingConfirmBatch() {
    if (!paintingImage || !paintingProfile) return;
    if (paintingBatchCreating || paintingBatchConfirming) return;
    let ideas = paintingBatchIdeas;
    if (paintingBatchOnlyUnused) {
      ideas = ideas.filter((idea) => !isPaintingBatchIdeaUsed(idea, paintingVariationRound));
    }
    if (!ideas.length) {
      setPaintingError('没有可生成的方向：当前轮次的方向都已使用过。可取消“仅生成未使用方向”或换一轮再试。');
      setPaintingBatchConfirmOpen(false);
      return;
    }
    setPaintingBatchCreating(true);
    setPaintingBatchUnconfirmed(false);
    setPaintingBatchListError('');
    // 同一次确认操作的所有网络重试必须复用同一个编号；只有图片/方案/轮次/方向集合变化才重新生成。
    if (!batchCreationRequestIdRef.current) {
      batchCreationRequestIdRef.current = generatePaintingRequestId('batch');
    }
    const creationRequestId = batchCreationRequestIdRef.current;
    try {
      const result = await createPaintingBatchRun(buildPaintingBatchCreateOptions(ideas, creationRequestId));
      enterPaintingBatchProgress(result.batchRunId);
    } catch (error) {
      setPaintingBatchCreating(false);
      if (!isPaintingCreationOutcomeUnknown(error)) {
        setPaintingError(describePaintingNetworkError(error, '创建批量任务失败，请稍后重试。'));
        return;
      }
      // 网络错误：批次可能已创建但响应丢失，进入自动确认（绝不更换编号）。
      await confirmPaintingBatchCreation(ideas, creationRequestId);
    }
  }

  async function handlePaintingBatchAction(action: 'pause' | 'resume' | 'stop') {
    const runId = paintingBatchActiveRunId;
    if (!runId) return;
    if (action === 'stop') {
      const confirmed = window.confirm('终止后不会取消已提交给 Seedance 的任务，已提交任务会继续生成并自动存入素材库；仅停止排队中与后续任务。确定要终止吗？');
      if (!confirmed) return;
    }
    setPaintingBatchActionLoading(action);
    setPaintingBatchListError('');
    try {
      if (action === 'pause') await pausePaintingBatchRun(runId);
      else if (action === 'resume') await resumePaintingBatchRun(runId);
      else await stopPaintingBatchRun(runId);
      void pollPaintingBatch(runId);
    } catch (error) {
      setPaintingBatchListError(error instanceof Error ? error.message : '批量任务操作失败');
    } finally {
      setPaintingBatchActionLoading(null);
    }
  }

  // 查询原任务：仅回查已有 Seedance 任务编号的结果或重新入库，绝不重新提交。
  async function handlePaintingBatchQueryTask(taskId: number) {
    const runId = paintingBatchActiveRunId;
    setPaintingBatchListError('');
    try {
      await retryPaintingBatchTask(taskId);
      if (runId) void pollPaintingBatch(runId);
    } catch (error) {
      setPaintingBatchListError(error instanceof Error ? error.message : '查询原任务失败');
    }
  }

  // 重新提交：上游确认未生成后，允许新建 Seedance 任务（可能再次扣费），需二次确认。
  async function handlePaintingBatchResubmitTask(taskId: number) {
    const runId = paintingBatchActiveRunId;
    setPaintingBatchListError('');
    const ok = window.confirm(
      '重新提交会再次调用 Seedance 并可能再次扣费。请先在 Seedance 后台确认该方向上游确实没有生成视频，再确认重新提交。'
    );
    if (!ok) return;
    try {
      await resubmitPaintingBatchTask(taskId, { confirm: true });
      if (runId) void pollPaintingBatch(runId);
    } catch (error) {
      setPaintingBatchListError(error instanceof Error ? error.message : '重新提交任务失败');
    }
  }

  useEffect(() => {
    if (reverseMode !== 'painting') return;
    let cancelled = false;
    (async () => {
      try {
        const runs = await listPaintingBatchRuns();
        if (cancelled) return;
        setPaintingBatchRuns(runs);
        setPaintingBatchListError('');
        const active = runs.find((run) => ['running', 'paused', 'stopping'].includes(run.status));
        if (active && !paintingBatchActiveRunId) {
          setPaintingBatchActiveRunId(active.batchRunId);
          void pollPaintingBatch(active.batchRunId);
        }
      } catch (error) {
        if (!cancelled) {
          setPaintingBatchListError(error instanceof Error ? error.message : '读取批量任务历史失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reverseMode]);

  useEffect(() => () => clearPaintingBatchPoll(), []);

  function computeSeedanceReferencesWithImages(images: SelectedCreativeMedia[]): SeedanceReferenceFile[] {
    const isSeedance25 = seedanceModel === 'doubao-seedance-2-5-260628';
    const maxImageCount = isSeedance25 ? 30 : 9;
    let nextReferences = [...seedanceReferences];
    for (const image of images) {
      if (image.kind !== 'image') continue;
      // 按文件名去重：右侧已有同名参考图时不再重复追加。
      if (nextReferences.some((ref) => ref.kind === 'image' && ref.fileName === image.fileName)) continue;
      if (nextReferences.filter((ref) => ref.kind === 'image').length >= maxImageCount) break;
      nextReferences = [
        ...nextReferences,
        {
          id: createMessageId('seedance_ref'),
          kind: 'image',
          file: image.file,
          previewUrl: createMediaPreviewUrl(image.file),
          fileName: image.fileName,
        },
      ];
    }
    return nextReferences;
  }

  function computeSeedanceReferencesWithImage(image: SelectedCreativeMedia | null): SeedanceReferenceFile[] {
    return computeSeedanceReferencesWithImages(image ? [image] : []);
  }

  function computeNextSeedanceReferencesWithPainting(): SeedanceReferenceFile[] {
    return computeSeedanceReferencesWithImage(paintingImage);
  }

  function appendPaintingToSeedanceReferences() {
    setSeedanceReferences(computeNextSeedanceReferencesWithPainting());
  }

  async function handlePaintingLoadHistory(item: PaintingHistoryItem) {
    let restoredHistoryItem = item.uploadHistoryId
      ? await getUploadHistoryItem(item.uploadHistoryId).catch(() => null)
      : null;

    if (!restoredHistoryItem && item.imageFileName) {
      const summaries = await loadUploadHistorySummaries('image').catch(() => []);
      const matchingSummary = summaries.find((summary) => summary.name === item.imageFileName);
      if (matchingSummary) {
        restoredHistoryItem = await getUploadHistoryItem(matchingSummary.id).catch(() => null);
      }
    }

    let restoredFile = restoredHistoryItem?.kind === 'image' ? blobToFile(restoredHistoryItem) : null;
    let resolvedUploadHistoryId = restoredHistoryItem?.id || null;
    if (!restoredFile && item.thumbnail) {
      restoredFile = thumbnailDataUrlToFile(
        item.thumbnail,
        item.imageFileName || `${item.profile?.name || '挂画'}-历史缩略图.jpg`,
      );
      if (restoredFile) {
        resolvedUploadHistoryId = await saveUploadHistory(restoredFile, 'image').catch(() => 0) || null;
        if (resolvedUploadHistoryId) await refreshUploadHistories();
      }
    }

    if (restoredFile) {
      const previewUrl = createMediaPreviewUrl(restoredFile);
      if (paintingImage) URL.revokeObjectURL(paintingImage.previewUrl);
      setPaintingImage({ kind: 'image', file: restoredFile, previewUrl, fileName: restoredFile.name });
      setPaintingUploadHistoryId(resolvedUploadHistoryId);
      if (resolvedUploadHistoryId && item.uploadHistoryId !== resolvedUploadHistoryId) {
        setPaintingHistory((previous) => {
          const next = previous.map((historyItem) => historyItem.id === item.id
            ? { ...historyItem, uploadHistoryId: resolvedUploadHistoryId || undefined, imageFileName: restoredFile?.name }
            : historyItem);
          persistPaintingHistory(next);
          return next;
        });
      }
    } else {
      if (paintingImage) URL.revokeObjectURL(paintingImage.previewUrl);
      setPaintingImage(null);
      setPaintingUploadHistoryId(null);
      setPaintingError('这条旧历史记录没有可恢复的图片，请从历史图片中重新选择一次原图。');
    }
    const restoredBatch = item.frameworkBatch || 0;
    const restoredRound = item.variationRound || 0;
    const restoredUsageCounts = { ...(item.ideaUsageCounts || {}) };
    const restoredLastPrompts = { ...(item.ideaLastPrompts || {}) };
    // 旧版历史没有保存使用状态时，至少从标题中恢复最后一次使用的方向。
    if (Object.keys(restoredUsageCounts).length === 0 && item.fullPrompt) {
      const lastUsedIdea = (item.ideas || []).find((idea) => item.title.endsWith(idea.title));
      if (lastUsedIdea) {
        const usageKey = getPaintingIdeaUsageKey(restoredBatch, restoredRound, lastUsedIdea.id);
        restoredUsageCounts[usageKey] = 1;
        restoredLastPrompts[usageKey] = item.fullPrompt;
      }
    }
    setPaintingProfile(item.profile);
    setPaintingIdeas(item.ideas || []);
    setPaintingFullPrompt(item.fullPrompt || '');
    setPaintingSelectedIdea(null);
    setPaintingIdeaBatchCache(item.ideaBatchCache || {});
    setPaintingIdeaUsageCounts(restoredUsageCounts);
    setPaintingIdeaLastPrompts(restoredLastPrompts);
    setPaintingFrameworkBatch(restoredBatch);
    setPaintingTotalBatches(item.totalBatches || 4);
    setPaintingVariationRound(restoredRound);
    if (item.plan) {
      setPaintingPlan(item.plan);
    } else {
      setPaintingPlan((previous) => ({
        ...previous,
        ratio: item.ratio || previous.ratio,
        stylePreset: item.stylePreset || previous.stylePreset,
      }));
    }
    if (restoredFile) setPaintingError('');
  }

  function handlePaintingDeleteHistory(id: string) {
    setPaintingHistory((previous) => {
      const next = previous.filter((item) => item.id !== id);
      persistPaintingHistory(next);
      return next;
    });
  }

  async function handleImageToVideoPaintingChange(file: File | null) {
    setRequestError('');
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('挂画参考素材必须是图片格式。');
      }
      if (file.size > MAX_VIDEO_SIZE_BYTES) {
        throw new Error('挂画参考图片请控制在 150MB 以内。');
      }
      const previewUrl = createMediaPreviewUrl(file);
      if (imageToVideoPainting) {
        URL.revokeObjectURL(imageToVideoPainting.previewUrl);
      }
      setImageToVideoPainting({ kind: 'image', file, previewUrl, fileName: file.name });
      await saveUploadHistory(file, 'image');
      await refreshUploadHistories();
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : '挂画参考图片读取失败，请换一张再试。');
    } finally {
      if (imageToVideoPaintingInputRef.current) {
        imageToVideoPaintingInputRef.current.value = '';
      }
    }
  }

  function clearImageToVideoPainting() {
    if (imageToVideoPainting) {
      URL.revokeObjectURL(imageToVideoPainting.previewUrl);
    }
    setImageToVideoPainting(null);
    if (imageToVideoPaintingInputRef.current) {
      imageToVideoPaintingInputRef.current.value = '';
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

      await saveUploadHistory(file, 'image');
      await refreshUploadHistories();
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

  async function selectVideoFromHistory(item: { id: number; name: string; timestamp: number; previewUrl: string }) {
    const found = await getUploadHistoryItem(item.id);
    if (!found) return;
    const file = blobToFile(found);
    const previewUrl = createMediaPreviewUrl(file);
    if (selectedMedia) {
      URL.revokeObjectURL(selectedMedia.previewUrl);
    }
    setSelectedMedia({ kind: 'video', file, previewUrl, fileName: file.name });
  }

  async function openVideoHistoryPreview(item: UploadHistoryPreviewItem, source: 'video' | 'video-edit-video' = 'video') {
    const found = await getUploadHistoryItem(item.id);
    if (!found) return;
    const previewUrl = URL.createObjectURL(found.blob);
    setHistoryPreviewItem({
      id: item.id,
      name: item.name,
      timestamp: item.timestamp,
      previewUrl,
      duration: item.duration,
      kind: 'video',
      source,
      ownedPreviewUrl: true,
    });
    if (Number.isFinite(item.duration) && item.duration && item.duration > 0) {
      rememberHistoryVideoDuration(item.id, item.duration);
    }
  }

  async function openImageHistoryPreview(item: UploadHistoryPreviewItem, source: 'image-creative' | 'image-seedance' | 'video-edit-image') {
    if (item.previewUrl) {
      setHistoryPreviewItem({
        id: item.id,
        name: item.name,
        timestamp: item.timestamp,
        previewUrl: item.previewUrl,
        kind: 'image',
        source,
      });
      return;
    }

    const found = await getUploadHistoryItem(item.id);
    if (!found) return;
    const previewUrl = URL.createObjectURL(found.blob);
    setHistoryPreviewItem({
      id: item.id,
      name: item.name,
      timestamp: item.timestamp,
      previewUrl,
      kind: 'image',
      source,
      ownedPreviewUrl: true,
    });
  }

  function rememberHistoryVideoDuration(id: number, seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    setHistoryVideoDurations((previous) => {
      if (Math.abs((previous[id] || 0) - seconds) < 0.5) return previous;
      return { ...previous, [id]: seconds };
    });
  }

  async function selectHistoryPreviewItem(item: HistoryPreviewItem) {
    if (item.source === 'video') {
      await selectVideoFromHistory(item);
    } else if (item.source === 'image-creative') {
      if (reverseMode === 'painting') {
        await selectPaintingFromHistory(item);
      } else {
        await selectImageFromHistory(item, reverseMode !== 'image');
      }
    } else if (item.source === 'video-edit-video' || item.source === 'video-edit-image') {
      const found = await getUploadHistoryItem(item.id);
      if (found) {
        await handleVideoEditReference(blobToFile(found), item.source === 'video-edit-video' ? 'video' : 'image');
      }
    } else {
      await selectSeedanceReferenceFromHistory(item, 'image');
    }
    setShowHistoryModal(false);
    setHistoryPreviewItem(null);
  }

  async function selectImageFromHistory(item: { id: number; name: string; timestamp: number; previewUrl: string }, forReplace: boolean) {
    const found = await getUploadHistoryItem(item.id);
    if (!found) return;
    const file = blobToFile(found);
    const previewUrl = createMediaPreviewUrl(file);
    if (forReplace) {
      if (replaceImage) {
        URL.revokeObjectURL(replaceImage.previewUrl);
      }
      setReplaceImage({ kind: 'image', file, previewUrl, fileName: file.name });
    } else {
      if (selectedMedia) {
        URL.revokeObjectURL(selectedMedia.previewUrl);
      }
      setSelectedMedia({ kind: 'image', file, previewUrl, fileName: file.name });
    }
  }

  async function selectPaintingFromHistory(item: { id: number; name: string; timestamp: number; previewUrl: string }) {
    const found = await getUploadHistoryItem(item.id);
    if (!found) return;
    const file = blobToFile(found);
    const previewUrl = createMediaPreviewUrl(file);
    if (paintingImage) {
      URL.revokeObjectURL(paintingImage.previewUrl);
    }
    setPaintingImage({ kind: 'image', file, previewUrl, fileName: file.name });
    setPaintingUploadHistoryId(item.id);
    setPaintingProfile(null);
    setPaintingIdeas([]);
    setPaintingIdeaBatchCache({});
    setPaintingSelectedIdea(null);
    setPaintingFullPrompt('');
    setPaintingIdeaUsageCounts({});
    setPaintingIdeaLastPrompts({});
    setPaintingFrameworkBatch(0);
    setPaintingVariationRound(0);
    setPaintingError('');
  }

  async function handleDeleteVideoHistory(id: number) {
    await deleteUploadHistory(id);
    setHistoryPreviewItem((previous) => previous?.kind === 'video' && previous.id === id ? null : previous);
    setHistoryVideoDurations((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    setVideoHistory((previous) => {
      const item = previous.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return previous.filter((p) => p.id !== id);
    });
  }

  async function handleDeleteImageHistory(id: number) {
    await deleteUploadHistory(id);
    setHistoryPreviewItem((previous) => previous?.kind === 'image' && previous.id === id ? null : previous);
    setImageHistory((previous) => {
      const item = previous.find((p) => p.id === id);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return previous.filter((p) => p.id !== id);
    });
  }

  async function selectSeedanceReferenceFromHistory(item: { id: number; name: string; timestamp: number; previewUrl: string }, kind: 'image' | 'video') {
    const found = await getUploadHistoryItem(item.id);
    if (!found) return;

    const file = blobToFile(found);
    const previewUrl = createMediaPreviewUrl(file);

    setSeedanceReferences((previous) => {
      const imageCount = previous.filter((r) => r.kind === 'image').length;
      const videoCount = previous.filter((r) => r.kind === 'video').length;
      const audioCount = previous.filter((r) => r.kind === 'audio').length;

      if (kind === 'image' && imageCount >= 9) {
        setSeedanceError('参考图片最多上传 9 张。');
        return previous;
      }
      if (kind === 'video') {
        if (!publicBaseUrlConfigured) {
          setSeedanceError('视频参考功能仅线上环境可用，本地开发不支持上传视频参考素材。');
          return previous;
        }
        if (videoCount >= 3) {
          setSeedanceError('参考视频最多上传 3 个。');
          return previous;
        }
        if (file.size > 50 * 1024 * 1024) {
          setSeedanceError('参考视频单个文件不能超过 50MB。');
          return previous;
        }
      }

      return [
        ...previous,
        {
          id: createMessageId('seedance_ref'),
          kind,
          file,
          previewUrl,
          fileName: file.name,
        },
      ];
    });
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

  function addNotebookItem() {
    const content = notebookDraft.trim();
    if (!content) return;
    const newItem: NotebookItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content,
      createdAt: Date.now(),
    };
    setNotebookItems((prev) => [newItem, ...prev]);
    setNotebookDraft("");
  }

  function deleteNotebookItem(id: string) {
    setNotebookItems((prev) => prev.filter((item) => item.id !== id));
  }

  async function copyNotebookItem(item: NotebookItem) {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopiedNotebookId(item.id);
      setTimeout(() => setCopiedNotebookId((current) => (current === item.id ? null : current)), 2000);
    } catch {
      // ignore
    }
  }

  async function copyAdditionalHistory(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAdditionalId(text);
      setTimeout(() => setCopiedAdditionalId((current) => (current === text ? null : current)), 2000);
    } catch {
      // ignore
    }
  }

  async function handleSend(forceQuestion?: string) {
    const rawQuestion = forceQuestion?.trim() || input.trim();
    if (!rawQuestion || isLoading) return;

    // If the user is sending the video reverse prompt, silently append format
    // instructions so Doubao returns each section on its own line without
    // cluttering the input box.
    const isReversePrompt = rawQuestion.includes('核心主体信息') && (
      rawQuestion.includes('待复刻样片') || rawQuestion.includes('唯一的视觉基准')
    );
    const question = isReversePrompt ? rawQuestion + VIDEO_REVERSE_FORMAT_SUFFIX : rawQuestion;
    const isReplaceMode = reverseMode === 'replace' && selectedMedia?.kind === 'video' && replaceImage;
    const isImageToVideoWithPainting = reverseMode === 'image' && selectedMedia?.kind === 'image' && imageToVideoAddPainting && imageToVideoPainting;
    const shouldIsolateReverseTask = !!selectedMedia && (isReversePrompt || isReplaceMode);
    const mediaToSend: SelectedCreativeMedia | SelectedCreativeMedia[] | null = isReplaceMode
      ? [selectedMedia!, replaceImage!]
      : isImageToVideoWithPainting
        ? [selectedMedia!, imageToVideoPainting!]
        : selectedMedia;
    const mediaMessages: Message[] = [];
    if (isReplaceMode || isImageToVideoWithPainting) {
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
      const secondMedia = isReplaceMode ? replaceImage : imageToVideoPainting;
      if (secondMedia) {
        mediaMessages.push({
          id: createMessageId(`creative_${secondMedia.kind}`),
          role: 'user',
          type: secondMedia.kind,
          content: '',
          mediaUrl: secondMedia.previewUrl,
          mediaKind: secondMedia.kind,
          fileName: secondMedia.fileName,
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
    const history = shouldIsolateReverseTask ? [] : buildHistory();

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
        provider: reverseModel,
        enableThinking: false,
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
      const errorMessage = error instanceof Error
        ? error.message
        : `${reverseModel === 'qwen' ? '千问' : '豆包'}回答失败`;
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
  const reverseApiConfigured = reverseModel === 'qwen' ? dashscopeApiConfigured : arkApiConfigured;

  return (
    <div className="h-screen bg-slate-200 flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept={reverseMode === 'image' ? 'image/*' : 'video/*'}
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
        ref={videoEditVideoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="hidden"
        onChange={(event) => {
          void handleVideoEditReference(event.target.files?.[0] || null, 'video');
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={videoEditImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          void handleVideoEditReference(event.target.files?.[0] || null, 'image');
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={replaceImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleReplaceImageChange(event.target.files?.[0] || null)}
      />
      <input
        ref={imageToVideoPaintingInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleImageToVideoPaintingChange(event.target.files?.[0] || null)}
      />

      <header className="h-14 border-b border-slate-300 bg-white/80 backdrop-blur-md flex items-center justify-between px-6 shrink-0 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <HomeBackButton onClick={onBack} />
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
          <CreativeSubNav
            current="video"
            onSwitchVideo={() => {}}
            onSwitchCopy={onSwitchToCopy ?? (() => {})}
          />
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center">
            <button
              type="button"
              onClick={handleCreateNewSession}
              disabled={isLoading}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="size-3.5" />
              新建对话
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn(
              "size-2 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.6)]",
              configReachable && reverseApiConfigured ? "bg-emerald-500 animate-pulse" : "bg-amber-400"
            )} />
            <span className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              configReachable && reverseApiConfigured ? "text-emerald-600" : "text-amber-600"
            )}>
              {configReachable && reverseApiConfigured ? 'AI 在线' : '待配置'}
            </span>
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 md:p-4 space-y-4 scroll-smooth"
      >
        <div className="max-w-6xl mx-auto w-full space-y-6">
          <section className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-[22px] border border-slate-300 bg-white p-4 shadow-[0_10px_40px_rgba(15,23,42,0.1)] md:p-5">
              <div className="mb-4 flex min-h-[49px] items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">
                    <Film className="size-3.5" />
                    模块一
                  </div>
                  <h2 className="text-base font-black text-slate-900">视频反推提示词</h2>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className={cn(
                    "relative rounded-full border px-1 shadow-sm transition-colors",
                    reverseModel === 'qwen'
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-emerald-300 bg-emerald-50 text-emerald-700"
                  )}>
                    <select
                      value={reverseModel}
                      onChange={(event) => setReverseModel(event.target.value as CreativeReverseModel)}
                      disabled={isLoading}
                      aria-label="反推提示词模型"
                      className="h-8 appearance-none bg-transparent pl-3 pr-8 text-xs font-black outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <option value="doubao">{formatDoubaoMultimodalModelName(doubaoMultimodalModel)}</option>
                      <option value="qwen">千问 {qwenMultimodalModel === 'qwen3.8-max' ? 'Qwen3.8-Max' : qwenMultimodalModel}</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                  </div>
                </div>
              </div>

              <div className="mb-4 flex h-9 rounded-xl border border-slate-200 bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => switchReverseMode('direct')}
                  className={cn(
                    'flex-1 rounded-lg px-3 text-xs font-bold transition-all',
                    reverseMode === 'direct'
                      ? 'bg-emerald-600 text-white shadow-[0_5px_14px_rgba(5,150,105,0.28)]'
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
                  onClick={() => switchReverseMode('replace')}
                  className={cn(
                    'flex-1 rounded-lg px-3 text-xs font-bold transition-all',
                    reverseMode === 'replace'
                      ? 'bg-violet-600 text-white shadow-[0_5px_14px_rgba(124,58,237,0.28)]'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Replace className="size-3.5" />
                    元素替换
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => switchReverseMode('image')}
                  className={cn(
                    'flex-1 rounded-lg px-3 text-xs font-bold transition-all',
                    reverseMode === 'image'
                      ? 'bg-amber-500 text-white shadow-[0_5px_14px_rgba(245,158,11,0.28)]'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <ImageIcon className="size-3.5" />
                    图片生视频
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => switchReverseMode('painting')}
                  className={cn(
                    'flex-1 rounded-lg px-3 text-xs font-bold transition-all',
                    reverseMode === 'painting'
                      ? 'bg-rose-500 text-white shadow-[0_5px_14px_rgba(244,63,94,0.28)]'
                      : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <ImageIcon className="size-3.5" />
                    挂画创意素材
                  </span>
                </button>
              </div>

              {reverseMode === 'painting' ? (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-slate-300 bg-slate-100 p-3">
                    {paintingImage ? (
                      <div className="space-y-3">
                        <img
                          src={paintingImage.previewUrl}
                          alt={paintingImage.fileName}
                          className="aspect-video w-full rounded-xl bg-slate-950 object-contain"
                        />
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 text-xs font-semibold text-slate-500">
                            <span className="block truncate">{paintingImage.fileName}</span>
                            <span className="text-slate-400">待分析的挂画/装饰画</span>
                          </div>
                          <button
                            type="button"
                            onClick={clearPaintingImage}
                            className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white hover:text-slate-600"
                            aria-label="移除挂画图片"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => paintingFileInputRef.current?.click()}
                        disabled={paintingLoading !== 'idle'}
                        className="flex min-h-[160px] w-full flex-col items-center justify-center gap-3 rounded-xl text-center transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                          <Plus className="size-5" />
                        </span>
                        <span className="text-sm font-bold text-slate-700">上传挂画图片</span>
                        <span className="max-w-xs text-xs leading-5 text-slate-400">上传一张挂画/卷轴图片，AI 会分析成产品固定档案。</span>
                      </button>
                    )}
                    <input
                      ref={paintingFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        void handlePaintingImageChange(file);
                      }}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePaintingAnalyze}
                      disabled={!paintingImage || paintingLoading !== 'idle'}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-bold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {paintingLoading === 'analyze' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                      分析产品
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryModalKind('image-creative');
                        setShowHistoryModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:border-rose-200 hover:bg-rose-50/40"
                    >
                      <History className="size-3 text-slate-400" />
                      <span>历史图片</span>
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-slate-100 px-1.5 py-0 text-[10px] font-bold text-slate-500">
                        {isUploadHistoryLoading ? <Loader2 className="size-2.5 animate-spin" aria-label="正在读取历史图片" /> : imageHistory.length}
                      </span>
                    </button>
                    {paintingProfile && (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600">产品档案已生成</span>
                    )}
                  </div>

                  {paintingProfile && (
                    <div className="rounded-2xl border border-slate-300 bg-white p-3">
                      <div className="mb-2 text-xs font-black text-slate-800">产品固定档案</div>
                      <dl className="grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2">
                        {[
                          ['名称', paintingProfile.name],
                          ['风格', paintingProfile.style],
                          ['主体', paintingProfile.subject],
                          ['材质', paintingProfile.material],
                          ['构图', paintingProfile.composition],
                          ['外框结构', paintingProfile.frameStructure],
                          ['纹理', paintingProfile.texture],
                          ['氛围', paintingProfile.atmosphere],
                          ['比例', paintingProfile.ratio],
                        ].filter(([, value]) => typeof value === 'string' && value.trim()).map(([label, value]) => (
                          <div key={label} className="flex items-start gap-2">
                            <span className="shrink-0 font-bold text-slate-400">{label}</span>
                            <span className="min-w-0 break-words text-slate-700">{value}</span>
                          </div>
                        ))}
                        {Array.isArray(paintingProfile.colors) && paintingProfile.colors.length > 0 && (
                          <div className="flex items-start gap-2 sm:col-span-2">
                            <span className="shrink-0 font-bold text-slate-400">主色调</span>
                            <span className="min-w-0 break-words text-slate-700">{paintingProfile.colors.join('、')}</span>
                          </div>
                        )}
                      </dl>
                    </div>
                  )}

                  {paintingProfile && (
                    <div ref={paintingPlanRef} className="space-y-2 rounded-2xl border border-slate-300 bg-slate-50 p-3">
                      <div className="text-xs font-black text-slate-800">素材计划</div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-[11px] font-semibold text-slate-500 sm:col-span-2">
                          本轮整体风格
                          <select
                            value={paintingPlan.stylePreset}
                            onChange={(event) => setPaintingPlan((previous) => ({ ...previous, stylePreset: event.target.value }))}
                            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-300"
                          >
                            {PAINTING_STYLE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label} · {option.description}
                              </option>
                            ))}
                          </select>
                          <span className="mt-1 block text-[10px] font-medium leading-4 text-slate-400">
                            选定后，场景、人物服装、色彩、光线、镜头、声音和文案语气会整套保持一致。
                          </span>
                        </label>
                        <div className="text-[11px] font-semibold text-slate-500">
                          方案数量
                          <div className="mt-1 flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600">
                            一轮 40 个不同方向 · 当前每批展示 10 条
                          </div>
                        </div>
                        <label className="text-[11px] font-semibold text-slate-500">
                          画面比例
                          <select
                            value={paintingPlan.ratio}
                            onChange={(event) => setPaintingPlan((previous) => ({ ...previous, ratio: event.target.value }))}
                            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-300"
                          >
                            <option value="9:16">9:16 竖屏</option>
                            <option value="16:9">16:9 横屏</option>
                            <option value="1:1">1:1 方形</option>
                          </select>
                        </label>
                        <label className="text-[11px] font-semibold text-slate-500">
                          时长下限（秒）
                          <input
                            type="number"
                            min={4}
                            max={15}
                            value={paintingPlan.durationMin}
                            onChange={(event) => setPaintingPlan((previous) => {
                              const durationMin = Math.min(15, Math.max(4, Number(event.target.value) || 5));
                              return { ...previous, durationMin, durationMax: Math.max(previous.durationMax, durationMin) };
                            })}
                            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-300"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-500">
                          时长上限（秒）
                          <input
                            type="number"
                            min={4}
                            max={15}
                            value={paintingPlan.durationMax}
                            onChange={(event) => setPaintingPlan((previous) => {
                              const durationMax = Math.min(15, Math.max(4, Number(event.target.value) || 10));
                              return { ...previous, durationMax, durationMin: Math.min(previous.durationMin, durationMax) };
                            })}
                            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-300"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-500 sm:col-span-2">
                          人物偏好（可选）
                          <input
                            type="text"
                            value={paintingPlan.character}
                            onChange={(event) => setPaintingPlan((previous) => ({ ...previous, character: event.target.value }))}
                            placeholder="例如：年轻女性、茶室主人、家居博主"
                            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-300"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-500 sm:col-span-2">
                          声音/音乐偏好（可选）
                          <input
                            type="text"
                            value={paintingPlan.audio}
                            onChange={(event) => setPaintingPlan((previous) => ({ ...previous, audio: event.target.value }))}
                            placeholder="例如：舒缓古风背景音乐、轻声旁白"
                            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-300"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-500 sm:col-span-2">
                          场景偏好（可选）
                          <input
                            type="text"
                            value={paintingPlan.scene}
                            onChange={(event) => setPaintingPlan((previous) => ({ ...previous, scene: event.target.value }))}
                            placeholder="例如：新中式客厅、茶室、书房、展厅"
                            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-300"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-500 sm:col-span-2">
                          其他特殊要求（可选）
                          <input
                            type="text"
                            value={paintingPlan.extraRequirements}
                            onChange={(event) => setPaintingPlan((previous) => ({ ...previous, extraRequirements: event.target.value }))}
                            placeholder="例如：不要出现人物、画面必须特写木条工艺、加入礼盒送礼元素"
                            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-rose-300"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={handlePaintingGenerateIdeas}
                        disabled={paintingLoading !== 'idle'}
                        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {paintingLoading === 'ideas' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                        生成创意方案
                      </button>
                    </div>
                  )}

                  {paintingProfile && (
                    <>
                      <button
                        type="button"
                        onClick={() => void handlePaintingOpenBatchConfirm()}
                        disabled={!paintingImage || paintingLoading !== 'idle' || paintingBatchPreparing}
                        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-600 to-orange-500 px-4 text-sm font-black text-white shadow-[0_8px_20px_rgba(244,63,94,0.28)] transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {paintingBatchPreparing ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />}
                        {paintingBatchPreparing ? (paintingBatchPrepareStage || '正在准备 40 个方向…') : '全自动生成40条视频'}
                      </button>
                      {paintingBatchPrepareFailed && (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                          <div className="font-bold">{paintingBatchPrepareError || '准备批量生成失败。'}</div>
                          <div className="mt-1">
                            已成功准备 {paintingBatchPreparedBatches}/{paintingTotalBatches} 批 · 可安全重试，已完成批次不会重复生成。
                          </div>
                          <button
                            type="button"
                            onClick={() => void handlePaintingOpenBatchConfirm()}
                            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-amber-600 px-3 text-[11px] font-bold text-white transition-colors hover:bg-amber-700"
                          >
                            继续准备
                          </button>
                        </div>
                      )}
                    </>
                  )}

                  {paintingIdeas.length > 0 && (
                    <div ref={paintingIdeasRef} className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-black text-slate-800">创意方案（{paintingIdeas.length} 条）</div>
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">
                            第 {paintingFrameworkBatch + 1}/{paintingTotalBatches} 批 · 第 {paintingVariationRound + 1} 轮
                          </span>
                          <button
                            type="button"
                            onClick={handlePaintingPreviousIdeas}
                            disabled={paintingLoading !== 'idle' || paintingFrameworkBatch <= 0}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            上一批
                          </button>
                          <button
                            type="button"
                            onClick={handlePaintingRegenerateIdeas}
                            disabled={paintingLoading !== 'idle'}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {paintingLoading === 'ideas' ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                            下一批
                          </button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        {paintingIdeas.map((idea) => {
                          const usageKey = getPaintingIdeaUsageKey(paintingFrameworkBatch, paintingVariationRound, idea.id);
                          const usageCount = paintingIdeaUsageCounts[usageKey] || 0;
                          const isUsed = usageCount > 0;
                          return (
                          <div
                            key={idea.id}
                            className={cn(
                              'rounded-xl border p-3 shadow-sm',
                              paintingSelectedIdea?.id === idea.id
                                ? 'border-rose-300 bg-white ring-1 ring-rose-200'
                                : isUsed
                                  ? 'border-emerald-200 bg-emerald-50/40'
                                  : 'border-slate-200 bg-white'
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <div className="text-xs font-black text-slate-800">{idea.title}</div>
                                  {isUsed && (
                                    <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                                      <Check className="size-2.5" />
                                      已使用 {usageCount} 次
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1 text-xs leading-5 text-slate-500">{idea.summary}</div>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handlePaintingGeneratePrompt(idea)}
                                  disabled={paintingLoading !== 'idle'}
                                  className={cn(
                                    'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                    isUsed
                                      ? 'border-emerald-200 bg-white text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
                                  )}
                                >
                                  {paintingLoading === 'prompt' && paintingSelectedIdea?.id === idea.id ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                                  生成完整提示词
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePaintingAutoGenerateVideo(idea)}
                                  disabled={paintingLoading !== 'idle' || isSeedanceLoading}
                                  className="inline-flex h-8 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 text-[11px] font-bold text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {paintingLoading === 'prompt' && paintingSelectedIdea?.id === idea.id ? <Loader2 className="size-3 animate-spin" /> : <Film className="size-3" />}
                                  自动生成视频
                                </button>
                                {isUsed && (
                                  <button
                                    type="button"
                                    onClick={() => handlePaintingAutoGenerateVideo(idea, { remixElements: true })}
                                    disabled={paintingLoading !== 'idle' || isSeedanceLoading}
                                    className="inline-flex h-8 items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-3 text-[11px] font-bold text-violet-600 transition-colors hover:border-violet-300 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
                                    title="保留这条创意的镜头与动作框架，改换场景、人物、服装和陈设后再生成一个视频"
                                  >
                                    {paintingLoading === 'prompt' && paintingSelectedIdea?.id === idea.id ? <Loader2 className="size-3 animate-spin" /> : <Replace className="size-3" />}
                                    换元素再生成
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {paintingFullPrompt && (
                    <div className="rounded-2xl border border-slate-300 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-xs font-black text-slate-800">完整提示词</div>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText(paintingFullPrompt)}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Copy className="size-3" />
                          复制
                        </button>
                      </div>
                      <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-700">
                        {paintingFullPrompt}
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-600">
                        <Film className="size-3.5" />
                        已自动填入右侧 Seedance
                      </div>
                    </div>
                  )}

                  {paintingError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-medium leading-5 text-red-500">{paintingError}</div>
                  )}

                  {paintingHistory.length > 0 && (
                    <div className="rounded-2xl border border-slate-300 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center gap-2 text-xs font-black text-slate-800">
                        <History className="size-3.5 text-slate-400" />
                        历史记录
                      </div>
                      <div className="space-y-2">
                        {paintingHistory.map((item) => {
                          const previewUrl = imageHistory.find((image) => image.id === item.uploadHistoryId)?.previewUrl || item.thumbnail || '';
                          return <div
                            key={item.id}
                            className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 transition-colors hover:border-rose-200"
                          >
                            <button
                              type="button"
                              onClick={() => void handlePaintingLoadHistory(item)}
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            >
                              {previewUrl ? (
                                <img src={previewUrl} alt={item.title} className="size-10 shrink-0 rounded-lg bg-slate-100 object-cover" />
                              ) : (
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-300">
                                  <ImageIcon className="size-4" />
                                </span>
                              )}
                              <span className="min-w-0">
                                <span className="block truncate text-xs font-bold text-slate-700">{item.title}</span>
                                <span className="block truncate text-[10px] text-slate-400">
                                  {formatHistoryTime(new Date(item.savedAt).getTime())} · {item.ratio}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePaintingDeleteHistory(item.id)}
                              className="flex size-7 shrink-0 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                              aria-label="删除这条历史记录"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>;
                        })}
                      </div>
                    </div>
                  )}

                  {paintingBatchListError && !paintingBatchDetail && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-medium leading-5 text-red-500">{paintingBatchListError}</div>
                  )}

                  {paintingBatchDetail && (
                    <div
                      ref={paintingBatchModuleRef}
                      className={cn(
                        'rounded-2xl border p-3',
                        !PAINTING_BATCH_TERMINAL_STATUSES.includes(paintingBatchDetail.run.status)
                          ? 'batch-tech-card'
                          : 'border-slate-300 bg-white'
                      )}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-black text-slate-800">
                            <Film className="size-4 shrink-0 text-rose-500" />
                            全自动批量生成
                            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', getPaintingBatchStatusTone(paintingBatchDetail.run.status))}>
                              {getPaintingBatchStatusLabel(paintingBatchDetail.run.status)}
                            </span>
                          </div>
                          {paintingBatchDetail.run.createdAt > 0 && (
                            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-bold text-rose-600">
                              <Clock className="size-3.5" />
                              已运行 {formatElapsedDuration(Math.max(0, Math.floor(paintingBatchClock / 1000) - paintingBatchDetail.run.createdAt)) || '0秒'}
                            </div>
                          )}
                          <div className="mt-1 text-xs text-slate-500">
                            {paintingBatchDetail.run.paintingName} · {paintingBatchDetail.run.resolution} · {paintingBatchDetail.run.ratio}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-400">
                            目标文件夹：{paintingBatchDetail.run.targetFolderName || '通用素材'} · 共 {paintingBatchDetail.counts.total} 条
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {!PAINTING_BATCH_TERMINAL_STATUSES.includes(paintingBatchDetail.run.status) && (
                            <>
                              {paintingBatchDetail.run.controlStatus === 'paused' ? (
                                <button
                                  type="button"
                                  onClick={() => void handlePaintingBatchAction('resume')}
                                  disabled={paintingBatchActionLoading !== null}
                                  className="inline-flex h-8 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-[11px] font-bold text-emerald-600 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {paintingBatchActionLoading === 'resume' ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                                  继续
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handlePaintingBatchAction('pause')}
                                  disabled={paintingBatchActionLoading !== null}
                                  className="inline-flex h-8 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 text-[11px] font-bold text-amber-600 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {paintingBatchActionLoading === 'pause' ? <Loader2 className="size-3 animate-spin" /> : <Pause className="size-3" />}
                                  暂停
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void handlePaintingBatchAction('stop')}
                                disabled={paintingBatchActionLoading !== null}
                                className="inline-flex h-8 items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 text-[11px] font-bold text-red-600 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {paintingBatchActionLoading === 'stop' ? <Loader2 className="size-3 animate-spin" /> : <Square className="size-3" />}
                                终止
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {[
                          ['已完成', paintingBatchDetail.counts.completed, 'text-emerald-600'],
                          ['生成中', paintingBatchDetail.counts.rendering, 'text-blue-600'],
                          ['待复核', paintingBatchDetail.counts.needsReview, 'text-amber-600'],
                          ['失败', paintingBatchDetail.counts.failed, 'text-red-600'],
                        ].map(([label, value, tone]) => (
                          <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] font-bold text-slate-400">{label}</div>
                            <div className={cn('text-lg font-black', tone)}>{value}</div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
                        {paintingBatchDetail.tasks.map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                                <span className="shrink-0 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-black text-slate-500">
                                  方向{String(task.directionNumber).padStart(2, '0')}
                                </span>
                                <span className="truncate">{task.ideaTitle || '未命名方向'}</span>
                              </div>
                              {task.errorMessage && (
                                <div className="mt-0.5 truncate text-[10px] text-red-400">{task.errorMessage}</div>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', getPaintingBatchStatusTone(task.status))}>
                                {getPaintingBatchStatusLabel(task.status)}
                              </span>
                              {['failed', 'needs_review', 'stopped'].includes(task.status) && (
                                task.seedanceTaskId ? (
                                  <button
                                    type="button"
                                    onClick={() => void handlePaintingBatchQueryTask(task.id)}
                                    className="inline-flex h-6 items-center gap-1 rounded-full border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-500 hover:border-blue-200 hover:text-blue-600"
                                  >
                                    <RotateCcw className="size-2.5" />
                                    查询原任务
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => void handlePaintingBatchResubmitTask(task.id)}
                                    className="inline-flex h-6 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 text-[10px] font-bold text-amber-600 hover:border-amber-300 hover:bg-amber-100"
                                  >
                                    <RotateCcw className="size-2.5" />
                                    重新提交
                                  </button>
                                )
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {paintingBatchRuns.length > 0 && (
                    <div className="rounded-2xl border border-slate-300 bg-slate-50 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-black text-slate-800">
                          <History className="size-3.5 text-slate-400" />
                          批量生成历史
                        </div>
                        <button
                          type="button"
                          onClick={() => void loadPaintingBatchRuns()}
                          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-500 hover:border-rose-200 hover:text-rose-600"
                        >
                          <RefreshCw className="size-3" />
                          刷新
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        {paintingBatchRuns.map((run) => {
                          const isActive = run.batchRunId === paintingBatchActiveRunId;
                          return (
                            <button
                              key={run.batchRunId}
                              type="button"
                              onClick={() => {
                                setPaintingBatchActiveRunId(run.batchRunId);
                                void pollPaintingBatch(run.batchRunId);
                              }}
                              className={cn(
                                'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                                isActive ? 'border-rose-200 bg-white ring-1 ring-rose-100' : 'border-slate-200 bg-white hover:border-rose-200'
                              )}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-bold text-slate-700">{run.paintingName}</div>
                                <div className="truncate text-[10px] text-slate-400">
                                  {formatHistoryTime(run.createdAt * 1000)} · {run.totalDirections} 条 · {run.targetFolderName || '通用素材'}
                                </div>
                              </div>
                              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold', getPaintingBatchStatusTone(run.status))}>
                                {getPaintingBatchStatusLabel(run.status)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
              <>
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
                      {reverseMode === 'replace' ? '上传原视频' : reverseMode === 'image' ? '上传基准图片' : '上传视频'}
                    </span>
                    <span className="max-w-xs text-xs leading-5 text-slate-400">
                      {reverseMode === 'image' ? '上传一张图片，AI 会据此设计视频动态。' : '支持常见视频格式，当前上限 150MB。'}
                    </span>
                  </button>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {!selectedMedia && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryModalKind(reverseMode === 'image' ? 'image-creative' : 'video');
                      setShowHistoryModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                  >
                    <History className="size-3 text-slate-400" />
                    <span>{reverseMode === 'image' ? '历史图片' : '历史视频'}</span>
                    {(reverseMode === 'image' ? imageHistory.length : videoHistory.length) > 0 && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0 text-[10px] font-bold text-slate-500">
                        {reverseMode === 'image' ? imageHistory.length : videoHistory.length}
                      </span>
                    )}
                  </button>
                )}
                <div className="relative">
                  {!isNotebookOpen && (
                    <button
                      type="button"
                      onClick={() => setIsNotebookOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                    >
                      <BookText className="size-3 text-slate-400" />
                      <span>笔记本</span>
                      {notebookItems.length > 0 && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0 text-[10px] font-bold text-slate-500">{notebookItems.length}</span>
                      )}
                    </button>
                  )}
                  {isNotebookOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-20 bg-slate-900/20 backdrop-blur-sm"
                        onClick={() => {
                          if (notebookDraft.trim()) {
                            addNotebookItem();
                          }
                          setIsNotebookOpen(false);
                        }}
                      ></div>
                      <div ref={notebookRef} className="fixed left-1/2 top-1/2 z-30 w-[520px] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl border border-slate-200/60 bg-white/95 shadow-2xl">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <BookText className="size-4 text-slate-500" />
                          <div>
                            <div className="text-xs font-black text-slate-900">笔记本</div>
                            <div className="mt-0.5 text-[11px] text-slate-400">记录重要内容，随时粘贴和查阅</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setIsNotebookOpen(false)}
                          className="flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                          aria-label="收起笔记本"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3">
                        <div className="mb-3">
                          <textarea
                            value={notebookDraft}
                            onChange={(e) => setNotebookDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                addNotebookItem();
                              }
                            }}
                            placeholder="粘贴或输入重要内容，回车保存..."
                            className="min-h-[120px] w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-xs leading-6 text-slate-700 outline-none transition-colors focus:border-indigo-300"
                          />
                          <div className="mt-2 text-[10px] text-slate-400">
                            点击空白处自动保存
                          </div>
                        </div>
                        {notebookItems.length > 0 && (
                          <div className="space-y-2">
                            {notebookItems.map((item) => (
                              <div
                                key={item.id}
                                className="group relative rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm"
                              >
                                <div className="whitespace-pre-wrap text-xs leading-5 text-slate-700 pr-6">
                                  {item.content}
                                </div>
                                <div className="mt-1.5 flex items-center justify-between">
                                  <span className="text-[10px] text-slate-400">
                                    {new Date(item.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => copyNotebookItem(item)}
                                      className="flex size-6 items-center justify-center rounded text-slate-300 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                                      aria-label="复制笔记"
                                      title="复制"
                                    >
                                      {copiedNotebookId === item.id ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => deleteNotebookItem(item.id)}
                                      className="flex size-6 items-center justify-center rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                                      aria-label="删除笔记"
                                      title="删除"
                                    >
                                      <Trash2 className="size-3" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
              </div>

              {reverseMode === 'image' && (
                <div className="mt-3 space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/35 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-slate-800">图片生视频调整</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">不填写的部分默认保持图片原样，只补全自然的视频动态。</div>
                    </div>
                    <label className="inline-flex shrink-0 items-center gap-2 text-[11px] font-bold text-slate-600">
                      <input
                        type="checkbox"
                        checked={imageToVideoAddPainting}
                        onChange={(event) => setImageToVideoAddPainting(event.target.checked)}
                        disabled={isLoading}
                        className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      加入挂画/装饰画
                    </label>
                  </div>
                  <div className="rounded-xl border border-indigo-100 bg-white/80 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="image-to-video-duration" className="text-[11px] font-bold text-slate-700">
                        视频时长（秒）<span className="ml-1 text-red-500">必填</span>
                      </label>
                      <span className="text-[10px] font-semibold text-slate-400">
                        当前模型支持 4-{seedanceModel === 'doubao-seedance-2-5-260628' ? 30 : 15} 秒
                      </span>
                    </div>
                    <input
                      id="image-to-video-duration"
                      type="number"
                      min={4}
                      max={seedanceModel === 'doubao-seedance-2-5-260628' ? 30 : 15}
                      step={1}
                      inputMode="numeric"
                      required
                      value={imageToVideoDuration}
                      onChange={(event) => setImageToVideoDuration(event.target.value)}
                      placeholder={`请输入 4-${seedanceModel === 'doubao-seedance-2-5-260628' ? 30 : 15} 之间的整数`}
                      disabled={isLoading}
                      className="mt-2 w-full rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none placeholder:text-slate-300 focus:border-indigo-400 disabled:opacity-60"
                    />
                  </div>
                  {imageToVideoAddPainting && (
                    <div className="space-y-3 rounded-xl border border-indigo-100 bg-white/80 p-3">
                      {imageToVideoPainting ? (
                        <div className="flex items-center gap-3">
                          <img
                            src={imageToVideoPainting.previewUrl}
                            alt={imageToVideoPainting.fileName}
                            className="size-16 rounded-lg bg-slate-100 object-contain"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-bold text-slate-700">{imageToVideoPainting.fileName}</div>
                            <div className="mt-1 text-[11px] text-indigo-500">已作为挂画参考图</div>
                          </div>
                          <button
                            type="button"
                            onClick={clearImageToVideoPainting}
                            className="flex size-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            aria-label="移除挂画参考图"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => imageToVideoPaintingInputRef.current?.click()}
                          disabled={isLoading}
                          className="flex min-h-[92px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-200 text-center text-indigo-600 hover:bg-indigo-50/50 disabled:opacity-60"
                        >
                          <ImageIcon className="size-5" />
                          <span className="text-xs font-bold">上传挂画/装饰画参考图</span>
                        </button>
                      )}
                      <div>
                        <label className="text-[11px] font-bold text-slate-600">插入位置</label>
                        <input
                          type="text"
                          value={imageToVideoPaintingPlacement}
                          onChange={(event) => setImageToVideoPaintingPlacement(event.target.value)}
                          placeholder="如：人物身后的白墙中央，位于人物右侧"
                          disabled={isLoading}
                          className="mt-1.5 w-full rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none placeholder:text-slate-300 focus:border-indigo-400 disabled:opacity-60"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

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

                  {!replaceImage && (
                    <button
                      type="button"
                      onClick={() => {
                        setHistoryModalKind('image-creative');
                        setShowHistoryModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                    >
                      <History className="size-3 text-slate-400" />
                      <span>历史图片</span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0 text-[10px] font-bold text-slate-500">{imageHistory.length}</span>
                    </button>
                  )}

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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-medium text-slate-400">常用：</span>
                        <button
                          type="button"
                          onClick={() => setReplaceTarget('视频中的挂画')}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                        >
                          视频中的挂画
                        </button>
                        <button
                          type="button"
                          onClick={() => setReplaceTarget('视频中的装饰画')}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                        >
                          视频中的装饰画
                        </button>
                      </div>
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-medium text-slate-400">常用：</span>
                        <button
                          type="button"
                          onClick={() => setReplaceWith('图片中的挂画')}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                        >
                          图片中的挂画
                        </button>
                        <button
                          type="button"
                          onClick={() => setReplaceWith('图片中的装饰画')}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-600"
                        >
                          图片中的装饰画
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 space-y-1.5">
                <label className="text-[11px] font-bold text-slate-600">额外调整（可选）</label>
                <textarea
                  ref={additionalChangeRef}
                  value={additionalChange}
                  onChange={(e) => setAdditionalChange(e.target.value)}
                  placeholder="如：把模特的衣服换成红色"
                  disabled={isLoading}
                  rows={2}
                  className="min-h-[48px] w-full resize-none overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold leading-5 text-slate-900 outline-none transition-colors placeholder:text-slate-300 focus:border-indigo-400 disabled:opacity-60"
                />
              </div>

              <div className="mt-3 flex items-center">
                {additionalChangeHistory.length > 0 && (
                  <div className="relative">
                    {!isAdditionalHistoryOpen && (
                      <button
                        type="button"
                        onClick={() => setIsAdditionalHistoryOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50/40"
                      >
                        <History className="size-3 text-slate-400" />
                        <span>历史记录</span>
                        <span className="rounded-full bg-slate-100 px-1.5 py-0 text-[10px] font-bold text-slate-500">{additionalChangeHistory.length}</span>
                      </button>
                    )}
                    {isAdditionalHistoryOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-20 bg-slate-900/20 backdrop-blur-sm"
                          onClick={() => setIsAdditionalHistoryOpen(false)}
                        ></div>
                        <div ref={additionalHistoryRef} className="fixed left-1/2 top-1/2 z-30 w-[480px] max-h-[70vh] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl border border-slate-200/60 bg-white/95 shadow-2xl">
                          <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
                            <div className="flex items-center gap-2">
                              <History className="size-4 text-slate-500" />
                              <div>
                                <div className="text-xs font-black text-slate-900">额外调整历史记录</div>
                                <div className="mt-0.5 text-[11px] text-slate-400">点击记录可填充到输入框</div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setIsAdditionalHistoryOpen(false)}
                              className="flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                              aria-label="收起"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                          <div className="flex-1 overflow-y-auto p-3">
                            <div className="sticky top-0 z-10 mb-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                              <div className="flex items-center gap-2">
                                <Search className="size-3.5 shrink-0 text-slate-400" />
                                <input
                                  type="text"
                                  value={additionalHistorySearch}
                                  onChange={(event) => setAdditionalHistorySearch(event.target.value)}
                                  placeholder="搜索额外调整历史..."
                                  className="h-7 min-w-0 flex-1 bg-transparent text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-300"
                                  autoFocus
                                />
                                {additionalHistorySearch.trim() && (
                                  <button
                                    type="button"
                                    onClick={() => setAdditionalHistorySearch("")}
                                    className="flex size-6 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500"
                                    aria-label="清空搜索"
                                  >
                                    <X className="size-3" />
                                  </button>
                                )}
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                                  {filteredAdditionalChangeHistory.length}/{additionalChangeHistory.length}
                                </span>
                              </div>
                            </div>
                            {filteredAdditionalChangeHistory.length === 0 ? (
                              <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-slate-400">
                                没有匹配的历史记录
                              </div>
                            ) : (
                            <div className="space-y-2">
                              {filteredAdditionalChangeHistory.map(({ item, index }) => (
                                <div
                                  key={`${item.createdAt}-${index}`}
                                  className="group relative rounded-xl border border-slate-200/70 bg-white/80 p-3 shadow-sm"
                                >
                                  <div className="whitespace-pre-wrap text-xs leading-5 text-slate-700 pr-6">
                                    {item.text}
                                  </div>
                                  <div className="mt-1.5 flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400">第 {additionalChangeHistory.length - index} 条</span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => copyAdditionalHistory(item.text)}
                                        className="flex size-6 items-center justify-center rounded text-slate-300 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                                        aria-label="复制"
                                        title="复制"
                                      >
                                        {copiedAdditionalId === item.text ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setAdditionalChange(item.text);
                                          setIsAdditionalHistoryOpen(false);
                                        }}
                                        className="flex size-6 items-center justify-center rounded text-slate-300 transition-colors hover:bg-indigo-50 hover:text-indigo-500"
                                        aria-label="使用"
                                        title="填充到输入框"
                                      >
                                        <Sparkles className="size-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => deleteAdditionalChangeHistory(item.text)}
                                        className="flex size-6 items-center justify-center rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                                        aria-label="删除"
                                        title="删除"
                                      >
                                        <Trash2 className="size-3" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {reverseMode !== 'image' && (
                  <div className="ml-auto flex w-[180px] items-center gap-2">
                    <input
                      id="enable-character-remix"
                      type="checkbox"
                      checked={enableCharacterRemix}
                      onChange={(e) => setEnableCharacterRemix(e.target.checked)}
                      disabled={isLoading}
                      className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <label htmlFor="enable-character-remix" className="text-xs font-semibold text-slate-600 cursor-pointer select-none">
                      启用人物改造
                    </label>
                  </div>
                )}
              </div>

              {reverseMode !== 'image' && enableCharacterRemix && (
                <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/45 p-3">
                  <label htmlFor="character-remix" className="text-[11px] font-bold text-indigo-700">人物改造要求</label>
                  <input
                    id="character-remix"
                    type="text"
                    value={characterRemix}
                    onChange={(e) => setCharacterRemix(e.target.value)}
                    placeholder="如：把人物改成80岁左右的女性，服装要符合茶室环境"
                    disabled={isLoading}
                    className="mt-1.5 w-full rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-300 focus:border-indigo-400 disabled:opacity-60"
                  />
                  <p className="mt-1.5 text-[11px] leading-4 text-indigo-500">
                    只改变人物年龄、性别、气质、发型和服装等人物设定；场景、道具、镜头、动作流程和光影节奏仍按原视频复刻。
                  </p>
                </div>
              )}

              <div className="mt-3 flex justify-end">
                <div className="ml-auto flex w-[180px] items-center gap-2">
                  <input
                    id="include-subtitles"
                    type="checkbox"
                    checked={includeSubtitles}
                    onChange={(e) => setIncludeSubtitles(e.target.checked)}
                    disabled={isLoading}
                    className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <label htmlFor="include-subtitles" className="text-xs font-semibold text-slate-600 cursor-pointer select-none">
                    反推提示词包含字幕内容
                  </label>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={prepareVideoReversePrompt}
                  disabled={
                    isLoading ||
                    (reverseMode === 'image' ? selectedMedia?.kind !== 'image' : selectedMedia?.kind !== 'video') ||
                    (reverseMode === 'image' && !imageToVideoDuration.trim()) ||
                    (reverseMode === 'replace' && (!replaceImage || !replaceTarget.trim() || !replaceWith.trim()))
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles className="size-3.5" />
                  {reverseMode === 'replace' ? '填入替换指令' : reverseMode === 'image' ? '生成图片生视频提示词' : '填入反推指令'}
                </button>
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

              <div className="mt-4">
                {!isManualInputOpen ? (
                  <button
                    type="button"
                    onClick={() => setIsManualInputOpen(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 py-3 text-xs font-bold text-slate-500 transition-colors hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
                  >
                    <ChevronDown className="size-3.5" />
                    展开手动输入
                  </button>
                ) : (
                  <div className="rounded-2xl border border-slate-300 bg-white p-3 shadow-sm focus-within:border-indigo-300">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500">手动输入</span>
                      <button
                        type="button"
                        onClick={() => setIsManualInputOpen(false)}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                      >
                        <ChevronUp className="size-3" />
                        收起
                      </button>
                    </div>
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
                )}
              </div>

              {(requestError || !configReachable || !arkApiConfigured) && (
                <div className="mt-3 space-y-1 text-[11px] font-medium leading-5 text-red-500">
                  {!configReachable && <div>无法读取服务端配置，请确认后端已启动。</div>}
                  {configReachable && !arkApiConfigured && <div>服务端缺少 ARK_API_KEY，创意创作暂时不可用。</div>}
                  {requestError && <div>{requestError}</div>}
                </div>
              )}
              </>
              )}

            </div>

            <div ref={seedancePanelRef} className="rounded-[22px] border border-slate-300 bg-white p-4 shadow-[0_10px_40px_rgba(15,23,42,0.1)] md:p-5">
              <div className="mb-4 flex min-h-[49px] items-start justify-between gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-violet-500">
                    <Sparkles className="size-3.5" />
                    模块二
                  </div>
                  <h2 className="text-base font-black text-slate-900">Seedance 生成视频</h2>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <select
                    value={seedanceModel}
                    onChange={(event) => {
                      const nextModel = event.target.value as SeedanceModelId;
                      setSeedanceModel(nextModel);
                      // Each model starts from a predictable profile so switching
                      // models cannot carry incompatible settings across.
                      setSeedanceRatio('9:16');
                      setSeedanceResolution('720p');
                      setSeedanceDuration(5);
                      setSeedanceGenerateAudio(nextModel === 'doubao-seedance-2-5-260628');
                      setSeedanceWatermark(false);
                    }}
                    disabled={isSeedanceLoading || seedanceTaskMode === 'video-edit-painting'}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[10px] font-black outline-none transition-colors disabled:opacity-60",
                      seedanceModel === 'doubao-seedance-2-5-260628'
                        ? "border-violet-600 bg-violet-600 text-white shadow-[0_5px_14px_rgba(124,58,237,0.28)]"
                        : seedanceModel === 'doubao-seedance-2-0-mini-260615'
                          ? "border-amber-600 bg-amber-600 text-white shadow-[0_5px_14px_rgba(217,119,6,0.28)]"
                          : "border-emerald-600 bg-emerald-600 text-white shadow-[0_5px_14px_rgba(5,150,105,0.28)]"
                    )}
                    aria-label="选择 Seedance 模型"
                  >
                    <option className="bg-white text-slate-800" value="doubao-seedance-2-0-260128">Seedance 2.0 稳定版</option>
                    <option className="bg-white text-slate-800" value="doubao-seedance-2-0-mini-260615">Seedance 2.0 mini</option>
                    <option className="bg-white text-slate-800" value="doubao-seedance-2-5-260628">Seedance 2.5 测试版</option>
                  </select>
                  <span className="rounded-full bg-slate-50 px-2.5 py-0.5 text-[10px] font-semibold text-slate-500">
                    今日 ¥{seedanceCostStats.daily} / 本月 ¥{seedanceCostStats.monthly} / 本年 ¥{seedanceCostStats.yearly}
                  </span>
                </div>
              </div>

              <div className="mb-4 flex h-9 rounded-xl border border-slate-200 bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => switchSeedanceTaskMode('generate')}
                  className={cn(
                    "flex-1 rounded-lg px-4 text-xs font-black transition-colors",
                    seedanceTaskMode === 'generate' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  常规生成
                </button>
                <button
                  type="button"
                  onClick={() => switchSeedanceTaskMode('video-edit-painting')}
                  className={cn(
                    "flex-1 rounded-lg px-4 text-xs font-black transition-colors",
                    seedanceTaskMode === 'video-edit-painting' ? "bg-violet-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  视频直接换画
                </button>
              </div>

              <div className="rounded-2xl border border-slate-300 bg-slate-100 p-3 relative">
                {seedanceTaskMode === 'video-edit-painting' && (
                  <div className="mb-3 rounded-xl border border-violet-200 bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">Seedance 2.5 视频编辑</div>
                        <div className="mt-1 text-[11px] font-medium text-slate-500">直接保留原视频动作和镜头，只替换目标挂画</div>
                      </div>
                      <span className="rounded-full bg-violet-50 px-3 py-1 text-[10px] font-black text-violet-700">原比例 · 原时长</span>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {(['video', 'image'] as const).map((kind) => {
                        const reference = seedanceReferences.find((item) => item.kind === kind);
                        const isVideo = kind === 'video';
                        return (
                          <div key={kind} className="space-y-2">
                            <button
                              type="button"
                              onClick={() => (isVideo ? videoEditVideoInputRef : videoEditImageInputRef).current?.click()}
                              disabled={isSeedanceLoading}
                              className="flex min-h-20 w-full items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/40 disabled:opacity-60"
                            >
                              <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-slate-400 shadow-sm">
                                {reference?.previewUrl ? (
                                  isVideo
                                    ? <video src={reference.previewUrl} className="size-full object-cover" muted />
                                    : <img src={reference.previewUrl} alt="目标挂画" className="size-full object-cover" />
                                ) : isVideo ? <Film className="size-5" /> : <ImageIcon className="size-5" />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-black text-slate-800">{isVideo ? '上传原视频' : '上传目标挂画'}</div>
                                <div className="mt-1 truncate text-[11px] font-medium text-slate-400">
                                  {reference?.fileName || (isVideo ? '4-30 秒，最大 50MB' : '保持原图文字、比例与颜色')}
                                </div>
                                {isVideo && videoEditSourceDuration && (
                                  <div className="mt-1 text-[10px] font-black text-emerald-600">视频时长 {videoEditSourceDuration.toFixed(1)} 秒</div>
                                )}
                              </div>
                            </button>
                            {(isVideo ? videoHistory.length : imageHistory.length) > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setHistoryModalKind(isVideo ? 'video-edit-video' : 'video-edit-image');
                                  setShowHistoryModal(true);
                                }}
                                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-50/50 hover:text-violet-700"
                              >
                                <History className="size-3 text-slate-400" />
                                <span>{isVideo ? '历史视频' : '历史图片'}</span>
                                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-500">
                                  {isVideo ? videoHistory.length : imageHistory.length}
                                </span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-black text-slate-600">原视频中要替换的位置</span>
                        <textarea
                          ref={videoEditTargetRef}
                          rows={1}
                          value={videoEditTarget}
                          onChange={(event) => {
                            const nextTarget = event.target.value;
                            setVideoEditTarget(nextTarget);
                            setSeedancePrompt(buildVideoEditPaintingPrompt(nextTarget, videoEditAdjustments));
                          }}
                          placeholder="例如：人物手中正在展开的卷轴挂画"
                          className="min-h-10 w-full resize-none overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium leading-5 text-slate-700 outline-none focus:border-violet-300"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[11px] font-black text-slate-600">额外调整（选填）</span>
                        <textarea
                          ref={videoEditAdjustmentsRef}
                          rows={1}
                          value={videoEditAdjustments}
                          onChange={(event) => {
                            const nextAdjustments = event.target.value;
                            setVideoEditAdjustments(nextAdjustments);
                            setSeedancePrompt(buildVideoEditPaintingPrompt(videoEditTarget, nextAdjustments));
                          }}
                          placeholder="例如：墙面改为浅灰色，其他内容不变"
                          className="min-h-10 w-full resize-none overflow-hidden rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium leading-5 text-slate-700 outline-none focus:border-violet-300"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* 提示词输入框 + 内部参考素材 */}
                <div className="relative">
                  {seedanceReplaceHighlight && (
                    <div
                      className="pointer-events-none absolute inset-0 z-0 min-h-[280px] overflow-hidden rounded-xl bg-white p-4 pb-20 text-sm leading-7 text-slate-700 whitespace-pre-wrap"
                      aria-hidden="true"
                    >
                      <div style={{ transform: `translateY(-${seedancePromptScrollTop}px)` }}>
                        {renderHighlightedText(seedanceReplaceHighlight)}
                      </div>
                    </div>
                  )}
                  <textarea
                    ref={seedancePromptRef}
                    value={seedancePrompt}
                    onChange={handleSeedancePromptChange}
                    onKeyDown={handleSeedanceKeyDown}
                    onScroll={(event) => setSeedancePromptScrollTop(event.currentTarget.scrollTop)}
                    readOnly={seedanceTaskMode === 'video-edit-painting'}
                    placeholder={seedanceTaskMode === 'video-edit-painting' ? '上传原视频和目标挂画后即可提交视频编辑任务' : '等待模块一反推出视频提示词...'}
                    className={cn(
                      "relative z-10 min-h-[280px] w-full resize-none rounded-xl border p-4 pb-20 text-sm leading-7 outline-none transition-all focus:border-violet-300 whitespace-pre-wrap",
                      seedanceReplaceHighlight ? "bg-transparent text-transparent caret-slate-800 selection:bg-emerald-200/70" : "bg-white text-slate-700",
                      seedancePromptHighlight ? "border-violet-400 ring-2 ring-violet-300" : "border-slate-300"
                    )}
                  />

                  {/* 已上传的参考素材列表（放在输入框底部内部） */}
                  {seedanceReferences.length > 0 && (
                    <div className="absolute bottom-2 left-2 right-2 z-20 flex flex-wrap gap-1.5">
                      {seedanceReferences.map((reference) => (
                        <div
                          key={reference.id}
                          className="group flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-2 py-1 shadow-sm backdrop-blur-sm transition-colors hover:border-violet-200"
                          title={reference.fileName}
                        >
                          <div className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded bg-slate-100 text-slate-400">
                            {reference.kind === 'image' && reference.previewUrl ? (
                              <img src={reference.previewUrl} alt={reference.fileName} className="size-full object-cover" />
                            ) : reference.kind === 'video' && reference.previewUrl ? (
                              <video src={reference.previewUrl} className="size-full object-cover" muted />
                            ) : (
                              <Music className="size-3" />
                            )}
                          </div>
                          <span className="max-w-[80px] truncate text-[10px] font-semibold text-slate-600">{reference.fileName}</span>
                          <button
                            type="button"
                            onClick={() => removeSeedanceReference(reference.id)}
                            className="flex size-4 items-center justify-center rounded text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                            aria-label="移除参考素材"
                          >
                            <X className="size-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* @ 引用下拉菜单 */}
                  {showAtMenu && (
                    <div data-at-menu className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden max-h-56 overflow-y-auto">
                      {seedanceReferences.length === 0 ? (
                        <div className="px-3 py-3 text-center text-xs text-slate-400">
                          暂无参考素材，请先点击下方“添加参考素材”上传
                        </div>
                      ) : (
                        (() => {
                          const filtered = seedanceReferences
                            .map((ref, i) => ({ ref, index: i, label: getAtReferenceLabel(ref, i) }))
                            .filter(({ label }) => label.toLowerCase().includes(atMenuFilter));
                          if (filtered.length === 0) {
                            return (
                              <div className="px-3 py-3 text-center text-xs text-slate-400">
                                未找到匹配的素材
                              </div>
                            );
                          }
                          return (
                            <>
                              <div className="px-3 py-2 text-[10px] font-bold text-slate-400 border-b border-slate-100">
                                选择参考素材插入到提示词中
                              </div>
                              {filtered.map((item, i) => (
                                <button
                                  key={item.ref.id}
                                  type="button"
                                  onClick={() => insertAtReference(item.index)}
                                  onMouseEnter={() => setAtMenuSelectedIndex(i)}
                                  className={cn(
                                    "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                                    i === atMenuSelectedIndex ? "bg-violet-50" : "hover:bg-violet-50"
                                  )}
                                >
                                  <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100 text-slate-400">
                                    {item.ref.kind === 'image' && item.ref.previewUrl ? (
                                      <img src={item.ref.previewUrl} alt={item.ref.fileName} className="size-full object-cover" />
                                    ) : item.ref.kind === 'video' && item.ref.previewUrl ? (
                                      <video src={item.ref.previewUrl} className="size-full object-cover" muted />
                                    ) : (
                                      <Music className="size-3.5" />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-xs font-bold text-slate-700">
                                      {item.label} <span className="text-slate-400 font-medium">{item.ref.fileName}</span>
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      {item.ref.kind === 'image' ? '参考图片' : item.ref.kind === 'video' ? '参考视频' : '参考音频'}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </>
                          );
                        })()
                      )}
                    </div>
                  )}
                </div>

                {seedanceTaskMode === 'generate' && imageHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryModalKind('image-seedance');
                      setShowHistoryModal(true);
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:border-violet-200 hover:bg-violet-50/40"
                  >
                    <History className="size-3 text-slate-400" />
                    <span>历史图片</span>
                    <span className="rounded-full bg-slate-100 px-1.5 py-0 text-[10px] font-bold text-slate-500">{imageHistory.length}</span>
                  </button>
                )}

                {/* 搜索替换按钮 */}
                {seedanceTaskMode === 'generate' && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchText('');
                      setReplaceText('');
                      setShowSearchReplaceModal(true);
                    }}
                    className="mt-3 ml-2 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-colors hover:border-violet-200 hover:bg-violet-50/40"
                  >
                    <Search className="size-3 text-slate-400" />
                    <span>搜索替换</span>
                  </button>
                )}

                {/* 底部工具栏：添加素材 + 设置 */}
                <div className="mt-3 flex items-center gap-2">
                  {seedanceTaskMode === 'generate' && (
                    <button
                      type="button"
                      onClick={() => seedanceFileInputRef.current?.click()}
                      disabled={isSeedanceLoading}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Plus className="size-3.5" />
                      添加素材
                    </button>
                  )}
                  <div ref={seedanceSettingsRef} className="relative flex-1">
                    <button
                      type="button"
                      onClick={() => setShowSeedanceSettings((value) => !value)}
                      className="flex h-9 w-full flex-wrap items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-left text-xs font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
                    >
                      <SlidersHorizontal className="size-3.5 text-slate-500" />
                      <span>{seedanceResolution.toUpperCase()}</span>
                      <span className="h-3.5 w-px bg-slate-200" />
                      <span>{seedanceTaskMode === 'video-edit-painting' ? '原视频比例' : getSeedanceRatioLabel(seedanceRatio)}</span>
                      <span className="h-3.5 w-px bg-slate-200" />
                      <span>{seedanceTaskMode === 'video-edit-painting' ? '原视频时长' : `${seedanceDuration} 秒`}</span>
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
                          <div className="mb-2 text-xs font-black text-slate-700">视频清晰度</div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {getSeedanceResolutions(seedanceModel).map((resolution) => (
                              <button
                                key={resolution}
                                type="button"
                                onClick={() => setSeedanceResolution(resolution)}
                                className={cn(
                                  "rounded-xl border px-2 py-2 text-xs font-black uppercase transition-colors",
                                  seedanceResolution === resolution
                                    ? "border-violet-300 bg-violet-50 text-violet-700"
                                    : "border-slate-200 bg-slate-50 text-slate-500 hover:border-violet-200 hover:bg-white"
                                )}
                              >
                                {resolution}
                              </button>
                            ))}
                          </div>
                        </div>

                        {seedanceTaskMode === 'generate' && <div>
                          <div className="mb-2 mt-4 text-xs font-black text-slate-700">视频比例</div>
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
                        </div>}

                        {seedanceTaskMode === 'generate' && <div className="mt-4">
                          <div className="mb-2 text-xs font-black text-slate-700">视频时长</div>
                          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                            {(seedanceModel === 'doubao-seedance-2-5-260628' ? SEEDANCE_DURATIONS_2_5 : SEEDANCE_DURATIONS).map((duration) => (
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
                        </div>}

                        {seedanceTaskMode === 'video-edit-painting' && (
                          <div className="rounded-xl bg-violet-50 px-3 py-2 text-xs font-bold leading-5 text-violet-700">
                            视频编辑固定使用智能比例和原视频时长；清晰度可以在上方选择480P或720P。
                          </div>
                        )}

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
                {seedanceTaskMode === 'generate' && (
                  <button
                    type="button"
                    onClick={syncLatestPromptToSeedance}
                    disabled={!latestAssistantText}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Send className="size-3.5" />
                    同步最新提示词
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleCreateSeedanceVideo()}
                  disabled={
                    !seedancePrompt.trim()
                    || isSeedanceLoading
                    || !seedanceApiConfigured
                    || (seedanceTaskMode === 'video-edit-painting' && (
                      !videoEditTarget.trim()
                      || !videoEditSourceDuration
                      || !seedanceReferences.some((item) => item.kind === 'video')
                      || !seedanceReferences.some((item) => item.kind === 'image')
                    ))
                  }
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSeedanceLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  {seedanceTaskMode === 'video-edit-painting' ? '开始直接换画' : '开始生成视频'}
                </button>
                {seedanceTaskMode === 'generate' && <button
                  type="button"
                  onClick={() => {
                    setSeedancePrompt("");
                    setSeedanceReplaceHighlight(null);
                    setSeedancePromptScrollTop(0);
                    setShowAtMenu(false);
                  }}
                  disabled={!seedancePrompt.trim() || isSeedanceLoading}
                  className={cn(
                    "ml-auto inline-flex items-center rounded-full px-3 py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed",
                    seedancePrompt.trim()
                      ? "bg-red-500 text-white hover:bg-red-600"
                      : "border border-slate-100 bg-slate-50 text-slate-300 opacity-60"
                  )}
                >
                  清空提示词
                </button>}
              </div>

              {/* 生成任务预览区域 */}
              <div ref={seedanceTaskStatusRef} className="mt-3">
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
                            {seedanceTaskMode === 'video-edit-painting' ? `${seedanceResolution.toUpperCase()} · 原视频比例 · 原视频时长` : `${seedanceResolution.toUpperCase()} · ${seedanceRatio} · ${seedanceDuration}秒`}
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
                          <button
                            type="button"
                            onClick={() => void openSeedanceLibrarySave({
                              taskId: seedanceTask.taskId,
                              createdAt: seedanceTask.createdAt,
                            })}
                            disabled={!seedanceTask.taskId || !!currentSeedanceLibraryFolder}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-bold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700"
                          >
                            {currentSeedanceLibraryFolder ? <Check className="size-3.5" /> : <FolderOpen className="size-3.5" />}
                            {currentSeedanceLibraryFolder
                              ? `已保存至 ${currentSeedanceLibraryFolder}`
                              : '保存到视频素材库'}
                          </button>
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
                {videoLibrarySaveNotice && (
                  <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-medium leading-5 text-emerald-700">
                    {videoLibrarySaveNotice}
                  </div>
                )}
              </div>

              {/* 生成历史 — 底部全宽区域 */}
              <div className="mt-6 rounded-2xl border border-slate-300 bg-slate-100 p-3 md:p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-slate-800">生成历史</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">保存最近 {SEEDANCE_HISTORY_MAX_AGE_DAYS} 天的 Seedance 任务</div>
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
                  <div className="space-y-3">
                    {/* 最近 30 天日期选择器 */}
                    {(() => {
                      const historyByDate = getSeedanceHistoryByDate(seedanceHistory);
                      const days = getLast30Days();
                      return (
                        <>
                          <div className="flex gap-1.5 overflow-x-auto rounded-xl border border-slate-300 bg-white p-2 scrollbar-thin">
                            {days.map((day) => {
                              const count = historyByDate.get(day.date)?.length || 0;
                              const selected = selectedHistoryDate === day.date;
                              return (
                                <button
                                  key={day.date}
                                  type="button"
                                  onClick={() => setSelectedHistoryDate(day.date)}
                                  className={cn(
                                    'flex shrink-0 flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-center transition-all',
                                    selected
                                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                                  )}
                                  style={{ width: '52px' }}
                                >
                                  <span className="text-[9px] font-bold leading-none opacity-80">{day.dayName}</span>
                                  <span className="mt-0.5 text-sm font-black leading-none">{day.dayNumber}</span>
                                  <span
                                    className={cn(
                                      'mt-1 h-1.5 w-1.5 rounded-full',
                                      count > 0 ? 'bg-emerald-500' : 'bg-slate-200'
                                    )}
                                  />
                                </button>
                              );
                            })}
                          </div>

                          {/* 选中日期详情 */}
                          {selectedHistoryDate && (
                            <div className="rounded-xl border border-slate-300 bg-white p-3">
                              <div className="mb-2 flex items-center justify-between">
                                <div className="text-xs font-black text-slate-800">
                                  {formatHistoryDate(selectedHistoryDate)}
                                  <span className="ml-1.5 text-[10px] font-medium text-slate-400">
                                    {historyByDate.get(selectedHistoryDate)?.length || 0} 条记录
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-2">
                                {(historyByDate.get(selectedHistoryDate) || []).length === 0 ? (
                                  <div className="py-4 text-center text-xs text-slate-400">这一天还没有生成记录</div>
                                ) : (
                                  (historyByDate.get(selectedHistoryDate) || []).map((item) => {
                                    const expired = !!item.videoUrl && isSeedanceVideoExpired(item.savedAt);
                                    const isRunning = !item.videoUrl && !isSeedanceTerminalStatus(item.status);
                                    const liveElapsedSeconds = isRunning && item.createdAt
                                      ? Math.max(0, Math.floor(seedanceClock / 1000) - item.createdAt)
                                      : 0;
                                    return (
                                      <div key={item.taskId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="min-w-0 flex-1">
                                            <div className="line-clamp-2 text-xs font-black text-slate-700">
                                              {item.prompt.replace(/\s+/g, ' ').trim() || 'Seedance 视频任务'}
                                            </div>
                                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-slate-400">
                                              <span className={item.model === 'doubao-seedance-2-5-260628' ? 'font-black text-violet-600' : 'font-black text-slate-500'}>
                                                {getSeedanceHistoryModeLabel(item)}
                                              </span>
                                              <span>{formatSessionTime(item.savedAt)}</span>
                                              <span>{item.resolution ? item.resolution.toUpperCase() : '默认分辨率'}</span>
                                              <span>{getSeedanceHistoryRatioLabel(item)}</span>
                                              <span>{getSeedanceHistoryDurationLabel(item)}</span>
                                              <span>{getSeedanceStatusLabel(item.status, !!item.videoUrl)}</span>
                                              {item.elapsedSeconds !== undefined && item.elapsedSeconds > 0 && (
                                                <span className="text-emerald-600">
                                                  生成耗时 {formatElapsedDuration(item.elapsedSeconds)}
                                                </span>
                                              )}
                                              {isRunning && liveElapsedSeconds > 0 && (
                                                <span className="text-cyan-600">
                                                  已等待 {formatSeedanceWait(liveElapsedSeconds)}
                                                </span>
                                              )}
                                              {expired && <span className="text-amber-600">视频链接已过期</span>}
                                              {item.isGood && (
                                                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-700 ring-1 ring-amber-200">
                                                  好
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-0.5">
                                            <button
                                              type="button"
                                              onClick={() => toggleSeedanceHistoryGood(item.taskId)}
                                              className={cn(
                                                "flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-[11px] font-black transition-colors",
                                                item.isGood
                                                  ? "bg-amber-400 text-white shadow-sm shadow-amber-200 hover:bg-amber-500"
                                                  : "border border-slate-200 bg-white text-slate-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600"
                                              )}
                                              aria-label={item.isGood ? "取消好标记" : "标记为好"}
                                              title={item.isGood ? "取消好标记" : "标记为好"}
                                            >
                                              好
                                            </button>
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
                                              <Trash2 className="size-3.5" />
                                            </button>
                                          </div>
                                        </div>

                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() => handleViewSeedanceHistoryItem(item)}
                                            disabled={expired}
                                            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
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
                                          {item.videoUrl && !expired && (
                                            <>
                                              <button
                                                type="button"
                                                onClick={() => void openSeedanceLibrarySave({
                                                  taskId: item.taskId,
                                                  createdAt: item.createdAt,
                                                })}
                                                disabled={!!item.libraryFolder}
                                                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-4 text-xs font-bold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700"
                                              >
                                                {item.libraryFolder ? <Check className="size-3.5" /> : <FolderOpen className="size-3.5" />}
                                                {item.libraryFolder ? `已保存至 ${item.libraryFolder}` : '保存到素材库'}
                                              </button>
                                              <a
                                                href={item.videoUrl}
                                                download={`seedance-${item.taskId}.mp4`}
                                                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-4 text-xs font-bold text-white transition-colors hover:bg-emerald-700"
                                              >
                                                <Download className="size-3.5" />
                                                下载
                                              </a>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
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
                    <span className={seedanceModalItem.model === 'doubao-seedance-2-5-260628' ? 'font-black text-violet-300' : 'font-black text-slate-300'}>
                      {getSeedanceHistoryModeLabel(seedanceModalItem)}
                    </span>
                    <span>{getSeedanceHistoryRatioLabel(seedanceModalItem)}</span>
                    <span>{getSeedanceHistoryDurationLabel(seedanceModalItem)}</span>
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

      <AnimatePresence>
        {seedanceLibrarySaveTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
            onClick={() => {
              if (!isSavingToVideoLibrary) setSeedanceLibrarySaveTarget(null);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="w-full max-w-lg rounded-3xl border border-white/60 bg-white p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-black text-slate-900">保存到视频素材库</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    原视频会立即复制到我们自己的素材库，不再依赖 Seedance 临时链接；不压缩、不转码，下载仍为 MP4。
                  </p>
                  <p className="mt-1 text-[11px] font-medium leading-5 text-amber-600">
                    请在 Seedance 链接失效前完成保存；保存成功后可长期预览和下载。
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSavingToVideoLibrary}
                  onClick={() => setSeedanceLibrarySaveTarget(null)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed"
                  aria-label="关闭"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">默认文件名</div>
                <div className="mt-1 text-sm font-bold text-slate-800">
                  {formatSeedanceLibraryFileName(seedanceLibrarySaveTarget.createdAt)}
                </div>
              </div>

              <div className="mt-5">
                <div className="mb-2 text-xs font-black text-slate-700">选择保存文件夹</div>
                {isVideoLibraryFolderLoading ? (
                  <div className="flex min-h-28 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-xs font-bold text-slate-400">
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    正在读取文件夹…
                  </div>
                ) : videoLibraryFolders.length > 0 ? (
                  <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
                    {videoLibraryFolders.map((folder) => (
                      <button
                        key={folder}
                        type="button"
                        onClick={() => {
                          setSelectedVideoLibraryFolder(folder);
                          saveLastVideoLibraryFolder(folder);
                        }}
                        disabled={isSavingToVideoLibrary}
                        className={cn(
                          "flex min-h-16 items-center gap-2 rounded-2xl border px-3 py-2 text-left text-xs font-bold transition-colors disabled:cursor-not-allowed",
                          selectedVideoLibraryFolder === folder
                            ? "border-indigo-400 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-100"
                            : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50/50"
                        )}
                      >
                        <FolderOpen className="size-4 shrink-0" />
                        <span className="break-all">{folder}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                    素材库还没有文件夹，请先到视频素材库创建一个文件夹。
                  </div>
                )}
              </div>

              {videoLibrarySaveError && (
                <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium leading-5 text-red-600">
                  {videoLibrarySaveError}
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={isSavingToVideoLibrary}
                  onClick={() => setSeedanceLibrarySaveTarget(null)}
                  className="h-10 rounded-full border border-slate-200 bg-white px-5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isSavingToVideoLibrary || isVideoLibraryFolderLoading || !selectedVideoLibraryFolder}
                  onClick={() => void handleSaveSeedanceToLibrary()}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-indigo-600 px-5 text-xs font-bold text-white shadow-sm shadow-indigo-200 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  {isSavingToVideoLibrary ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
                  {isSavingToVideoLibrary ? '正在保存原视频…' : '确认保存'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 挂画全自动批量生成确认弹窗 */}
      {paintingBatchConfirmOpen && (
        <div
          className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!paintingBatchCreating) setPaintingBatchConfirmOpen(false);
          }}
        >
          <div
            className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/60 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-black text-slate-900">全自动批量生成</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  服务端在后台持续生成并自动存入视频素材库；刷新或关闭页面不会中断，稍后回来仍可查看进度。
                </p>
              </div>
              <button
                type="button"
                disabled={paintingBatchCreating || paintingBatchConfirming}
                onClick={() => setPaintingBatchConfirmOpen(false)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed"
                aria-label="关闭"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
              {paintingImage && (
                <img
                  src={paintingImage.previewUrl}
                  alt={paintingImage.fileName}
                  className="size-20 shrink-0 rounded-xl bg-slate-100 object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-slate-800">{paintingProfile?.name || '未命名挂画'}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{paintingProfile?.style || '未知风格'}</div>
                <div className="mt-0.5 truncate text-[10px] text-slate-400">
                  {paintingProfile?.subject || '未描述主体'}
                </div>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
              {[
                ['批量模型', `${SEEDANCE_BATCH_MODEL_LABEL}（固定）`],
                ['清晰度', `${SEEDANCE_BATCH_RESOLUTION.toUpperCase()}（固定）`],
                ['计费单价', `${getSeedanceRatePerSecond(SEEDANCE_BATCH_MODEL, SEEDANCE_BATCH_RESOLUTION) ?? '暂无法估算'}元/秒`],
                ['画面比例', paintingPlan.ratio || seedanceRatio],
                ['单条时长', `${paintingPlan.durationMin}-${paintingPlan.durationMax} 秒`],
                ['本轮风格', getPaintingStyleLabel(paintingPlan.stylePreset)],
                ['背景音乐', seedanceGenerateAudio ? '开启' : '关闭'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-[10px] font-bold text-slate-400">{label}</div>
                  <div className="mt-0.5 truncate font-bold text-slate-700">{value}</div>
                </div>
              ))}
            </dl>

            <label className="mt-4 flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <input
                type="checkbox"
                checked={paintingBatchOnlyUnused}
                onChange={(event) => setPaintingBatchOnlyUnused(event.target.checked)}
                className="size-4 accent-rose-600"
              />
              <span className="text-xs font-bold text-slate-700">仅生成未使用方向</span>
              <span className="text-[10px] text-slate-400">（默认，跳过当前轮次已生成过的方向）</span>
            </label>

            <div className="mt-4">
              <div className="mb-2 text-xs font-black text-slate-700">保存到文件夹</div>
              {paintingBatchFolderList.length > 0 ? (
                <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto pr-1">
                  {paintingBatchFolderList.map((folder) => (
                    <button
                      key={folder}
                      type="button"
                      onClick={() => {
                        setPaintingBatchFolder(folder);
                        setPaintingBatchFolderId(null);
                        saveLastVideoLibraryFolder(folder);
                      }}
                      disabled={paintingBatchCreating || paintingBatchConfirming}
                      className={cn(
                        'flex min-h-14 items-center gap-2 rounded-2xl border px-3 py-2 text-left text-xs font-bold transition-colors disabled:cursor-not-allowed',
                        paintingBatchFolder === folder
                          ? 'border-rose-400 bg-rose-50 text-rose-700 ring-2 ring-rose-100'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50/50'
                      )}
                    >
                      <FolderOpen className="size-4 shrink-0" />
                      <span className="break-all">{folder}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                  素材库还没有文件夹，将自动保存到「通用素材」。
                </div>
              )}
            </div>

            <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-xs leading-5 text-rose-700">
              {(() => {
                const effectiveIdeas = paintingBatchOnlyUnused
                  ? paintingBatchIdeas.filter((idea) => !isPaintingBatchIdeaUsed(idea, paintingVariationRound))
                  : paintingBatchIdeas;
                const effectiveCount = effectiveIdeas.length;
                let totalMinSeconds = 0;
                let totalMaxSeconds = 0;
                for (const idea of effectiveIdeas) {
                  const min = Number(idea.durationMin) || Number(paintingPlan.durationMin) || 0;
                  const max = Number(idea.durationMax) || Number(paintingPlan.durationMax) || 0;
                  totalMinSeconds += min > 0 ? min : 0;
                  totalMaxSeconds += max > 0 ? max : 0;
                }
                const ratePerSecond = getSeedanceRatePerSecond(SEEDANCE_BATCH_MODEL, SEEDANCE_BATCH_RESOLUTION);
                const costMin = ratePerSecond == null ? null : Number((totalMinSeconds * ratePerSecond).toFixed(2));
                const costMax = ratePerSecond == null ? null : Number((totalMaxSeconds * ratePerSecond).toFixed(2));
                const sameRange = totalMinSeconds === totalMaxSeconds;
                return (
                  <>
                    将生成 <b>{effectiveCount}</b> 条视频
                    {ratePerSecond == null ? (
                      <> · <b>暂无法估算费用</b></>
                    ) : (
                      <>
                        {' '}· 预计总时长 {sameRange ? <b>{totalMaxSeconds} 秒</b> : <b>{totalMinSeconds}～{totalMaxSeconds} 秒</b>}
                        {' '}· Mini <b>¥{ratePerSecond.toFixed(2)}/秒</b>
                        {' '}· 预计费用 {sameRange ? <b>¥{costMax.toFixed(2)}</b> : <b>¥{costMin.toFixed(2)}～¥{costMax.toFixed(2)}</b>}
                      </>
                    )}
                    {' '}· 方向 29 固定为 4～6 秒一镜到底。
                    {effectiveCount === 0 && <span className="mt-1 block font-bold text-red-600">当前轮次方向已全部使用，无法生成。</span>}
                    <span className="mt-1 block text-rose-500">{SEEDANCE_PRICING_NOTE}</span>
                  </>
                );
              })()}
            </div>

            {paintingBatchConfirming && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-600">
                <Loader2 className="size-4 animate-spin text-rose-500" />
                {paintingBatchPrepareStage || '正在确认批次是否已经创建'}
              </div>
            )}
            {paintingBatchUnconfirmed && (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                暂时无法确认批次是否创建成功。请先查看批量生成历史，系统不会自动创建第二个批次。
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              {paintingBatchUnconfirmed ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setPaintingBatchConfirmOpen(false);
                      void loadPaintingBatchRuns();
                      window.setTimeout(() => {
                        paintingBatchModuleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 80);
                    }}
                    className="h-10 rounded-full border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    查看批量历史
                  </button>
                  <button
                    type="button"
                    disabled={paintingBatchCreating || paintingBatchConfirming}
                    onClick={() => void handlePaintingConfirmBatch()}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-amber-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    重新确认
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={paintingBatchCreating || paintingBatchConfirming}
                    onClick={() => setPaintingBatchConfirmOpen(false)}
                    className="h-10 rounded-full border border-slate-200 bg-white px-5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={paintingBatchCreating || paintingBatchConfirming || paintingBatchIdeas.length === 0}
                    onClick={() => void handlePaintingConfirmBatch()}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-rose-600 px-5 text-xs font-bold text-white shadow-sm shadow-rose-200 hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                  >
                    {paintingBatchCreating || paintingBatchConfirming ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />}
                    {paintingBatchCreating ? '正在创建任务…' : paintingBatchConfirming ? '正在确认批次…' : '确认生成'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 上传历史记录弹窗 */}
      {showHistoryModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowHistoryModal(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <History className="size-4 text-slate-400" />
                <h3 className="text-sm font-black text-slate-800">
                  {historyModalKind === 'video' || historyModalKind === 'video-edit-video'
                    ? '最近上传的视频'
                    : historyModalKind === 'image-creative'
                      ? '最近上传的图片'
                      : '最近上传的图片'}
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                  {historyModalKind === 'video' || historyModalKind === 'video-edit-video'
                    ? videoHistory.length
                    : imageHistory.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {isUploadHistoryLoading ? (
                <div className="flex items-center justify-center gap-2 py-14 text-sm font-bold text-slate-400">
                  <Loader2 className="size-5 animate-spin text-indigo-500" />
                  正在读取历史记录
                </div>
              ) : (historyModalKind === 'video' || historyModalKind === 'video-edit-video') && (
                <>
                  {videoHistory.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-400">暂无视频记录</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {videoHistory.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "group relative cursor-pointer rounded-xl border bg-white p-2 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md",
                            historyPreviewItem?.kind === 'video'
                              && historyPreviewItem.source === (historyModalKind === 'video-edit-video' ? 'video-edit-video' : 'video')
                              && historyPreviewItem.id === item.id
                              ? 'border-indigo-300 ring-2 ring-indigo-100'
                              : 'border-slate-200'
                          )}
                          onClick={() => {
                            if (hoverPreviewTimerRef.current) {
                              clearTimeout(hoverPreviewTimerRef.current);
                              hoverPreviewTimerRef.current = null;
                            }
                            void openVideoHistoryPreview(item, historyModalKind === 'video-edit-video' ? 'video-edit-video' : 'video');
                          }}
                        >
                          <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-slate-950">
                            <HistoryVideoThumbnail
                              src={item.previewUrl}
                              name={item.name}
                            />
                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/5" />
                            <div className="absolute bottom-1.5 left-1.5 rounded bg-black/45 px-1.5 py-0.5 text-[10px] font-bold text-white/80">
                              {formatVideoDuration(historyVideoDurations[item.id])}
                            </div>
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                              <div className="flex size-9 items-center justify-center rounded-full bg-white/85 text-slate-900 shadow-sm">
                                <Film className="size-4" />
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-1">
                            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-600">{item.name}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteVideoHistory(item.id);
                              }}
                              className="shrink-0 rounded p-0.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-400">{formatHistoryTime(item.timestamp)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {!isUploadHistoryLoading && historyModalKind === 'image-creative' && (
                <>
                  {imageHistory.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-400">暂无图片记录</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                      {imageHistory.map((item) => (
                        <div
                          key={item.id}
                          className={cn(
                            "group relative cursor-pointer rounded-xl border bg-white p-2 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md",
                            historyPreviewItem?.kind === 'image' && historyPreviewItem.source === 'image-creative' && historyPreviewItem.id === item.id
                              ? 'border-indigo-300 ring-2 ring-indigo-100'
                              : 'border-slate-200'
                          )}
                          onClick={() => {
                            if (hoverPreviewTimerRef.current) {
                              clearTimeout(hoverPreviewTimerRef.current);
                              hoverPreviewTimerRef.current = null;
                            }
                            void openImageHistoryPreview(item, 'image-creative');
                          }}
                        >
                          <div className="relative overflow-hidden rounded-lg bg-slate-950">
                            <HistoryImageThumbnail
                              src={item.previewUrl}
                              name={item.name}
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-1">
                            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-600">{item.name}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteImageHistory(item.id);
                              }}
                              className="shrink-0 rounded p-0.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-400">{formatHistoryTime(item.timestamp)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {!isUploadHistoryLoading && (historyModalKind === 'image-seedance' || historyModalKind === 'video-edit-image') && (
                <>
                  {imageHistory.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-400">暂无图片记录</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                      {imageHistory.map((item) => (
                        <div
                          key={`img_${item.id}`}
                          className={cn(
                            "group relative cursor-pointer rounded-xl border bg-white p-2 shadow-sm transition-all hover:border-violet-200 hover:shadow-md",
                            historyPreviewItem?.kind === 'image'
                              && historyPreviewItem.source === (historyModalKind === 'video-edit-image' ? 'video-edit-image' : 'image-seedance')
                              && historyPreviewItem.id === item.id
                              ? 'border-violet-300 ring-2 ring-violet-100'
                              : 'border-slate-200'
                          )}
                          onClick={() => {
                            if (hoverPreviewTimerRef.current) {
                              clearTimeout(hoverPreviewTimerRef.current);
                              hoverPreviewTimerRef.current = null;
                            }
                            void openImageHistoryPreview(item, historyModalKind === 'video-edit-image' ? 'video-edit-image' : 'image-seedance');
                          }}
                        >
                          <div className="relative overflow-hidden rounded-lg bg-slate-950">
                            <HistoryImageThumbnail
                              src={item.previewUrl}
                              name={item.name}
                            />
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-1">
                            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-600">{item.name}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleDeleteImageHistory(item.id);
                              }}
                              className="shrink-0 rounded p-0.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                          <div className="text-[10px] text-slate-400">{formatHistoryTime(item.timestamp)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 搜索替换弹窗 */}
      {showSearchReplaceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { setReplaceResult(null); setShowSearchReplaceModal(false); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <Search className="size-4 text-slate-400" />
                <h3 className="text-sm font-black text-slate-800">搜索替换</h3>
              </div>
              <button
                type="button"
                onClick={() => { setReplaceResult(null); setShowSearchReplaceModal(false); }}
                className="flex size-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-4 p-5">
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-700">查找目标</label>
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="输入要查找的文本..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold text-slate-700">替换为</label>
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="输入替换后的文本..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </div>
              {replaceResult && (
                <div className="rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs font-bold text-emerald-600">
                  {replaceResult}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => { setReplaceResult(null); setShowSearchReplaceModal(false); }}
                className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSearchReplace}
                disabled={!searchText || !!replaceResult}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                替换
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 历史记录大预览层（Quick Look 风格） */}
      {historyPreviewItem && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center pointer-events-none">
          {/* 背景遮罩 */}
          <div className="pointer-events-auto absolute inset-0 bg-black/75" onClick={() => setHistoryPreviewItem(null)} />
          {/* 内容区域 - 接收鼠标事件 */}
          <div
            className="relative pointer-events-auto"
            onMouseEnter={() => {
              if (hoverPreviewTimerRef.current) {
                clearTimeout(hoverPreviewTimerRef.current);
                hoverPreviewTimerRef.current = null;
              }
            }}
            onDoubleClick={() => {
              void selectHistoryPreviewItem(historyPreviewItem);
            }}
          >
            <div className="relative flex max-h-[82vh] max-w-[85vw] items-center justify-center">
              {historyPreviewItem.kind === 'video' ? (
                <video
                  src={historyPreviewItem.previewUrl}
                  className="max-h-[78vh] max-w-[82vw] rounded-xl object-contain shadow-2xl"
                  autoPlay
                  loop
                  muted
                  controls
                  playsInline
                  onLoadedMetadata={(event) => rememberHistoryVideoDuration(historyPreviewItem.id, event.currentTarget.duration)}
                />
              ) : (
                <img
                  src={historyPreviewItem.previewUrl}
                  alt={historyPreviewItem.name}
                  className="max-h-[78vh] max-w-[82vw] rounded-xl object-contain shadow-2xl"
                />
              )}
              {/* 删除按钮 */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setHistoryPreviewItem(null);
                }}
                className="absolute -right-3 -top-3 flex size-7 items-center justify-center rounded-full bg-white text-slate-400 shadow-md transition-colors hover:bg-slate-50 hover:text-slate-700"
                title="关闭预览"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="mt-4 flex flex-col items-center gap-3 text-center">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold text-white backdrop-blur-sm">
                  {historyPreviewItem.name}
                </span>
                {historyPreviewItem.kind === 'video' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-bold text-white/85 backdrop-blur-sm">
                    <Clock className="size-3.5" />
                    视频时长 {formatVideoDuration(historyVideoDurations[historyPreviewItem.id])}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHistoryPreviewItem(null)}
                  className="rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20"
                >
                  继续浏览
                </button>
                <button
                  type="button"
                  onClick={() => void selectHistoryPreviewItem(historyPreviewItem)}
                  className="rounded-full bg-white px-5 py-2 text-xs font-black text-slate-900 shadow-lg transition-colors hover:bg-slate-100"
                >
                  选用此{historyPreviewItem.kind === 'video' ? '视频' : '图片'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
