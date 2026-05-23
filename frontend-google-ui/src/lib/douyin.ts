import { sendCreativeMessage } from './creative';

export interface DouyinDownloadCandidate {
  url: string;
  source?: string;
  host?: string;
  hasAudio?: boolean;
}

export interface DouyinResolveResult {
  ok: boolean;
  mode: 'stable';
  videoId: string;
  title?: string;
  desc?: string;
  downloadUrl: string;
  downloadUrlCandidates?: DouyinDownloadCandidate[];
  videoUrls?: string[];
  videoUrlCandidates?: DouyinDownloadCandidate[];
  caption?: string;
  fallbackCaption?: string;
  fallbackCaptionSource?: 'none' | 'tikhub_caption';
  authorName?: string;
  duration?: number;
  videoData?: Record<string, unknown> | null;
  normalizedUrl?: string;
  sourceType: 'web_url' | 'short_share_text' | 'local_upload' | 'universal';
  resolveStrategy?: string;
  platform?: string;
  images?: string[];
  tags?: string[];
  sourceUrl?: string;
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
  sourceType: 'web_url' | 'short_share_text' | 'local_upload' | 'universal';
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
  arkApiKey: boolean;
  dashscopeApiKey: boolean;
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
      ...(typeof record.hasAudio === 'boolean' ? { hasAudio: record.hasAudio } : {}),
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
      arkApiKey: !!json?.serverManaged?.arkApiKey,
      dashscopeApiKey: !!json?.serverManaged?.dashscopeApiKey,
    };
  } catch {
    return {
      reachable: false,
      siliconFlowApiKey: false,
      tikhubApiToken: false,
      arkApiKey: false,
      dashscopeApiKey: false,
    };
  }
}

// ===================== CopyPilot API =====================

function extractVideoIdFromData(data: any): string {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data;
  return String(detail?.aweme_id || detail?.video_id || detail?.id || data?.note?.id || Date.now());
}

function extractTitleFromData(data: any): string {
  return data?.title || data?.desc || data?.aweme_detail?.desc || data?.itemInfo?.itemStruct?.desc || data?.note?.title || '';
}

function extractAuthorFromData(data: any): string {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data;
  return detail?.author?.nickname || detail?.author?.unique_id || detail?.author_name || data?.author?.nickname || data?.note?.user?.nickname || '';
}

function extractDurationFromData(data: any): number {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data;
  const video = detail?.video || data?.video || {};
  const candidates = [
    data?.lengthSeconds, data?.durationSeconds, data?.duration, data?.duration_sec,
    detail?.lengthSeconds, detail?.durationSeconds, detail?.duration, detail?.duration_sec,
    video?.duration, video?.duration_ms, video?.lengthSeconds
  ];
  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    return numeric > 10000 ? numeric / 1000 : numeric;
  }
  return 0;
}

function extractVideoUrlsFromData(data: any): string[] {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data || {};
  const video = detail.video || data?.video || {};
  const links: string[] = [];
  if (video.play_addr?.url_list?.length) links.push(...video.play_addr.url_list);
  if (video.download_addr?.url_list?.length) links.push(...video.download_addr.url_list);
  if (detail.video_url) links.push(detail.video_url);
  if (data?.video_url) links.push(data.video_url);
  if (data?.videos?.items?.length) {
    const sorted = [...data.videos.items].sort((a: any, b: any) => Number(b.hasAudio) - Number(a.hasAudio));
    links.push(...sorted.map((item: any) => item.url));
  }
  return [...new Set(links)].filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
}

function extractCandidatesFromData(data: any): DouyinDownloadCandidate[] {
  const items = data?.videos?.items || [];
  if (!Array.isArray(items)) return [];
  const candidates: DouyinDownloadCandidate[] = [];
  for (const item of items) {
    if (!item?.url) continue;
    candidates.push({
      url: String(item.url),
      source: String(item.source || item.type || ''),
      host: String(item.host || ''),
      ...(typeof item.hasAudio === 'boolean' ? { hasAudio: item.hasAudio } : {}),
    });
  }
  // Also add play_addr / download_addr URLs
  const urls = extractVideoUrlsFromData(data);
  for (const url of urls) {
    if (candidates.some(c => c.url === url)) continue;
    candidates.push({ url, source: 'play_addr' });
  }
  return candidates;
}

