export interface VideoLibraryItem {
  id: number;
  folderName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  streamUrl: string;
  downloadUrl: string;
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function errorMessage(json: any, fallback: string) {
  return typeof json?.error === 'string' ? json.error : fallback;
}

export async function getVideoLibrary(filters?: { folder?: string; query?: string }) {
  const params = new URLSearchParams();
  if (filters?.folder) params.set('folder', filters.folder);
  if (filters?.query) params.set('q', filters.query);
  const query = params.toString();
  const response = await fetch(`/api/video-library/videos${query ? `?${query}` : ''}`, { credentials: 'include' });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '读取视频库失败'));
  return {
    items: Array.isArray(json?.items) ? json.items as VideoLibraryItem[] : [],
    folders: Array.isArray(json?.folders) ? json.folders as string[] : ['通用素材'],
  };
}

export async function uploadVideoLibraryVideo(file: File, folderName: string) {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('folderName', folderName);
  const response = await fetch('/api/video-library/videos', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '上传视频失败'));
  return {
    item: json?.item as VideoLibraryItem,
    duplicate: Boolean(json?.duplicate),
    message: typeof json?.message === 'string' ? json.message : '',
  };
}

export async function createVideoLibraryFolder(folderName: string) {
  const response = await fetch('/api/video-library/folders', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderName }),
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '新建文件夹失败'));
  return String(json?.folder || folderName);
}

export async function updateVideoLibraryNote(id: number, note: string) {
  const response = await fetch(`/api/video-library/videos/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '保存备注失败'));
  return json?.item as VideoLibraryItem;
}

export async function deleteVideoLibraryVideo(id: number) {
  const response = await fetch(`/api/video-library/videos/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '删除视频失败'));
}

export function formatVideoLibrarySize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatVideoLibraryTime(timestamp: number) {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
