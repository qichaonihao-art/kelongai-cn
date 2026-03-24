/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import VoiceCloningPage from './pages/VoiceCloningPage';
import CreativeCreationPage from './pages/CreativeCreationPage';
import { getAuthStatus, loginWithPassword, logout } from './lib/auth';

type Page = 'login' | 'home' | 'voice' | 'creative';

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

  const handleNavigate = (page: 'voice' | 'creative') => {
    setCurrentPage(page);
  };

  const handleBackToHome = () => {
    setCurrentPage('home');
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
      {currentPage === 'voice' && <VoiceCloningPage onBack={handleBackToHome} />}
      {currentPage === 'creative' && (
        <CreativeCreationPage 
          onBack={handleBackToHome} 
          onLogout={handleLogout} 
        />
      )}
    </div>
  );
}
