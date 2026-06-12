import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Boxes,
  Building2,
  Check,
  Link2,
  ListPlus,
  Loader2,
  Maximize2,
  Megaphone,
  Minimize2,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Store,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import ModuleQuickNav from '@/src/components/ModuleQuickNav';
import SiteFooter from '@/src/components/SiteFooter';
import { cn } from '@/src/lib/utils';
import {
  createStoreOverviewEdge,
  createStoreOverviewNode,
  deleteStoreOverviewEdge,
  deleteStoreOverviewNode,
  getStoreOverviewGraph,
  updateStoreOverviewSettings,
  updateStoreOverviewNode,
  type StoreOverviewEdge,
  type StoreOverviewGraph,
  type StoreOverviewNode,
  type StoreOverviewNodeType,
} from '@/src/lib/storeOverview';

interface StoreOverviewPageProps {
  onBack: () => void;
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel') => void;
}

const NODE_TYPES: {
  type: StoreOverviewNodeType;
  label: string;
  shortLabel: string;
  icon: typeof Store;
  tone: string;
  soft: string;
  column: number;
}[] = [
  { type: 'video', label: '视频号', shortLabel: '视频号', icon: Radio, tone: 'bg-sky-500 text-white', soft: 'bg-sky-50 text-sky-700 border-sky-100', column: 0 },
  { type: 'adq', label: 'ADQ', shortLabel: 'ADQ', icon: Megaphone, tone: 'bg-violet-500 text-white', soft: 'bg-violet-50 text-violet-700 border-violet-100', column: 1 },
  { type: 'store', label: '店铺/小店广告', shortLabel: '店铺', icon: Store, tone: 'bg-emerald-500 text-white', soft: 'bg-emerald-50 text-emerald-700 border-emerald-100', column: 2 },
  { type: 'supplier', label: '发货商家', shortLabel: '商家', icon: Truck, tone: 'bg-orange-500 text-white', soft: 'bg-orange-50 text-orange-700 border-orange-100', column: 3 },
  { type: 'product', label: '商品', shortLabel: '商品', icon: Boxes, tone: 'bg-rose-500 text-white', soft: 'bg-rose-50 text-rose-700 border-rose-100', column: 4 },
];

const TYPE_META = Object.fromEntries(NODE_TYPES.map((item) => [item.type, item])) as Record<StoreOverviewNodeType, typeof NODE_TYPES[number]>;
const STORE_RELATION_TYPES: StoreOverviewNodeType[] = ['product', 'video', 'adq', 'supplier'];
const DEFAULT_GRAPH_COLUMN_TYPES: StoreOverviewNodeType[] = ['video', 'adq', 'store', 'supplier', 'product'];

function normalizeGraphColumnTypes(value: unknown): StoreOverviewNodeType[] {
  const parsed = Array.isArray(value) ? value : [];
  const valid = parsed.filter((type): type is StoreOverviewNodeType => DEFAULT_GRAPH_COLUMN_TYPES.includes(type));
  return [
    ...valid,
    ...DEFAULT_GRAPH_COLUMN_TYPES.filter((type) => !valid.includes(type)),
  ];
}

