export interface ImageTask {
  id: number;
  prompt: string;
  size: string;
  resolution: string;
  status: string;
  external_task_id: string;
  result_urls: string[];
  reference_images: string[];
  error_message: string;
  created_at: number;
  completed_at: number | null;
}

export interface ImageConfigStatus {
  reachable: boolean;
  gptImageApiKey: boolean;
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

export async function getImageConfigStatus(): Promise<ImageConfigStatus> {
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
      gptImageApiKey: !!json?.serverManaged?.gptImageApiKey,
    };
  } catch {
    return {
      reachable: false,
      gptImageApiKey: false,
    };
  }
}

export async function createImageTask(
  prompt: string,
  size: string,
  resolution: string,
  imageUrls?: string[]
): Promise<ImageTask> {
  const response = await fetch('/api/image/tasks', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, size, resolution, image_urls: imageUrls }),
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '创建图片生成任务失败'));
  }
  return json?.task;
}

export async function getImageTaskStatus(id: number): Promise<ImageTask> {
  const response = await fetch(`/api/image/tasks/${id}`, {
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '查询任务状态失败'));
  }
  return json?.task;
}

export async function getImageTasks(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ tasks: ImageTask[]; total: number; limit: number; offset: number }> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const response = await fetch(`/api/image/tasks?${searchParams.toString()}`, {
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '获取任务列表失败'));
  }
  return {
    tasks: json?.tasks || [],
    total: json?.total || 0,
    limit: json?.limit || 50,
    offset: json?.offset || 0,
  };
}

export async function deleteImageTask(id: number): Promise<void> {
  const response = await fetch(`/api/image/tasks/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '删除任务失败'));
  }
}
