import { useEffect, useRef, useState } from 'react';
import { Loader2, History, X, Download, RefreshCw, UserRound, Check } from 'lucide-react';
import { getSeedanceRatePerSecond } from '@/src/lib/creative';
import { blobToFile, getUploadHistoryItem, loadUploadHistorySummaries, saveUploadHistory, type UploadHistorySummaryItem } from '@/src/lib/uploadHistory';
import { getVideoLibraryFolders } from '@/src/lib/videoLibrary';
import { invalidateVideoLibraryCache } from '@/src/lib/videoLibraryViewCache';

type Model = 'doubao-seedance-2-0-260128' | 'doubao-seedance-2-5-260628';
type AudioMode = 'preserve' | 'rewrite' | 'new-voice' | 'silent' | 'generate';
interface PersonTask {
  id: string; stage: string; model: Model; resolution: string; audioMode: AudioMode; prompt: string; dialogue?: string; voiceDescription?: string;
  sourceName: string; duration: number; createdAt: number; updatedAt: number;
  videoUrl: string; maskedVideoUrl: string; generatedVideoUrl: string; error: string; notice: string; canRetry: boolean; ambiguous: boolean;
}
const API = '/api/person-replacement/tasks';
const PENDING_KEY = 'kelongai.personReplacement.pendingRequest';
const STAGES: Record<string, string> = {
  uploading: '正在保存原视频', queued: '等待人脸打码', normalizing: '正在准备视频格式',
  submitting_blur: '正在提交人脸打码', blurring: '正在识别人脸并打码', saving_mask: '正在保存打码结果',
  ready: '打码完成，准备替换人物', submitting_generation: '正在提交人物替换', generating: 'Seedance 正在替换人物',
  finalizing: '正在处理声音并保存成片', completed: '人物替换完成', failed: '处理未完成',
};
const busyTask = (task: PersonTask | null) => !!task && !['completed', 'failed'].includes(task.stage);
async function request(url: string, options?: RequestInit) {
  const response = await fetch(url, { credentials: 'include', ...options });
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
function HistoryImage({ item, onSelect }: { item: UploadHistorySummaryItem; onSelect: () => void }) {
  const url = usePreview(item.previewBlob);
  return <button type="button" onClick={onSelect} className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 text-left hover:border-violet-400">
    {url ? <img src={url} alt={item.name} className="h-24 w-full object-contain" /> : <UserRound className="mx-auto h-24 text-slate-300" />}
    <div className="mt-1 truncate text-xs">{item.name}</div>
  </button>;
}

export default function PersonReplacementPanel() {
  const [video, setVideo] = useState<File | null>(null);
  const [portrait, setPortrait] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('');
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
  const [history, setHistory] = useState<UploadHistorySummaryItem[] | null>(null);
  const [folder, setFolder] = useState('人物替换');
  const [folders, setFolders] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [acting, setActing] = useState(false);
  const selectedId = useRef('');
  const mounted = useRef(true);
  const submitting = useRef(false);
  const videoUrl = usePreview(video);
  const portraitUrl = usePreview(portrait);
  const locked = uploading || recovering || busyTask(task) || acting;
  const maxDuration = model === 'doubao-seedance-2-0-260128' ? 15 : 30;
  const rate = getSeedanceRatePerSecond(model, resolution);
  const estimate = rate !== null && duration > 0 ? (rate * Math.round(duration)).toFixed(2) : null;

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
      if (json.task) { updateTask(json.task); rememberPending(''); }
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
    void getVideoLibraryFolders().then(setFolders).catch(() => {});
    return () => { mounted.current = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { if (pendingRequest) void recover(pendingRequest); }, []);

  async function selectFile(file: File | null, kind: 'video' | 'image') {
    if (!file) return;
    setError(''); setNotice('');
    if (kind === 'video') {
      if (!/\.(mp4|mov)$/i.test(file.name) || file.size > 50 * 1024 * 1024) { setError('请使用50MB以内的MP4或MOV单人视频'); return; }
      setVideo(file); setDuration(0);
    } else {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('人物参考图请使用10MB以内的JPG、PNG或WebP'); return; }
      setPortrait(file);
    }
    try { await saveUploadHistory(file, kind); } catch { /* Selecting a file does not depend on history storage. */ }
  }
  async function chooseHistory(id: number) {
    try {
      const item = await getUploadHistoryItem(id);
      if (!item) throw new Error('这张历史图片已不存在');
      await selectFile(blobToFile(item), 'image'); setHistory(null);
    } catch (err) { setError(err instanceof Error ? err.message : '读取历史图片失败'); }
  }
  async function submit(reusePending = false) {
    if (submitting.current || locked || (pendingRequest && !reusePending)) return;
    if (!video || !prompt.trim()) { setError('请上传原视频并填写人物替换要求'); return; }
    if (['rewrite', 'new-voice'].includes(audioMode) && !dialogue.trim()) { setError('请填写新台词'); return; }
    if (!duration || duration < 4 || duration > maxDuration) { setError(`所选模型支持4-${maxDuration}秒视频，请先裁剪或切换模型`); return; }
    submitting.current = true; setUploading(true); setUploadProgress(0); setError(''); setNotice('');
    const requestId = reusePending ? pendingRequest : crypto.randomUUID(); rememberPending(requestId);
    const form = new FormData();
    form.append('files', video); if (portrait) form.append('files', portrait);
    form.append('prompt', prompt); form.append('model', model); form.append('resolution', resolution);
    form.append('audioMode', audioMode); form.append('dialogue', dialogue); form.append('voiceDescription', voiceDescription); form.append('creationRequestId', requestId);
    try {
      const result = await new Promise<{ task: PersonTask }>((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhr.open('POST', API); xhr.withCredentials = true; xhr.timeout = 180000;
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
      updateTask(result.task); rememberPending('');
    } catch (err) { setError(err instanceof Error ? err.message : '提交失败'); }
    finally { submitting.current = false; setUploading(false); }
  }
  async function retry() {
    if (!task || acting) return;
    setActing(true); setError('');
    try { updateTask((await request(`${API}/${task.id}/retry`, { method: 'POST' })).task); }
    catch (err) { setError(err instanceof Error ? err.message : '重试失败'); }
    finally { setActing(false); }
  }
  async function save() {
    if (!task || saving) return;
    setSaving(true); setNotice('');
    try {
      const json = await request(`${API}/${task.id}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderName: folder }) });
      invalidateVideoLibraryCache();
      setNotice(json.message);
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setSaving(false); }
  }
  const inputClass = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-violet-400 disabled:opacity-60';
  return <div className="space-y-4">
    <p className="text-xs leading-5 text-slate-500">上传单人视频，系统先自动为人脸打码，再按要求替换人物。人物参考图可选；未上传时按文字生成新形象。</p>
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <label className="block text-xs font-bold">原视频（必传）<input aria-label="上传人物替换原视频" type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="mt-2 block w-full text-[11px]" onChange={event => { void selectFile(event.target.files?.[0] || null, 'video'); event.target.value = ''; }} /></label>
          {videoUrl && <video src={videoUrl} controls preload="metadata" onLoadedMetadata={event => setDuration(event.currentTarget.duration)} className="max-h-48 w-full rounded-lg bg-slate-950" />}
          <p className="break-all text-[11px] text-slate-500">{video?.name || 'MP4 / MOV，最大50MB'}{duration > 0 ? ` · ${duration.toFixed(1)}秒` : ''}</p>
        </div>
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <label className="block text-xs font-bold">目标人物参考图（选传）<input aria-label="上传目标人物参考图" type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-[11px]" onChange={event => { void selectFile(event.target.files?.[0] || null, 'image'); event.target.value = ''; }} /></label>
          {portraitUrl && <img src={portraitUrl} alt="目标人物参考" className="h-36 w-full rounded-lg object-contain" />}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="inline-flex items-center gap-1 text-xs font-bold text-violet-600" onClick={() => { void loadUploadHistorySummaries('image').then(setHistory).catch(err => setError(String(err))); }}><History size={14} />历史图片</button>
            {portrait && <button type="button" onClick={() => setPortrait(null)} className="text-xs text-slate-500">移除参考图</button>}
          </div>
          {portrait && <p className="break-all text-[11px] text-slate-500">{portrait.name}</p>}
        </div>
      </div>
      <label className="block text-xs font-bold">人物替换要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={6000} rows={5} className={`${inputClass} mt-2`} placeholder="例如：将视频中的人物换成一位穿米白色新中式服装的女性，动作、场景和手中的商品保持原样。" /></label>
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
      {task.canRetry && <button type="button" disabled={acting} onClick={() => void retry()} className="text-xs font-bold text-violet-700">按原要求重试（复用已完成的打码）</button>}
      {task.maskedVideoUrl && <details className="text-xs text-slate-600"><summary className="cursor-pointer">查看打码结果</summary><video src={task.maskedVideoUrl} controls preload="none" className="mt-2 max-h-60 w-full rounded-lg bg-slate-950" /></details>}
      {task.videoUrl && <><video src={task.videoUrl} controls playsInline className="max-h-96 w-full rounded-xl bg-slate-950" />
        <a href={task.videoUrl} download={`人物替换-${task.id}.mp4`} className="inline-flex items-center gap-1 text-xs font-bold text-violet-700"><Download size={14} />下载成片</a>
        <div className="flex gap-2"><input aria-label="人物替换保存文件夹" value={folder} onChange={event => setFolder(event.target.value)} list="person-replacement-folders" className={inputClass} placeholder="保存文件夹" /><datalist id="person-replacement-folders">{folders.map(name => <option key={name} value={name} />)}</datalist>
          <button type="button" disabled={saving || !folder.trim()} onClick={() => void save()} className="shrink-0 text-xs font-bold text-violet-700">{saving ? '保存中…' : '保存到素材库'}</button></div>
      </>}
    </div>}
    {notice && <p className="text-xs text-emerald-700">{notice}</p>}
    <div className="space-y-2 border-t border-slate-200 pt-3"><div className="text-xs font-bold">人物替换记录</div>
      {!tasks.length && <p className="text-xs text-slate-400">暂无记录，处理进度会自动保存，刷新后可继续查看。</p>}
      {tasks.map(item => <button type="button" key={item.id} disabled={uploading || acting} onClick={() => { selectedId.current = item.id; setTask(item); setNotice(''); }} className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-left text-xs ${task?.id === item.id ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`}>
        <span className="min-w-0"><span className="block truncate">{item.sourceName}</span><span className="text-[10px] text-slate-400">{new Date(item.createdAt).toLocaleString('zh-CN')}</span></span><span className="shrink-0 text-[11px]">{STAGES[item.stage] || item.stage}</span>
      </button>)}
    </div>
    {history && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setHistory(null)}><div role="dialog" aria-modal="true" aria-label="选择人物历史图片" className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-2xl bg-white p-4" onClick={event => event.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between text-sm font-bold">选择人物参考图<button type="button" aria-label="关闭人物图片历史" onClick={() => setHistory(null)}><X size={20} /></button></div>
      <div className="grid grid-cols-3 gap-3">{history.map(item => <HistoryImage key={item.id} item={item} onSelect={() => void chooseHistory(item.id)} />)}</div>{!history.length && <p className="text-xs text-slate-500">暂无历史图片</p>}
    </div></div>}
  </div>;
}
