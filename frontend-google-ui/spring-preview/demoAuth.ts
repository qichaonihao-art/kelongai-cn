export async function getAuthStatus() {
  return false;
}

export async function loginWithPassword(password: string) {
  return password === '2027' ? { ok: true } : { ok: false, error: '请输入演示密码 2027。' };
}

export async function logout() {
  // The preview session only lives in the app's local state.
}
