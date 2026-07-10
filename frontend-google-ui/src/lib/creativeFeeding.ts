export interface CreativeFeedingSettings {
  businessBackground: string;
  targetAudience: string;
  productFeatures: string;
  stylePreference: string;
  conversionDirections: string;
  forbiddenExpressions: string;
  openingRules: string;
  outputFormat: string;
}

export interface CreativeOpening {
  id: string;
  openingText: string;
  paintingName: string;
  scene: string;
  hookType: string;
  platform: string;
  videoUrl: string;
  performanceNote: string;
  reasonAnalysis: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreativeGenerateRequest {
  paintingName: string;
  scene: string;
  sellingPoint: string;
  extraRequirement: string;
  count: number;
  referenceLimit?: number;
  referenceIds?: string[];
}

export interface CreativeGenerateResult {
  openingText: string;
  logic: string;
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error || `请求失败：HTTP ${response.status}`);
  }
  return json as T;
}

export async function fetchCreativeFeedingSettings() {
  const json = await requestJson<{ ok: boolean; settings: CreativeFeedingSettings }>('/api/creative-feeding/settings');
  return json.settings;
}

export async function saveCreativeFeedingSettings(settings: CreativeFeedingSettings) {
  const json = await requestJson<{ ok: boolean; settings: CreativeFeedingSettings }>('/api/creative-feeding/settings', {
    method: 'POST',
    body: JSON.stringify({ settings }),
  });
  return json.settings;
}

export async function fetchCreativeOpenings(filters?: { q?: string; tag?: string }) {
  const params = new URLSearchParams();
  if (filters?.q) params.set('q', filters.q);
  if (filters?.tag) params.set('tag', filters.tag);
  const query = params.toString();
  const json = await requestJson<{ ok: boolean; openings: CreativeOpening[]; total: number }>(
    `/api/creative-feeding/openings${query ? `?${query}` : ''}`
  );
  return json.openings;
}

export async function createCreativeOpening(opening: Partial<CreativeOpening>) {
  const json = await requestJson<{ ok: boolean; opening: CreativeOpening }>('/api/creative-feeding/openings', {
    method: 'POST',
    body: JSON.stringify(opening),
  });
  return json.opening;
}

export async function updateCreativeOpening(id: string, opening: Partial<CreativeOpening>) {
  const json = await requestJson<{ ok: boolean; opening: CreativeOpening }>(`/api/creative-feeding/openings/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(opening),
  });
  return json.opening;
}

export async function deleteCreativeOpening(id: string) {
  await requestJson<{ ok: boolean }>(`/api/creative-feeding/openings/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function generateCreativeOpenings(request: CreativeGenerateRequest) {
  return requestJson<{
    ok: boolean;
    model: string;
    modelId: string;
    answer: string;
    results: CreativeGenerateResult[];
    referenceCount: number;
  }>('/api/creative-feeding/generate', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}
