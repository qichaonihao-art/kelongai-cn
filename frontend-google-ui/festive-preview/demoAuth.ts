const AUTH_KEY = 'kelongai.springPreviewAuth';

function stripScreenParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('screen')) return;
  url.searchParams.delete('screen');
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

export async function getAuthStatus() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('screen') === 'home') {
    window.sessionStorage.setItem(AUTH_KEY, '1');
    stripScreenParam();
    return true;
  }
  return window.sessionStorage.getItem(AUTH_KEY) === '1';
}

export async function loginWithPassword(password: string) {
  if (password === '2027') {
    window.sessionStorage.setItem(AUTH_KEY, '1');
    return { ok: true };
  }
  return { ok: false, error: '请输入演示密码 2027。' };
}

export async function logout() {
  window.sessionStorage.removeItem(AUTH_KEY);
  stripScreenParam();
}
