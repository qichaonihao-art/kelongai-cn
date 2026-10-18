import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, AudioLines, BookOpenText,
  Check, ChevronRight, Command, Crown, Film, FolderOpen, Image as ImageIcon,
  LayoutDashboard, LogOut, Menu, Network, PencilLine, Search, Sparkles,
  Video, Wand2, X, CalendarRange,
} from 'lucide-react';
import type { ModuleId } from '../src/components/ModuleQuickNav';
import SiteFooter from '../src/components/SiteFooter';
import './home.css';

type Group = '全部工具' | '内容创作' | '素材管理' | '团队协作';
type Tool = { id: ModuleId; title: string; desc: string; category: Group; icon: typeof Wand2; keywords: string };
const tools: Tool[] = [
  { id: 'creative', title: '创意创作', desc: '视频创作、镜头截取与文案创作', category: '内容创作', icon: Wand2, keywords: '视频 生成 元素替换 人物替换 挂画 贴画 摆台 摆件 剪辑 剪裁' },
  { id: 'image', title: '图片生成', desc: '从灵感生图，到细节编辑', category: '内容创作', icon: ImageIcon, keywords: '图片 生图 修图 海报' },
  { id: 'voice', title: '声音克隆', desc: '克隆专属音色，制作自然配音', category: '内容创作', icon: AudioLines, keywords: '音频 语音 口播' },
  { id: 'douyin', title: '视频解析', desc: '下载无水印视频，提取口播文案', category: '素材管理', icon: ArrowDownToLine, keywords: '抖音 下载 提取' },
  { id: 'topmodel', title: '顶级模型', desc: '多模型对话，梳理创意与思路', category: '内容创作', icon: Crown, keywords: 'Claude ChatGPT 豆包 Doubao 千问 Qwen 聊天' },
  { id: 'feeding', title: '创意文库', desc: '收藏爆款案例，积累好文案', category: '素材管理', icon: BookOpenText, keywords: '文案 仿写 素材 开头' },
  { id: 'video-library', title: '视频素材库', desc: '原文件保存，团队共享与复用', category: '素材管理', icon: FolderOpen, keywords: '视频 文件 历史 下载' },
  { id: 'collection', title: '店铺总览', desc: '店铺、商品与账号关系，一目了然', category: '团队协作', icon: Network, keywords: '商品 视频号 ADQ 发货 商家' },
  { id: 'timeline', title: '团队轨迹', desc: '记录团队的关键选择与成长', category: '团队协作', icon: CalendarRange, keywords: '团队 历史 记录' },
];
const groups: Group[] = ['全部工具', '内容创作', '素材管理', '团队协作'];
const defaultMottos = ['多试试总没错', '7+3=七分专注，三分探索'];
const storagePrefix = 'kelong:home-design-preview:';

function readLocal<T,>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(storagePrefix + key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(storagePrefix + key, JSON.stringify(value)); } catch { /* Preview works without storage. */ }
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'hp-brand-mark hp-brand-mark--small' : 'hp-brand-mark'} viewBox="0 0 36 36" fill="none" aria-hidden="true">
    <path d="M7 25 17.5 6 29 25H7Z" stroke="currentColor" strokeWidth="2.3" strokeLinejoin="round" />
    <path d="m12 25 5.5-10L23 25M10 30h16" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
    <circle cx="28" cy="9" r="2.5" fill="currentColor" />
  </svg>;
}

