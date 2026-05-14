export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
  videos?: string[];
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  supportsMultimodal?: boolean;
  supportsWebSearch?: boolean;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', description: 'Anthropic 最强推理模型' },
  { id: 'doubao-seed-2-0-pro-260215', name: 'Doubao Seed 2.0 Pro', description: '字节跳动多模态大模型', supportsMultimodal: true, supportsWebSearch: true },
];

function toApiMessages(messages: ChatMessage[]) {
  return messages.map((msg) => {
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      return {
        role: msg.role,
        content: [
          { type: 'text', text: msg.content },
          ...msg.images.map((url) => ({ type: 'image_url', image_url: { url } })),
        ],
      };
    }
    return { role: msg.role, content: msg.content };
  });
}

export async function* streamChatCompletion(
  messages: ChatMessage[],
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    tools?: Array<{ type: string }>;
  }
): AsyncGenerator<string, void, unknown> {
  const model = options?.model || 'claude-opus-4-7';
  const isDoubao = model === 'doubao-seed-2-0-pro-260215';
  const endpoint = isDoubao ? '/api/chat/doubao' : '/api/chat/completions';

  const body: Record<string, unknown> = { model, stream: true };

  if (isDoubao) {
    body.messages = messages;
    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }
  } else {
    body.messages = toApiMessages(messages);
    if (typeof options?.temperature === 'number') body.temperature = options.temperature;
    if (typeof options?.maxTokens === 'number') body.max_tokens = options.maxTokens;
    if (typeof options?.topP === 'number') body.top_p = options.topP;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let msg = '对话请求失败';
    try {
      const json = await response.json();
      msg = json?.error || msg;
    } catch {
      msg = `HTTP ${response.status}`;
    }
    throw new Error(msg);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取响应流');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, '').trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta.length > 0) {
            yield delta;
          }
        } catch {
          // Ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}
