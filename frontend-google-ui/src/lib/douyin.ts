export interface DouyinDownloadCandidate {
  url: string;
  source?: string;
  host?: string;
}

export interface DouyinResolveResult {
  ok: boolean;
  mode: 'stable';
  videoId: string;
  title?: string;
  downloadUrl: string;
  downloadUrlCandidates?: DouyinDownloadCandidate[];
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
  downloadUrlCandidates?: DouyinDownloadCandidate[];
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

export interface DouyinConfigStatus {
  reachable: boolean;
  siliconFlowApiKey: boolean;
  tikhubApiToken: boolean;
}

function buildDownloadFileName(videoId: string) {
  const safeVideoId = String(videoId || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .slice(0, 64);
  return `douyin_${safeVideoId || Date.now().toString(36)}.mp4`;
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

function readDownloadUrlCandidates(value: unknown): DouyinDownloadCandidate[] {
  if (!Array.isArray(value)) return [];

  const candidates: DouyinDownloadCandidate[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : '';
    if (!url) continue;

    candidates.push({
      url,
      source: typeof record.source === 'string' ? record.source : '',
      host: typeof record.host === 'string' ? record.host : '',
    });
  }

  return candidates;
}

export async function getDouyinConfigStatus(): Promise<DouyinConfigStatus> {
  try {
    const response = await fetch('/api/config/status', {
      credentials: 'include',
    });
    const json = await parseJsonSafely(response);

    if (!response.ok) {
      throw new Error(json?.error || '读取服务端配置失败');
    }

    return {
      reachable: true,
      siliconFlowApiKey: !!json?.serverManaged?.siliconFlowApiKey,
      tikhubApiToken: !!json?.serverManaged?.tikhubApiToken,
    };
  } catch {
    return {
      reachable: false,
      siliconFlowApiKey: false,
      tikhubApiToken: false,
    };
  }
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
    downloadUrlCandidates: readDownloadUrlCandidates(json?.downloadUrlCandidates),
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
    downloadUrlCandidates: readDownloadUrlCandidates(json?.downloadUrlCandidates),
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

export async function downloadDouyinVideoFile(params: {
  videoId: string;
  downloadUrl: string;
  downloadUrlCandidates?: DouyinDownloadCandidate[];
}) {
  const response = await fetch('/api/douyin/download-video', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      videoId: params.videoId,
      downloadUrl: params.downloadUrl,
      downloadUrlCandidates: params.downloadUrlCandidates || [],
    }),
  });

  if (!response.ok) {
    const json = await parseJsonSafely(response);
    throw new Error(buildErrorMessage(json, '视频下载失败'));
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = buildDownloadFileName(params.videoId);
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(objectUrl);
}
