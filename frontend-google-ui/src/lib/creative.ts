export interface CreativeHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface SelectedCreativeMedia {
  kind: 'image' | 'video';
  file: File;
  previewUrl: string;
  fileName: string;
}

export interface SeedanceReferenceFile {
  id: string;
  kind: 'image' | 'video' | 'audio';
  file: File;
  previewUrl?: string;
  fileName: string;
}

interface CreativeConfigStatus {
  reachable: boolean;
  arkApiKey: boolean;
  dashscopeApiKey: boolean;
  seedanceApiKey: boolean;
  minimaxApiKey: boolean;
  publicBaseUrl: boolean;
  doubaoMultimodalModel?: string;
  qwenMultimodalModel?: string;
}

export type CreativeReverseModel = 'doubao' | 'qwen';

export interface SeedanceTaskResult {
  ok: boolean;
  taskId: string;
  status?: string;
  videoUrl?: string;
  createdAt?: number;
  updatedAt?: number;
  errorMessage?: string;
  executionExpiresAfter?: number;
  directionNumber?: number;
  variationRound?: number;
  response: unknown;
}

function extractResponseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;

  if (typeof record.answer === 'string' && record.answer) return record.answer;
  if (typeof record.output_text === 'string' && record.output_text) return record.output_text;

  const response = record.response;
  if (response && typeof response === 'object') {
    const responseRecord = response as Record<string, unknown>;
    if (typeof responseRecord.output_text === 'string' && responseRecord.output_text) {
      return responseRecord.output_text;
    }
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const choiceRecord = choice as Record<string, unknown>;
    const message = choiceRecord.message;
    if (message && typeof message === 'object') {
      const messageRecord = message as Record<string, unknown>;
      if (typeof messageRecord.content === 'string' && messageRecord.content) {
        return messageRecord.content;
      }
    }
  }

  const containers = [record, response].filter(Boolean) as Array<Record<string, unknown>>;
  const parts: string[] = [];

  for (const item of containers) {
    if (typeof item.text === 'string' && item.text) {
      parts.push(item.text);
    }

    if (!Array.isArray(item.content)) continue;
    for (const contentItem of item.content) {
      if (!contentItem || typeof contentItem !== 'object') continue;
      const contentRecord = contentItem as Record<string, unknown>;
      if (typeof contentRecord.text === 'string' && contentRecord.text) {
        parts.push(contentRecord.text);
      }
    }
  }

  return parts.join('\n').trim();
}

function isReasoningEvent(value: unknown) {
  return /reason|think|analysis/i.test(String(value || ''));
}

function isDeltaEvent(value: unknown) {
  return /delta/i.test(String(value || ''));
}

function extractStreamDelta(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  if (isReasoningEvent(record.type)) return '';

  if (typeof record.delta === 'string') return record.delta;

  if (record.delta && typeof record.delta === 'object') {
    const deltaRecord = record.delta as Record<string, unknown>;
    if (!isReasoningEvent(deltaRecord.type) && typeof deltaRecord.text === 'string') {
      return deltaRecord.text;
    }
  }

  const choices = Array.isArray(record.choices) ? record.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const choiceRecord = choice as Record<string, unknown>;
    const delta = choiceRecord.delta;
    if (delta && typeof delta === 'object') {
      const deltaRecord = delta as Record<string, unknown>;
      if (typeof deltaRecord.content === 'string') {
        return deltaRecord.content;
      }
    }
  }

  const containers = [record.delta, record.item, record.data].filter(Boolean) as Array<Record<string, unknown>>;
  for (const item of containers) {
    if (isReasoningEvent(item.type)) continue;
    if (typeof item.text === 'string' && item.text) return item.text;
    if (!Array.isArray(item.content)) continue;
    for (const contentItem of item.content) {
      if (!contentItem || typeof contentItem !== 'object') continue;
      const contentRecord = contentItem as Record<string, unknown>;
      if (!isReasoningEvent(contentRecord.type) && typeof contentRecord.text === 'string') {
        return contentRecord.text;
      }
    }
  }

  return '';
}

function getIncrementalText(baseText: string, incomingText: string) {
  if (!incomingText) return '';
  if (!baseText) return incomingText;
  if (incomingText === baseText) return '';
  if (incomingText.startsWith(baseText)) return incomingText.slice(baseText.length);

  const maxOverlap = Math.min(baseText.length, incomingText.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (baseText.slice(-overlap) === incomingText.slice(0, overlap)) {
      return incomingText.slice(overlap);
    }
  }

  return incomingText;
}

function normalizeCompareText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[#*_`>\-\s]/g, '')
    .replace(/[，。、“”‘’；：:,.!?！？（）()【】\[\]《》<>]/g, '');
}

