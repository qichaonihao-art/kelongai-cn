import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, FolderOpen, Loader2, Play, Plus, RefreshCw, Search, Trash2, Upload, Video, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import {
  deleteVideoLibraryVideo,
  createVideoLibraryFolder,
  formatVideoLibrarySize,
  formatVideoLibraryTime,
  getVideoLibrary,
  updateVideoLibraryItem,
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
  const [newFolderDraft, setNewFolderDraft] = useState('');
  const [selectedItem, setSelectedItem] = useState<VideoLibraryItem | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isFolderOpen, setIsFolderOpen] = useState(false);
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
      const result = await uploadVideoLibraryVideo(file, folderDraft);
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

  async function handleCreateFolder() {
    if (!newFolderDraft.trim()) {
      setError('请输入文件夹名称');
      return;
    }
    try {
      const folder = await createVideoLibraryFolder(newFolderDraft.trim());
      setFolders((previous) => Array.from(new Set([...previous, folder])));
      setSelectedFolder(folder);
      setNewFolderDraft('');
      setIsFolderOpen(false);
      setNotice(`文件夹“${folder}”已创建`);
    } catch (folderError) {
      setError(folderError instanceof Error ? folderError.message : '新建文件夹失败');
    }
  }

  async function handleSaveNote(item: VideoLibraryItem, note: string) {
    try {
      const updated = await updateVideoLibraryItem(item.id, { note });
      setItems((previous) => previous.map((current) => current.id === updated.id ? updated : current));
      setSelectedItem(updated);
      setNotice('备注已保存，所有设备都会同步');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存备注失败');
    }
  }

  function startRename(item: VideoLibraryItem) {
    setRenamingId(item.id);
    setRenameDraft(item.originalName);
  }

  async function saveRename(item: VideoLibraryItem) {
    const originalName = renameDraft.trim();
    if (!originalName || originalName === item.originalName) {
      setRenamingId(null);
      return;
    }
    try {
      const updated = await updateVideoLibraryItem(item.id, { originalName });
      setItems((previous) => previous.map((current) => current.id === updated.id ? updated : current));
      if (selectedItem?.id === updated.id) setSelectedItem(updated);
      setRenamingId(null);
      setNotice('视频名称已保存，所有设备都会同步');
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : '保存视频名称失败');
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
    <main className="min-h-screen bg-slate-100 px-3 py-4 text-slate-900 md:px-6">
      <section className="mx-auto max-w-7xl rounded-2xl border border-white/80 bg-white/90 p-3 shadow-sm md:p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-3">
          <button type="button" onClick={onBack} className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50" title="返回首页">
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex min-w-0 items-center gap-2 text-sm font-black text-slate-700"><Video className="size-4 text-sky-500" />视频素材库</div>
          <button type="button" onClick={() => { setError(''); setNewFolderDraft(''); setIsFolderOpen(true); }} className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-black text-white shadow-sm hover:bg-slate-800">
            <Plus className="size-4" />新建文件夹
          </button>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1 lg:flex-none lg:w-72 xl:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refresh(); }} placeholder="搜索素材" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-semibold outline-none focus:border-sky-300 focus:bg-white" />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            <button type="button" onClick={() => setSelectedFolder('')} className={cn('whitespace-nowrap rounded-xl px-3 py-2 text-xs font-black', !selectedFolder ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>全部视频</button>
            {folders.map((folder) => <button key={folder} type="button" onClick={() => setSelectedFolder(folder)} className={cn('whitespace-nowrap rounded-xl px-3 py-2 text-xs font-black', selectedFolder === folder ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200')}>{folder}</button>)}
          </div>
          <button type="button" onClick={() => void refresh()} className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-black text-slate-600 hover:bg-slate-50"><RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />刷新</button>
        </div>
        {(error || notice) && <div className={cn('mt-3 rounded-2xl px-4 py-3 text-sm font-bold', error ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700')}>{error || notice}</div>}
      </section>

      <section className="mx-auto mt-4 max-w-7xl space-y-5">
        {isLoading ? <div className="flex items-center justify-center rounded-2xl border border-white/80 bg-white/80 py-20 text-sm font-bold text-slate-400"><Loader2 className="mr-2 size-5 animate-spin" />正在读取共享视频库</div> : groupedItems.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 py-20 text-center"><FolderOpen className="mx-auto size-9 text-slate-300" /><h2 className="mt-3 text-lg font-black text-slate-600">还没有共享视频</h2><p className="mt-1 text-sm font-semibold text-slate-400">先上传一条视频，团队成员就都能看到</p><button type="button" onClick={() => openUpload()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-black text-white"><Plus className="size-4" />上传第一条</button></div> : groupedItems.map(([folder, folderItems]) => <div key={folder}><div className="mb-2 flex items-center gap-2"><FolderOpen className="size-4 text-sky-500" /><h2 className="text-base font-black">{folder}</h2><span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-black text-slate-500">{folderItems.length}</span><button type="button" onClick={() => openUpload(folder)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50"><Plus className="size-3" />上传</button></div><div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{folderItems.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md"><button type="button" onClick={() => setSelectedItem(item)} className="group relative block aspect-video w-full bg-slate-900 text-left"><video src={item.streamUrl} preload="metadata" muted playsInline className="h-full w-full object-cover" /><span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 text-white transition-colors group-hover:bg-slate-950/30"><Play className="size-7 opacity-0 drop-shadow transition-opacity group-hover:opacity-100" /></span></button><div className="p-2.5"><div className="flex items-center gap-1">{renamingId === item.id ? <input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onBlur={() => void saveRename(item)} onKeyDown={(event) => { if (event.key === 'Enter') void saveRename(item); if (event.key === 'Escape') setRenamingId(null); }} className="min-w-0 flex-1 rounded-md border border-sky-300 bg-sky-50 px-1.5 py-1 text-xs font-black outline-none" /> : <h3 onDoubleClick={() => startRename(item)} className="min-w-0 flex-1 cursor-text truncate text-xs font-black" title="双击修改名称">{item.originalName}</h3>}<button type="button" onClick={() => setSelectedItem(item)} className={cn('shrink-0 rounded-md px-1.5 py-1 text-[10px] font-black', item.note ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>备注</button></div><div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-slate-400"><span>{formatVideoLibrarySize(item.fileSize)}</span><span>{formatVideoLibraryTime(item.createdAt)}</span></div>{item.note && <p className="mt-2 line-clamp-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-bold leading-4 text-amber-700">{item.note}</p>}<div className="mt-2 flex items-center gap-1.5"><a href={item.downloadUrl} download className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 py-1.5 text-[10px] font-black text-slate-600 hover:bg-slate-200"><Download className="size-3" />下载</a><button type="button" onClick={() => void handleDelete(item)} className="inline-flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="删除视频"><Trash2 className="size-3.5" /></button></div></div></article>)}</div></div>)}
      </section>

      <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(event) => void handleUpload(event)} />

      {isUploadOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => !isUploading && setIsUploadOpen(false)}><div className="w-full max-w-lg rounded-3xl border border-white/80 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><div><h2 className="text-xl font-black">上传共享视频</h2><p className="mt-1 text-xs font-semibold text-slate-400">原视频不会被重新压缩，单个文件不超过10MB</p></div><button type="button" onClick={() => setIsUploadOpen(false)} disabled={isUploading} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div><label className="mt-5 block text-sm font-black text-slate-600">保存到文件夹</label><input value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} list="video-library-folders" placeholder="例如：通用素材、富贵牡丹" className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-sky-300 focus:bg-white" /><datalist id="video-library-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist><button type="button" onClick={handleFilePick} disabled={isUploading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 py-3.5 text-sm font-black text-white shadow-sm hover:bg-sky-600 disabled:opacity-60"><Upload className="size-4" />{isUploading ? '正在上传...' : '选择视频并上传'}</button></div></div>}

      {isFolderOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setIsFolderOpen(false)}><div className="w-full max-w-sm rounded-3xl border border-white/80 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-xl font-black">新建文件夹</h2><button type="button" onClick={() => setIsFolderOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div><input autoFocus value={newFolderDraft} onChange={(event) => setNewFolderDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateFolder(); }} placeholder="例如：富贵牡丹" className="mt-5 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-sky-300 focus:bg-white" /><button type="button" onClick={() => void handleCreateFolder()} className="mt-4 w-full rounded-2xl bg-slate-900 py-3 text-sm font-black text-white hover:bg-slate-800">创建文件夹</button></div></div>}

      {selectedItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={() => setSelectedItem(null)}><div className="w-full max-w-3xl rounded-3xl bg-white p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between gap-3 px-2 pb-3"><div className="min-w-0"><h2 className="truncate text-lg font-black">{selectedItem.originalName}</h2><p className="text-xs font-semibold text-slate-400">{selectedItem.folderName} · {formatVideoLibrarySize(selectedItem.fileSize)}</p></div><button type="button" onClick={() => setSelectedItem(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div><video src={selectedItem.streamUrl} controls autoPlay playsInline className="max-h-[65vh] w-full rounded-2xl bg-black" /><div className="mt-4 flex gap-2"><input defaultValue={selectedItem.note} onKeyDown={(event) => { if (event.key === 'Enter') void handleSaveNote(selectedItem, event.currentTarget.value); }} placeholder="输入备注后按回车保存" className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-sky-300 focus:bg-white" /><a href={selectedItem.downloadUrl} download className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-black text-white"><Download className="size-4" />下载</a></div></div></div>}
    </main>
  );
}
