export interface DouyinResolveResult {
  ok: boolean;
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
    throw new Error(json?.error || '抖音视频解析失败');
  }

  return {
    ok: true,
    videoId: String(json?.videoId || ''),
    downloadUrl: String(json?.downloadUrl || ''),
    videoData: json?.videoData && typeof json.videoData === 'object' ? json.videoData as Record<string, unknown> : null,
    normalizedUrl: typeof json?.normalizedUrl === 'string' ? json.normalizedUrl : '',
    sourceType: json?.sourceType === 'web_url' ? 'web_url' : 'short_share_text',
  };
}