function normalizeDisplayText(value: string) {
  const raw = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';

  const lines = raw.split('\n').map((line) => line.trim());
  const deduped: string[] = [];

  for (const line of lines) {
    if (!line && deduped[deduped.length - 1] === '') continue;
    if (line && deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }

  const filtered: string[] = [];
  for (let i = 0; i < deduped.length; i += 1) {
    const current = deduped[i];
    if (!current) {
      filtered.push(current);
      continue;
    }

    const currentNormalized = normalizeCompareText(current);
    let duplicated = false;

    for (let span = 2; span <= 6; span += 1) {
      const nextLines = deduped.slice(i + 1, i + 1 + span).filter(Boolean);
      if (nextLines.length < span) continue;
      if (normalizeCompareText(nextLines.join('')) === currentNormalized) {
        duplicated = true;
        break;
      }
    }

    if (!duplicated) filtered.push(current);
  }

  return filtered.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function parseSseBlock(rawBlock: string) {
  const lines = rawBlock.split(/\r?\n/);
  let eventName = '';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const rawData = dataLines.join('\n').trim();
  if (!rawData) return null;
  if (rawData === '[DONE]') {
    return { done: true, event: eventName || 'done' };
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawData);
  } catch {
    return null;
  }

  const payloadRecord = payload as Record<string, unknown>;

  return {
    event: eventName || String(payloadRecord?.type || 'message'),
    done:
      payloadRecord?.type === 'response.completed' ||
      payloadRecord?.type === 'response.done' ||
      payloadRecord?.done === true,
    error:
      typeof payloadRecord?.error === 'string'
        ? payloadRecord.error
        : payloadRecord?.error && typeof payloadRecord.error === 'object'
          ? String((payloadRecord.error as Record<string, unknown>).message || '流式响应失败')
          : payloadRecord?.type === 'error'
            ? String(payloadRecord?.message || '流式响应失败')
            : '',
    delta: extractStreamDelta(payload),
    fullText: extractResponseText(payload),
  };
}

async function consumeStreamResponse(
  response: Response,
  onDelta?: (text: string) => void
) {
  if (!response.body) {
    throw new Error('当前环境不支持流式读取');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let finalTextCandidate = '';
  let sawDelta = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n/);
    buffer = chunks.pop() || '';

    for (const block of chunks) {
      const parsed = parseSseBlock(block);
      if (!parsed) continue;
      console.log('[creative sse] event', {
        event: parsed.event,
        done: parsed.done,
        hasDelta: !!parsed.delta,
        deltaPreview: parsed.delta ? parsed.delta.slice(0, 50) : '',
        hasFullText: !!parsed.fullText,
        fullTextPreview: parsed.fullText ? parsed.fullText.slice(0, 50) : ''
      });
      if (parsed.error) throw new Error(parsed.error);
      if (isReasoningEvent(parsed.event)) continue;

      if (parsed.fullText) {
        finalTextCandidate = parsed.fullText;
      }

      if (isDeltaEvent(parsed.event) && parsed.delta) {
        const nextDelta = getIncrementalText(answer, parsed.delta);
        if (!nextDelta) continue;
        sawDelta = true;
        answer += nextDelta;
        onDelta?.(answer);
      }

      if (parsed.done && parsed.fullText) {
        finalTextCandidate = parsed.fullText;
      }
    }
  }

  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }

  if (buffer.trim()) {
    const parsed = parseSseBlock(buffer);
    if (parsed) {
      if (parsed.error) throw new Error(parsed.error);
      if (!isReasoningEvent(parsed.event)) {
        if (parsed.fullText) {
          finalTextCandidate = parsed.fullText;
        }
        if (isDeltaEvent(parsed.event) && parsed.delta) {
          const nextDelta = getIncrementalText(answer, parsed.delta);
          if (nextDelta) {
            sawDelta = true;
            answer += nextDelta;
            onDelta?.(answer);
          }
        }
      }
    }
  }

  return normalizeDisplayText(finalTextCandidate || (!sawDelta ? answer : '') || answer).trim();
}

export function createMediaPreviewUrl(file: File) {
  try {
    return URL.createObjectURL(file);
  } catch {
    throw new Error(file.type.startsWith('video/') ? '视频预览生成失败，请换一个文件再试。' : '图片预览生成失败，请换一张再试。');
  }
}

export async function getCreativeConfigStatus(): Promise<CreativeConfigStatus> {
  try {
    const response = await fetch('/api/config/status', {
      credentials: 'include',
    });
    const json = await response.json();

    if (!response.ok) {
      throw new Error(json?.error || '读取服务端配置失败');
    }

    return {
      reachable: true,
      arkApiKey: !!json?.serverManaged?.arkApiKey,
      dashscopeApiKey: !!json?.serverManaged?.dashscopeApiKey,
      seedanceApiKey: !!json?.serverManaged?.seedanceApiKey,
      minimaxApiKey: !!json?.serverManaged?.minimaxApiKey,
      publicBaseUrl: !!json?.serverManaged?.publicBaseUrl,
      doubaoMultimodalModel: json?.serverManaged?.doubaoMultimodalModel || '',
      qwenMultimodalModel: json?.serverManaged?.qwenMultimodalModel || '',
    };
  } catch {
    return {
      reachable: false,
      arkApiKey: false,
      dashscopeApiKey: false,
      seedanceApiKey: false,
      minimaxApiKey: false,
      publicBaseUrl: false,
    };
  }
}

