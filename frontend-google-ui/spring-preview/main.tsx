import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import '../src/index.css';
import './spring.css';

function Preview() {
  const [theme, setTheme] = useState<'spring' | 'original'>('spring');

  return <>
    <header className="spring-preview-bar">
      <div className="spring-preview-label"><strong>春节配色预览</strong><span>本地演示 · 密码 2027</span></div>
      <div className="spring-preview-group" role="group" aria-label="切换配色">
        <button aria-pressed={theme === 'spring'} onClick={() => setTheme('spring')}>春节配色</button>
        <button aria-pressed={theme === 'original'} onClick={() => setTheme('original')}>当前配色</button>
      </div>
    </header>
    <div className="spring-preview-stage" data-theme={theme}>
      <App />
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
