import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, FolderOpen, Loader2, Play, Plus, RefreshCw, Search, Trash2, Upload, Video, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import {
  deleteVideoLibraryVideo,
  formatVideoLibrarySize,
  formatVideoLibraryTime,
  getVideoLibrary,
  updateVideoLibraryNote,
  uploadVideoLibraryVideo,
  type VideoLibraryItem,
} from '@/src/lib/videoLibrary';

interface VideoLibraryPageProps {
  onBack: () => void;
}

const DEFAULT_FOLDER = '通用素材';

export default function VideoLibraryPage({ onBack }: VideoLibraryPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<VideoLibraryItem[]>([]);
  const [folders, setFolders] = useState<string[]>([DEFAULT_FOLDER]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [search, setSearch] = useState('');
  const [folderDraft, setFolderDraft] = useState(DEFAULT_FOLDER);
  const [noteDraft, setNoteDraft] = useState('');
  const [selectedItem, setSelectedItem] = useState<VideoLibraryItem | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    setIsLoading(true);
    setError('');
    try {
      const result = await getVideoLibrary({ folder: selectedFolder, query: search.trim() });
      setItems(result.items);
      setFolders(result.folders);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取视频库失败');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [selectedFolder]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, VideoLibraryItem[]>();
    items.forEach((item) => {
      const list = groups.get(item.folderName) || [];
      list.push(item);
      groups.set(item.folderName, list);
    });
    return Array.from(groups.entries());
  }, [items]);

  function openUpload(folder = selectedFolder || DEFAULT_FOLDER) {
    setFolderDraft(folder || DEFAULT_FOLDER);
    setNoteDraft('');
    setError('');
    setIsUploadOpen(true);
  }

  function handleFilePick() {
    inputRef.current?.click();
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('请选择视频文件');
      return;
    }
    setIsUploading(true);
    setError('');
    setNotice('');
    try {
      const result = await uploadVideoLibraryVideo(file, folderDraft, noteDraft);
      setNotice(result.message || (result.duplicate ? '这个视频已经存在，没有重复保存' : '视频上传成功'));
      setIsUploadOpen(false);
      setSelectedFolder(folderDraft === DEFAULT_FOLDER ? '' : folderDraft);
      await refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传视频失败');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSaveNote(item: VideoLibraryItem, note: string) {
    try {
      const updated = await updateVideoLibraryNote(item.id, note);
      setItems((previous) => previous.map((current) => current.id === updated.id ? updated : current));
      setSelectedItem(updated);
      setNotice('备注已保存，所有设备都会同步');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存备注失败');
    }
  }

  async function handleDelete(item: VideoLibraryItem) {
    if (!window.confirm(`确定删除“${item.originalName}”吗？删除后所有设备都会消失。`)) return;
    try {
      await deleteVideoLibraryVideo(item.id);
      setItems((previous) => previous.filter((current) => current.id !== item.id));
      setSelectedItem(null);
      setNotice('视频已删除');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除视频失败');
    }
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5 text-slate-900 md:px-8">
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 rounded-3xl border border-white/80 bg-white/90 px-5 py-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 hover:bg-slate-50" title="返回首页">
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.22em] text-sky-600"><Video className="size-4" />视频素材库</div>
            <h1 className="truncate text-2xl font-black tracking-tight">团队共享视频素材</h1>
            <p className="mt-1 text-xs font-semibold text-slate-400">原文件保存，多设备同步，方便复用和互相借鉴</p>
          </div>
        </div>
        <button type="button" onClick={() => openUpload()} className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800">
          <Upload className="size-4" />上传视频
        </button>
      </header>

      <section className="mx-auto mt-5 max-w-7xl rounded-3xl border border-white/80 bg-white/90 p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refresh(); }} placeholder="搜索视频名称、画名或备注" className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm font-semibold outline-none focus:border-sky-300 focus:bg-white" />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            <button type="button" onClick={() => setSelectedFolder('')} className={cn('whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-black', !selectedFolder ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>全部视频</button>
            {folders.map((folder) => <button key={folder} type="button" onClick={() => setSelectedFolder(folder)} className={cn('whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-black', selectedFolder === folder ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>{folder}</button>)}
          </div>
          <button type="button" onClick={() => void refresh()} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm font-black text-slate-600 hover:bg-slate-50"><RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />刷新</button>
        </div>
        {(error || notice) && <div className={cn('mt-3 rounded-2xl px-4 py-3 text-sm font-bold', error ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700')}>{error || notice}</div>}
      </section>

      <section className="mx-auto mt-5 max-w-7xl space-y-6">
        {isLoading ? <div className="flex items-center justify-center rounded-3xl border border-white/80 bg-white/80 py-24 text-sm font-bold text-slate-400"><Loader2 className="mr-2 size-5 animate-spin" />正在读取共享视频库</div> : groupedItems.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white/70 py-24 text-center"><FolderOpen className="mx-auto size-10 text-slate-300" /><h2 className="mt-3 text-lg font-black text-slate-600">还没有共享视频</h2><p className="mt-1 text-sm font-semibold text-slate-400">先上传一条视频，团队成员就都能看到</p><button type="button" onClick={() => openUpload()} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-sky-500 px-4 py-3 text-sm font-black text-white"><Plus className="size-4" />上传第一条</button></div> : groupedItems.map(([folder, folderItems]) => <div key={folder}><div className="mb-3 flex items-center gap-2"><FolderOpen className="size-5 text-sky-500" /><h2 className="text-lg font-black">{folder}</h2><span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-black text-slate-500">{folderItems.length}</span><button type="button" onClick={() => openUpload(folder)} className="ml-auto inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"><Plus className="size-3.5" />上传到这里</button></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{folderItems.map((item) => <article key={item.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"><button type="button" onClick={() => setSelectedItem(item)} className="group relative block aspect-video w-full bg-slate-900 text-left"><video src={item.streamUrl} preload="metadata" muted playsInline className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 text-white transition-colors group-hover:bg-slate-950/30"><Play className="size-10 opacity-0 drop-shadow transition-opacity group-hover:opacity-100" /></span></button><div className="p-4"><h3 className="truncate text-sm font-black" title={item.originalName}>{item.originalName}</h3><div className="mt-1 flex items-center justify-between text-[11px] font-semibold text-slate-400"><span>{formatVideoLibrarySize(item.fileSize)}</span><span>{formatVideoLibraryTime(item.createdAt)}</span></div>{item.note && <p className="mt-3 line-clamp-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-700">备注：{item.note}</p>}<div className="mt-3 flex items-center gap-2"><a href={item.downloadUrl} download className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2 text-xs font-black text-slate-600 hover:bg-slate-200"><Download className="size-3.5" />下载原视频</a><button type="button" onClick={() => void handleDelete(item)} className="inline-flex size-9 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500" title="删除视频"><Trash2 className="size-4" /></button></div></div></article>)}</div></div>)}
      </section>

      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(event) => void handleUpload(event)} />

      {isUploadOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => !isUploading && setIsUploadOpen(false)}><div className="w-full max-w-lg rounded-3xl border border-white/80 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><h2 className="text-xl font-black">上传共享视频</h2><p className="mt-1 text-xs font-semibold text-slate-400">原视频不会被重新压缩，单个文件不超过10MB</p></div><button type="button" onClick={() => setIsUploadOpen(false)} disabled={isUploading} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div><label className="mt-5 block text-sm font-black text-slate-600">保存到文件夹</label><input value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} list="video-library-folders" placeholder="例如：通用素材、富贵牡丹" className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-sky-300 focus:bg-white" /><datalist id="video-library-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist><label className="mt-4 block text-sm font-black text-slate-600">备注（可选）</label><textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} rows={3} placeholder="例如：已违规，不建议继续使用" className="mt-2 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold outline-none focus:border-sky-300 focus:bg-white" /><button type="button" onClick={handleFilePick} disabled={isUploading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 py-3.5 text-sm font-black text-white shadow-sm hover:bg-sky-600 disabled:opacity-60"><Upload className="size-4" />{isUploading ? '正在上传...' : '选择视频并上传'}</button></div></div>}

      {selectedItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={() => setSelectedItem(null)}><div className="w-full max-w-3xl rounded-3xl bg-white p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between gap-3 px-2 pb-3"><div className="min-w-0"><h2 className="truncate text-lg font-black">{selectedItem.originalName}</h2><p className="text-xs font-semibold text-slate-400">{selectedItem.folderName} · {formatVideoLibrarySize(selectedItem.fileSize)}</p></div><button type="button" onClick={() => setSelectedItem(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div><video src={selectedItem.streamUrl} controls autoPlay playsInline className="max-h-[65vh] w-full rounded-2xl bg-black" /><div className="mt-4 flex gap-2"><input defaultValue={selectedItem.note} onKeyDown={(event) => { if (event.key === 'Enter') void handleSaveNote(selectedItem, event.currentTarget.value); }} placeholder="输入备注后按回车保存" className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-sky-300 focus:bg-white" /><a href={selectedItem.downloadUrl} download className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-black text-white"><Download className="size-4" />下载</a></div></div></div>}
    </main>
  );
}