function CreativeGeometry() {
  return <div className="hp-geometry" aria-hidden="true">
    <svg viewBox="0 0 340 280" fill="none">
      <path d="M28 208C74 257 277 256 317 190M37 87C85 35 263 29 314 88" stroke="#58797d" strokeWidth=".8" />
      <ellipse cx="174" cy="149" rx="143" ry="76" transform="rotate(-32 174 149)" stroke="#446c73" strokeWidth=".8" />
      <path d="M100 55 249 73 231 211 81 193Z" fill="#14353d" stroke="#619595" />
      <path d="m117 38 146 32-31 141-146-32Z" fill="#1b454b" stroke="#74b3aa" />
      <rect x="129" y="74" width="110" height="142" rx="8" fill="#b9e1c8" />
      <rect x="139" y="84" width="90" height="103" rx="3" fill="#163c42" />
      <path d="m139 160 27-29 18 16 18-26 27 39v27h-90Z" fill="#73a99e" />
      <circle cx="204" cy="106" r="10" fill="#d1ebaf" />
      <path d="M142 201h37m8 0h27" stroke="#325d57" strokeWidth="3" strokeLinecap="round" />
      <rect x="191" y="172" width="93" height="53" rx="7" fill="#edf3d9" />
      <path d="m230 187 17 11-17 11v-22Z" fill="#173a3f" />
      <path d="M53 204h28m-14-14v28M280 57h18m-9-9v18" stroke="#aed6cb" strokeWidth="1.5" />
      <circle cx="71" cy="98" r="4" fill="#d0e9ab" />
      <circle cx="292" cy="166" r="3" fill="#87b9ad" />
    </svg>
  </div>;
}

interface HomeProps {
  onNavigate: (page: ModuleId) => void;
  onLogout: () => void;
  onHome?: () => void;
  currentModule?: ModuleId;
  moduleTitle?: string;
  moduleDescription?: string;
  workspaceContent?: ReactNode;
}

