import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, FolderInput, FolderOpen, Loader2, Play, Plus, RefreshCw, Search, Trash2, Upload, Video, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import {
  deleteVideoLibraryVideo,
  createVideoLibraryFolder,
  formatVideoLibrarySize,
  formatVideoLibraryTime,
  calculateVideoLibraryUnread,
  getVideoLibrary,
  getVideoLibrarySummary,
  markVideoLibraryItemsRead,
  updateVideoLibraryItem,
  uploadVideoLibraryVideo,
  type VideoLibraryItem,
} from '@/src/lib/videoLibrary';

interface VideoLibraryPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
}

const VIDEO_LIBRARY_MAX_FILE_BYTES = 20 * 1024 * 1024;

interface UploadProgress {
  total: number;
  completed: number;
  uploaded: number;
  duplicates: number;
  failed: number;
  currentName: string;
  errors: string[];
}

const DEFAULT_FOLDER = '通用素材';
const VIDEO_FILE_EXTENSION_PATTERN = /\.(mp4|m4v|mov|webm|avi|mkv)$/i;

function getVideoDateKey(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatVideoDateLabel(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = getVideoDateKey(timestamp);
  const dateText = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  if (key === getVideoDateKey(today.getTime() / 1000)) return `今天 · ${dateText}`;
  if (key === getVideoDateKey(yesterday.getTime() / 1000)) return `昨天 · ${dateText}`;
  return dateText;
}

function groupVideosByDate(items: VideoLibraryItem[]) {
  const groups = new Map<string, VideoLibraryItem[]>();
  items.forEach((item) => {
    const key = getVideoDateKey(item.createdAt);
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  return Array.from(groups.entries()).map(([key, dateItems]) => ({
    key,
    label: formatVideoDateLabel(dateItems[0]?.createdAt || 0),
    items: dateItems,
  }));
}

export default function VideoLibraryPage({ onBack, onNavigate }: VideoLibraryPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewWarmupRef = useRef<{ id: number; video: HTMLVideoElement } | null>(null);
  const [items, setItems] = useState<VideoLibraryItem[]>([]);
  const [folders, setFolders] = useState<string[]>([DEFAULT_FOLDER]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [search, setSearch] = useState('');
  const [folderDraft, setFolderDraft] = useState(DEFAULT_FOLDER);
  const [newFolderDraft, setNewFolderDraft] = useState('');
  const [selectedItem, setSelectedItem] = useState<VideoLibraryItem | null>(null);
  const [movingItem, setMovingItem] = useState<VideoLibraryItem | null>(null);
  const [moveTargetFolder, setMoveTargetFolder] = useState('');
  const [isMoving, setIsMoving] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isFolderOpen, setIsFolderOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [unreadVideoIds, setUnreadVideoIds] = useState<Set<number>>(() => new Set());
  const [folderUnreadCounts, setFolderUnreadCounts] = useState<Map<string, number>>(() => new Map());

  function applyUnreadSummary(summary: Awaited<ReturnType<typeof getVideoLibrarySummary>>) {
    const unread = calculateVideoLibraryUnread(summary);
    setUnreadVideoIds(unread.unreadIds);
    setFolderUnreadCounts(unread.byFolder);
  }

  async function refreshUnreadSummary() {
    try {
      applyUnreadSummary(await getVideoLibrarySummary());
    } catch {
      // 未看提醒更新失败不影响素材的上传、移动或删除。
    }
  }

  async function refresh(overrides?: { folder?: string; query?: string }) {
    setIsLoading(true);
    setError('');
    try {
      const [result, summary] = await Promise.all([
        getVideoLibrary({
          folder: overrides?.folder ?? selectedFolder,
          query: overrides?.query ?? search.trim(),
        }),
        getVideoLibrarySummary().catch(() => null),
      ]);
      setItems(result.items);
      setFolders(result.folders);
      if (summary) applyUnreadSummary(summary);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取视频库失败');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [selectedFolder]);

  useEffect(() => () => {
    const warmed = previewWarmupRef.current?.video;
    if (!warmed) return;
    warmed.removeAttribute('src');
    warmed.load();
  }, []);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, VideoLibraryItem[]>();
    items.forEach((item) => {
      const list = groups.get(item.folderName) || [];
      list.push(item);
      groups.set(item.folderName, list);
    });
    return Array.from(groups.entries());
  }, [items]);

  const folderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((item) => counts.set(item.folderName, (counts.get(item.folderName) || 0) + 1));
    return counts;
  }, [items]);

  const isFolderHome = !selectedFolder && !search.trim();
  const folderHomeContent = (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {folders.map((folder) => (
        <button key={folder} type="button" onClick={() => setSelectedFolder(folder)} className="group relative flex aspect-[1.35] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md">
          {(folderUnreadCounts.get(folder) || 0) > 0 && (
            <span className="absolute right-3 top-3 flex min-w-6 h-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-black text-white shadow-sm">
              {(folderUnreadCounts.get(folder) || 0) > 99 ? '99+' : folderUnreadCounts.get(folder)}
            </span>
          )}
          <FolderOpen className="size-11 text-sky-400 transition-colors group-hover:text-sky-500" />
          <span className="mt-3 max-w-full truncate text-sm font-black text-slate-700">{folder}</span>
          <span className="mt-1 text-[11px] font-bold text-slate-400">{folderCounts.get(folder) || 0} 个视频</span>
        </button>
      ))}
    </div>
  );

  function openUpload(folder = selectedFolder || DEFAULT_FOLDER) {
    setFolderDraft(folder || DEFAULT_FOLDER);
    setError('');
    setUploadProgress(null);
    setIsUploadOpen(true);
  }

  function handleFilePick() {
    inputRef.current?.click();
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;

    const validFiles = files.filter((file) => file.type.startsWith('video/') || VIDEO_FILE_EXTENSION_PATTERN.test(file.name));
    const invalidFiles = files.filter((file) => !validFiles.includes(file));
    if (!validFiles.length) {
      setError('请选择视频文件');
      return;
    }

    const oversizedFiles = validFiles.filter((file) => file.size > VIDEO_LIBRARY_MAX_FILE_BYTES);
    const uploadableFiles = validFiles.filter((file) => file.size <= VIDEO_LIBRARY_MAX_FILE_BYTES);
    if (!uploadableFiles.length) {
      setError('视频文件不能超过20MB');
      return;
    }

    setIsUploading(true);
    setError('');
    setNotice('');
    let progress: UploadProgress = {
      total: files.length,
      completed: invalidFiles.length + oversizedFiles.length,
      uploaded: 0,
      duplicates: 0,
      failed: invalidFiles.length + oversizedFiles.length,
      currentName: '',
      errors: [
        ...invalidFiles.map((file) => `${file.name}：不是支持的视频格式`),
        ...oversizedFiles.map((file) => `${file.name}：视频文件不能超过20MB`),
      ],
    };
    setUploadProgress(progress);

    for (const file of uploadableFiles) {
      progress = { ...progress, currentName: file.name };
      setUploadProgress(progress);
      try {
        const result = await uploadVideoLibraryVideo(file, folderDraft);
        if (result.item?.id) markVideoLibraryItemsRead([result.item.id]);
        progress = {
          ...progress,
          completed: progress.completed + 1,
          uploaded: progress.uploaded + (result.duplicate ? 0 : 1),
          duplicates: progress.duplicates + (result.duplicate ? 1 : 0),
        };
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : '上传失败';
        progress = {
          ...progress,
          completed: progress.completed + 1,
          failed: progress.failed + 1,
          errors: [...progress.errors, `${file.name}：${message}`],
        };
      }
      setUploadProgress(progress);
    }

    progress = { ...progress, currentName: '' };
    setUploadProgress(progress);
    setIsUploading(false);
    setSelectedFolder(folderDraft);
    await refresh({ folder: folderDraft, query: '' });
    setNotice(`批量上传完成：成功 ${progress.uploaded} 个，已存在 ${progress.duplicates} 个，失败 ${progress.failed} 个`);
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
      void refreshUnreadSummary();
      setNotice('视频已删除');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除视频失败');
    }
  }

  function openMoveDialog(item: VideoLibraryItem) {
    const firstAvailableFolder = folders.find((folder) => folder !== item.folderName) || '';
    setMovingItem(item);
    setMoveTargetFolder(firstAvailableFolder);
    setError('');
  }

  async function handleMoveVideo() {
    if (!movingItem || !moveTargetFolder || moveTargetFolder === movingItem.folderName || isMoving) return;
    setIsMoving(true);
    setError('');
    try {
      const updated = await updateVideoLibraryItem(movingItem.id, { folderName: moveTargetFolder });
      setItems((previous) => selectedFolder && selectedFolder !== updated.folderName
        ? previous.filter((item) => item.id !== updated.id)
        : previous.map((item) => item.id === updated.id ? updated : item));
      if (selectedItem?.id === updated.id) setSelectedItem(updated);
      setMovingItem(null);
      setMoveTargetFolder('');
      void refreshUnreadSummary();
      setNotice(`“${updated.originalName}”已移动到“${updated.folderName}”，所有设备都会同步`);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : '移动视频失败');
    } finally {
      setIsMoving(false);
    }
  }

  function warmVideoPreview(item: VideoLibraryItem) {
    if (previewWarmupRef.current?.id === item.id) return;
    const previous = previewWarmupRef.current?.video;
    if (previous) {
      previous.removeAttribute('src');
      previous.load();
    }
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = item.streamUrl;
    video.load();
    previewWarmupRef.current = { id: item.id, video };
  }

  function openVideoPreview(item: VideoLibraryItem) {
    if (unreadVideoIds.has(item.id)) {
      markVideoLibraryItemsRead([item.id]);
      setUnreadVideoIds((previous) => {
        const next = new Set(previous);
        next.delete(item.id);
        return next;
      });
      setFolderUnreadCounts((previous) => {
        const next = new Map(previous);
        const remaining = Math.max(0, (next.get(item.folderName) || 0) - 1);
        if (remaining) next.set(item.folderName, remaining);
        else next.delete(item.folderName);
        return next;
      });
    }
    setSelectedItem(item);
  }

  function renderVideoCard(item: VideoLibraryItem) {
    const isUnread = unreadVideoIds.has(item.id);
    return (
      <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
        <button
          type="button"
          onPointerEnter={() => warmVideoPreview(item)}
          onFocus={() => warmVideoPreview(item)}
          onTouchStart={() => warmVideoPreview(item)}
          onClick={() => openVideoPreview(item)}
          className="group relative flex aspect-video w-full items-center justify-center overflow-hidden bg-slate-900 text-left"
        >
          <Video className="size-8 text-slate-600" />
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(event) => { event.currentTarget.style.display = 'none'; }}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 text-white transition-colors group-hover:bg-slate-950/30">
            <Play className="size-7 opacity-0 drop-shadow transition-opacity group-hover:opacity-100" />
          </span>
          {isUnread && <span className="absolute right-2 top-2 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white shadow-sm">新</span>}
        </button>
        <div className="p-2.5">
          <div className="flex items-center gap-1">
            {renamingId === item.id ? (
              <input
                autoFocus
                value={renameDraft}
                onChange={(event) => setRenameDraft(event.target.value)}
                onBlur={() => void saveRename(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveRename(item);
                  if (event.key === 'Escape') setRenamingId(null);
                }}
                className="min-w-0 flex-1 rounded-md border border-sky-300 bg-sky-50 px-1.5 py-1 text-xs font-black outline-none"
              />
            ) : (
              <h3 onDoubleClick={() => startRename(item)} className="min-w-0 flex-1 cursor-text truncate text-xs font-black" title="双击修改名称">
                {item.originalName}
              </h3>
            )}
            <button type="button" onClick={() => openVideoPreview(item)} className={cn('shrink-0 rounded-md px-1.5 py-1 text-[10px] font-black', item.note ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400 hover:bg-slate-200')}>
              备注
            </button>
          </div>
          <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-slate-400">
            <span>{formatVideoLibrarySize(item.fileSize)}</span>
            <span>{formatVideoLibraryTime(item.createdAt)}</span>
          </div>
          {item.note && <p className="mt-2 line-clamp-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-bold leading-4 text-amber-700">{item.note}</p>}
          <div className="mt-2 flex items-center gap-1.5">
            <a href={item.downloadUrl} download={item.downloadName} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-100 py-1.5 text-[10px] font-black text-slate-600 hover:bg-slate-200">
              <Download className="size-3" />下载
            </a>
            <button type="button" onClick={() => openMoveDialog(item)} className="inline-flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-sky-50 hover:text-sky-600" title="移动到其他文件夹">
              <FolderInput className="size-3.5" />
            </button>
            <button type="button" onClick={() => void handleDelete(item)} className="inline-flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500" title="删除视频">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-3 py-4 text-slate-900 md:px-6">
      <section className="mx-auto max-w-7xl rounded-2xl border border-white/80 bg-white/90 p-3 shadow-sm md:p-4">
        <div className="mb-3 flex min-w-0 items-center gap-2 border-b border-slate-100 pb-3">
          <button type="button" onClick={onBack} className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50" title="返回首页">
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1 overflow-hidden">
            <ModuleQuickNav current="video-library" onNavigate={onNavigate} />
          </div>
          <button type="button" onClick={() => { setError(''); setNewFolderDraft(''); setIsFolderOpen(true); }} className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-black text-white shadow-sm hover:bg-slate-800">
            <Plus className="size-4" />新建文件夹
          </button>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1 lg:flex-none lg:w-72 xl:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void refresh(); }} placeholder="搜索素材" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs font-semibold outline-none focus:border-sky-300 focus:bg-white" />
          </div>
          <button type="button" onClick={() => void refresh()} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-sky-300 bg-sky-50 px-4 text-sm font-black text-sky-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-sky-400 hover:bg-sky-100 hover:shadow-md"><RefreshCw className={cn('size-4.5', isLoading && 'animate-spin')} />刷新</button>
          <div className="flex gap-2 overflow-x-auto">
            {selectedFolder && <button type="button" onClick={() => setSelectedFolder('')} className="inline-flex h-11 whitespace-nowrap items-center gap-2 rounded-xl border-2 border-slate-800 bg-slate-900 px-4 text-sm font-black text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-lg"><ArrowLeft className="size-4.5" />返回文件夹</button>}
          </div>
        </div>
        {(error || notice) && <div className={cn('mt-3 rounded-2xl px-4 py-3 text-sm font-bold', error ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700')}>{error || notice}</div>}
      </section>

      <section className="mx-auto mt-4 max-w-7xl space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center rounded-2xl border border-white/80 bg-white/80 py-20 text-sm font-bold text-slate-400"><Loader2 className="mr-2 size-5 animate-spin" />正在读取共享视频库</div>
        ) : isFolderHome ? (
          folderHomeContent
        ) : groupedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 py-20 text-center">
            <FolderOpen className="mx-auto size-9 text-slate-300" />
            <h2 className="mt-3 text-lg font-black text-slate-600">这个文件夹里还没有视频</h2>
            <p className="mt-1 text-sm font-semibold text-slate-400">可以从这里上传第一条视频</p>
            <button type="button" onClick={() => openUpload(selectedFolder)} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-black text-white"><Plus className="size-4" />上传视频</button>
          </div>
        ) : groupedItems.map(([folder, folderItems]) => (
          <div key={folder}>
            <div className="mb-4 flex items-center gap-2">
              <FolderOpen className="size-4 text-sky-500" />
              <h2 className="text-base font-black">{folder}</h2>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-black text-slate-500">{folderItems.length}</span>
              {(folderUnreadCounts.get(folder) || 0) > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-black text-red-500">{folderUnreadCounts.get(folder)} 个未看</span>}
              <button type="button" onClick={() => openUpload(folder)} className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:bg-slate-50"><Plus className="size-3" />上传</button>
            </div>
            <div className="space-y-6">
              {groupVideosByDate(folderItems).map((dateGroup) => (
                <section key={dateGroup.key}>
                  <div className="mb-2 flex items-center gap-3">
                    <h3 className="shrink-0 text-2xl font-black text-slate-800 md:text-3xl">{dateGroup.label}</h3>
                    <span className="text-[11px] font-bold text-slate-400">{dateGroup.items.length} 个素材</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {dateGroup.items.map(renderVideoCard)}
                  </div>
                </section>
              ))}
            </div>
          </div>
        ))}
      </section>

      <input ref={inputRef} type="file" accept="video/*,.mp4,.m4v,.mov,.webm,.avi,.mkv" multiple className="hidden" onChange={(event) => void handleUpload(event)} />

      {isUploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => !isUploading && setIsUploadOpen(false)}>
          <div className="w-full max-w-lg rounded-3xl border border-white/80 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black">批量上传共享视频</h2>
                <p className="mt-1 text-xs font-semibold text-slate-400">一次可选择多个视频，原文件不压缩；每个文件不超过20MB</p>
              </div>
              <button type="button" onClick={() => setIsUploadOpen(false)} disabled={isUploading} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-40"><X className="size-5" /></button>
            </div>
            <label className="mt-5 block text-sm font-black text-slate-600">全部保存到文件夹</label>
            <input value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} disabled={isUploading} list="video-library-folders" placeholder="例如：通用素材、富贵牡丹" className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-sky-300 focus:bg-white disabled:opacity-60" />
            <datalist id="video-library-folders">{folders.map((folder) => <option key={folder} value={folder} />)}</datalist>

            {uploadProgress && (
              <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between text-xs font-black text-slate-600">
                  <span>{isUploading ? `正在上传 ${uploadProgress.completed + 1}/${uploadProgress.total}` : '上传完成'}</span>
                  <span>{uploadProgress.completed}/{uploadProgress.total}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${uploadProgress.total ? (uploadProgress.completed / uploadProgress.total) * 100 : 0}%` }} />
                </div>
                {uploadProgress.currentName && <p className="mt-2 truncate text-xs font-semibold text-slate-500">{uploadProgress.currentName}</p>}
                {!isUploading && <p className="mt-3 text-xs font-black text-slate-600">成功 {uploadProgress.uploaded} 个 · 已存在 {uploadProgress.duplicates} 个 · 失败 {uploadProgress.failed} 个</p>}
                {uploadProgress.errors.length > 0 && <div className="mt-3 max-h-28 overflow-y-auto rounded-xl bg-red-50 px-3 py-2 text-[11px] font-bold leading-5 text-red-600">{uploadProgress.errors.map((message) => <p key={message}>{message}</p>)}</div>}
              </div>
            )}

            <button type="button" onClick={isUploading ? undefined : handleFilePick} disabled={isUploading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-500 py-3.5 text-sm font-black text-white shadow-sm hover:bg-sky-600 disabled:opacity-60">
              {isUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {isUploading ? '正在逐个上传，请勿关闭' : uploadProgress ? '继续选择视频' : '选择多个视频并上传'}
            </button>
            {uploadProgress && !isUploading && <button type="button" onClick={() => setIsUploadOpen(false)} className="mt-2 w-full rounded-2xl py-2.5 text-sm font-black text-slate-500 hover:bg-slate-100">完成</button>}
          </div>
        </div>
      )}

      {isFolderOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={() => setIsFolderOpen(false)}><div className="w-full max-w-sm rounded-3xl border border-white/80 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-xl font-black">新建文件夹</h2><button type="button" onClick={() => setIsFolderOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div><input autoFocus value={newFolderDraft} onChange={(event) => setNewFolderDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateFolder(); }} placeholder="例如：富贵牡丹" className="mt-5 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-sky-300 focus:bg-white" /><button type="button" onClick={() => void handleCreateFolder()} className="mt-4 w-full rounded-2xl bg-slate-900 py-3 text-sm font-black text-white hover:bg-slate-800">创建文件夹</button></div></div>}

      {movingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={() => !isMoving && setMovingItem(null)}>
          <div className="w-full max-w-md rounded-3xl border border-white/80 bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-black text-slate-900">移动视频</h2>
                <p className="mt-1 truncate text-xs font-semibold text-slate-400">{movingItem.originalName}</p>
              </div>
              <button type="button" onClick={() => setMovingItem(null)} disabled={isMoving} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-40"><X className="size-5" /></button>
            </div>
            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
              当前文件夹：<span className="text-slate-800">{movingItem.folderName}</span>
            </div>
            <div className="mt-5 text-sm font-black text-slate-700">选择目标文件夹</div>
            {folders.some((folder) => folder !== movingItem.folderName) ? (
              <div className="mt-2 grid max-h-64 grid-cols-2 gap-2 overflow-y-auto pr-1">
                {folders.filter((folder) => folder !== movingItem.folderName).map((folder) => (
                  <button
                    key={folder}
                    type="button"
                    disabled={isMoving}
                    onClick={() => setMoveTargetFolder(folder)}
                    className={cn(
                      'flex min-h-14 items-center gap-2 rounded-2xl border px-3 py-2 text-left text-xs font-black transition-colors disabled:cursor-not-allowed',
                      moveTargetFolder === folder
                        ? 'border-sky-400 bg-sky-50 text-sky-700 ring-2 ring-sky-100'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:bg-sky-50/50'
                    )}
                  >
                    <FolderOpen className="size-4 shrink-0" />
                    <span className="break-all">{folder}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-700">
                目前没有其他文件夹，请先新建一个文件夹。
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={isMoving} onClick={() => setMovingItem(null)} className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-40">取消</button>
              <button
                type="button"
                disabled={isMoving || !moveTargetFolder || moveTargetFolder === movingItem.folderName}
                onClick={() => void handleMoveVideo()}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-sky-500 px-4 text-xs font-black text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isMoving ? <Loader2 className="size-4 animate-spin" /> : <FolderInput className="size-4" />}
                {isMoving ? '正在移动' : '确认移动'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedItem && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={() => setSelectedItem(null)}><div className="w-full max-w-3xl rounded-3xl bg-white p-4 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between gap-3 px-2 pb-3"><div className="min-w-0"><h2 className="truncate text-lg font-black">{selectedItem.originalName}</h2><p className="text-xs font-semibold text-slate-400">{selectedItem.folderName} · {formatVideoLibrarySize(selectedItem.fileSize)}</p></div><button type="button" onClick={() => setSelectedItem(null)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div><video key={selectedItem.id} src={selectedItem.streamUrl} poster={selectedItem.thumbnailUrl} controls autoPlay playsInline preload="auto" className="max-h-[65vh] w-full rounded-2xl bg-black" /><div className="mt-4 flex gap-2"><input defaultValue={selectedItem.note} onKeyDown={(event) => { if (event.key === 'Enter') void handleSaveNote(selectedItem, event.currentTarget.value); }} placeholder="输入备注后按回车保存" className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold outline-none focus:border-sky-300 focus:bg-white" /><a href={selectedItem.downloadUrl} download={selectedItem.downloadName} className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-black text-white"><Download className="size-4" />下载</a></div></div></div>}
    </main>
  );
}
