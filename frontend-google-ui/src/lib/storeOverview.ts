export type StoreOverviewNodeType = 'store' | 'product' | 'video' | 'adq' | 'supplier';

export interface StoreOverviewNode {
  id: number;
  type: StoreOverviewNodeType;
  name: string;
  note: string;
  created_at: number;
  updated_at: number;
}

export interface StoreOverviewEdge {
  id: number;
  source_id: number;
  target_id: number;
  relation_type: string;
  note: string;
  created_at: number;
  updated_at: number;
}

export interface StoreOverviewGraph {
  nodes: StoreOverviewNode[];
  edges: StoreOverviewEdge[];
  settings: StoreOverviewSettings;
}

export interface StoreOverviewSettings {
  columnOrder: StoreOverviewNodeType[];
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

export async function getStoreOverviewGraph(): Promise<StoreOverviewGraph> {
  const response = await fetch('/api/store-overview/graph', {
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '获取店铺总览失败'));
  }
  return {
    nodes: Array.isArray(json?.nodes) ? json.nodes : [],
    edges: Array.isArray(json?.edges) ? json.edges : [],
    settings: {
      columnOrder: Array.isArray(json?.settings?.columnOrder) ? json.settings.columnOrder : [],
    },
  };
}

export async function updateStoreOverviewSettings(input: Partial<StoreOverviewSettings>): Promise<StoreOverviewSettings> {
  const response = await fetch('/api/store-overview/settings', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '保存店铺总览设置失败'));
  }
  return {
    columnOrder: Array.isArray(json?.settings?.columnOrder) ? json.settings.columnOrder : [],
  };
}

export async function createStoreOverviewNode(input: {
  type: StoreOverviewNodeType;
  name: string;
  note?: string;
}): Promise<StoreOverviewNode> {
  const response = await fetch('/api/store-overview/nodes', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '新增项目失败'));
  }
  return json?.node;
}

export async function updateStoreOverviewNode(id: number, input: {
  name: string;
  note?: string;
}): Promise<StoreOverviewNode> {
  const response = await fetch(`/api/store-overview/nodes/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '更新项目失败'));
  }
  return json?.node;
}

export async function deleteStoreOverviewNode(id: number): Promise<void> {
  const response = await fetch(`/api/store-overview/nodes/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '删除项目失败'));
  }
}

export async function createStoreOverviewEdge(input: {
  sourceId: number;
  targetId: number;
  relationType?: string;
  note?: string;
}): Promise<StoreOverviewEdge> {
  const response = await fetch('/api/store-overview/edges', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '新增关联失败'));
  }
  return json?.edge;
}

export async function deleteStoreOverviewEdge(id: number): Promise<void> {
  const response = await fetch(`/api/store-overview/edges/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '取消关联失败'));
  }
}
