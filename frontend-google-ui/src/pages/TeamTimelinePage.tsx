import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';

interface TeamTimelinePageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
}

interface TimelineRecord {
  id: string;
  date: string;
  title: string;
  content: string;
  challenge: string;
  createdAt: string;
  updatedAt: string;
}

interface TimelineDraft {
  date: string;
  title: string;
  content: string;
  challenge: string;
}

const EMPTY_DRAFT: TimelineDraft = { date: '', title: '', content: '', challenge: '' };

function formatDate(value: string) {
  const [year, month] = value.split('-');
  return month ? `${year}年${Number(month)}月` : value;
}

function getYear(value: string) {
  return value.slice(0, 4);
}

function highlightTeamPhrase(value: string) {
  return value.split('天塌了').map((part, index, parts) => (
    <span key={`${part}-${index}`}>
      {part}
      {index < parts.length - 1 && <span className="rounded px-0.5 font-black text-blue-600">天塌了</span>}
    </span>
  ));
}

async function requestTimeline<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error || '时间线操作失败');
  return json as T;
}

function sortRecords(records: TimelineRecord[]) {
  return [...records].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
}

export default function TeamTimelinePage({ onBack, onNavigate }: TeamTimelinePageProps) {
  const [records, setRecords] = useState<TimelineRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TimelineDraft>(EMPTY_DRAFT);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void requestTimeline<{ records: TimelineRecord[] }>('/api/team-timeline')
      .then((result) => {
        if (!cancelled) setRecords(sortRecords(result.records || []));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取时间线失败');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const visibleRecords = useMemo(() => records, [records]);

  function openCreate() {
    setEditingId(null);
    setDraft({ ...EMPTY_DRAFT, date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}` });
    setError('');
    setIsEditorOpen(true);
  }

  function openEdit(record: TimelineRecord) {
    setEditingId(record.id);
    setDraft({ date: record.date, title: record.title, content: record.content, challenge: record.challenge });
    setError('');
    setIsEditorOpen(true);
  }

  function closeEditor() {
    if (isSaving) return;
    setIsEditorOpen(false);
    setEditingId(null);
  }

  async function saveRecord() {
    if (!draft.date || !draft.title.trim()) {
      setError('请先填写事件时间和事件名称');
      return;
    }
    setIsSaving(true);
    setError('');
    try {
      const path = editingId ? `/api/team-timeline/${encodeURIComponent(editingId)}` : '/api/team-timeline';
      const result = await requestTimeline<{ records: TimelineRecord[] }>(path, {
        method: editingId ? 'PUT' : 'POST',
        body: JSON.stringify(draft),
      });
      setRecords(sortRecords(result.records || []));
      setIsEditorOpen(false);
      setEditingId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRecord(record: TimelineRecord) {
    if (!window.confirm(`确定删除“${record.title}”吗？`)) return;
    try {
      const result = await requestTimeline<{ records: TimelineRecord[] }>(`/api/team-timeline/${encodeURIComponent(record.id)}`, { method: 'DELETE' });
      setRecords(sortRecords(result.records || []));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败');
    }
  }

  async function deleteEditingRecord() {
    const record = records.find((item) => item.id === editingId);
    if (!record) return;
    await deleteRecord(record);
    setIsEditorOpen(false);
    setEditingId(null);
  }

  return (
    <div className="min-h-screen bg-background px-4 py-5 text-slate-900 md:px-8 md:py-8">
      <style>{`@keyframes team-timeline-flow { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }`}</style>
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex min-w-0 items-center gap-3 px-1">
          <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-bold text-slate-400 transition hover:text-slate-800">
            <ArrowLeft className="size-4" /> 返回主页
          </button>
          <ModuleQuickNav current="timeline" onNavigate={onNavigate} />
        </div>

        <p className="mb-2 text-center text-sm font-semibold tracking-[0.18em] text-slate-400 md:text-base">
          时间是一条河，经过的地方都会留下痕迹
        </p>

        <main className="relative left-1/2 mt-8 w-screen -translate-x-1/2 pb-16">
          {isLoading ? (
            <div className="rounded-3xl border border-white/80 bg-white/60 p-10 text-center font-bold text-slate-400">正在读取团队时间线...</div>
          ) : visibleRecords.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-teal-200 bg-white/60 p-12 text-center">
              <Sparkles className="mx-auto mb-3 size-8 text-teal-400" />
              <p className="font-black text-slate-700">这一年还没有记录</p>
              <p className="mt-2 text-sm font-semibold text-slate-400">把下一个重要时刻写进团队的长期记忆里。</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="relative min-w-max py-8 pl-6 md:pl-10" style={{ width: 'max-content', minWidth: '100vw' }}>
                <div className="relative grid items-stretch gap-x-10" style={{ gridTemplateColumns: `repeat(${visibleRecords.length + 1}, 16rem)`, gridTemplateRows: 'auto 120px auto' }}>
                  <svg className="pointer-events-none z-0 col-span-full row-start-2 h-full w-full overflow-visible" viewBox="0 0 1680 120" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M0 60 C120 8 240 112 360 60 S600 8 720 60 S960 112 1080 60 S1320 8 1440 60 S1560 112 1680 60" fill="none" stroke="#24b9a7" strokeLinecap="round" strokeWidth="18" opacity="0.12" />
                    <path d="M0 60 C120 8 240 112 360 60 S600 8 720 60 S960 112 1080 60 S1320 8 1440 60 S1560 112 1680 60" fill="none" stroke="#24aF9f" strokeLinecap="round" strokeWidth="6" />
                    <path d="M0 50 C120 -2 240 102 360 50 S600 -2 720 50 S960 102 1080 50 S1320 -2 1440 50 S1560 102 1680 50" fill="none" stroke="#8fe4d7" strokeLinecap="round" strokeWidth="2" opacity="0.9" />
                    <path d="M0 60 C120 8 240 112 360 60 S600 8 720 60 S960 112 1080 60 S1320 8 1440 60 S1560 112 1680 60" pathLength="1" fill="none" stroke="#55c7b8" strokeLinecap="round" strokeWidth="3" opacity="0.72" strokeDasharray="0.12 0.88" style={{ animation: 'team-timeline-flow 4.8s linear infinite' }} />
                  </svg>
                  {visibleRecords.map((record, index) => {
                    const isTop = index % 2 === 0;
                    return (
                      <motion.article key={record.id} style={{ gridColumn: index + 1, gridRow: isTop ? 1 : 3 }} initial={{ opacity: 0, y: isTop ? -12 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className={cn('w-64 self-stretch p-4', isTop ? 'self-end' : 'self-start')}>
                        <div onDoubleClick={() => openEdit(record)} className="w-full cursor-pointer rounded-2xl text-left">
                          <h2 className="text-lg font-black leading-6 tracking-tight text-slate-900">{highlightTeamPhrase(record.title)}</h2>
                          <p className="mt-2 whitespace-pre-wrap break-words text-xs font-semibold leading-5 text-slate-500">{record.content ? highlightTeamPhrase(record.content) : '暂无详细记录'}</p>
                          {record.challenge && <p className="mt-3 whitespace-pre-wrap break-words text-xs font-bold leading-5 text-amber-700"><span className="font-black">困难 / 思考：</span>{highlightTeamPhrase(record.challenge)}</p>}
                        </div>
                      </motion.article>
                    );
                  })}
                  {visibleRecords.map((record, index) => {
                    const isTop = index % 2 === 0;
                    return (
                      <div key={`${record.id}-axis`} style={{ gridColumn: index + 1, gridRow: 2 }} className="relative flex items-center justify-center">
                        <span className="relative z-10 rounded-full bg-background/95 px-3 py-1 text-xs font-black tracking-wide text-teal-700 shadow-sm">{formatDate(record.date)}</span>
                        {isTop ? (
                          <span aria-hidden="true" className="absolute left-1/2 top-0 h-12 w-px -translate-x-1/2 bg-teal-500"><span className="absolute -left-[4px] top-0 border-x-[5px] border-b-[8px] border-x-transparent border-b-teal-600" /></span>
                        ) : (
                          <span aria-hidden="true" className="absolute bottom-0 left-1/2 h-12 w-px -translate-x-1/2 bg-teal-500"><span className="absolute -left-[4px] bottom-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-teal-600" /></span>
                        )}
                      </div>
                    );
                  })}
                  <button type="button" onClick={openCreate} title="新增轨迹记录" aria-label="新增轨迹记录" style={{ gridColumn: visibleRecords.length + 1, gridRow: '1 / span 3' }} className="flex w-64 items-center justify-center text-teal-700 transition hover:scale-110 hover:text-slate-900">
                    <Plus className="size-8" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <AnimatePresence>
        {isEditorOpen && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={closeEditor}>
            <motion.div className="w-full max-w-2xl rounded-[2rem] border border-white/80 bg-white p-6 shadow-2xl md:p-8" initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }} onMouseDown={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between">
                <div><div className="text-xs font-black uppercase tracking-[0.2em] text-teal-600">Timeline Entry</div><h2 className="mt-2 text-2xl font-black">{editingId ? '编辑轨迹记录' : '新增轨迹记录'}</h2></div>
                <button type="button" onClick={closeEditor} className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"><X className="size-5" /></button>
              </div>
              <div className="mt-7 grid gap-4 md:grid-cols-[180px_1fr]">
                <label className="text-sm font-black text-slate-600">发生时间<input type="month" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none transition focus:border-teal-400 focus:bg-white" /></label>
                <label className="text-sm font-black text-slate-600">事件名称<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：第一次遇到增长瓶颈" className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold outline-none transition focus:border-teal-400 focus:bg-white" /></label>
              </div>
              <label className="mt-4 block text-sm font-black text-slate-600">发生了什么<textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="记录事情的经过、当时的判断和阶段成果" rows={4} className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-semibold leading-6 outline-none transition focus:border-teal-400 focus:bg-white" /></label>
              <label className="mt-4 block text-sm font-black text-slate-600">困难 / 思考<textarea value={draft.challenge} onChange={(event) => setDraft({ ...draft, challenge: event.target.value })} placeholder="遇到了什么困难？后来怎样解决或沉淀？（可不填）" rows={3} className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-semibold leading-6 outline-none transition focus:border-teal-400 focus:bg-white" /></label>
              {error && <p className="mt-4 text-sm font-bold text-red-500">{error}</p>}
              <div className="mt-6 flex items-center justify-between gap-2"><div>{editingId && <button type="button" onClick={() => void deleteEditingRecord()} disabled={isSaving} className="inline-flex items-center gap-1 text-sm font-black text-red-400 transition hover:text-red-600 disabled:opacity-50"><Trash2 className="size-3.5" />删除此条记录</button>}</div><div className="flex gap-2"><button type="button" onClick={closeEditor} disabled={isSaving} className="rounded-full px-5 py-3 text-sm font-black text-slate-500 transition hover:bg-slate-100">取消</button><button type="button" onClick={() => void saveRecord()} disabled={isSaving} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-black text-white transition hover:bg-teal-700 disabled:opacity-60"><Save className="size-4" />{isSaving ? '保存中...' : '保存记录'}</button></div></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
