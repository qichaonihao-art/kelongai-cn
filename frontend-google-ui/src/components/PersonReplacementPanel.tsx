import { useEffect, useRef, useState } from 'react';
import { Loader2, History, X, Download, RefreshCw, UserRound, Check, Upload, Film, FolderOpen, Play, ZoomIn, Image as ImageIcon } from 'lucide-react';
import UploadHistoryPreview from '@/src/components/UploadHistoryPreview';
import { getKelongDeviceId, getSeedanceRatePerSecond } from '@/src/lib/creative';
import { blobToFile, getUploadHistoryItem, loadUploadHistorySummaries, saveUploadHistory, formatHistoryTime, type UploadHistoryItem, type UploadHistorySummaryItem } from '@/src/lib/uploadHistory';

type Model = 'doubao-seedance-2-0-260128' | 'doubao-seedance-2-5-260628';
type AudioMode = 'preserve' | 'rewrite' | 'new-voice' | 'silent' | 'generate';
interface PersonTask {
  id: string; stage: string; model: Model; resolution: string; audioMode: AudioMode; prompt: string; dialogue?: string; voiceDescription?: string;
  sourceName: string; duration: number; createdAt: number; updatedAt: number; libraryFolder?: string;
  videoUrl: string; maskedVideoUrl: string; generatedVideoUrl: string; error: string; notice: string; canRetry: boolean; canRecover: boolean; awaitingNotification?: boolean; generationTaskId?: string; ambiguous: boolean;
}
export type PersonLibrarySaveTarget = Pick<PersonTask, 'id' | 'model' | 'prompt' | 'createdAt'>;
const API = '/api/person-replacement/tasks';
const PENDING_KEY = 'kelongai.personReplacement.pendingRequest';
const PROMPT_HISTORY_KEY = 'kelongai.personReplacement.promptHistory';
interface PromptHistoryItem { prompt: string; timestamp: number }
function mergePromptHistory(items: PromptHistoryItem[]) {
  const seen = new Set<string>();
  return items.filter(item => typeof item.prompt === 'string' && item.prompt.trim() && item.prompt.length <= 6000 && Number.isFinite(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp).filter(item => {
      const text = item.prompt.trim();
      if (seen.has(text)) return false;
      seen.add(text); return true;
    }).slice(0, 100);
}
function readPromptHistory(): PromptHistoryItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(PROMPT_HISTORY_KEY) || '[]');
    return Array.isArray(items) ? mergePromptHistory(items.filter(item => item && typeof item === 'object')) : [];
  } catch { return []; }
}
const STAGES: Record<string, string> = {
  uploading: '正在保存原视频', queued: '等待人脸打码', normalizing: '正在准备视频格式',
  submitting_blur: '正在提交人脸打码', blurring: '正在识别人脸并打码', saving_mask: '正在保存打码结果',
  ready: '打码完成，准备替换人物', submitting_generation: '正在提交人物替换', generating: 'Seedance 正在替换人物',
  awaiting_confirmation: '提交待确认，正在等待火山任务通知',
  finalizing: '正在处理声音并保存成片', completed: '人物替换完成', failed: '处理未完成',
};
const busyTask = (task: PersonTask | null) => !!task && !['completed', 'failed'].includes(task.stage);
function deviceIdForRequest() {
  const deviceId = getKelongDeviceId();
  if (!deviceId) throw new Error('无法保存当前设备标识，请允许浏览器保存本地数据后重试');
  return deviceId;
}
async function request(url: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  headers.set('X-Device-Id', deviceIdForRequest());
  const response = await fetch(url, { credentials: 'include', ...options, headers });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw new Error(json?.error || `请求失败（HTTP ${response.status}）`);
  return json;
}
function usePreview(file: Blob | null | undefined) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const next = URL.createObjectURL(file); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}
function historyUnavailableReason(item: UploadHistorySummaryItem) {
  if (item.kind === 'video') {
    if (!/\.(mp4|mov)$/i.test(item.name)) return '请选择MP4或MOV视频';
    if (item.size > 50 * 1024 * 1024) return '文件超过50MB';
  } else {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(item.type)) return '请选择JPG、PNG或WebP图片';
    if (item.size > 10 * 1024 * 1024) return '图片超过10MB';
  }
  return '';
}
function HistoryMedia({ item, disabled, selecting, onSelect }: { item: UploadHistorySummaryItem; disabled: boolean; selecting: boolean; onSelect: () => void }) {
  const url = usePreview(item.previewBlob);
  const reason = historyUnavailableReason(item);
  const Icon = item.kind === 'video' ? Film : ImageIcon;
  const PreviewIcon = item.kind === 'video' ? Play : ZoomIn;
  return <button type="button" disabled={disabled} aria-label={`预览${item.kind === 'video' ? '视频' : '图片'}：${item.name}`} onClick={onSelect} title={`点击预览：${item.name}`} className="group min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 text-left transition hover:border-violet-400 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50">
    <div className="relative grid aspect-video place-items-center overflow-hidden rounded-lg bg-slate-100">
      {url ? <img src={url} alt={item.name} className="h-full w-full object-contain" /> : <Icon className="size-8 text-slate-300" />}
      {selecting && <span className="absolute inset-0 grid place-items-center bg-white/70"><Loader2 className="size-5 animate-spin text-violet-600" /></span>}
      {!selecting && <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/10"><span className="grid size-8 place-items-center rounded-full bg-white/85 text-violet-700 shadow"><PreviewIcon size={16} /></span></span>}
      {item.kind === 'video' && item.duration && <span className="absolute bottom-1 right-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] text-white">{item.duration.toFixed(1)}秒</span>}
    </div>
    <div className="mt-2 truncate text-xs font-semibold text-slate-700">{item.name}</div>
    <div className="mt-1 text-[10px] leading-4 text-slate-400">{(item.size / 1024 / 1024).toFixed(1)}MB · {formatHistoryTime(item.timestamp)}</div>
    {reason && <div className="mt-1 text-[10px] text-amber-700">{reason}</div>}
  </button>;
}
function MediaUploadCard({ kind, file, previewUrl, duration = 0, disabled, onFile, onClear, onHistory, onDuration }: {
  kind: 'video' | 'image'; file: File | null; previewUrl: string; duration?: number; disabled: boolean;
  onFile: (file: File | null) => void; onClear: () => void; onHistory: () => void; onDuration?: (duration: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const isVideo = kind === 'video';
  const Icon = isVideo ? Film : UserRound;
  const title = isVideo ? '原视频' : '目标人物参考图';
  return <div className={`min-w-0 rounded-2xl border bg-white p-3 transition-colors ${dragging ? 'border-violet-500 ring-2 ring-violet-100' : file ? 'border-violet-200' : 'border-slate-200'}`}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); if (!disabled) setDragging(true); } }}
    onDragLeave={() => setDragging(false)}
    onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled) onFile(event.dataTransfer.files?.[0] || null); }}>
    <input ref={input} type="file" aria-label={isVideo ? '上传人物替换原视频' : '上传目标人物参考图'} accept={isVideo ? 'video/mp4,video/quicktime,.mp4,.mov' : 'image/jpeg,image/png,image/webp'} hidden disabled={disabled}
      onChange={event => { onFile(event.target.files?.[0] || null); event.target.value = ''; }} />
    <div className="mb-3 flex min-h-9 items-center gap-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-600"><Icon size={17} /></span>
      <span className="min-w-0 flex-1 text-xs font-bold text-slate-800">{title}</span>
      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${isVideo ? 'bg-violet-50 text-violet-600' : 'bg-slate-100 text-slate-500'}`}>{isVideo ? '必传' : '选传'}</span>
    </div>
    {file ? <div className="space-y-2">
      <div className="grid h-40 place-items-center overflow-hidden rounded-xl bg-slate-100">
        {isVideo ? <video key={previewUrl} src={previewUrl} controls preload="metadata" onLoadedMetadata={event => onDuration?.(event.currentTarget.duration)} className="h-full w-full object-contain" />
          : <img src={previewUrl} alt="目标人物参考" className="h-full w-full object-contain" />}
      </div>
      <div className="flex items-start gap-2">
        <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
        <div className="min-w-0 flex-1"><p title={file.name} className="truncate text-[11px] font-semibold text-slate-700">{file.name}</p><p className="mt-0.5 text-[10px] text-slate-400">已选择 · {(file.size / 1024 / 1024).toFixed(1)}MB{isVideo && duration > 0 ? ` · ${duration.toFixed(1)}秒` : ''}</p></div>
        <button type="button" disabled={disabled} aria-label={isVideo ? '移除原视频' : '移除人物图片'} onClick={onClear} className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"><X size={14} /></button>
      </div>
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-violet-50 py-2 text-xs font-bold text-violet-700 hover:bg-violet-100"><Upload size={14} />{isVideo ? '更换视频' : '更换图片'}</button>
    </div> : <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="group flex min-h-40 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/50 px-2 py-4 transition hover:border-violet-400 hover:bg-violet-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed">
      <span className="mb-3 grid size-11 place-items-center rounded-full bg-white text-violet-600 shadow-sm transition group-hover:-translate-y-0.5"><Upload size={21} /></span>
      <span className="text-xs font-bold text-violet-700">{isVideo ? '点击上传原视频' : '点击上传人物图片'}</span>
      <span className="mt-1.5 text-[10px] leading-4 text-slate-500">或将文件拖到这里</span>
      <span className="mt-2 text-[10px] text-slate-400">{isVideo ? 'MP4 / MOV · 最大50MB' : 'JPG / PNG / WebP · 最大10MB'}</span>
    </button>}
    <button type="button" disabled={disabled} onClick={onHistory} className="mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-600 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"><History size={14} />{isVideo ? '历史视频' : '历史图片'}</button>
  </div>;
}

export default function PersonReplacementPanel({ onSaveToLibrary }: {
  onSaveToLibrary: (target: PersonLibrarySaveTarget, onSaved: (folder: string) => void) => void;
}) {
  const [video, setVideo] = useState<File | null>(null);
  const [portrait, setPortrait] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
  const [savedPrompts, setSavedPrompts] = useState<PromptHistoryItem[]>(readPromptHistory);
  const [promptHistoryOpen, setPromptHistoryOpen] = useState(false);
  const [promptSearch, setPromptSearch] = useState('');
  const [promptHistoryNotice, setPromptHistoryNotice] = useState('');
  const [dialogue, setDialogue] = useState('');
  const [voiceDescription, setVoiceDescription] = useState('');
  const [model, setModel] = useState<Model>('doubao-seedance-2-0-260128');
  const [resolution, setResolution] = useState('720p');
  const [audioMode, setAudioMode] = useState<AudioMode>('preserve');
  const [duration, setDuration] = useState(0);
  const [task, setTask] = useState<PersonTask | null>(null);
  const [tasks, setTasks] = useState<PersonTask[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [missingRequest, setMissingRequest] = useState(false);
  const [pendingRequest, setPendingRequest] = useState(() => { try { return localStorage.getItem(PENDING_KEY) || ''; } catch { return ''; } });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [history, setHistory] = useState<{ kind: 'video' | 'image'; items: UploadHistorySummaryItem[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySelecting, setHistorySelecting] = useState<number | null>(null);
  const [historyOpening, setHistoryOpening] = useState<number | null>(null);
  const [historyPreview, setHistoryPreview] = useState<{ item: UploadHistoryItem; duration?: number } | null>(null);
  const [historyPreviewError, setHistoryPreviewError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const historyRequest = useRef(0);
  const historyPreviewRequest = useRef(0);
  const [acting, setActing] = useState(false);
  const [upstreamTaskId, setUpstreamTaskId] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const selectedId = useRef('');
  const mounted = useRef(true);
  const submitting = useRef(false);
  const videoUrl = usePreview(video);
  const portraitUrl = usePreview(portrait);
  const historyPreviewUrl = usePreview(historyPreview?.item.blob);
  const locked = uploading || recovering || busyTask(task) || acting;
  const maxDuration = model === 'doubao-seedance-2-0-260128' ? 15 : 30;
  const rate = getSeedanceRatePerSecond(model, resolution);
  const estimate = rate !== null && duration > 0 ? (rate * Math.round(duration)).toFixed(2) : null;
  const promptHistory = mergePromptHistory([...savedPrompts, ...tasks.map(item => ({ prompt: item.prompt, timestamp: item.createdAt }))]);
  const filteredPrompts = promptHistory.filter(item => item.prompt.toLocaleLowerCase().includes(promptSearch.trim().toLocaleLowerCase()));

  function rememberPrompt(text: string, showFeedback = false) {
    if (!text.trim()) return;
    const items = mergePromptHistory([{ prompt: text.trim(), timestamp: Date.now() }, ...readPromptHistory()]);
    try {
      localStorage.setItem(PROMPT_HISTORY_KEY, JSON.stringify(items)); setSavedPrompts(items);
      if (showFeedback) setPromptHistoryNotice('已保存到要求历史，下次可直接选用。');
    } catch { if (showFeedback) setPromptHistoryNotice('历史记录未能保存，请检查浏览器存储空间。'); }
  }

  function updateTask(next: PersonTask) {
    setTasks(previous => [next, ...previous.filter(item => item.id !== next.id)].sort((a, b) => b.createdAt - a.createdAt));
    setTask(next); selectedId.current = next.id;
  }
  function rememberPending(value: string) {
    setPendingRequest(value);
    try { if (value) localStorage.setItem(PENDING_KEY, value); else localStorage.removeItem(PENDING_KEY); } catch { /* The server still owns task state. */ }
  }
  async function recover(id = pendingRequest) {
    if (!id) return;
    setRecovering(true); setError('');
    try {
      const json = await request(`${API}/by-request/${encodeURIComponent(id)}`);
      if (json.task) { updateTask(json.task); rememberPrompt(json.task.prompt); rememberPending(''); }
      else { setMissingRequest(true); setError('暂未找到任务记录，可以继续查询，或用相同提交编号重新上传；服务端会合并重复提交。'); }
    } catch (err) { setError(err instanceof Error ? err.message : '查询失败'); }
    finally { setRecovering(false); }
  }
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const json = await request(API);
        if (!mounted.current) return;
        setTasks(json.tasks);
        const current = json.tasks.find((item: PersonTask) => item.id === selectedId.current);
        if (current) setTask(current);
        else if (!selectedId.current && json.tasks.length) { selectedId.current = json.tasks[0].id; setTask(json.tasks[0]); }
      } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : '读取任务失败'); }
      if (mounted.current) timer = setTimeout(refresh, 5000);
    }
    void refresh();
    return () => { mounted.current = false; historyRequest.current++; historyPreviewRequest.current++; clearTimeout(timer); };
  }, []);
  useEffect(() => { if (pendingRequest) void recover(pendingRequest); }, []);

  async function selectFile(file: File | null, kind: 'video' | 'image') {
    if (!file || locked) return false;
    setError(''); setNotice('');
    if (kind === 'video') {
      if (!/\.(mp4|mov)$/i.test(file.name) || file.size > 50 * 1024 * 1024) { setError('请使用50MB以内的MP4或MOV单人视频'); return false; }
      setVideo(file); setDuration(0);
    } else {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('人物参考图请使用10MB以内的JPG、PNG或WebP'); return false; }
      setPortrait(file);
    }
    try { await saveUploadHistory(file, kind); } catch { /* Selecting a file does not depend on history storage. */ }
    return true;
  }
  async function openHistory(kind: 'video' | 'image') {
    if (locked) return;
    historyPreviewRequest.current++; setHistoryPreview(null); setHistoryPreviewError(''); setHistoryOpening(null);
    const requestId = ++historyRequest.current;
    setHistory({ kind, items: [] }); setHistoryLoading(true); setHistoryError('');
    try {
      const items = await loadUploadHistorySummaries(kind);
      if (historyRequest.current === requestId) setHistory({ kind, items });
    } catch (err) { if (historyRequest.current === requestId) setHistoryError(err instanceof Error ? err.message : '读取上传历史失败'); }
    finally { if (historyRequest.current === requestId) setHistoryLoading(false); }
  }
  function closeHistory() {
    if (historySelecting !== null) return;
    historyRequest.current++; historyPreviewRequest.current++;
    setHistory(null); setHistoryPreview(null); setHistoryOpening(null); setHistoryError(''); setHistoryPreviewError('');
  }
  function closeHistoryPreview() {
    if (historySelecting !== null) return;
    historyPreviewRequest.current++; setHistoryPreview(null); setHistoryPreviewError('');
  }
  async function openHistoryPreview(id: number) {
    if (!history || historyOpening !== null || historySelecting !== null) return;
    const requestId = ++historyPreviewRequest.current;
    const kind = history.kind;
    const summary = history.items.find(item => item.id === id);
    setHistoryOpening(id); setHistoryError(''); setHistoryPreviewError('');
    try {
      const item = await getUploadHistoryItem(id);
      if (!mounted.current || requestId !== historyPreviewRequest.current) return;
      if (!item || item.kind !== kind || !(item.blob instanceof Blob) || !item.blob.size) throw new Error('这条历史素材已不存在或文件为空，请重新上传');
      setHistoryPreview({ item, duration: summary?.duration });
    } catch (err) { if (requestId === historyPreviewRequest.current) setHistoryError(err instanceof Error ? err.message : '读取历史素材失败'); }
    finally { if (requestId === historyPreviewRequest.current) setHistoryOpening(null); }
  }
  async function chooseHistory() {
    if (!historyPreview || historySelecting !== null || locked) return;
    const item = historyPreview.item;
    if (item.kind !== 'video' && item.kind !== 'image') return;
    setHistorySelecting(item.id); setHistoryPreviewError('');
    try {
      if (await selectFile(blobToFile(item), item.kind)) {
        historyRequest.current++; historyPreviewRequest.current++; setHistoryPreview(null); setHistory(null);
      } else setHistoryPreviewError('这份素材不符合上传要求，请重新选择');
    } catch (err) { setHistoryPreviewError(err instanceof Error ? err.message : '选用历史素材失败'); }
    finally { setHistorySelecting(null); }
  }
  async function submit(reusePending = false) {
    if (submitting.current || locked || (pendingRequest && !reusePending)) return;
    if (!video || !prompt.trim()) { setError('请上传原视频并填写人物替换要求'); return; }
    if (['rewrite', 'new-voice'].includes(audioMode) && !dialogue.trim()) { setError('请填写新台词'); return; }
    if (!duration || duration < 4 || duration > maxDuration) { setError(`所选模型支持4-${maxDuration}秒视频，请先裁剪或切换模型`); return; }
    let deviceId: string;
    try { deviceId = deviceIdForRequest(); } catch (err) { setError(err instanceof Error ? err.message : '无法识别当前设备'); return; }
    submitting.current = true; setUploading(true); setUploadProgress(0); setError(''); setNotice('');
    const requestId = reusePending ? pendingRequest : crypto.randomUUID(); rememberPending(requestId);
    const form = new FormData();
    form.append('files', video); if (portrait) form.append('files', portrait);
    form.append('prompt', prompt); form.append('model', model); form.append('resolution', resolution);
    form.append('audioMode', audioMode); form.append('dialogue', dialogue); form.append('voiceDescription', voiceDescription); form.append('creationRequestId', requestId);
    try {
      const result = await new Promise<{ task: PersonTask }>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open('POST', API); xhr.withCredentials = true; xhr.timeout = 180000;
        xhr.setRequestHeader('X-Device-Id', deviceId);
        xhr.upload.onprogress = event => { if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100)); };
        xhr.onload = () => {
          let json; try { json = JSON.parse(xhr.responseText); } catch { reject(new Error('服务响应中断，请查询提交结果')); return; }
          if (xhr.status >= 200 && xhr.status < 300 && json.task) resolve(json);
          else {
            // An explicit validation response is safe to edit and submit again.
            if (xhr.status >= 400 && xhr.status < 500) rememberPending('');
            reject(new Error(json.error || '提交失败，请查询任务记录'));
          }
        };
        xhr.onerror = () => reject(new Error('上传连接中断，请查询提交结果，避免重复提交'));
        xhr.ontimeout = () => reject(new Error('提交等待超时，请查询提交结果，避免重复提交'));
        xhr.send(form);
      });
      updateTask(result.task); rememberPrompt(result.task.prompt); rememberPending('');
    } catch (err) { setError(err instanceof Error ? err.message : '提交失败'); }
    finally { submitting.current = false; setUploading(false); }
  }
  useEffect(() => { setUpstreamTaskId(''); setRecoveryError(''); }, [task?.id]);
  async function recoverUpstreamTask() {
    if (!task || !upstreamTaskId.trim() || acting) return;
    setActing(true); setRecoveryError('');
    try { updateTask((await request(`${API}/${task.id}/recover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: upstreamTaskId.trim() }) })).task); }
    catch (err) { setRecoveryError(err instanceof Error ? err.message : '恢复查询失败'); }
    finally { setActing(false); }
  }
  async function retry() {
    if (!task || acting) return;
    setActing(true); setError('');
    try { updateTask((await request(`${API}/${task.id}/retry`, { method: 'POST' })).task); }
    catch (err) { setError(err instanceof Error ? err.message : '重试失败'); }
    finally { setActing(false); }
  }
  function openLibrarySave() {
    if (!task) return;
    const id = task.id;
    onSaveToLibrary(task, libraryFolder => {
      setTasks(previous => previous.map(item => item.id === id ? { ...item, libraryFolder } : item));
      setTask(previous => previous?.id === id ? { ...previous, libraryFolder } : previous);
    });
  }
  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-violet-400 disabled:opacity-60';
  return <div className="space-y-4">
    <p className="text-xs leading-5 text-slate-500">上传单人视频，系统先自动为人脸打码，再按要求替换人物。人物参考图可选；未上传时按文字生成新形象。</p>
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MediaUploadCard kind="video" file={video} previewUrl={videoUrl} duration={duration} disabled={locked} onFile={file => void selectFile(file, 'video')}
          onClear={() => { setVideo(null); setDuration(0); }} onHistory={() => void openHistory('video')} onDuration={setDuration} />
        <MediaUploadCard kind="image" file={portrait} previewUrl={portraitUrl} disabled={locked} onFile={file => void selectFile(file, 'image')}
          onClear={() => setPortrait(null)} onHistory={() => void openHistory('image')} />
      </div>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="person-replacement-prompt" className="text-xs font-bold">人物替换要求</label>
          <div className="flex items-center gap-3">
            <button type="button" disabled={!prompt.trim()} onClick={() => rememberPrompt(prompt, true)} className="text-xs font-semibold text-violet-600 hover:text-violet-800 disabled:opacity-40">保存要求</button>
            <button type="button" onClick={() => { setSavedPrompts(readPromptHistory()); setPromptSearch(''); setPromptHistoryOpen(true); }} className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100"><History size={14} />要求历史{promptHistory.length > 0 && <span className="rounded-full bg-white px-1.5 text-[10px]">{promptHistory.length}</span>}</button>
          </div>
        </div>
        <textarea id="person-replacement-prompt" value={prompt} onChange={event => { setPrompt(event.target.value); setPromptHistoryNotice(''); }} maxLength={6000} rows={5} className={`${inputClass} mt-2`} placeholder="例如：将视频中的人物换成一位穿米白色新中式服装的女性，动作、场景和手中的商品保持原样。" />
        {promptHistoryNotice && <p role="status" className="mt-1 text-[11px] text-slate-500">{promptHistoryNotice}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-bold">生成模型<select aria-label="人物替换模型" value={model} onChange={event => { const next = event.target.value as Model; setModel(next); if (next === 'doubao-seedance-2-5-260628') setResolution('720p'); }} className={`${inputClass} mt-2`}>
          <option value="doubao-seedance-2-0-260128">Seedance 2.0</option><option value="doubao-seedance-2-5-260628">Seedance 2.5</option>
        </select></label>
        <label className="text-xs font-bold">分辨率<select aria-label="人物替换分辨率" value={resolution} onChange={event => setResolution(event.target.value)} className={`${inputClass} mt-2`}>
          {model === 'doubao-seedance-2-0-260128' && <option value="480p">480P</option>}<option value="720p">720P</option>
        </select></label>
      </div>
      <label className="block text-xs font-bold">声音<select aria-label="人物替换声音" value={audioMode} onChange={event => setAudioMode(event.target.value as AudioMode)} className={`${inputClass} mt-2`}>
        <option value="preserve">保留原声与台词（默认）</option><option value="rewrite">沿用原音色，说新台词</option><option value="new-voice">换新音色，说新台词</option><option value="silent">静音</option>
      </select></label>
      {audioMode === 'new-voice' && <label className="block text-xs font-bold">目标音色描述（选填）<input aria-label="人物替换目标音色" value={voiceDescription} onChange={event => setVoiceDescription(event.target.value)} maxLength={500} className={`${inputClass} mt-2`} placeholder="例如：自然亲切的成年女声，普通话，语速适中" /><span className="mt-1 block text-[11px] font-normal leading-5 text-slate-500">不填时按人物要求匹配新声音，不沿用原人物音色。</span></label>}
      {['rewrite', 'new-voice'].includes(audioMode) ? <label className="block text-xs font-bold">新台词<textarea aria-label="人物替换新台词" value={dialogue} onChange={event => setDialogue(event.target.value)} maxLength={2000} rows={4} className={`${inputClass} mt-2`} placeholder="填写希望新人物说的完整台词，口型将跟随新台词。" /><span className="mt-1 block text-[11px] font-normal leading-5 text-slate-500">{audioMode === 'rewrite' ? '原视频需要有清晰人声，用于参考原音色。' : '使用新音色，不要求原视频有人声。'}台词长度尽量适合原视频时长，声音与新口型由模型一同处理。</span></label> : audioMode === 'preserve' ? <p className="text-[11px] leading-5 text-slate-500">只换人物，原台词与声音尽量保持不变，口型由模型同步处理。</p> : null}
      <p className="text-[11px] leading-5 text-slate-500">支持4–{maxDuration}秒，尽量保留原片比例和动作。{estimate ? `视频生成预估 ¥${estimate}` : '上传视频后显示生成费用估算'}；另含人脸打码费用，实际费用以火山账单为准。</p>
    </fieldset>
    <button type="button" disabled={locked || !!pendingRequest || !video || !prompt.trim() || (['rewrite', 'new-voice'].includes(audioMode) && !dialogue.trim())} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-5 py-3 text-xs font-bold text-white disabled:opacity-50">
      {locked ? <Loader2 size={16} className="animate-spin" /> : <UserRound size={16} />}{uploading ? `正在上传 ${uploadProgress}%` : '开始人物替换'}
    </button>
    {pendingRequest && missingRequest && !uploading && <button type="button" disabled={locked || !video || !prompt.trim()} onClick={() => void submit(true)} className="ml-2 text-xs font-bold text-violet-600">用相同编号重新上传</button>}
    {pendingRequest && !uploading && <button type="button" disabled={recovering} onClick={() => void recover()} className="ml-2 text-xs font-bold text-violet-600">查询上次提交结果</button>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs leading-5 text-red-600">{error}</p>}
    {task && <div aria-live="polite" className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
      <div className="flex items-center gap-2 text-xs font-bold text-violet-700">{busyTask(task) ? <Loader2 size={16} className="animate-spin" /> : task.stage === 'completed' ? <Check size={16} /> : <RefreshCw size={16} />}{STAGES[task.stage] || task.stage}</div>
      <p className="break-all text-[11px] text-slate-500">{task.sourceName} · {task.model.includes('2-5') ? 'Seedance 2.5' : 'Seedance 2.0'} · {task.resolution.toUpperCase()} · {new Date(task.createdAt).toLocaleString('zh-CN')}</p>
      {task.voiceDescription && <p className="text-xs leading-5 text-slate-600">目标音色：{task.voiceDescription}</p>}
      {task.dialogue && <details className="text-xs text-slate-600"><summary className="cursor-pointer">查看本次新台词</summary><p className="mt-2 whitespace-pre-wrap leading-5">{task.dialogue}</p></details>}
      {task.notice && <p className="text-xs leading-5 text-amber-700">{task.notice}</p>}
      {task.error && <p role="alert" className="text-xs leading-5 text-red-600">{task.error}</p>}
      {task.stage === 'failed' && task.generatedVideoUrl && <details className="text-xs text-slate-600"><summary className="cursor-pointer">查看已生成的画面</summary><video src={task.generatedVideoUrl} controls preload="none" className="mt-2 max-h-60 w-full rounded-lg bg-slate-950" /></details>}
      {task.canRecover && <div className="space-y-2 rounded-lg border border-amber-200 bg-white p-3">
        <p className="text-xs leading-5 text-slate-600">已保留打码视频。{task.awaitingNotification ? '可等待火山任务通知，或填入火山后台对应这条视频的任务编号，直接找回结果。' : '请填入火山后台对应这条视频的任务编号，直接找回结果。'}这里只查询已有任务，不会重新生成。</p>
        <label className="block text-xs font-bold">火山任务编号<input aria-label="恢复人物替换任务编号" value={upstreamTaskId} onChange={event => setUpstreamTaskId(event.target.value)} placeholder="例如 cgt- 开头的任务编号" className={`${inputClass} mt-2`} disabled={acting} /></label>
        <button type="button" disabled={acting || !upstreamTaskId.trim()} onClick={() => void recoverUpstreamTask()} className="text-xs font-bold text-violet-700">{acting ? '正在查询…' : '找回已有任务（不重新生成）'}</button>
        {recoveryError && <p role="alert" className="text-xs text-red-600">{recoveryError}</p>}
      </div>}
      {task.generationTaskId && <p className="break-all text-[11px] text-slate-500">火山任务：{task.generationTaskId}</p>}
      {task.canRetry && <button type="button" disabled={acting} onClick={() => void retry()} className="text-xs font-bold text-violet-700">按原要求重试（复用已完成的打码）</button>}
      {task.maskedVideoUrl && <details className="text-xs text-slate-600"><summary className="cursor-pointer">查看打码结果</summary><video src={task.maskedVideoUrl} controls preload="none" className="mt-2 max-h-60 w-full rounded-lg bg-slate-950" /></details>}
      {task.videoUrl && <><video src={task.videoUrl} controls playsInline className="max-h-96 w-full rounded-xl bg-slate-950" />
        <a href={task.videoUrl} download={`人物替换-${task.id}.mp4`} className="inline-flex items-center gap-1 text-xs font-bold text-violet-700"><Download size={14} />下载成片</a>
        <button type="button" disabled={!!task.libraryFolder} onClick={openLibrarySave} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-700">
          {task.libraryFolder ? <Check size={14} /> : <FolderOpen size={14} />}{task.libraryFolder ? `已保存至 ${task.libraryFolder}` : '保存到视频素材库'}
        </button>
      </>}
    </div>}
    {notice && <p className="text-xs text-emerald-700">{notice}</p>}
    <div className="space-y-2 border-t border-slate-200 pt-3"><div className="text-xs font-bold">人物替换记录 <span className="ml-1 text-[10px] font-normal text-slate-400">仅当前设备</span></div>
      {!tasks.length && <p className="text-xs text-slate-400">当前设备暂无记录，处理进度会自动保存，刷新后可继续查看。</p>}
      {tasks.map(item => <button type="button" key={item.id} disabled={uploading || acting} onClick={() => { selectedId.current = item.id; setTask(item); setNotice(''); }} className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-left text-xs ${task?.id === item.id ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`}>
        <span className="min-w-0"><span className="block truncate">{item.sourceName}</span><span className="text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</span></span><span className="shrink-0 text-[11px]">{STAGES[item.stage] || item.stage}</span>
      </button>)}
    </div>
    {promptHistoryOpen && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setPromptHistoryOpen(false)} onKeyDown={event => { if (event.key === 'Escape') setPromptHistoryOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="人物替换要求历史" className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl bg-white p-4" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between text-sm font-bold">人物替换要求历史<button type="button" aria-label="关闭要求历史" onClick={() => setPromptHistoryOpen(false)} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>
        <p className="my-3 text-xs leading-5 text-slate-500">已提交的要求会自动记录，也可点击“保存要求”提前收藏。选用后仍可修改，只填入人物要求。</p>
        <input autoFocus aria-label="搜索人物替换要求历史" value={promptSearch} onChange={event => setPromptSearch(event.target.value)} placeholder="搜索历史要求" className={`${inputClass} mb-3`} />
        <div className="min-h-0 space-y-3 overflow-y-auto">
          {filteredPrompts.map(item => <div key={item.prompt.trim()} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-3"><span className="text-[11px] text-slate-400">{new Date(item.timestamp).toLocaleString('zh-CN')}</span><button type="button" disabled={locked} onClick={() => { setPrompt(item.prompt); rememberPrompt(item.prompt); setPromptHistoryOpen(false); setPromptHistoryNotice('已填入历史要求，可继续修改。'); }} className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40">使用这条</button></div>
            <p className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-700">{item.prompt}</p>
          </div>)}
          {!filteredPrompts.length && <p className="py-10 text-center text-xs text-slate-400">{promptHistory.length ? '没有找到匹配的要求，换个关键词试试。' : '暂无历史要求，保存或提交后会显示在这里。'}</p>}
        </div>
      </div>
    </div>}
    {history && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4" onClick={closeHistory} onKeyDown={event => { if (event.key === 'Escape') closeHistory(); }}><div role="dialog" aria-modal="true" aria-label={history.kind === 'video' ? '选择历史视频' : '选择人物历史图片'} className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-4" onClick={event => event.stopPropagation()}>
      <div className="mb-2 flex items-center justify-between text-sm font-bold">{history.kind === 'video' ? '选择历史视频' : '选择人物参考图'}<button type="button" disabled={historySelecting !== null} aria-label="关闭上传历史" onClick={closeHistory} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"><X size={20} /></button></div>
      <p className="mb-4 text-xs leading-5 text-slate-500">{history.kind === 'video' ? '点击缩略图先预览播放，确认后选用此视频。支持MP4 / MOV，最大50MB。' : '点击缩略图查看完整图片，确认后选用作本次人物参考。'}</p>
      {historyError && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-2 text-xs text-red-600">{historyError}</p>}
      {historyLoading ? <div className="flex justify-center gap-2 py-12 text-xs text-slate-500"><Loader2 size={16} className="animate-spin" />正在读取历史记录…</div>
        : history.items.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{history.items.map(item => <HistoryMedia key={item.id} item={item} disabled={historySelecting !== null || historyOpening !== null} selecting={historyOpening === item.id} onSelect={() => void openHistoryPreview(item.id)} />)}</div>
        : <div className="grid place-items-center gap-2 py-12 text-slate-400"><History size={28} /><p className="text-xs">{history.kind === 'video' ? '暂无历史视频，上传后会自动保存在这里。' : '暂无历史图片，上传后会自动保存在这里。'}</p></div>}
    </div></div>}
    {historyPreview && historyPreviewUrl && <UploadHistoryPreview
      item={{ kind: historyPreview.item.kind === 'video' ? 'video' : 'image', name: historyPreview.item.name, previewUrl: historyPreviewUrl }}
      duration={historyPreview.duration} selecting={historySelecting !== null} error={historyPreviewError}
      selectionDisabledReason={historyUnavailableReason({ ...historyPreview.item, size: historyPreview.item.blob.size }) || (locked ? '当前任务处理中，请完成后再选用。' : '')}
      onClose={closeHistoryPreview} onSelect={() => void chooseHistory()}
      onDuration={seconds => setHistoryPreview(previous => previous ? { ...previous, duration: seconds } : previous)} />}
  </div>;
}
