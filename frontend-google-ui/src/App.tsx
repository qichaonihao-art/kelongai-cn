/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import VoiceCloningPage from './pages/VoiceCloningPage';
import CreativeCreationPage from './pages/CreativeCreationPage';
import CreativeSelectPage from './pages/CreativeSelectPage';
import CopywritingPage from './pages/CopywritingPage';
import DouyinDownloaderPage from './pages/DouyinDownloaderPage';
import StoreOverviewPage from './pages/StoreOverviewPage';
import ImageGenerationPage from './pages/ImageGenerationPage';
import TopModelPage from './pages/TopModelPage';
import UniversalExtractorPage from './pages/UniversalExtractorPage';
import CreativeFeedingPage from './pages/CreativeFeedingPage';
import TeamTimelinePage from './pages/TeamTimelinePage';
import VideoLibraryPage from './pages/VideoLibraryPage';
import { getAuthStatus, loginWithPassword, logout } from './lib/auth';
import type { ModuleId } from './components/ModuleQuickNav';

type Page = 'login' | 'home' | 'universal' | 'creative-video' | 'creative-copy' | ModuleId;

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[app] page render failed', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-screen place-items-center bg-slate-200 p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/80 bg-white p-8 text-center shadow-xl">
            <div className="text-lg font-black text-slate-900">页面暂时没有正常显示</div>
            <div className="mt-2 text-sm leading-6 text-slate-500">任务数据仍会尽量保留。重新加载后可以继续查看历史记录。</div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-slate-900 px-5 text-sm font-bold text-white transition-colors hover:bg-slate-700"
            >
              重新加载页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('login');
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const authenticated = await getAuthStatus();
        if (!cancelled) {
          setCurrentPage(authenticated ? 'home' : 'login');
        }
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
        }
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (password: string) => {
    const result = await loginWithPassword(password);
    if (result.ok) {
      setCurrentPage('home');
    }
    return result;
  };

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
  };

  const handleBackToHome = () => {
    setCurrentPage('home');
  };

  const handleBackToCreative = () => {
    setCurrentPage('creative');
  };

  const handleBackToDouyin = () => {
    setCurrentPage('douyin');
  };

  const handleLogout = async () => {
    await logout();
    setCurrentPage('login');
  };

  if (!authChecked) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <AppErrorBoundary>
    <div className="min-h-screen font-sans text-slate-900">
      {currentPage === 'login' && <LoginPage onLogin={handleLogin} />}
      {currentPage === 'home' && (
        <HomePage 
          onNavigate={handleNavigate} 
          onLogout={handleLogout} 
        />
      )}
      {currentPage === 'voice' && (
        <VoiceCloningPage
          onBack={handleBackToHome}
          onNavigate={handleNavigate}
        />
      )}
      {currentPage === 'creative' && (
        <CreativeSelectPage
          onBack={handleBackToHome}
          onNavigate={handleNavigate}
          onSelectVideo={() => setCurrentPage('creative-video')}
          onSelectCopy={() => setCurrentPage('creative-copy')}
        />
      )}
      {currentPage === 'creative-video' && (
        <CreativeCreationPage
          onBack={handleBackToCreative}
          onNavigate={handleNavigate}
          onSwitchToCopy={() => setCurrentPage('creative-copy')}
        />
      )}
      {currentPage === 'creative-copy' && (
        <CopywritingPage
          onBack={handleBackToCreative}
          onNavigate={handleNavigate}
          onSwitchToVideo={() => setCurrentPage('creative-video')}
        />
      )}
      {currentPage === 'douyin' && (
        <DouyinDownloaderPage
          onBack={handleBackToHome}
          onNavigate={handleNavigate}
        />
      )}
      {currentPage === 'collection' && (
        <StoreOverviewPage
          onBack={handleBackToHome}
          onNavigate={handleNavigate}
        />
      )}
      {currentPage === 'image' && (
        <ImageGenerationPage
          onBack={handleBackToHome}
          onNavigate={handleNavigate}
        />
      )}
      {currentPage === 'topmodel' && (
        <TopModelPage
          onBack={handleBackToHome}
          onNavigate={handleNavigate}
        />
      )}
      {currentPage === 'feeding' && (
        <CreativeFeedingPage
          onBack={handleBackToHome}
          onNavigate={handleNavigate}
        />
      )}
      {currentPage === 'timeline' && (
        <TeamTimelinePage onBack={handleBackToHome} onNavigate={handleNavigate} />
      )}
      {currentPage === 'video-library' && (
        <VideoLibraryPage onBack={handleBackToHome} onNavigate={handleNavigate} />
      )}
      {currentPage === 'universal' && (
        <UniversalExtractorPage
          onBack={handleBackToDouyin}
          onNavigate={handleNavigate}
        />
      )}
    </div>
    </AppErrorBoundary>
  );
}
