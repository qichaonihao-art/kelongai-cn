export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
}

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', description: 'Anthropic 最强推理模型' },
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
  }
): AsyncGenerator<string, void, unknown> {
  const response = await fetch('/api/chat/completions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options?.model || 'claude-opus-4-7',
      messages: toApiMessages(messages),
      stream: true,
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
      top_p: options?.topP,
    }),
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