function extractImagesFromData(data: any): string[] {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data || {};
  const images: string[] = [];
  const imageList = detail.images || data?.images || detail.image_list || data?.image_list;
  if (Array.isArray(imageList)) {
    for (const img of imageList) {
      if (typeof img === 'string' && img.startsWith('http')) {
        images.push(img);
      } else if (img?.url_list?.length) {
        const first = img.url_list.find((u: any) => typeof u === 'string' && u.startsWith('http'));
        if (first) images.push(first);
      } else if (img?.url && typeof img.url === 'string' && img.url.startsWith('http')) {
        images.push(img.url);
      }
    }
  }
  return [...new Set(images)];
}

function extractTagsFromData(data: any): string[] {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data || {};
  const tags = detail.text_extra || data?.text_extra || [];
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((t: any) => t?.hashtag_name || t?.name)
    .map((t: any) => String(t.hashtag_name || t.name))
    .filter(Boolean);
}

function convertCpExtractToResolveResult(data: any): DouyinResolveResult {
  const videoUrls = extractVideoUrlsFromData(data);
  const candidates = extractCandidatesFromData(data);
  return {
    ok: true,
    mode: 'stable',
    videoId: extractVideoIdFromData(data),
    title: extractTitleFromData(data),
    desc: extractTitleFromData(data),
    downloadUrl: videoUrls[0] || '',
    downloadUrlCandidates: candidates,
    videoUrls,
    videoUrlCandidates: candidates,
    caption: data?.caption || data?.publishedText || '',
    fallbackCaption: '',
    fallbackCaptionSource: 'none',
    authorName: extractAuthorFromData(data),
    duration: extractDurationFromData(data),
    videoData: data,
    normalizedUrl: '',
    sourceType: 'universal',
    resolveStrategy: 'copypilot',
    platform: 'douyin',
    images: extractImagesFromData(data),
    tags: extractTagsFromData(data),
    sourceUrl: '',
  };
}

function convertCpTranscribeToResult(data: any): DouyinTranscriptResult {
  const videoUrls = extractVideoUrlsFromData(data);
  return {
    ok: true,
    transcriptOk: !!data?.transcript || !!data?.text,
    videoId: extractVideoIdFromData(data),
    title: extractTitleFromData(data),
    downloadUrl: videoUrls[0] || '',
    downloadUrlCandidates: extractCandidatesFromData(data),
    authorName: extractAuthorFromData(data),
    normalizedUrl: '',
    sourceType: 'universal',
    transcript: data?.transcript || data?.text || '',
    transcriptError: '',
    transcriptSegments: 0,
    fallbackCaption: data?.publishedText || '',
    fallbackCaptionSource: 'none',
    resolveStrategy: 'copypilot',
  };
}

export async function resolveCpExtract(url: string): Promise<DouyinResolveResult> {
  const response = await fetch('/api/cp/extract', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || '视频解析失败');
  }

  return convertCpExtractToResolveResult(json?.data);
}

export async function extractCpTranscript(url: string): Promise<DouyinTranscriptResult> {
  const response = await fetch('/api/cp/transcribe-link-qwen', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || '视频文案提取失败');
  }

  return convertCpTranscribeToResult(json?.data);
}

export async function extractCpLocalTranscript(file: File): Promise<DouyinTranscriptResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/cp/transcribe', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const json = await parseJsonSafely(response);
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || '本地视频文案提取失败');
  }

  return {
    ok: true,
    transcriptOk: !!json?.data?.text,
    videoId: `local_${Date.now()}`,
    title: json?.data?.title || file.name,
    downloadUrl: '',
    downloadUrlCandidates: [],
    authorName: '',
    normalizedUrl: '',
    sourceType: 'local_upload',
    transcript: json?.data?.text || '',
    transcriptError: '',
    transcriptSegments: 0,
    fallbackCaption: '',
    fallbackCaptionSource: 'none',
    resolveStrategy: 'copypilot',
  };
}