function formatTime(seconds: number) {
  if (!seconds) return '';
  return new Date(seconds * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeEdge(edge: StoreOverviewEdge, nodeMap: Map<number, StoreOverviewNode>) {
  const source = nodeMap.get(edge.source_id);
  const target = nodeMap.get(edge.target_id);
  if (!source || !target) return null;
  const store = source.type === 'store' ? source : target.type === 'store' ? target : null;
  const related = store?.id === source.id ? target : source;
  return { edge, source, target, store, related };
}

export default function StoreOverviewPage({ onBack, onNavigate }: StoreOverviewPageProps) {
  const [graph, setGraph] = useState<StoreOverviewGraph>({ nodes: [], edges: [], settings: { columnOrder: DEFAULT_GRAPH_COLUMN_TYPES } });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeType, setActiveType] = useState<StoreOverviewNodeType | 'all'>('all');
  const [newType, setNewType] = useState<StoreOverviewNodeType>('store');
  const [newName, setNewName] = useState('');
  const [newNote, setNewNote] = useState('');
  const [createMode, setCreateMode] = useState<'single' | 'batch'>('batch');
  const [batchNames, setBatchNames] = useState('');
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [bindTargetId, setBindTargetId] = useState<Record<string, string>>({});
  const [isOverviewMode, setIsOverviewMode] = useState(false);
  const [isConnectMode, setIsConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<number | null>(null);
  const [graphColumnTypes, setGraphColumnTypes] = useState<StoreOverviewNodeType[]>(DEFAULT_GRAPH_COLUMN_TYPES);
  const [draggingColumnType, setDraggingColumnType] = useState<StoreOverviewNodeType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refreshGraph(keepSelection = true) {
    setIsLoading(true);
    setError('');
    try {
      const nextGraph = await getStoreOverviewGraph();
      setGraph(nextGraph);
      setGraphColumnTypes(normalizeGraphColumnTypes(nextGraph.settings?.columnOrder));
      setSelectedId((current) => {
        if (!keepSelection) return nextGraph.nodes[0]?.id || null;
        if (current && nextGraph.nodes.some((node) => node.id === current)) return current;
        return nextGraph.nodes[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载店铺总览失败');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refreshGraph(false);
  }, []);

  const nodeMap = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selectedNode = selectedId ? nodeMap.get(selectedId) || null : null;
  const normalizedEdges = useMemo(
    () => graph.edges.map((edge) => normalizeEdge(edge, nodeMap)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [graph.edges, nodeMap]
  );

  const relatedGraph = useMemo(() => {
    const nodeIds = new Set<number>();
    const edgeIds = new Set<number>();
    if (!selectedNode) return { nodeIds, edgeIds };

    nodeIds.add(selectedNode.id);
    const adjacency = new Map<number, { node: StoreOverviewNode; edgeId: number }[]>();
    normalizedEdges.forEach(({ edge, source, target }) => {
      adjacency.set(source.id, [...(adjacency.get(source.id) || []), { node: target, edgeId: edge.id }]);
      adjacency.set(target.id, [...(adjacency.get(target.id) || []), { node: source, edgeId: edge.id }]);
    });

    const typeIndex = new Map(graphColumnTypes.map((type, index) => [type, index]));
    const selectedIndex = typeIndex.get(selectedNode.type) ?? 0;

    const walk = (direction: -1 | 1) => {
      const visited = new Set<number>([selectedNode.id]);
      let frontier = [{ id: selectedNode.id, index: selectedIndex }];
      while (frontier.length > 0) {
        const nextFrontier: { id: number; index: number }[] = [];
        frontier.forEach(({ id, index }) => {
          (adjacency.get(id) || []).forEach(({ node, edgeId }) => {
            if (visited.has(node.id)) return;
            const nextIndex = typeIndex.get(node.type);
            if (nextIndex === undefined) return;
            if (direction === -1 && nextIndex >= index) return;
            if (direction === 1 && nextIndex <= index) return;
            visited.add(node.id);
            nodeIds.add(node.id);
            edgeIds.add(edgeId);
            nextFrontier.push({ id: node.id, index: nextIndex });
          });
        });
        frontier = nextFrontier;
      }
    };

    walk(-1);
    walk(1);
    return { nodeIds, edgeIds };
  }, [graphColumnTypes, normalizedEdges, selectedNode]);

  const relatedNodeIds = relatedGraph.nodeIds;
  const relatedEdgeIds = relatedGraph.edgeIds;

  const visibleNodes = useMemo(() => {
    return graph.nodes.filter((node) => activeType === 'all' || node.type === activeType);
  }, [activeType, graph.nodes]);

  const nodesByType = useMemo(() => {
    const data = new Map<StoreOverviewNodeType, StoreOverviewNode[]>();
    NODE_TYPES.forEach(({ type }) => data.set(type, []));
    visibleNodes.forEach((node) => data.get(node.type)?.push(node));
    data.forEach((items) => items.sort((a, b) => a.created_at - b.created_at));
    return data;
  }, [visibleNodes]);

  const graphColumns = useMemo(() => {
    return graphColumnTypes.map((type, index) => ({
      type,
      label: TYPE_META[type].label,
      x: ((index + 0.5) / graphColumnTypes.length) * 100,
    }));
  }, [graphColumnTypes]);

  const graphNodes = useMemo(() => {
    const positions = new Map<number, { x: number; y: number; node: StoreOverviewNode }>();
    graphColumns.forEach((column) => {
      const items = nodesByType.get(column.type) || [];
      const gap = Math.max(11, 72 / Math.max(items.length, 1));
      const start = Math.max(10, 50 - ((items.length - 1) * gap) / 2);
      items.forEach((node, index) => {
        positions.set(node.id, { x: column.x, y: start + index * gap, node });
      });
    });
    return positions;
  }, [graphColumns, nodesByType]);

  useEffect(() => {
    if (!selectedNode) {
      setEditName('');
      setEditNote('');
      return;
    }
    setEditName(selectedNode.name);
    setEditNote(selectedNode.note || '');
  }, [selectedNode]);

  useEffect(() => {
    if (!isConnectMode) {
      setConnectSourceId(null);
    }
  }, [isConnectMode]);

  function getStoreEdges(storeId: number, type?: StoreOverviewNodeType) {
    return normalizedEdges
      .filter(({ store, related }) => store?.id === storeId && related && (!type || related.type === type))
      .map(({ edge, store, related }) => ({ edge, store: store!, related: related! }));
  }

  function getRelatedStores(nodeId: number) {
    return normalizedEdges
      .filter(({ store, related }) => related?.id === nodeId && store)
      .map(({ edge, store, related }) => ({ edge, store: store!, related: related! }));
  }

  function getDirectRelations(nodeId: number) {
    return normalizedEdges
      .filter(({ source, target }) => source.id === nodeId || target.id === nodeId)
      .map(({ edge, source, target }) => ({
        edge,
        node: source.id === nodeId ? target : source,
      }));
  }

  function getAvailableTargets(storeId: number, type: StoreOverviewNodeType) {
    const linkedIds = new Set(getStoreEdges(storeId, type).map(({ related }) => related.id));
    return graph.nodes.filter((node) => node.type === type && !linkedIds.has(node.id));
  }

  async function runAction(action: () => Promise<void>, successText?: string) {
    setIsSaving(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (successText) setNotice(successText);
      await refreshGraph(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateNode() {
    const name = newName.trim();
    if (!name) {
      setError('请先填写项目名称');
      return;
    }
    await runAction(async () => {
      const node = await createStoreOverviewNode({ type: newType, name, note: newNote.trim() });
      setSelectedId(node.id);
      setNewName('');
      setNewNote('');
    }, '项目已新增');
  }

  async function handleCreateBatchNodes() {
    const names = Array.from(new Set(
      batchNames
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    ));
    if (names.length === 0) {
      setError(`请先填写${TYPE_META[newType].label}名称，每行一个`);
      return;
    }

    await runAction(async () => {
      let lastNode: StoreOverviewNode | null = null;
      for (const name of names) {
        lastNode = await createStoreOverviewNode({ type: newType, name });
      }
      setSelectedId(lastNode?.id || null);
      setBatchNames('');
    }, `已批量新增 ${names.length} 个${TYPE_META[newType].label}`);
  }

  async function handleSaveSelected() {
    if (!selectedNode) return;
    const name = editName.trim();
    if (!name) {
      setError('项目名称不能为空');
      return;
    }
    await runAction(async () => {
      await updateStoreOverviewNode(selectedNode.id, { name, note: editNote.trim() });
    }, '项目已保存');
  }

  async function handleDeleteSelected() {
    if (!selectedNode) return;
    const confirmed = window.confirm(`确定删除“${selectedNode.name}”吗？相关连线也会一起删除。`);
    if (!confirmed) return;
    await runAction(async () => {
      await deleteStoreOverviewNode(selectedNode.id);
      setSelectedId(null);
    }, '项目已删除');
  }

  async function handleCreateEdge(storeId: number, type: StoreOverviewNodeType) {
    const targetId = Number(bindTargetId[type]);
    if (!targetId) return;
    await runAction(async () => {
      await createStoreOverviewEdge({ sourceId: storeId, targetId, relationType: type });
      setBindTargetId((previous) => ({ ...previous, [type]: '' }));
    }, '关联已添加');
  }

  async function handleBindToStore(nodeId: number) {
    const storeId = Number(bindTargetId.store);
    if (!storeId) return;
    await runAction(async () => {
      await createStoreOverviewEdge({ sourceId: storeId, targetId: nodeId, relationType: selectedNode?.type || 'linked' });
      setBindTargetId((previous) => ({ ...previous, store: '' }));
    }, '关联已添加');
  }

  async function handleDeleteEdge(edgeId: number) {
    await runAction(async () => {
      await deleteStoreOverviewEdge(edgeId);
    }, '关联已取消');
  }

  async function handleDeleteGraphEdge(edge: StoreOverviewEdge, store: StoreOverviewNode, related: StoreOverviewNode) {
    const confirmed = window.confirm(`确定删除“${store.name}”和“${related.name}”之间的连线吗？`);
    if (!confirmed) return;
    await handleDeleteEdge(edge.id);
  }

  async function persistGraphColumnTypes(next: StoreOverviewNodeType[]) {
    const normalized = normalizeGraphColumnTypes(next);
    setGraphColumnTypes(normalized);
    try {
      const settings = await updateStoreOverviewSettings({ columnOrder: normalized });
      setGraphColumnTypes(normalizeGraphColumnTypes(settings.columnOrder));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存图谱列顺序失败');
    }
  }

  function handleColumnDrop(targetType: StoreOverviewNodeType) {
    if (!draggingColumnType || draggingColumnType === targetType) {
      setDraggingColumnType(null);
      return;
    }

    const previous = graphColumnTypes;
    const next = (() => {
      const fromIndex = previous.indexOf(draggingColumnType);
      const toIndex = previous.indexOf(targetType);
      if (fromIndex < 0 || toIndex < 0) return previous;
      const reordered = [...previous];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      return reordered;
    })();
    void persistGraphColumnTypes(next);
    setDraggingColumnType(null);
  }

  function moveGraphColumn(type: StoreOverviewNodeType, direction: -1 | 1) {
    const index = graphColumnTypes.indexOf(type);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= graphColumnTypes.length) return;
    const next = [...graphColumnTypes];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    void persistGraphColumnTypes(next);
  }

  async function handleGraphNodeClick(node: StoreOverviewNode) {
    if (!isConnectMode) {
      setSelectedId(node.id);
      return;
    }

    if (!connectSourceId) {
      setConnectSourceId(node.id);
      setSelectedId(node.id);
      setNotice(`已选择“${node.name}”，再点击另一个项目即可连线`);
      setError('');
      return;
    }

    if (connectSourceId === node.id) {
      setConnectSourceId(null);
      setNotice('已取消当前连线起点');
      return;
    }

    const source = nodeMap.get(connectSourceId);
    if (!source) {
      setConnectSourceId(node.id);
      setSelectedId(node.id);
      return;
    }

    if (source.type === node.type) {
      setError(`同一类目内不需要互相连线，请选择其他类目的项目。`);
      setNotice('');
      return;
    }

    const relationType = source.type === 'store' ? node.type : source.type;
    await runAction(async () => {
      await createStoreOverviewEdge({ sourceId: source.id, targetId: node.id, relationType });
      setConnectSourceId(null);
      setSelectedId(node.id);
    }, `已连接“${source.name}”和“${node.name}”`);
  }

  const totalStores = graph.nodes.filter((node) => node.type === 'store').length;

  return (
    <div className="min-h-screen bg-[#f3f6fb] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur-md">
        <div className="flex h-14 items-center justify-between gap-4 px-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white pl-1 pr-4 text-xs font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-slate-900 text-white">
                <ArrowLeft className="size-3.5" />
              </span>
              返回
            </button>
            <ModuleQuickNav current="collection" onNavigate={onNavigate} />
          </div>
          <button
            type="button"
            onClick={() => void refreshGraph(true)}
            disabled={isLoading || isSaving}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            刷新同步
          </button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1500px] flex-col gap-3 p-3">
        {!isOverviewMode && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-600">
              <Building2 className="size-3.5" />
              店铺总览
            </div>
            <h1 className="mt-0.5 text-lg font-black tracking-tight text-slate-950">店铺关系图谱</h1>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5 text-center">
            {NODE_TYPES.map(({ type, label, soft }) => (
              <div key={type} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-1', soft)}>
                <span className="text-xs font-black">{graph.nodes.filter((node) => node.type === type).length}</span>
                <span className="text-[10px] font-bold">{label}</span>
              </div>
            ))}
          </div>
        </section>
        )}

        {(error || notice) && (
          <div className={cn(
            'flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-bold shadow-sm',
            error ? 'border-red-100 bg-red-50 text-red-600' : 'border-emerald-100 bg-emerald-50 text-emerald-700'
          )}>
            {error ? <X className="size-4" /> : <Check className="size-4" />}
            {error || notice}
          </div>
        )}

        <section className={cn(
          'grid min-h-[680px] gap-4',
          isOverviewMode ? 'grid-cols-1' : 'xl:grid-cols-[300px_minmax(0,1fr)_360px]'
        )}>
          {!isOverviewMode && (
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black text-slate-900">新增项目</h2>
              <ListPlus className="size-4 text-slate-400" />
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {NODE_TYPES.map(({ type, label, icon: Icon, soft }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setNewType(type)}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all',
                      newType === type ? soft : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    )}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setCreateMode('batch')}
                  className={cn(
                    'h-8 rounded-lg text-xs font-black transition-all',
                    createMode === 'batch' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  批量新增
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode('single')}
                  className={cn(
                    'h-8 rounded-lg text-xs font-black transition-all',
                    createMode === 'single' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  单个新增
                </button>
              </div>

              {createMode === 'batch' ? (
                <>
                  <textarea
                    value={batchNames}
                    onChange={(event) => setBatchNames(event.target.value)}
                    placeholder={`一行一个${TYPE_META[newType].label}名称\n例如：\n${TYPE_META[newType].label}1\n${TYPE_META[newType].label}2\n${TYPE_META[newType].label}3`}
                    rows={8}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold leading-5 outline-none transition-colors placeholder:text-slate-300 focus:border-emerald-400"
                  />
                  <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] leading-4 text-slate-500">
                    当前将新增 {batchNames.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).length} 个{TYPE_META[newType].label}，系统会自动忽略空行和本次重复名称。
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCreateBatchNodes()}
                    disabled={isSaving}
                    className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-xs font-black text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                  >
                    {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <ListPlus className="size-3.5" />}
                    批量新增{TYPE_META[newType].label}
                  </button>
                </>
              ) : (
                <>
                  <input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    placeholder={`${TYPE_META[newType].label}名称`}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold outline-none transition-colors focus:border-emerald-400"
                  />
                  <textarea
                    value={newNote}
                    onChange={(event) => setNewNote(event.target.value)}
                    placeholder="备注，可不填"
                    rows={3}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium outline-none transition-colors focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateNode()}
                    disabled={isSaving}
                    className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-slate-900 text-xs font-black text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
                  >
                    {isSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                    新增到图谱
                  </button>
                </>
              )}
            </div>

            <div className="mt-6 border-t border-slate-100 pt-4">
              <div className="mb-2 text-xs font-black text-slate-900">筛选显示</div>
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setActiveType('all')}
                  className={cn('flex h-9 w-full items-center justify-between rounded-xl px-3 text-xs font-bold', activeType === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100')}
                >
                  全部项目
                  <span>{graph.nodes.length}</span>
                </button>
                {NODE_TYPES.map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setActiveType(type)}
                    className={cn('flex h-9 w-full items-center justify-between rounded-xl px-3 text-xs font-bold', activeType === type ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100')}
                  >
                    <span className="flex items-center gap-2"><Icon className="size-3.5" />{label}</span>
                    <span>{graph.nodes.filter((node) => node.type === type).length}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
          )}

          <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-black text-slate-900">图谱视图</h2>
                <p className="text-[11px] font-medium text-slate-400">{totalStores} 个店铺，{graph.edges.length} 条关联线</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-2 text-[11px] font-bold text-slate-400 sm:flex">
                  <Link2 className="size-3.5" />
                  {isConnectMode ? '先点起点，再点终点' : '点击节点查看关联'}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsConnectMode((value) => !value);
                    setConnectSourceId(null);
                    setNotice('');
                    setError('');
                  }}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-black shadow-sm transition-colors',
                    isConnectMode
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <Link2 className="size-3.5" />
                  {isConnectMode ? '连线中' : '手动连线'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOverviewMode((value) => !value)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-black text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                >
                  {isOverviewMode ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                  {isOverviewMode ? '恢复编辑' : '只看总览'}
                </button>
              </div>
            </div>

            <div className={cn(
              'relative overflow-auto bg-slate-50',
              isOverviewMode ? 'h-[calc(100vh-250px)] min-h-[720px]' : 'h-[620px]'
            )}>
              {isLoading ? (
                <div className="flex h-full items-center justify-center text-sm font-bold text-slate-400">
                  <Loader2 className="mr-2 size-5 animate-spin" />
                  正在同步店铺图谱
                </div>
              ) : graph.nodes.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <Store className="mx-auto size-10 text-slate-300" />
                    <div className="mt-3 text-sm font-black text-slate-700">先新增一个店铺</div>
                    <div className="mt-1 text-xs text-slate-400">再新增商品、视频号、ADQ 和发货商家进行绑定。</div>
                  </div>
                </div>
              ) : (
                <div className="relative h-full min-w-[1180px]">
                  {graphColumns.map((column) => (
                    <div
                      key={`column-bg-${column.type}`}
                      className="pointer-events-none absolute top-14 bottom-6 rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50/30"
                      style={{
                        left: `${column.x}%`,
                        width: '196px',
                        transform: 'translateX(-50%)',
                      }}
                    />
                  ))}

                  <svg className="absolute inset-0 size-full">
                    {normalizedEdges.map(({ edge, source, target }) => {
                      const a = graphNodes.get(source.id);
                      const b = graphNodes.get(target.id);
                      if (!a || !b) return null;
                      const active = !selectedNode || relatedEdgeIds.has(edge.id);
                      return (
                        <g key={edge.id}>
                          <line
                            x1={`${a.x}%`}
                            y1={`${a.y}%`}
                            x2={`${b.x}%`}
                            y2={`${b.y}%`}
                            stroke="transparent"
                            strokeWidth={14}
                            strokeLinecap="round"
                            className="cursor-pointer"
                            onClick={() => void handleDeleteGraphEdge(edge, source, target)}
                          />
                          <line
                            x1={`${a.x}%`}
                            y1={`${a.y}%`}
                            x2={`${b.x}%`}
                            y2={`${b.y}%`}
                            stroke={active ? '#10b981' : '#cbd5e1'}
                            strokeWidth={active ? 3 : 1.5}
                            strokeLinecap="round"
                            opacity={active ? 0.88 : 0.28}
                            className="pointer-events-none"
                          />
                        </g>
                      );
                    })}
                  </svg>

                  {graphColumns.map((column) => {
                    const meta = TYPE_META[column.type];
                    const Icon = meta.icon;
                    return (
                      <div
                        key={column.type}
                        draggable
                        onDragStart={() => setDraggingColumnType(column.type)}
                        onDragEnd={() => setDraggingColumnType(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => handleColumnDrop(column.type)}
                        onDoubleClick={() => void persistGraphColumnTypes(DEFAULT_GRAPH_COLUMN_TYPES)}
                        title="拖动可调整整列顺序，双击恢复默认顺序，也可以点左右箭头移动"
                        className={cn(
                          'absolute top-3 flex cursor-grab items-center gap-1.5 rounded-2xl border-2 px-2.5 py-1.5 text-sm font-black shadow-lg transition-all active:cursor-grabbing',
                          draggingColumnType === column.type
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 opacity-70'
                            : cn('bg-opacity-90 backdrop-blur-sm hover:opacity-90', meta.soft)
                        )}
                        style={{ left: `${column.x}%`, transform: 'translateX(-50%)' }}
                      >
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            moveGraphColumn(column.type, -1);
                          }}
                          disabled={graphColumnTypes.indexOf(column.type) === 0}
                          className="flex size-5 items-center justify-center rounded-full transition-colors hover:bg-white/40 disabled:cursor-not-allowed disabled:opacity-20"
                          title="整列左移"
                        >
                          <ChevronLeft className="size-3.5" />
                        </button>
                        <span className="flex min-w-[64px] items-center justify-center gap-1 px-1 text-center tracking-wide">
                          <Icon className="size-3.5" />
                          {column.label}
                        </span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            moveGraphColumn(column.type, 1);
                          }}
                          disabled={graphColumnTypes.indexOf(column.type) === graphColumnTypes.length - 1}
                          className="flex size-5 items-center justify-center rounded-full transition-colors hover:bg-white/40 disabled:cursor-not-allowed disabled:opacity-20"
                          title="整列右移"
                        >
                          <ChevronRight className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}

                  {Array.from(graphNodes.values()).map(({ node, x, y }) => {
                    const meta = TYPE_META[node.type];
                    const Icon = meta.icon;
                    const selected = selectedNode?.id === node.id;
                    const connectSource = connectSourceId === node.id;
                    const related = !selectedNode || relatedNodeIds.has(node.id);
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => void handleGraphNodeClick(node)}
                        className={cn(
                          'absolute w-[150px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-[calc(50%+2px)] hover:shadow-lg',
                          selected ? 'border-emerald-300 ring-4 ring-emerald-100' : 'border-slate-200',
                          connectSource && 'border-amber-300 ring-4 ring-amber-100',
                          isConnectMode && !connectSource && 'cursor-crosshair',
                          !related && 'opacity-25 grayscale'
                        )}
                        style={{ left: `${x}%`, top: `${y}%` }}
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-xl', meta.tone)}>
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-black text-slate-900">{node.name}</span>
                            <span className="block text-[10px] font-bold text-slate-400">{meta.shortLabel}</span>
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {!isOverviewMode && (
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {!selectedNode ? (
              <div className="flex h-full min-h-[360px] items-center justify-center text-center">
                <div>
                  <Store className="mx-auto size-9 text-slate-300" />
                  <div className="mt-3 text-sm font-black text-slate-700">选择一个节点</div>
                  <div className="mt-1 text-xs text-slate-400">点击图谱里的店铺、商品、视频号、ADQ 或商家查看详情。</div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black', TYPE_META[selectedNode.type].soft)}>
                      {TYPE_META[selectedNode.type].label}
                    </div>
                    <h2 className="mt-2 text-lg font-black text-slate-950">{selectedNode.name}</h2>
                    <p className="mt-1 text-[11px] font-medium text-slate-400">更新于 {formatTime(selectedNode.updated_at)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteSelected()}
                    disabled={isSaving}
                    className="flex size-8 items-center justify-center rounded-full text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-60"
                    title="删除项目"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <div className="space-y-2">
                  <input
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-xs font-bold outline-none transition-colors focus:border-emerald-400"
                  />
                  <textarea
                    value={editNote}
                    onChange={(event) => setEditNote(event.target.value)}
                    rows={4}
                    placeholder="备注"
                    className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium outline-none transition-colors focus:border-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveSelected()}
                    disabled={isSaving}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-xs font-black text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                  >
                    <Save className="size-3.5" />
                    保存信息
                  </button>
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-black text-slate-800">直接关联</div>
                    <div className="text-[10px] font-bold text-slate-400">{getDirectRelations(selectedNode.id).length} 条</div>
                  </div>
                  <div className="space-y-1.5">
                    {getDirectRelations(selectedNode.id).length === 0 ? (
                      <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400">暂无直接关联</div>
                    ) : getDirectRelations(selectedNode.id).map(({ edge, node }) => (
                      <div key={edge.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setSelectedId(node.id)}
                          className="min-w-0 truncate text-left text-xs font-bold text-slate-700"
                        >
                          <span className={cn('mr-1.5 rounded-full border px-1.5 py-0.5 text-[9px] font-black', TYPE_META[node.type].soft)}>
                            {TYPE_META[node.type].shortLabel}
                          </span>
                          {node.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteEdge(edge.id)}
                          className="shrink-0 text-slate-300 transition-colors hover:text-red-500"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedNode.type === 'store' ? (
                  <div className="space-y-4 border-t border-slate-100 pt-4">
                    {STORE_RELATION_TYPES.map((type) => {
                      const meta = TYPE_META[type];
                      const linked = getStoreEdges(selectedNode.id, type);
                      const available = getAvailableTargets(selectedNode.id, type);
                      return (
                        <div key={type} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div className="text-xs font-black text-slate-800">关联{meta.label}</div>
                            <div className="text-[10px] font-bold text-slate-400">{linked.length} 个</div>
                          </div>
                          <div className="space-y-1.5">
                            {linked.length === 0 ? (
                              <div className="rounded-lg bg-white px-2 py-2 text-[11px] text-slate-400">暂无关联</div>
                            ) : linked.map(({ edge, related }) => (
                              <div key={edge.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5">
                                <span className="min-w-0 truncate text-xs font-bold text-slate-700">{related.name}</span>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteEdge(edge.id)}
                                  className="shrink-0 text-slate-300 transition-colors hover:text-red-500"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 flex gap-2">
                            <select
                              value={bindTargetId[type] || ''}
                              onChange={(event) => setBindTargetId((previous) => ({ ...previous, [type]: event.target.value }))}
                              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 outline-none"
                            >
                              <option value="">选择{meta.label}</option>
                              {available.map((node) => (
                                <option key={node.id} value={node.id}>{node.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void handleCreateEdge(selectedNode.id, type)}
                              disabled={!bindTargetId[type] || isSaving}
                              className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-900 px-2.5 text-[11px] font-black text-white disabled:opacity-50"
                            >
                              <Link2 className="size-3" />
                              绑定
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-3 border-t border-slate-100 pt-4">
                    <div>
                      <div className="mb-2 text-xs font-black text-slate-800">关联店铺</div>
                      <div className="space-y-1.5">
                        {getRelatedStores(selectedNode.id).length === 0 ? (
                          <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-400">暂未绑定店铺</div>
                        ) : getRelatedStores(selectedNode.id).map(({ edge, store }) => (
                          <div key={edge.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setSelectedId(store.id)}
                              className="min-w-0 truncate text-left text-xs font-bold text-emerald-700"
                            >
                              {store.name}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteEdge(edge.id)}
                              className="shrink-0 text-slate-300 transition-colors hover:text-red-500"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={bindTargetId.store || ''}
                        onChange={(event) => setBindTargetId((previous) => ({ ...previous, store: event.target.value }))}
                        className="h-9 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 outline-none"
                      >
                        <option value="">选择店铺</option>
                        {graph.nodes
                          .filter((node) => node.type === 'store' && !getRelatedStores(selectedNode.id).some(({ store }) => store.id === node.id))
                          .map((node) => (
                            <option key={node.id} value={node.id}>{node.name}</option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleBindToStore(selectedNode.id)}
                        disabled={!bindTargetId.store || isSaving}
                        className="inline-flex h-9 items-center gap-1 rounded-xl bg-slate-900 px-3 text-xs font-black text-white disabled:opacity-50"
                      >
                        <Link2 className="size-3.5" />
                        绑定
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