export async function sendCreativeMessage(options: {
  question: string;
  media?: SelectedCreativeMedia | SelectedCreativeMedia[] | null;
  history: CreativeHistoryItem[];
  onDelta?: (text: string) => void;
  model?: string;
  provider?: CreativeReverseModel;
  enableThinking?: boolean;
}) {
  const mediaArray = options.media
    ? Array.isArray(options.media)
      ? options.media
      : [options.media]
    : [];

  const buildRequest = (stream: boolean): { headers: Record<string, string>; body: BodyInit } => {
    const headers: Record<string, string> = {
      Accept: stream ? 'text/event-stream, application/json' : 'application/json',
    };

    if (mediaArray.length > 0) {
      const formData = new FormData();
      formData.append('question', options.question);
      formData.append('history', JSON.stringify(options.history));
      formData.append('stream', String(stream));
      if (options.model) {
        formData.append('model', options.model);
      }
      formData.append('enable_thinking', 'false');
      if (mediaArray.length === 1) {
        formData.append('media_kind', mediaArray[0].kind);
        formData.append('file', mediaArray[0].file, mediaArray[0].fileName);
      } else {
        const kinds: string[] = [];
        for (const media of mediaArray) {
          formData.append('files', media.file, media.fileName);
          kinds.push(media.kind);
        }
        formData.append('files_kinds', JSON.stringify(kinds));
      }
      return { headers, body: formData };
    }

    headers['Content-Type'] = 'application/json';
    return {
      headers,
      body: JSON.stringify({
        question: options.question,
        history: options.history,
        stream,
        enable_thinking: false,
        ...(options.model ? { model: options.model } : {}),
      }),
    };
  };

  const isRetriableNetworkError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '');
    return /network|fetch|failed|timeout|timed out|abort|terminated|connection|econn|socket|网络|连接|中断|超时/i.test(message);
  };

  const runRequest = async (stream: boolean) => {
    const { headers, body } = buildRequest(stream);
    const provider = options.provider || 'doubao';
    const providerLabel = provider === 'qwen' ? '千问' : '豆包';
    const response = await fetch(provider === 'qwen' ? '/api/qwen/multimodal' : '/api/doubao/multimodal', {
      method: 'POST',
      credentials: 'include',
      headers,
      body,
    });

    if (!response.ok) {
      let message = `${providerLabel}回答失败（HTTP ${response.status}）`;
      try {
        const json = await response.json();
        if (json?.error) {
          message = String(json.error);
          if (json?.debug?.stage) {
            message += `，阶段：${String(json.debug.stage)}`;
          }
        } else if (json?.upstream) {
          message = typeof json.upstream === 'string'
            ? json.upstream
            : JSON.stringify(json.upstream);
        }
      } catch {
        try {
          const text = await response.text();
          if (text) message = text;
        } catch {}
      }
      throw new Error(message);
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/event-stream')) {
      const answer = await consumeStreamResponse(response, options.onDelta);
      if (!answer) {
        throw new Error('模型已返回结果，但 answer 为空（SSE 流无内容）');
      }
      return answer;
    }

    const json = await response.json();
    const answer = String(json?.answer || '').trim();
    if (!answer) {
      const debugInfo = json?.debug
        ? `（响应字段：${json.debug.responseKeys?.join(', ') || '无'}）`
        : '';
      throw new Error(`模型已返回结果，但 answer 为空${debugInfo}`);
    }
    return answer;
  };

  try {
    return await runRequest(true);
  } catch (error) {
    if (!isRetriableNetworkError(error)) {
      throw error;
    }
    console.warn('[creative] stream request failed, retrying once with non-stream mode:', error);
    try {
      return await runRequest(false);
    } catch (retryError) {
      if (isRetriableNetworkError(retryError)) {
        const providerLabel = options.provider === 'qwen' ? '千问' : '豆包';
        throw new Error(`${providerLabel}连接偶发中断，已自动重试一次但仍未成功。请稍后再试。`);
      }
      throw retryError;
    }
  }
}

