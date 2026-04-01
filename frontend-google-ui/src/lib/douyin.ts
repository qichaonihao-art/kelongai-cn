export interface DouyinResolveResult {
  ok: boolean;
  mode: 'stable' | 'high_quality';
  videoId: string;
  downloadUrl: string;
  videoData?: Record<string, unknown> | null;
  normalizedUrl?: string;
  sourceType: 'web_url' | 'short_share_text';
}

async function parseJsonSafely(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestDouyinDownload(input: string, mode: 'stable' | 'high_quality'): Promise<DouyinResolveResult> {
  const response = await fetch('/api/douyin/resolve-download', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input, mode }),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    const errorMessage = typeof json?.error === 'string' ? json.error : '抖音视频解析失败';
    const detailMessage = typeof json?.detail === 'string' ? json.detail : '';
    throw new Error(detailMessage && detailMessage !== errorMessage ? `${errorMessage} ${detailMessage}` : errorMessage);
  }

  return {
    ok: true,
    mode: json?.mode === 'high_quality' ? 'high_quality' : 'stable',
    videoId: String(json?.videoId || ''),
    downloadUrl: String(json?.downloadUrl || ''),
    videoData: json?.videoData && typeof json.videoData === 'object' ? json.videoData as Record<string, unknown> : null,
    normalizedUrl: typeof json?.normalizedUrl === 'string' ? json.normalizedUrl : '',
    sourceType: json?.sourceType === 'web_url' ? 'web_url' : 'short_share_text',
  };
}

export async function resolveDouyinDownload(input: string): Promise<DouyinResolveResult> {
  return requestDouyinDownload(input, 'stable');
}

export async function resolveDouyinHighQualityDownload(input: string): Promise<DouyinResolveResult> {
  return requestDouyinDownload(input, 'high_quality');
}
