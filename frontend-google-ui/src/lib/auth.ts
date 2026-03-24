export interface AuthResult {
  ok: boolean;
  error?: string;
}

async function parseJsonSafely(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function getAuthStatus(): Promise<boolean> {
  const response = await fetch('/api/auth/status', {
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);

  if (!response.ok) {
    return false;
  }

  return !!json?.authenticated;
}

export async function loginWithPassword(password: string): Promise<AuthResult> {
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    const json = await parseJsonSafely(response);

    if (!response.ok) {
      return {
        ok: false,
        error: json?.error || '登录失败',
      };
    }

    return { ok: true };
  } catch {
    return {
      ok: false,
      error: '无法连接登录服务，请确认后端已启动。',
    };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Ignore logout network failures and clear local UI state anyway.
  }
}