export async function createSeedanceTask(options: {
  productType?: PaintingProductType;
  model: 'doubao-seedance-2-0-260128' | 'doubao-seedance-2-0-fast-260128' | 'doubao-seedance-2-0-mini-260615' | 'doubao-seedance-2-5-260628' | 'MiniMax-H3' | 'wan3.0-video';
  taskMode?: 'generate' | 'video_edit';
  prompt: string;
  resolution: '480p' | '720p' | '768p' | '1080p' | '4k';
  ratio: string;
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
  references?: SeedanceReferenceFile[];
  imageHash?: string;
  directionNumber?: number;
  variationRound?: number;
}): Promise<SeedanceTaskResult> {
  let headers: Record<string, string> | undefined = {
    'Content-Type': 'application/json',
  };
  let body: BodyInit;

  if (options.references?.length) {
    const formData = new FormData();
    formData.append('prompt', options.prompt);
    if (options.productType) formData.append('productType', options.productType);
    formData.append('model', options.model);
    formData.append('taskMode', options.taskMode || 'generate');
    formData.append('resolution', options.resolution);
    formData.append('ratio', options.ratio);
    formData.append('duration', String(options.duration));
    formData.append('generateAudio', String(options.generateAudio));
    formData.append('watermark', String(options.watermark));
    if (options.imageHash) formData.append('imageHash', options.imageHash);
    if (options.directionNumber) formData.append('directionNumber', String(options.directionNumber));
    if (options.variationRound) formData.append('variationRound', String(options.variationRound));
    for (const reference of options.references) {
      formData.append('files', reference.file, reference.fileName);
    }
    headers = undefined;
    body = formData;
  } else {
    body = JSON.stringify({
      prompt: options.prompt,
      productType: options.productType,
      model: options.model,
      taskMode: options.taskMode || 'generate',
      resolution: options.resolution,
      ratio: options.ratio,
      duration: options.duration,
      generateAudio: options.generateAudio,
      watermark: options.watermark,
      imageHash: options.imageHash || undefined,
      directionNumber: options.directionNumber || undefined,
      variationRound: options.variationRound || undefined,
    });
  }

  const response = await fetch('/api/seedance/tasks', {
    method: 'POST',
    credentials: 'include',
    ...(headers ? { headers } : {}),
    body,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const providerLabel = options.model === 'MiniMax-H3' ? 'MiniMax H3' : options.model === 'wan3.0-video' ? 'Wan3.0 Video' : 'Seedance';
    let message = `${providerLabel} 创建任务失败（HTTP ${response.status}）`;
    if (json?.error) {
      message = String(json.error);
    } else if (json?.upstream) {
      message = typeof json.upstream === 'string' ? json.upstream : JSON.stringify(json.upstream);
    }
    throw new Error(message);
  }

  const taskId = String(json?.taskId || json?.id || '');
  if (!taskId) {
    const providerLabel = options.model === 'MiniMax-H3' ? 'MiniMax H3' : options.model === 'wan3.0-video' ? 'Wan3.0 Video' : 'Seedance';
    throw new Error(`${providerLabel} 创建任务失败：服务端未返回任务编号。`);
  }

  return {
    ok: true,
    taskId,
    status: typeof json?.status === 'string' ? json.status : undefined,
    videoUrl: typeof json?.videoUrl === 'string' ? json.videoUrl : undefined,
    createdAt: typeof json?.createdAt === 'number' ? json.createdAt : undefined,
    updatedAt: typeof json?.updatedAt === 'number' ? json.updatedAt : undefined,
    errorMessage: typeof json?.errorMessage === 'string' ? json.errorMessage : undefined,
    executionExpiresAfter: typeof json?.executionExpiresAfter === 'number' ? json.executionExpiresAfter : undefined,
    directionNumber: options.directionNumber,
    variationRound: options.variationRound,
    response: json?.response || json,
  };
}

export type PaintingProductType = 'hanging' | 'sticker';
export const getPaintingProductType = (profile?: PaintingProfile | null): PaintingProductType => profile?.productType === 'sticker' ? 'sticker' : 'hanging';
export const getPaintingProductLabel = (profile?: PaintingProfile | null) => getPaintingProductType(profile) === 'sticker' ? 'PVC背胶贴画' : '挂画／卷轴';

export interface PaintingProfile {
  productType?: PaintingProductType;
  widthCm?: number;
  heightCm?: number;
  name?: string;
  style?: string;
  subject?: string;
  colors?: string[];
  composition?: string;
  material?: string;
  frameStructure?: string;
  texture?: string;
  ratio?: string;
  atmosphere?: string;
  [key: string]: unknown;
}

export interface PaintingIdeaSummary {
  productType?: PaintingProductType;
  id: string;
  title: string;
  summary: string;
  directionNumber?: number;
  durationMin?: number;
  durationMax?: number;
}

export interface PaintingMaterialPlan {
  count: number;
  durationMin: number;
  durationMax: number;
  stylePreset: string;
  character: string;
  audio: string;
  ratio: string;
  scene: string;
  extraRequirements: string;
}

// —— 统一网络错误识别与中文转换（轮询重试与页面展示共用） ——

export const PAINTING_RETRIABLE_HTTP_STATUSES: ReadonlySet<number> = new Set([408, 429, 502, 503, 504]);

export class PaintingHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'PaintingHttpError';
    this.status = status;
  }
}

export function getPaintingHttpStatus(error: unknown): number | null {
  if (error instanceof PaintingHttpError) return error.status;
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

export function isPaintingNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /failed to fetch|networkerror|fetch failed|load failed|econnreset|econnrefused|network|网络|连接|中断/i.test(message);
}

export function isPaintingRetriableHttpStatus(status: number): boolean {
  return PAINTING_RETRIABLE_HTTP_STATUSES.has(status);
}

// 创建付费批次时，这些错误都代表“后端可能已经创建成功，但响应没有可靠到达前端”。
// 调用方必须保留原 creationRequestId 并先查询，不能换新编号直接重提。
export function isPaintingCreationOutcomeUnknown(error: unknown): boolean {
  const status = getPaintingHttpStatus(error);
  return isPaintingNetworkFailure(error) || (status != null && isPaintingRetriableHttpStatus(status));
}

export function paintingRetryBackoffMs(consecutiveFailures: number): number {
  // 递增退避：1s, 2s, 4s, 8s（封顶 8s）。
  return Math.min(8000, 1000 * Math.pow(2, Math.max(0, consecutiveFailures - 1)));
}

// 把底层网络错误转成用户能理解的中文提示；开发日志可保留原始错误，用户界面绝不展示 Failed to fetch。
export function describePaintingNetworkError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error || '');
  const status = getPaintingHttpStatus(error);
  if (isPaintingNetworkFailure(error)) {
    return '网络连接暂时中断，已完成的准备进度已保留。你可以点击继续，系统不会重复创建已完成的任务。';
  }
  if (status === 504 || /504|gateway timeout/i.test(message)) {
    return '代理超时（504），已完成的准备进度已保留，请稍后重试。';
  }
  if (status === 401 || /401|登录|鉴权|unauthorized/i.test(message)) {
    return '登录状态已失效，请重新登录后再试。';
  }
  return message || fallback;
}

const PAINTING_TASK_POLL_RETRY_LIMIT = 5;

