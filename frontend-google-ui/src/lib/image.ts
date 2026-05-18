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

const IMAGE_TASKS_KEY = 'image_generation_tasks';
const MAX_LOCAL_STORAGE_CHARS = 4_000_000;

function loadTasks(): ImageTask[] {
  try {
    const raw = localStorage.getItem(IMAGE_TASKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTasks(tasks: ImageTask[]) {
  try {
    const serialized = JSON.stringify(tasks);
    if (serialized.length <= MAX_LOCAL_STORAGE_CHARS) {
      localStorage.setItem(IMAGE_TASKS_KEY, serialized);
      return;
    }

    const compactTasks = tasks.map((task) => ({
      ...task,
      reference_images: task.reference_images?.filter((image) => !image.startsWith('data:')) || [],
    }));
    localStorage.setItem(IMAGE_TASKS_KEY, JSON.stringify(compactTasks));
  } catch {
    try {
      const compactTasks = tasks.map((task) => ({ ...task, reference_images: [] }));
      localStorage.setItem(IMAGE_TASKS_KEY, JSON.stringify(compactTasks));
    } catch {
      // Ignore storage failures; generation should keep working.
    }
  }
}

function upsertTask(tasks: ImageTask[], task: ImageTask) {
  const existingIndex = tasks.findIndex((item) => item.id === task.id);
  if (existingIndex === -1) {
    return [task, ...tasks];
  }
  const next = [...tasks];
  next[existingIndex] = task;
  return next;
}

export function saveImageTaskSnapshot(task: ImageTask) {
  const tasks = loadTasks();
  saveTasks(upsertTask(tasks, task));
}

export function replaceImageTaskSnapshot(previousId: number, task: ImageTask) {
  const tasks = loadTasks();
  const previousIndex = tasks.findIndex((item) => item.id === previousId);
  const remaining = tasks.filter((item) => item.id !== previousId && item.id !== task.id);
  if (previousIndex === -1) {
    saveTasks([task, ...remaining]);
    return;
  }
  remaining.splice(previousIndex, 0, task);
  saveTasks(remaining);
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
  imageUrls?: string[],
  localTaskId?: number
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
  const task = json?.task;
  if (task) {
    if (localTaskId !== undefined) {
      replaceImageTaskSnapshot(localTaskId, task);
    } else {
      saveImageTaskSnapshot(task);
    }
  }
  return task;
}

export async function getImageTaskStatus(id: number): Promise<ImageTask> {
  const response = await fetch(`/api/image/tasks/${id}`, {
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '查询任务状态失败'));
  }
  const task = json?.task;
  if (task) {
    const tasks = loadTasks();
    const updated = upsertTask(tasks, task);
    saveTasks(updated);
  }
  return task;
}

export async function getImageTasks(params?: {
  limit?: number;
  offset?: number;
}): Promise<{ tasks: ImageTask[]; total: number; limit: number; offset: number }> {
  const tasks = loadTasks();
  const offset = params?.offset || 0;
  const limit = params?.limit || 50;
  return {
    tasks: tasks.slice(offset, offset + limit),
    total: tasks.length,
    limit,
    offset,
  };
}

export async function deleteImageTask(id: number): Promise<void> {
  try {
    await fetch(`/api/image/tasks/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    // ignore backend delete errors
  }
  const tasks = loadTasks();
  saveTasks(tasks.filter((t) => t.id !== id));
}