// ===================== Legacy API (kept for fallback) =====================

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

  const videoUrlCandidates = readDownloadUrlCandidates(json?.videoUrlCandidates || json?.downloadUrlCandidates);
  const videoUrls = Array.isArray(json?.videoUrls)
    ? json.videoUrls.filter((u: unknown) => typeof u === 'string' && u.startsWith('http'))
    : videoUrlCandidates.map((c) => c.url);

  return {
    ok: true,
    mode: 'stable',
    videoId: String(json?.videoId || ''),
    title: typeof json?.title === 'string' ? json.title : '',
    desc: typeof json?.desc === 'string' ? json.desc : '',
    downloadUrl: String(json?.downloadUrl || json?.videoUrls?.[0] || ''),
    downloadUrlCandidates: readDownloadUrlCandidates(json?.downloadUrlCandidates),
    videoUrls,
    videoUrlCandidates,
    caption: typeof json?.caption === 'string' ? json.caption : '',
    fallbackCaption: typeof json?.fallbackCaption === 'string' ? json.fallbackCaption : '',
    fallbackCaptionSource: json?.fallbackCaptionSource === 'tikhub_caption' ? 'tikhub_caption' : 'none',
    authorName: typeof json?.authorName === 'string' ? json.authorName : '',
    duration: Number.isFinite(Number(json?.duration)) ? Number(json.duration) : 0,
    videoData: json?.videoData && typeof json.videoData === 'object' ? json.videoData as Record<string, unknown> : null,
    normalizedUrl: typeof json?.normalizedUrl === 'string' ? json.normalizedUrl : '',
    sourceType: json?.sourceType === 'web_url' ? 'web_url' : (json?.sourceType === 'universal' ? 'universal' : 'short_share_text'),
    resolveStrategy: typeof json?.resolveStrategy === 'string' ? json.resolveStrategy : '',
    platform: typeof json?.platform === 'string' ? json.platform : '',
    images: Array.isArray(json?.images) ? json.images.filter((u: unknown) => typeof u === 'string' && u.startsWith('http')) : [],
    tags: Array.isArray(json?.tags) ? json.tags.filter((t: unknown) => typeof t === 'string') : [],
    sourceUrl: typeof json?.sourceUrl === 'string' ? json.sourceUrl : '',
  };
}

export async function extractDouyinTranscript(input: string, asrEngine?: string): Promise<DouyinTranscriptResult> {
  const response = await fetch('/api/douyin/extract-transcript', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input, asrEngine }),
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
    downloadUrl: String(json?.downloadUrl || json?.videoUrls?.[0] || ''),
    downloadUrlCandidates: readDownloadUrlCandidates(json?.downloadUrlCandidates || json?.videoUrlCandidates),
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

export async function extractLocalVideoTranscript(file: File, asrEngine?: string): Promise<DouyinTranscriptResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (asrEngine) {
    formData.append('asrEngine', asrEngine);
  }

  const response = await fetch('/api/douyin/extract-local-transcript', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '本地视频文案提取失败'));
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
    sourceType: 'local_upload',
    transcript: typeof json?.transcript === 'string' ? json.transcript : '',
    transcriptError: typeof json?.transcriptError === 'string' ? json.transcriptError : '',
    transcriptSegments: Number.isFinite(json?.transcriptSegments) ? Number(json.transcriptSegments) : 0,
    fallbackCaption: typeof json?.fallbackCaption === 'string' ? json.fallbackCaption : '',
    fallbackCaptionSource: json?.fallbackCaptionSource === 'tikhub_caption' ? 'tikhub_caption' : 'none',
    resolveStrategy: typeof json?.resolveStrategy === 'string' ? json.resolveStrategy : '',
  };
}

function triggerBackgroundDownload(url: string) {
  return new Promise<void>((resolve) => {
    const iframe = document.createElement('iframe');
    const cleanup = () => {
      window.setTimeout(() => {
        iframe.remove();
      }, 30_000);
    };

    iframe.style.display = 'none';
    iframe.onload = () => {
      cleanup();
      resolve();
    };
    iframe.src = url;
    document.body.appendChild(iframe);

    window.setTimeout(() => {
      cleanup();
      resolve();
    }, 1800);
  });
}