// 生成幂等请求编号：格式满足后端校验（8-128 位字母/数字/._-）。
export function generatePaintingRequestId(prefix: string): string {
  const random = Array.from({ length: 10 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const ts = Date.now().toString(36);
  const id = `${prefix}-${ts}-${random}`;
  return id.length > 128 ? id.slice(0, 128) : id;
}

export async function waitForPaintingTask<T>(taskId: string, fallbackError: string): Promise<T> {
  const startedAt = Date.now();
  const timeoutMs = 10 * 60 * 1000;
  let consecutiveFailures = 0;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    let response: Response;
    try {
      response = await fetch(`/api/painting/tasks/${encodeURIComponent(taskId)}`, {
        credentials: 'include',
      });
    } catch (error) {
      // 浏览器断网 / 代理中断：单次轮询失败不能立即终止整个任务，退避重试。
      consecutiveFailures += 1;
      if (consecutiveFailures > PAINTING_TASK_POLL_RETRY_LIMIT) {
        throw new Error(`${fallbackError}：网络连接暂时中断，已自动重试 ${PAINTING_TASK_POLL_RETRY_LIMIT} 次仍未成功，请检查网络后重试。`);
      }
      await new Promise((resolve) => setTimeout(resolve, paintingRetryBackoffMs(consecutiveFailures)));
      continue;
    }
    const json = await response.json().catch(() => null);
    if (response.ok) {
      // 成功一次后重置连续失败次数。
      consecutiveFailures = 0;
      if (json?.status === 'failed') {
        throw new Error(String(json?.error || fallbackError));
      }
      if (json?.status === 'done') {
        return (json?.result || {}) as T;
      }
      continue;
    }
    if (isPaintingRetriableHttpStatus(response.status)) {
      consecutiveFailures += 1;
      if (consecutiveFailures > PAINTING_TASK_POLL_RETRY_LIMIT) {
        throw new Error(`${fallbackError}：服务暂时不可用（HTTP ${response.status}），已自动重试 ${PAINTING_TASK_POLL_RETRY_LIMIT} 次仍未成功，请稍后重试。`);
      }
      await new Promise((resolve) => setTimeout(resolve, paintingRetryBackoffMs(consecutiveFailures)));
      continue;
    }
    // 400/401/403 等业务/鉴权错误不盲目重试。
    throw new Error(String(json?.error || `${fallbackError}（HTTP ${response.status}）`));
  }
  throw new Error(`${fallbackError}：后台处理超过 10 分钟，请稍后重试。`);
}

export async function analyzePainting(file: File, productType: PaintingProductType = 'hanging', widthCm = 180, heightCm = 60): Promise<PaintingProfile> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('productType', productType);
  if (productType === 'sticker') {
    formData.append('widthCm', String(widthCm));
    formData.append('heightCm', String(heightCm));
  }

  const response = await fetch('/api/painting/analyze', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    let message = `挂画分析失败（HTTP ${response.status}）`;
    if (json?.error) {
      message = String(json.error);
    }
    throw new Error(message);
  }

  const taskId = String(json?.taskId || '');
  if (!taskId) throw new Error('挂画分析任务创建失败：服务端未返回任务编号。');
  const result = await waitForPaintingTask<{ profile?: PaintingProfile }>(taskId, '挂画分析失败');
  return result.profile && typeof result.profile === 'object'
    ? result.profile
    : {};
}

export interface PaintingIdeasResult {
  ideas: PaintingIdeaSummary[];
  batch: number;
  totalBatches: number;
}

export async function generatePaintingIdeas(
  profile: PaintingProfile,
  plan: PaintingMaterialPlan,
  batch = 0,
  options?: { variationRound?: number; avoidIdeas?: string[]; clientRequestId?: string }
): Promise<PaintingIdeasResult> {
  const response = await fetch('/api/painting/ideas', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile,
      plan,
      batch,
      variationRound: options?.variationRound || 0,
      avoidIdeas: options?.avoidIdeas || [],
      ...(options?.clientRequestId ? { clientRequestId: options.clientRequestId } : {}),
    }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    // 幂等编号对应的后台任务已失效（服务重启/过期）：明确返回，绝不假装任务仍在执行。
    if (response.status === 410 && json?.invalidated) {
      throw new Error('任务已失效，需要重新生成当前批次。');
    }
    let message = `创意方案生成失败（HTTP ${response.status}）`;
    if (json?.error) {
      message = String(json.error);
    }
    throw new Error(message);
  }

  const taskId = String(json?.taskId || '');
  if (!taskId) throw new Error('创意方案任务创建失败：服务端未返回任务编号。');

  // 幂等命中且原任务已完成：后端直接带回结果，无需再轮询。
  if (json?.deduplicated === true && json?.result) {
    const result = json.result as PaintingIdeasResult;
    return {
      ideas: Array.isArray(result?.ideas) ? result.ideas : [],
      batch: Number.isFinite(Number(result?.batch)) ? Number(result.batch) : batch,
      totalBatches: Number.isFinite(Number(result?.totalBatches)) ? Number(result.totalBatches) : 1,
    };
  }

  const result = await waitForPaintingTask<PaintingIdeasResult>(taskId, '创意方案生成失败');
  return {
    ideas: Array.isArray(result?.ideas) ? result.ideas : [],
    batch: Number.isFinite(Number(result?.batch)) ? Number(result.batch) : batch,
    totalBatches: Number.isFinite(Number(result?.totalBatches)) ? Number(result.totalBatches) : 1,
  };
}

