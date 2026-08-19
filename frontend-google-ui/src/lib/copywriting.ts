export interface CopyProfile {
  name?: string;
  visualDescription?: string;
  colors?: string[];
  style?: string;
  textCalligraphySeals?: string;
  material?: string;
  structure?: string;
  suitableScenes?: string[];
  targetAudiences?: string[];
  meanings?: string[];
  sellingPoints?: string[];
  uncertainClaims?: string[];
  [key: string]: unknown;
}

export interface CopyOriginalItem {
  id: string;
  mode: 'stable' | 'explore';
  direction: string;
  targetLength: number;
  title: string;
  hook: string;
  content: string;
  closing: string;
  fullText: string;
}

export interface CopyRewriteAnalysis {
  hookMechanism?: string;
  targetAudience?: string;
  coreSellingPoint?: string;
  emotionProgression?: string;
  narrativeStructure?: string;
  conversionMethod?: string;
  keepableCore?: string;
  claimsToDrop?: string;
  [key: string]: unknown;
}

export interface CopyRewriteVersion {
  version: string;
  content: string;
}

export interface CopyLibraryItem {
  id: string;
  type: 'original' | 'rewrite';
  profile: CopyProfile;
  imageThumb?: string;
  extraInfo?: string;
  forbidden?: string;
  originalText?: string;
  mode?: 'stable' | 'explore';
  version?: string;
  direction?: string;
  fullText: string;
  wordCount: number;
  isLiked: boolean;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyzeCopyPaintingFields {
  name?: string;
  extraInfo?: string;
  sellingPoints?: string;
  forbidden?: string;
}

async function parseJsonSafely(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildErrorMessage(json: any, fallback: string) {
  return typeof json?.error === 'string' && json.error ? json.error : fallback;
}

export async function analyzeCopyPainting(
  file: File,
  fields: AnalyzeCopyPaintingFields = {}
): Promise<CopyProfile> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  if (fields.name) formData.append('name', fields.name);
  if (fields.extraInfo) formData.append('extraInfo', fields.extraInfo);
  if (fields.sellingPoints) formData.append('sellingPoints', fields.sellingPoints);
  if (fields.forbidden) formData.append('forbidden', fields.forbidden);

  const response = await fetch('/api/copy/analyze', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, `挂画分析失败（HTTP ${response.status}）`));
  }

  return json?.profile && typeof json.profile === 'object' ? (json.profile as CopyProfile) : {};
}

export async function generateOriginalCopies(
  profile: CopyProfile,
  opts: { extraInfo?: string; forbidden?: string } = {}
): Promise<CopyOriginalItem[]> {
  const response = await fetch('/api/copy/generate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, extraInfo: opts.extraInfo || '', forbidden: opts.forbidden || '' }),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, `原创文案生成失败（HTTP ${response.status}）`));
  }

  return Array.isArray(json?.copies) ? (json.copies as CopyOriginalItem[]) : [];
}

export async function regenerateCopy(
  profile: CopyProfile,
  target: { mode: 'stable' | 'explore'; direction: string; targetLength: number },
  opts: { extraInfo?: string; forbidden?: string; excludeTexts?: string[] } = {}
): Promise<CopyOriginalItem> {
  const response = await fetch('/api/copy/regenerate', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile,
      target,
      extraInfo: opts.extraInfo || '',
      forbidden: opts.forbidden || '',
      excludeTexts: opts.excludeTexts || [],
    }),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, `单独重新生成失败（HTTP ${response.status}）`));
  }

  return json?.copy as CopyOriginalItem;
}

export async function rewriteCopy(
  originalText: string,
  profile: CopyProfile,
  opts: { extraInfo?: string; forbidden?: string } = {}
): Promise<{ analysis: CopyRewriteAnalysis; versions: CopyRewriteVersion[] }> {
  const response = await fetch('/api/copy/rewrite', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ originalText, profile, extraInfo: opts.extraInfo || '', forbidden: opts.forbidden || '' }),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, `爆款文案仿写失败（HTTP ${response.status}）`));
  }

  return {
    analysis: (json?.analysis && typeof json.analysis === 'object' ? json.analysis : {}) as CopyRewriteAnalysis,
    versions: Array.isArray(json?.versions) ? (json.versions as CopyRewriteVersion[]) : [],
  };
}

export async function listCopyLibrary(q?: string): Promise<CopyLibraryItem[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  const query = params.toString();
  const response = await fetch(`/api/copy/library${query ? `?${query}` : ''}`, {
    credentials: 'include',
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '读取文案库失败'));
  }
  return Array.isArray(json?.items) ? (json.items as CopyLibraryItem[]) : [];
}

export async function saveCopyLibraryItem(
  item: Partial<CopyLibraryItem>
): Promise<CopyLibraryItem> {
  const response = await fetch('/api/copy/library', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '保存到文案库失败'));
  }
  return json?.item as CopyLibraryItem;
}

export async function updateCopyLibraryItem(
  id: string,
  patch: Partial<CopyLibraryItem>
): Promise<CopyLibraryItem> {
  const response = await fetch(`/api/copy/library/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '更新文案失败'));
  }
  return json?.item as CopyLibraryItem;
}

export async function deleteCopyLibraryItem(id: string): Promise<void> {
  const response = await fetch(`/api/copy/library/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '删除文案失败'));
  }
}

export function countCopyChars(text: string): number {
  return String(text || '').replace(/\s/g, '').length;
}
