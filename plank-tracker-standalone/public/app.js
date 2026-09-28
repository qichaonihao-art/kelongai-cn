const $ = (selector) => document.querySelector(selector);
const loginView = $('#loginView');
const appView = $('#appView');
let sessions = [];
let elapsedMs = 0;
let running = false;
let startedAt = 0;
let accumulatedMs = 0;
let intervalId = null;
let wakeLock = null;

function formatTime(value) {
  const totalMs = Math.max(0, Math.round(Number(value || 0) * 1000));
  const mins = Math.floor(totalMs / 60_000);
  const secs = Math.floor(totalMs % 60_000 / 1000);
  const millis = totalMs % 1000;
  return mins
    ? `${mins}分${String(secs).padStart(2, '0')}秒${String(millis).padStart(3, '0')}毫秒`
    : `${secs}秒${String(millis).padStart(3, '0')}毫秒`;
}
function compactTime(value) {
  const totalMs = Math.max(0, Math.round(Number(value || 0) * 1000));
  const mins = Math.floor(totalMs / 60_000);
  const secs = Math.floor(totalMs % 60_000 / 1000);
  const millis = totalMs % 1000;
  return `${mins}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
function timerText(value) {
  const mins = Math.floor(value / 60_000);
  const secs = Math.floor(value % 60_000 / 1000);
  const millis = Math.floor(value % 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.remove('hidden');
  setTimeout(() => node.classList.add('hidden'), 2200);
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'include', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '请求失败');
  return body;
}
function cacheSessions() { localStorage.setItem('plank_server_cache', JSON.stringify(sessions)); }
function pendingItems() { return JSON.parse(localStorage.getItem('plank_pending_sync') || '[]'); }
function setPending(values) { localStorage.setItem('plank_pending_sync', JSON.stringify(values)); }
function showCelebration() {
  const node = $('#celebration');
  node.classList.remove('hidden', 'celebrating');
  void node.offsetWidth;
  node.classList.add('celebrating');
  setTimeout(() => node.classList.add('hidden'), 4200);
}

function render() {
  const sorted = [...sessions].sort((a, b) => b.performedAt - a.performedAt);
  $('#totalCount').textContent = String(sorted.length);
  $('#bestTime').textContent = formatTime(Math.max(0, ...sorted.map((item) => item.duration)));
  const now = new Date();
  $('#monthCount').textContent = String(sorted.filter((item) => { const d = new Date(item.performedAt); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).length);
  $('#emptyState').classList.toggle('hidden', sorted.length > 0);
  $('#history').innerHTML = sorted.slice(0, 30).map((item) => `<article class="history-row"><div class="history-icon">${item.duration >= 300 ? '★' : '稳'}</div><div><strong>${formatTime(item.duration)}</strong><small>${new Date(item.performedAt).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${item.note ? ` · ${escapeHtml(item.note)}` : ''}</small></div><button class="delete" data-id="${item.id || ''}" data-client="${item.clientId}">删除</button></article>`).join('');
  const recent = [...sorted].reverse().slice(-14);
  const max = Math.max(1, ...recent.map((item) => item.duration));
  $('#chart').innerHTML = recent.length ? recent.map((item) => {
    const level = Math.max(1, Math.min(20, Math.ceil(item.duration / max * 20)));
    return `<div class="bar-wrap" title="${formatTime(item.duration)}"><span class="bar-value">${compactTime(item.duration)}</span><div class="bar-track"><div class="bar bar-level-${level}"></div></div><span class="bar-label">${new Date(item.performedAt).getMonth() + 1}/${new Date(item.performedAt).getDate()}</span></div>`;
  }).join('') : '<div class="empty">保存训练后会显示趋势</div>';
  cacheSessions();
}
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }
function updateTimer() {
  if (running) elapsedMs = accumulatedMs + performance.now() - startedAt;
  $('#timer').textContent = timerText(elapsedMs);
  $('#saveButton').disabled = running || elapsedMs < 1000;
}
async function syncPending() {
  const pending = pendingItems();
  if (!pending.length) { $('#syncState').textContent = '数据已同步'; return; }
  $('#syncState').textContent = `等待同步 ${pending.length} 条`;
  const remaining = [];
  for (const item of pending) {
    try { await api('/api/sessions', { method: 'POST', body: JSON.stringify(item) }); } catch { remaining.push(item); }
  }
  setPending(remaining);
  if (!remaining.length) {
    $('#syncState').textContent = '数据已同步';
    const data = await api('/api/sessions'); sessions = data.sessions; render();
  }
}
async function enterApp() {
  loginView.classList.add('hidden'); appView.classList.remove('hidden');
  sessions = JSON.parse(localStorage.getItem('plank_server_cache') || '[]'); render();
  try { const data = await api('/api/sessions'); sessions = data.sessions; render(); await syncPending(); }
  catch { $('#syncState').textContent = '离线模式，联网后自动同步'; }
}

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); $('#loginError').textContent = '';
  try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) }); $('#password').value = ''; await enterApp(); }
  catch (error) { $('#loginError').textContent = error.message; }
});
$('#logoutButton').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.reload(); });
$('#toggleButton').addEventListener('click', async () => {
  running = !running;
  if (running) {
    startedAt = performance.now(); $('#toggleButton').textContent = '暂停'; $('#timerState').textContent = '保持呼吸，稳住核心'; intervalId = setInterval(updateTimer, 31);
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  } else {
    accumulatedMs += performance.now() - startedAt; clearInterval(intervalId); $('#toggleButton').textContent = '继续'; $('#timerState').textContent = '已暂停'; await wakeLock?.release().catch(() => {}); updateTimer();
  }
});
$('#resetButton').addEventListener('click', async () => { running = false; clearInterval(intervalId); elapsedMs = 0; accumulatedMs = 0; $('#toggleButton').textContent = '开始'; $('#timerState').textContent = '准备开始'; await wakeLock?.release().catch(() => {}); updateTimer(); });
$('#saveButton').addEventListener('click', async () => {
  if (elapsedMs < 1000) return;
  const duration = Math.round(elapsedMs) / 1000;
  const item = { clientId: crypto.randomUUID(), duration, performedAt: Date.now(), note: '' };
  sessions.push(item); setPending([...pendingItems(), item]); render(); toast(`已记录 ${formatTime(duration)}`);
  if (duration >= 300) showCelebration();
  elapsedMs = 0; accumulatedMs = 0; $('#toggleButton').textContent = '开始'; $('#timerState').textContent = '今天也完成了'; updateTimer(); await syncPending();
});
$('#history').addEventListener('click', async (event) => {
  const button = event.target.closest('.delete'); if (!button || !confirm('确定删除这条记录吗？')) return;
  if (button.dataset.id) await api(`/api/sessions/${button.dataset.id}`, { method: 'DELETE', body: '{}' });
  sessions = sessions.filter((item) => String(item.id || '') !== button.dataset.id && item.clientId !== button.dataset.client); render(); toast('记录已删除');
});
$('#exportButton').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), sessions }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `plank-records-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href);
});
$('#importInput').addEventListener('change', async (event) => {
  try { const values = JSON.parse(await event.target.files[0].text()); const data = await api('/api/sessions/import', { method: 'POST', body: JSON.stringify(values) }); sessions = data.sessions; render(); toast(`成功导入 ${data.imported} 条`); }
  catch (error) { toast(error.message); } finally { event.target.value = ''; }
});
window.addEventListener('online', syncPending);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const status = await api('/api/auth/status').catch(() => ({ authenticated: false }));
if (status.authenticated) enterApp(); else loginView.classList.remove('hidden');