export async function generatePaintingIdeaPrompt(
  profile: PaintingProfile,
  idea: PaintingIdeaSummary,
  context?: {
    durationMin?: number;
    durationMax?: number;
    ratio?: string;
    stylePreset?: string;
    character?: string;
    audio?: string;
    scene?: string;
    extraRequirements?: string;
    elementVariationIndex?: number;
    previousPrompt?: string;
  }
): Promise<{ prompt: string; duration: number }> {
  const response = await fetch('/api/painting/idea-prompt', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, idea, ...(context || {}) }),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    let message = `完整提示词生成失败（HTTP ${response.status}）`;
    if (json?.error) {
      message = String(json.error);
    }
    throw new Error(message);
  }

  // 完整提示词可能因质量检查触发二次生成，耗时会超过反向代理的同步请求窗口。
  // 服务端改为后台任务后在这里统一轮询，避免“自动生成视频”按钮一直转圈。
  if (response.status === 202 || json?.taskId) {
    const taskId = String(json?.taskId || '');
    if (!taskId) throw new Error('完整提示词任务创建失败：服务端未返回任务编号。');
    const result = await waitForPaintingTask<{ prompt?: string; duration?: number }>(taskId, '完整提示词生成失败');
    const prompt = String(result?.prompt || '').trim();
    if (!prompt) throw new Error('完整提示词生成失败：后台任务返回内容为空。');
    const parsedDuration = Number(result?.duration);
    const fallbackDuration =
      context?.durationMin && context?.durationMax
        ? Math.round((context.durationMin + context.durationMax) / 2)
        : 8;
    return {
      prompt,
      duration: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : fallbackDuration,
    };
  }

  const prompt = String(json?.prompt || '').trim();
  const parsedDuration = Number(json?.duration);
  const fallbackDuration =
    context?.durationMin && context?.durationMax
      ? Math.round((context.durationMin + context.durationMax) / 2)
      : 8;
  return {
    prompt,
    duration: Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : fallbackDuration,
  };
}

