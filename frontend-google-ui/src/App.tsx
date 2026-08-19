/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
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
  );
}
