export interface CreativeHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

interface CreativeConfigStatus {
  reachable: boolean;
  arkApiKey: boolean;
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

export function readImageAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败，请换一张再试。'));
    reader.readAsDataURL(file);
  });
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
    };
  } catch {
    return {
      reachable: false,
      arkApiKey: false,
    };
  }
}

export async function sendCreativeMessage(options: {
  question: string;
  image?: string;
  history: CreativeHistoryItem[];
  onDelta?: (text: string) => void;
}) {
  const response = await fetch('/api/doubao/multimodal', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
    },
    body: JSON.stringify({
      question: options.question,
      image: options.image || '',
      history: options.history,
      stream: true,
    }),
  });

  if (!response.ok) {
    let message = '豆包回答失败';
    try {
      const json = await response.json();
      if (json?.error) message = String(json.error);
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