export async function querySeedanceTask(taskId: string): Promise<SeedanceTaskResult> {
  const response = await fetch(`/api/seedance/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    credentials: 'include',
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const providerLabel = taskId.startsWith('minimax-h3_') ? 'MiniMax H3' : taskId.startsWith('wan3_') ? 'Wan3.0 Video' : 'Seedance';
    let message = `${providerLabel} 查询任务失败（HTTP ${response.status}）`;
    if (json?.error) {
      message = String(json.error);
    } else if (json?.upstream) {
      message = typeof json.upstream === 'string' ? json.upstream : JSON.stringify(json.upstream);
    }
    throw new Error(message);
  }

  return {
    ok: true,
    taskId: String(json?.taskId || taskId),
    status: typeof json?.status === 'string' ? json.status : undefined,
    videoUrl: typeof json?.videoUrl === 'string' ? json.videoUrl : undefined,
    createdAt: typeof json?.createdAt === 'number' ? json.createdAt : undefined,
    updatedAt: typeof json?.updatedAt === 'number' ? json.updatedAt : undefined,
    executionExpiresAfter: typeof json?.executionExpiresAfter === 'number' ? json.executionExpiresAfter : undefined,
    response: json?.response || json,
  };
}

export type PaintingBatchTaskStatus =
  | 'queued'
  | 'generating_prompt'
  | 'prompt_ready'
  | 'submitting_seedance'
  | 'seedance_submitted'
  | 'rendering'
  | 'video_succeeded'
  | 'saving_to_library'
  | 'completed'
  | 'retry_waiting'
  | 'failed'
  | 'paused'
  | 'stopped'
  | 'needs_review';

export interface PaintingBatchTask {
  id: number;
  batchRunId: string;
  directionNumber: number;
  batchIndex: number;
  variationRound: number;
  ideaId: string;
  ideaTitle: string;
  ideaSummary: string;
  duration: number;
  seedanceTaskId: string;
  videoUrl: string;
  libraryItemId: number | null;
  libraryItem: Record<string, unknown> | null;
  status: PaintingBatchTaskStatus;
  retryCount: number;
  saveRetryCount: number;
  errorMessage: string;
  diversityLedger: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface PaintingBatchRun {
  id: number;
  batchRunId: string;
  paintingName: string;
  profile: PaintingProfile;
  plan: PaintingMaterialPlan;
  imageHash: string;
  uploadHistoryId: number | null;
  stylePreset: string;
  model: string;
  resolution: string;
  ratio: string;
  generateAudio: boolean;
  watermark: boolean;
  variationRound: number;
  totalDirections: number;
  targetFolderId: number | null;
  targetFolderName: string;
  status: PaintingBatchTaskStatus | 'running' | 'completed' | 'failed' | 'paused' | 'stopped' | 'needs_review';
  controlStatus: 'running' | 'paused' | 'stopping' | 'stopped';
  options: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface PaintingBatchRunCounts {
  total: number;
  completed: number;
  failed: number;
  needsReview: number;
  stopped: number;
  rendering: number;
  generatingPrompt: number;
}

export interface PaintingBatchRunDetail {
  ok: boolean;
  run: PaintingBatchRun;
  tasks: PaintingBatchTask[];
  counts: PaintingBatchRunCounts;
}

export interface PaintingFolderBinding {
  id: number;
  paintingName: string;
  uploadHistoryId: number | null;
  imageHash: string;
  folderId: number;
  folderName: string;
  createdAt: number;
  updatedAt: number;
}

export interface PaintingBatchRunEstimate {
  model: string;
  resolution: string;
  ratePerSecond: number | null;
  currency: string;
  pricingNote: string;
}

// 全自动批量只开放成本较低的四个模型；稳定版与 2.5 不进入批量付费入口。
export const SEEDANCE_BATCH_MODEL = 'doubao-seedance-2-0-mini-260615';
export const SEEDANCE_BATCH_RESOLUTION = '720p';
export const SEEDANCE_BATCH_MODEL_OPTIONS = [
  { value: 'doubao-seedance-2-0-mini-260615', label: 'Seedance 2.0 Mini' },
  { value: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast' },
  { value: 'MiniMax-H3', label: 'MiniMax H3' },
  { value: 'wan3.0-video', label: '千问 Wan3.0 Video' },
] as const;
export function getPaintingBatchResolutionOptions(model: string): readonly string[] {
  return model === 'MiniMax-H3' ? ['768p'] : ['480p', '720p'];
}
export const SEEDANCE_PRICING_NOTE = '费用按所选模型、分辨率与时长估算，实际以平台账单为准。';

// 按秒估算单价（元/秒），与后端 getSeedanceRatePerSecond 保持一致。
export function getSeedanceRatePerSecond(model: string, resolution = '720p'): number | null {
  const res = String(resolution || '720p').toLowerCase();
  if (model === 'MiniMax-H3') return res === '768p' ? 0.5 : null;
  if (model === 'doubao-seedance-2-0-mini-260615') return res === '480p' ? 0.1 : res === '720p' ? 0.2 : null;
  if (model === 'doubao-seedance-2-0-fast-260128') return res === '480p' ? 0.278 : res === '720p' ? 0.598 : null;
  if (model === 'doubao-seedance-2-0-260128') return res === '480p' ? 0.46 : res === '720p' ? 1.0 : null;
  if (model === 'doubao-seedance-2-5-260628') return res === '720p' ? 1.5 : null;
  if (model === 'wan3.0-video') return res === '480p' ? 0.21 : res === '720p' ? 0.42 : res === '1080p' ? 0.84 : null;
  return null;
}

export interface CreatePaintingBatchRunOptions {
  file: File;
  upperWoodFile?: File | null;
  lowerWoodFile?: File | null;
  profile: PaintingProfile;
  plan: PaintingMaterialPlan;
  ideas: PaintingIdeaSummary[];
  totalDirections: number;
  startOrder: string;
  requestedCount: number;
  model: string;
  resolution: string;
  ratio: string;
  variationRound: number;
  generateAudio: boolean;
  watermark: boolean;
  stylePreset: string;
  uploadHistoryId?: number | null;
  targetFolderId?: number | null;
  targetFolderName?: string;
  onlyUnused?: boolean;
  autoEnhance480p?: boolean;
  creationRequestId: string;
}

async function readJsonError(response: Response, fallback: string): Promise<PaintingHttpError> {
  let message = fallback;
  try {
    const json = await response.json();
    if (json?.error) {
      message = String(json.error);
    } else if (json?.upstream) {
      message = typeof json.upstream === 'string' ? json.upstream : JSON.stringify(json.upstream);
    }
  } catch {}
  return new PaintingHttpError(message, response.status);
}

export async function getPaintingBatchRunEstimate(options: {
  model?: string;
  resolution?: string;
}): Promise<PaintingBatchRunEstimate> {
  const params = new URLSearchParams();
  if (options.model) params.set('model', options.model);
  if (options.resolution) params.set('resolution', options.resolution);
  const response = await fetch(`/api/painting/batch-runs/estimate?${params.toString()}`, {
    credentials: 'include',
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `批量任务估算失败（HTTP ${response.status}）`);
  }
  return (json?.estimate || {}) as PaintingBatchRunEstimate;
}

export async function createPaintingBatchRun(options: CreatePaintingBatchRunOptions): Promise<{
  batchRunId: string;
  status: string;
  controlStatus: string;
  totalDirections: number;
  taskCount: number;
  deduplicated: boolean;
  targetFolderId: number | null;
  targetFolderName: string;
}> {
  const formData = new FormData();
  formData.append('file', options.file, options.file.name);
  if (getPaintingProductType(options.profile) !== 'sticker') {
    if (options.upperWoodFile) formData.append('upperWoodFile', options.upperWoodFile, options.upperWoodFile.name);
    if (options.lowerWoodFile) formData.append('lowerWoodFile', options.lowerWoodFile, options.lowerWoodFile.name);
  }
  formData.append('profile', JSON.stringify(options.profile));
  formData.append('plan', JSON.stringify(options.plan));
  formData.append('ideas', JSON.stringify(options.ideas));
  formData.append('totalDirections', String(options.totalDirections));
  formData.append('startOrder', options.startOrder);
  formData.append('requestedCount', String(options.requestedCount));
  formData.append('model', options.model);
  formData.append('resolution', options.resolution);
  formData.append('ratio', options.ratio);
  formData.append('variationRound', String(options.variationRound));
  formData.append('generateAudio', String(options.generateAudio));
  formData.append('watermark', String(options.watermark));
  formData.append('stylePreset', options.stylePreset);
  formData.append('creationRequestId', options.creationRequestId);
  if (options.uploadHistoryId) {
    formData.append('uploadHistoryId', String(options.uploadHistoryId));
  }
  if (options.targetFolderId) {
    formData.append('targetFolderId', String(options.targetFolderId));
  }
  if (options.targetFolderName) {
    formData.append('targetFolderName', options.targetFolderName);
  }
  formData.append('onlyUnused', String(options.onlyUnused === true));
  formData.append('autoEnhance480p', String(options.autoEnhance480p === true));

  const response = await fetch('/api/painting/batch-runs', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `创建批量任务失败（HTTP ${response.status}）`);
  }

  const batchRunId = String(json?.batchRunId || '');
  if (!batchRunId) {
    throw new Error('创建批量任务失败：服务端未返回任务编号。');
  }

  return {
    batchRunId,
    status: String(json?.status || ''),
    controlStatus: String(json?.controlStatus || ''),
    totalDirections: Number(json?.totalDirections) || 0,
    taskCount: Number(json?.taskCount) || 0,
    deduplicated: json?.deduplicated === true,
    targetFolderId: json?.targetFolderId ?? null,
    targetFolderName: String(json?.targetFolderName || ''),
  };
}

export async function getPaintingBatchRun(batchRunId: string): Promise<PaintingBatchRunDetail> {
  const response = await fetch(`/api/painting/batch-runs/${encodeURIComponent(batchRunId)}`, {
    credentials: 'include',
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `读取批量任务失败（HTTP ${response.status}）`);
  }
  return {
    ok: true,
    run: (json?.run || {}) as PaintingBatchRun,
    tasks: (Array.isArray(json?.tasks) ? json.tasks : []) as PaintingBatchTask[],
    counts: (json?.counts || {}) as PaintingBatchRunCounts,
  };
}

export async function getPaintingBatchRunByRequest(requestId: string): Promise<{ found: boolean; detail?: PaintingBatchRunDetail }> {
  const response = await fetch(`/api/painting/batch-runs/by-request/${encodeURIComponent(requestId)}`, {
    credentials: 'include',
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `按请求编号查询批次失败（HTTP ${response.status}）`);
  }
  if (!json?.found) {
    return { found: false };
  }
  return {
    found: true,
    detail: {
      ok: true,
      run: (json?.run || {}) as PaintingBatchRun,
      tasks: (Array.isArray(json?.tasks) ? json.tasks : []) as PaintingBatchTask[],
      counts: (json?.counts || {}) as PaintingBatchRunCounts,
    },
  };
}

export async function listPaintingBatchRuns(): Promise<PaintingBatchRun[]> {
  const response = await fetch('/api/painting/batch-runs', {
    credentials: 'include',
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `读取批量任务列表失败（HTTP ${response.status}）`);
  }
  return (Array.isArray(json?.runs) ? json.runs : []) as PaintingBatchRun[];
}

export async function deletePaintingBatchRun(batchRunId: string): Promise<void> {
  const response = await fetch(`/api/painting/batch-runs/${encodeURIComponent(batchRunId)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) {
    throw await readJsonError(response, `删除批量生成历史失败（HTTP ${response.status}）`);
  }
}

async function postPaintingBatchRunAction(batchRunId: string, action: 'pause' | 'resume' | 'stop'): Promise<void> {
  const response = await fetch(`/api/painting/batch-runs/${encodeURIComponent(batchRunId)}/${action}`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!response.ok) {
    throw await readJsonError(response, `批量任务操作失败（HTTP ${response.status}）`);
  }
}

export function pausePaintingBatchRun(batchRunId: string): Promise<void> {
  return postPaintingBatchRunAction(batchRunId, 'pause');
}

export function resumePaintingBatchRun(batchRunId: string): Promise<void> {
  return postPaintingBatchRunAction(batchRunId, 'resume');
}

export function stopPaintingBatchRun(batchRunId: string): Promise<void> {
  return postPaintingBatchRunAction(batchRunId, 'stop');
}

export async function retryPaintingBatchTask(taskId: number): Promise<{ taskId: number; status: string }> {
  const response = await fetch(`/api/painting/batch-tasks/${taskId}/retry`, {
    method: 'POST',
    credentials: 'include',
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `查询原任务失败（HTTP ${response.status}）`);
  }
  return {
    taskId: Number(json?.taskId) || taskId,
    status: String(json?.status || ''),
  };
}

export async function resubmitPaintingBatchTask(taskId: number, options?: { confirm?: boolean }): Promise<{ taskId: number; status: string }> {
  const response = await fetch(`/api/painting/batch-tasks/${taskId}/resubmit`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: options?.confirm === true }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `重新提交任务失败（HTTP ${response.status}）`);
  }
  return {
    taskId: Number(json?.taskId) || taskId,
    status: String(json?.status || ''),
  };
}