function triggerDirectLinkDownload(url: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noreferrer';
  anchor.target = '_blank';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function getDirectDownloadCandidates(params: {
  downloadUrl: string;
  downloadUrlCandidates?: DouyinDownloadCandidate[];
}): DouyinDownloadCandidate[] {
  const seen = new Set<string>();
  const candidates = [...(params.downloadUrlCandidates || [])];
  if (params.downloadUrl) {
    candidates.push({ url: params.downloadUrl, source: 'resolved.downloadUrl' });
  }

  return candidates
    .filter((candidate) => candidate?.url)
    .sort((left, right) => Number(right.hasAudio === true) - Number(left.hasAudio === true))
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .slice(0, 6);
}

export async function downloadDouyinVideoFile(params: {
  videoId: string;
  downloadUrl: string;
  downloadUrlCandidates?: DouyinDownloadCandidate[];
  videoUrls?: string[];
  platform?: string;
}) {
  const safeVideoId = String(params.videoId || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .slice(0, 64);
  const fileName = buildDownloadFileName(safeVideoId);

  const form = document.createElement('form');
  const iframe = document.createElement('iframe');
  const frameName = `douyin_download_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  iframe.name = frameName;
  iframe.style.display = 'none';
  iframe.setAttribute('aria-hidden', 'true');

  form.method = 'POST';
  form.action = '/api/douyin/download-video';
  form.target = frameName;
  form.style.display = 'none';

  const fields: Record<string, string> = {
    downloadUrl: params.downloadUrl,
    videoId: params.videoId || '',
    platform: params.platform || 'douyin',
    fileName,
    download: '1',
  };
  if (params.downloadUrlCandidates?.length) {
    fields.downloadUrlCandidates = JSON.stringify(params.downloadUrlCandidates);
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!value) continue;
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(iframe);
  document.body.appendChild(form);

  try {
    form.submit();
  } finally {
    document.body.removeChild(form);
    window.setTimeout(() => {
      iframe.remove();
    }, 120_000);
  }
}

export async function directDownloadDouyinVideoFile(params: {
  videoId: string;
  downloadUrl: string;
  downloadUrlCandidates?: DouyinDownloadCandidate[];
  videoUrls?: string[];
  platform?: string;
  onProgress?: (loaded: number, total: number) => void;
}) {
  const platform = String(params?.platform || '').trim().toLowerCase();

  if (platform && platform !== 'douyin') {
    await downloadDouyinVideoFile(params);
    return;
  }

  const fileName = buildDownloadFileName(params.videoId);
  const candidates = getDirectDownloadCandidates(params);

  // Always use direct link for fastest download speed.
  // CopyPilot's TikHub extraction returns normal videos with audio.
  if (candidates.length > 0) {
    triggerDirectLinkDownload(candidates[0].url, fileName);
    return;
  }

  // Fallback to server-side download if no candidates available.
  await downloadDouyinVideoFile(params);
}

export async function polishDouyinTranscript(options: {
  originalTranscript: string;
  onDelta?: (text: string) => void;
}): Promise<string> {
  const question = `你是一位专业的语音转文字校对专家。下面这段文案是通过 ASR（自动语音识别）从视频中提取的口播内容，极有可能存在以下问题：
- 同音字错误（如"在"写成"再"，"做"写成"作"）
- 近音字错误（如"这种"听成"种族"）
- 漏字或多字
- 口语化表达不够通顺
- 标点符号使用不当

请逐句仔细对照语义进行校对，输出最准确、流畅的修正版本。即使你觉得原文"看起来差不多"，也请重新组织输出一遍，确保每个字都准确无误。

只输出修正后的完整文案，不要添加任何解释、说明、前言或格式标记。

---

原始文案：
${options.originalTranscript}`;

  const result = await sendCreativeMessage({
    question,
    history: [],
    onDelta: options.onDelta,
  });
  return result;
}