export default function HomePage({ onNavigate, onLogout, onHome, currentModule, moduleTitle, moduleDescription, workspaceContent }: HomeProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<Group>('全部工具');
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const [mottos, setMottos] = useState<string[]>(() => {
    const saved = readLocal<unknown>('mottos', defaultMottos);
    return Array.isArray(saved) && saved.length && saved.every(x => typeof x === 'string') ? saved.slice(0, 4) : defaultMottos;
  });
  const [editingMotto, setEditingMotto] = useState(false);
  const [mottoDraft, setMottoDraft] = useState('');
  const [recent, setRecent] = useState<ModuleId[]>(() => {
    const saved = readLocal<unknown>('recent', []);
    return Array.isArray(saved) ? saved.filter(id => tools.some(t => t.id === id)).slice(0, 3) : [];
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const isSearching = !!query.trim();
  const filtered = useMemo(() => tools.filter(tool =>
    (group === '全部工具' || tool.category === group) &&
    `${tool.title} ${tool.desc} ${tool.keywords}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  ), [group, query]);
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => { setCompact(media.matches); if (!media.matches) setMenuOpen(false); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!compact || !menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [compact, menuOpen]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') {
        if (menuOpen) { setMenuOpen(false); menuRef.current?.focus(); }
        else if (query) { setQuery(''); }
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [menuOpen, query]);

  useEffect(() => {
    if (!menuOpen) return;
    const sidebar = sidebarRef.current;
    const firstButton = sidebar?.querySelector<HTMLButtonElement>('button');
    firstButton?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !sidebar) return;
      const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>('button, textarea'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', trapFocus);
    return () => document.removeEventListener('keydown', trapFocus);
  }, [menuOpen, editingMotto]);

  function navigate(id: ModuleId) {
    const next = [id, ...recent.filter(x => x !== id)].slice(0, 3);
    setRecent(next);
    writeLocal('recent', next);
    setMenuOpen(false);
    setQuery('');
    setGroup('全部工具');
    onNavigate(id);
  }
  function resetFilters() { setQuery(''); setGroup('全部工具'); }
  function saveMotto() {
    const next = mottoDraft.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 4);
    if (!next.length) return;
    setMottos(next);
    writeLocal('mottos', next);
    setEditingMotto(false);
  }

  const toolResults = (<section className="hp-tools" aria-labelledby="hp-tools-heading">
          <div className="hp-section-heading"><h2 id="hp-tools-heading">{isSearching ? '搜索结果' : '你的创作工具箱'}<span>{filtered.length} 个工具</span></h2>
            <div className="hp-filters" role="group" aria-label="按用途筛选工具">{groups.map(item => <button key={item} aria-pressed={group === item} className={group === item ? 'is-active' : ''} onClick={() => setGroup(item)}>{item}</button>)}</div>
          </div>
          <div aria-live="polite" className="hp-result-announcement">{isSearching ? `找到 ${filtered.length} 个与“${query}”相关的工具` : ''}</div>
          {filtered.length ? <div className="hp-tool-grid">{filtered.map(tool => <button className="hp-tool" key={tool.id} onClick={() => navigate(tool.id)}><div className="hp-tool-icon"><tool.icon size={22} strokeWidth={1.65} /></div><div className="hp-tool-copy"><h3>{tool.title}</h3><p>{tool.desc}</p></div><ArrowUpRight className="hp-tool-arrow" size={17} /></button>)}</div> : <div className="hp-empty"><Search size={28} strokeWidth={1.4} /><h3>没有找到匹配的工具</h3><p>试试“视频”“配音”或“图片”，也可以查看全部工具。</p><button className="hp-secondary-button" onClick={resetFilters}>查看全部工具<ArrowRight size={15} /></button></div>}
        </section>);

  return <div className="hp-workspace">
    <a className="hp-skip-link" href="#hp-main">跳至工作区</a>
    {menuOpen && <button className="hp-menu-scrim" aria-label="关闭导航" onClick={() => { setMenuOpen(false); menuRef.current?.focus(); }} />}
    <aside ref={sidebarRef} id="hp-sidebar" className={`hp-sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="主导航" inert={compact && !menuOpen} aria-hidden={compact && !menuOpen ? true : undefined}>
      <div className="hp-brand"><BrandMark /><div><strong>AI 创意工作台</strong><span>让好创意，发生。</span></div>
        <button className="hp-mobile-close hp-icon-button" aria-label="关闭导航" onClick={() => { setMenuOpen(false); menuRef.current?.focus(); }}><X size={18} /></button>
      </div>
      <button className="hp-nav-home" onClick={() => { resetFilters(); onHome?.(); }} aria-current={!currentModule ? "page" : undefined}><LayoutDashboard size={18} />工作台<ChevronRight size={14} /></button>
      <nav>
        {(['内容创作', '素材管理', '团队协作'] as Group[]).map(category => <div className="hp-nav-group" key={category}>
          <p>{category}</p>
          {tools.filter(tool => tool.category === category).map(tool => <button key={tool.id} className={`hp-nav-item ${currentModule === tool.id ? "is-current" : ""}`} aria-current={currentModule === tool.id ? "page" : undefined} onClick={() => navigate(tool.id)}><tool.icon size={17} /><span>{tool.title}</span><ArrowUpRight className="hp-nav-arrow" size={14} /></button>)}
        </div>)}
      </nav>
      <div className="hp-sidebar-bottom">
        <div className="hp-culture">
          <div className="hp-culture-title"><span>一起，把事情做好</span><button className="hp-icon-button" aria-label="编辑团队标语" onClick={() => { setMottoDraft(mottos.join('\n')); setEditingMotto(true); }}><PencilLine size={14} /></button></div>
          {editingMotto ? <div className="hp-culture-editor">
            <label htmlFor="hp-motto">每行一句，最多 4 行</label>
            <textarea id="hp-motto" autoFocus value={mottoDraft} onChange={e => setMottoDraft(e.target.value)} rows={4} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setEditingMotto(false); } if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveMotto(); }} />
            <div><button onClick={() => setEditingMotto(false)}>取消</button><button disabled={!mottoDraft.trim()} onClick={saveMotto}><Check size={13} />保存</button></div>
            <small>本地预览，仅保存到当前设备</small>
          </div> : mottos.map((motto, i) => <p key={i}>{motto}</p>)}
        </div>
        <button className="hp-logout" onClick={onLogout}><LogOut size={16} />退出预览</button>
      </div>
    </aside>

    <div className="hp-body" inert={compact && menuOpen}>
      <header className="hp-topbar">
        <div className="hp-breadcrumb"><button ref={menuRef} aria-label="打开导航" aria-expanded={menuOpen} aria-controls="hp-sidebar" className="hp-mobile-menu hp-icon-button" onClick={() => setMenuOpen(true)}><Menu size={21} /></button><span>我的工作空间</span><ChevronRight size={14} /><strong>{moduleTitle || "工作台"}</strong></div>
        <div className="hp-search"><Search size={17} /><input ref={searchRef} type="search" aria-label="搜索工具" placeholder="搜索工具、功能…" value={query} onChange={e => { setQuery(e.target.value); setGroup('全部工具'); }} />{query ? <button className="hp-icon-button" aria-label="清空搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><X size={14} /></button> : <kbd><Command size={11} /> K</kbd>}</div>
        <div className="hp-topbar-end"><span>创作空间</span><div className="hp-avatar" aria-label="团队工作空间"><BrandMark small /></div></div>
      </header>

      <main id="hp-main" className={`hp-main ${workspaceContent && !isSearching ? "hp-main--module" : ""}`} tabIndex={-1}>
        <section className="hp-intro"><div><h1>{workspaceContent && !isSearching ? moduleTitle : "好作品，从一个想法开始。"}</h1><p>{workspaceContent && !isSearching ? moduleDescription : "把灵感交给 AI，把时间留给创造。"}</p></div><time>{date}</time></section>
        {workspaceContent ? <>
          {isSearching && toolResults}
          <div hidden={isSearching}>{workspaceContent}</div>
        </> : <>

        {!isSearching && group === '全部工具' && <section className="hp-featured" aria-label="主要创作入口">
          <article className="hp-creative-feature">
            <div className="hp-creative-copy"><h2>让灵感，<br />更快成为作品。</h2><p>从视频、镜头到文案，<br className="hp-hero-break" />在一个工作流里完成创作。</p><button className="hp-primary-button" onClick={() => navigate('creative')}>开始创意创作<ArrowUpRight size={18} /></button></div>
            <CreativeGeometry />
            <div className="hp-feature-bottom"><span><Film size={13} />视频创作</span><i /><span>镜头截取</span><i /><span>文案创作</span></div>
          </article>
          <article className="hp-image-feature">
            <div className="hp-image-symbol" aria-hidden="true"><svg viewBox="0 0 180 110" fill="none"><rect x="32" y="8" width="100" height="75" rx="5" stroke="#91b4a6" transform="rotate(-12 32 8)" /><rect x="53" y="18" width="100" height="75" rx="5" fill="#e7efdb" stroke="#3e7665" /><path d="m54 75 25-22 18 13 26-28 29 37v17H54Z" fill="#a1bea8" /><circle cx="129" cy="39" r="9" fill="#457865" /><path d="M47 13v-7m-3 3h7M161 80v12m-6-6h12" stroke="#3e7665" strokeWidth="1.5" /></svg></div>
            <div><h2>把脑海里的画面，<br />变成眼前的图片。</h2><p>灵感生图 · 精细编辑</p></div>
            <button className="hp-text-button" onClick={() => navigate('image')}>进入图片生成<ArrowRight size={17} /></button>
          </article>
        </section>}

        {toolResults}

        {!isSearching && group === '全部工具' && <section className="hp-library-banner" aria-label="素材复用"><div className="hp-library-visual" aria-hidden="true"><span /><span /><span><Video size={22} /></span></div><div><h2>好素材，值得被再次看见。</h2><p>把视频收进素材库，让每一次创作都有积累。</p></div><button className="hp-secondary-button" onClick={() => navigate('video-library')}>打开素材库<ArrowRight size={16} /></button></section>}

        {recent.length > 0 && !isSearching && <section className="hp-recent" aria-label="本机最近使用"><span>本机最近使用</span>{recent.map(id => { const tool = tools.find(t => t.id === id)!; return <button onClick={() => navigate(id)} key={id}><tool.icon size={14} />{tool.title}<ArrowUpRight size={12} /></button>; })}</section>}
        </>}
        <div className="hp-bottom"><span>专注创作，让每个想法都有回响。</span><SiteFooter /></div>
      </main>
    </div>
  </div>;
}
