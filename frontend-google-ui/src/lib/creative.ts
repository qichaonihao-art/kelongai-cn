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
  seedanceApiKey: boolean;
}

export interface SeedanceTaskResult {
  ok: boolean;
  taskId: string;
  status?: string;
  videoUrl?: string;
  createdAt?: number;
  updatedAt?: number;
  executionExpiresAfter?: number;
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
      payloadRecord?.error && typeof payloadRecord.error === 'object'
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
      seedanceApiKey: !!json?.serverManaged?.seedanceApiKey,
    };
  } catch {
    return {
      reachable: false,
      arkApiKey: false,
      seedanceApiKey: false,
    };
  }
}

export async function sendCreativeMessage(options: {
  question: string;
  media?: SelectedCreativeMedia | null;
  history: CreativeHistoryItem[];
  onDelta?: (text: string) => void;
}) {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream, application/json',
  };

  let body: BodyInit;
  if (options.media) {
    const formData = new FormData();
    formData.append('question', options.question);
    formData.append('history', JSON.stringify(options.history));
    formData.append('stream', 'true');
    formData.append('media_kind', options.media.kind);
    formData.append('file', options.media.file, options.media.fileName);
    body = formData;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({
      question: options.question,
      history: options.history,
      stream: true,
    });
  }

  const response = await fetch('/api/doubao/multimodal', {
    method: 'POST',
    credentials: 'include',
    headers,
    body,
  });

  if (!response.ok) {
    let message = `豆包回答失败（HTTP ${response.status}）`;
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
      throw new Error('模型已返回结果，但 answer 为空');
    }
    return answer;
  }

  const json = await response.json();
  const answer = String(json?.answer || '').trim();
  if (!answer) {
    throw new Error('模型已返回结果，但 answer 为空');
  }
  return answer;
}

export async function createSeedanceTask(options: {
  prompt: string;
  ratio: string;
  duration: number;
  generateAudio: boolean;
  watermark: boolean;
  references?: SeedanceReferenceFile[];
}): Promise<SeedanceTaskResult> {
  let headers: Record<string, string> | undefined = {
    'Content-Type': 'application/json',
  };
  let body: BodyInit;

  if (options.references?.length) {
    const formData = new FormData();
    formData.append('prompt', options.prompt);
    formData.append('model', 'doubao-seedance-2-0-260128');
    formData.append('ratio', options.ratio);
    formData.append('duration', String(options.duration));
    formData.append('generateAudio', String(options.generateAudio));
    formData.append('watermark', String(options.watermark));
    for (const reference of options.references) {
      formData.append('files', reference.file, reference.fileName);
    }
    headers = undefined;
    body = formData;
  } else {
    body = JSON.stringify({
      prompt: options.prompt,
      model: 'doubao-seedance-2-0-260128',
      ratio: options.ratio,
      duration: options.duration,
      generateAudio: options.generateAudio,
      watermark: options.watermark,
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
    let message = `Seedance 创建任务失败（HTTP ${response.status}）`;
    if (json?.error) {
      message = String(json.error);
    } else if (json?.upstream) {
      message = typeof json.upstream === 'string' ? json.upstream : JSON.stringify(json.upstream);
    }
    throw new Error(message);
  }

  return {
    ok: true,
    taskId: String(json?.taskId || json?.id || ''),
    status: typeof json?.status === 'string' ? json.status : undefined,
    videoUrl: typeof json?.videoUrl === 'string' ? json.videoUrl : undefined,
    createdAt: typeof json?.createdAt === 'number' ? json.createdAt : undefined,
    updatedAt: typeof json?.updatedAt === 'number' ? json.updatedAt : undefined,
    executionExpiresAfter: typeof json?.executionExpiresAfter === 'number' ? json.executionExpiresAfter : undefined,
    response: json?.response || json,
  };
}

export async function querySeedanceTask(taskId: string): Promise<SeedanceTaskResult> {
  const response = await fetch(`/api/seedance/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    credentials: 'include',
  });

  const json = await response.json().catch(() => null);
  if (!response.ok) {
    let message = `Seedance 查询任务失败（HTTP ${response.status}）`;
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
