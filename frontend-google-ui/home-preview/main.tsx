import { Component, Suspense, lazy, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import HomePage from './HomePage';
import CreativeEntry from './CreativeEntry';
import OriginalHomePage from '../src/pages/HomePage';
import type { ModuleId } from '../src/components/ModuleQuickNav';
import type { IncomingCreativeClip } from '../src/lib/clipCreative';
import '../src/index.css';
import './preview.css';
import './modules.css';

const CreativeSelectPage = lazy(() => import('../src/pages/CreativeSelectPage'));
const CreativeCreationPage = lazy(() => import('../src/pages/CreativeCreationPage'));
const ClipExtractionPage = lazy(() => import('../src/pages/ClipExtractionPage'));
const CopywritingPage = lazy(() => import('../src/pages/CopywritingPage'));
const VoiceCloningPage = lazy(() => import('../src/pages/VoiceCloningPage'));
const ImageGenerationPage = lazy(() => import('../src/pages/ImageGenerationPage'));
const DouyinDownloaderPage = lazy(() => import('../src/pages/DouyinDownloaderPage'));
const UniversalExtractorPage = lazy(() => import('../src/pages/UniversalExtractorPage'));
const StoreOverviewPage = lazy(() => import('../src/pages/StoreOverviewPage'));
const TopModelPage = lazy(() => import('../src/pages/TopModelPage'));
const CreativeFeedingPage = lazy(() => import('../src/pages/CreativeFeedingPage'));
const TeamTimelinePage = lazy(() => import('../src/pages/TeamTimelinePage'));
const VideoLibraryPage = lazy(() => import('../src/pages/VideoLibraryPage'));
type Page = ModuleId | 'home' | 'creative-video' | 'creative-clip' | 'creative-copy' | 'universal';

class PreviewBoundary extends Component<{ children: ReactNode; onBack: () => void }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    if (this.state.error) return <div className="home-preview-error"><h1>这个模块需要业务后台</h1><p>当前仅运行本地界面预览，没有连接线上数据。</p><button onClick={() => { this.setState({ error: false }); this.props.onBack(); }}>返回主页</button></div>;
    return this.props.children;
  }
}

function Preview() {
  const [variant, setVariant] = useState<'new' | 'original'>('new');
  const [page, setPage] = useState<Page>('home');
  const [incoming, setIncoming] = useState<IncomingCreativeClip | null>(null);
  const home = () => { setPage('home'); window.scrollTo(0, 0); };
  const navigate = (next: Page) => { setPage(next); window.scrollTo(0, 0); };
  const common = { onBack: home, onNavigate: navigate };
  const creativeCommon = { onBack: () => navigate('creative'), onNavigate: navigate };
  const moduleId: ModuleId | undefined = page === 'home' ? undefined : page.startsWith('creative-') ? 'creative' : page === 'universal' ? 'douyin' : page as ModuleId;
  const pageMeta: Record<Page, [string, string]> = {
    home: ['工作台', ''], creative: ['创意创作', '从灵感、镜头到文案，选择你的创作方式。'],
    'creative-video': ['视频创作', '分析参考、生成素材，把想法变成视频。'],
    'creative-clip': ['镜头截取', '识别镜头、精确剪切，让好素材进入下一次创作。'],
    'creative-copy': ['文案创作', '从真实案例出发，写出适合产品的表达。'],
    voice: ['声音克隆', '留下专属音色，让每一句表达自然发生。'],
    image: ['图片生成', '从灵感生图，到细节编辑。'],
    douyin: ['视频解析', '提取视频与文案，把参考变成创作起点。'],
    universal: ['全网全平台解析', '粘贴作品链接，提取视频与逐字稿。'],
    collection: ['店铺总览', '在一张关系图里，理清店铺、商品和账号。'],
    topmodel: ['顶级模型', '与不同模型对话，找到更好的思路。'],
    feeding: ['创意文库', '收藏好案例，让创意有据可循。'],
    timeline: ['团队轨迹', '记录每一个重要时刻，留下共同成长的轨迹。'],
    'video-library': ['视频素材库', '集中整理、快速查找，让好素材持续复用。'],
  };
  const moduleContent = <div className={`studio-module studio-module--${page}`} data-studio-page={page}>
    <PreviewBoundary key={page} onBack={home}><Suspense fallback={<div className="home-preview-loading">正在打开工具…</div>}>
      {page === 'creative' && (variant === 'new' ? <CreativeEntry onSelectVideo={() => navigate('creative-video')} onSelectClip={() => navigate('creative-clip')} onSelectCopy={() => navigate('creative-copy')} /> : <CreativeSelectPage {...common} onSelectVideo={() => navigate('creative-video')} onSelectClip={() => navigate('creative-clip')} onSelectCopy={() => navigate('creative-copy')} />)}
      {page === 'creative-video' && <CreativeCreationPage {...creativeCommon} onSwitchToClip={() => navigate('creative-clip')} onSwitchToCopy={() => navigate('creative-copy')} incomingClip={incoming} onIncomingClipConsumed={() => setIncoming(null)} />}
      {page === 'creative-clip' && <ClipExtractionPage {...creativeCommon} onSwitchToVideo={() => navigate('creative-video')} onSwitchToCopy={() => navigate('creative-copy')} onUseInCreative={(clip, mode) => { setIncoming({ ...clip, mode, token: Date.now() }); navigate('creative-video'); }} />}
      {page === 'creative-copy' && <CopywritingPage {...creativeCommon} onSwitchToVideo={() => navigate('creative-video')} onSwitchToClip={() => navigate('creative-clip')} />}
      {page === 'voice' && <VoiceCloningPage {...common} />}
      {page === 'image' && <ImageGenerationPage {...common} />}
      {page === 'douyin' && <DouyinDownloaderPage {...common} />}
      {page === 'universal' && <UniversalExtractorPage onBack={() => navigate('douyin')} onNavigate={navigate} />}
      {page === 'collection' && <StoreOverviewPage {...common} />}
      {page === 'topmodel' && <TopModelPage {...common} />}
      {page === 'feeding' && <CreativeFeedingPage {...common} />}
      {page === 'timeline' && <TeamTimelinePage {...common} />}
      {page === 'video-library' && <VideoLibraryPage {...common} />}
    </Suspense></PreviewBoundary></div>;
  return <>
    <div className="home-preview-toolbar"><div><span className="home-preview-dot" /><strong>全站 UI 本地预览</strong><span className="home-preview-disclaimer">离线界面预览 · 列表为本地空数据</span></div><div>
      {page !== 'home' && <button onClick={home}><ArrowLeft size={12} />返回主页</button>}
      <div className="home-preview-switch" role="group" aria-label="对比界面版本"><button aria-pressed={variant === 'new'} onClick={() => setVariant('new')}>新版界面</button><button aria-pressed={variant === 'original'} onClick={() => setVariant('original')}>原版对比<ArrowUpRight size={11} /></button></div>
    </div></div>
    <div className="home-preview-stage">{variant === 'new' ?
      <HomePage onNavigate={navigate} onHome={home} onLogout={() => { setVariant('original'); home(); }} currentModule={moduleId} moduleTitle={pageMeta[page][0]} moduleDescription={pageMeta[page][1]} workspaceContent={page === 'home' ? undefined : moduleContent} /> :
      page === 'home' ? <OriginalHomePage onNavigate={navigate} onLogout={() => { setVariant('new'); home(); }} /> : moduleContent
    }</div>
  </>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
