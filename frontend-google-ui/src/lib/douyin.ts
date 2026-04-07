export interface DouyinResolveResult {
  ok: boolean;
  mode: 'stable';
  videoId: string;
  title?: string;
  downloadUrl: string;
  caption?: string;
  fallbackCaption?: string;
  fallbackCaptionSource?: 'none' | 'tikhub_caption';
  authorName?: string;
  videoData?: Record<string, unknown> | null;
  normalizedUrl?: string;
  sourceType: 'web_url' | 'short_share_text';
  resolveStrategy?: string;
}

export interface DouyinTranscriptResult {
  ok: boolean;
  transcriptOk: boolean;
  videoId: string;
  title?: string;
  downloadUrl: string;
  authorName?: string;
  normalizedUrl?: string;
  sourceType: 'web_url' | 'short_share_text';
  transcript: string;
  transcriptError?: string;
  transcriptSegments?: number;
  fallbackCaption?: string;
  fallbackCaptionSource?: 'none' | 'tikhub_caption';
  resolveStrategy?: string;
}

async function parseJsonSafely(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildErrorMessage(json: any, fallback: string) {
  const errorMessage = typeof json?.error === 'string' ? json.error : fallback;
  const detailMessage = typeof json?.detail === 'string' ? json.detail : '';
  return detailMessage && detailMessage !== errorMessage ? `${errorMessage} ${detailMessage}` : errorMessage;
}

export async function resolveDouyinDownload(input: string): Promise<DouyinResolveResult> {
  const response = await fetch('/api/douyin/resolve-download', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '抖音视频解析失败'));
  }

  return {
    ok: true,
    mode: 'stable',
    videoId: String(json?.videoId || ''),
    title: typeof json?.title === 'string' ? json.title : '',
    downloadUrl: String(json?.downloadUrl || ''),
    caption: typeof json?.caption === 'string' ? json.caption : '',
    fallbackCaption: typeof json?.fallbackCaption === 'string' ? json.fallbackCaption : '',
    fallbackCaptionSource: json?.fallbackCaptionSource === 'tikhub_caption' ? 'tikhub_caption' : 'none',
    authorName: typeof json?.authorName === 'string' ? json.authorName : '',
    videoData: json?.videoData && typeof json.videoData === 'object' ? json.videoData as Record<string, unknown> : null,
    normalizedUrl: typeof json?.normalizedUrl === 'string' ? json.normalizedUrl : '',
    sourceType: json?.sourceType === 'web_url' ? 'web_url' : 'short_share_text',
    resolveStrategy: typeof json?.resolveStrategy === 'string' ? json.resolveStrategy : '',
  };
}

export async function extractDouyinTranscript(input: string): Promise<DouyinTranscriptResult> {
  const response = await fetch('/api/douyin/extract-transcript', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '视频文案提取失败'));
  }

  return {
    ok: json?.ok !== false,
    transcriptOk: json?.transcriptOk === true,
    videoId: String(json?.videoId || ''),
    title: typeof json?.title === 'string' ? json.title : '',
    downloadUrl: String(json?.downloadUrl || ''),
    authorName: typeof json?.authorName === 'string' ? json.authorName : '',
    normalizedUrl: typeof json?.normalizedUrl === 'string' ? json.normalizedUrl : '',
    sourceType: json?.sourceType === 'web_url' ? 'web_url' : 'short_share_text',
    transcript: typeof json?.transcript === 'string' ? json.transcript : '',
    transcriptError: typeof json?.transcriptError === 'string' ? json.transcriptError : '',
    transcriptSegments: Number.isFinite(json?.transcriptSegments) ? Number(json.transcriptSegments) : 0,
    fallbackCaption: typeof json?.fallbackCaption === 'string' ? json.fallbackCaption : '',
    fallbackCaptionSource: json?.fallbackCaptionSource === 'tikhub_caption' ? 'tikhub_caption' : 'none',
    resolveStrategy: typeof json?.resolveStrategy === 'string' ? json.resolveStrategy : '',
  };
}