export async function getPaintingUsedDirections(imageHash: string, variationRound: number, productType: PaintingProductType = 'hanging'): Promise<number[]> {
  const params = new URLSearchParams();
  params.set('imageHash', imageHash);
  params.set('variationRound', String(variationRound));
  params.set('productType', productType);
  const response = await fetch(`/api/painting/used-directions?${params.toString()}`, {
    credentials: 'include',
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `读取已使用方向失败（HTTP ${response.status}）`);
  }
  return (Array.isArray(json?.usedDirections) ? json.usedDirections : []).map(Number);
}

export async function sha256File(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function getPaintingFolderBinding(imageHash: string, paintingName?: string): Promise<PaintingFolderBinding | null> {
  const params = new URLSearchParams();
  if (paintingName?.trim()) params.set('paintingName', paintingName.trim());
  const query = params.toString();
  const response = await fetch(`/api/painting/folder-binding/${encodeURIComponent(imageHash)}${query ? `?${query}` : ''}`, {
    credentials: 'include',
  });
  if (response.status === 404) {
    return null;
  }
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `读取挂画文件夹绑定失败（HTTP ${response.status}）`);
  }
  return (json?.binding || null) as PaintingFolderBinding | null;
}

export async function setPaintingFolderBinding(options: {
  paintingName?: string;
  uploadHistoryId?: number | null;
  imageHash: string;
  folderId?: number | null;
  folderName?: string;
}): Promise<{ folderId: number; folderName: string }> {
  const response = await fetch('/api/painting/folder-binding', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw await readJsonError(response, `保存挂画文件夹绑定失败（HTTP ${response.status}）`);
  }
  return {
    folderId: Number(json?.folderId) || 0,
    folderName: String(json?.folderName || ''),
  };
}
