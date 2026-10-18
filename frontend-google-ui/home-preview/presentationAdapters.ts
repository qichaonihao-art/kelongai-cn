import type { Plugin } from 'vite';

/** Only adapt view-state defaults in the local preview. Fail loudly if the
 * source changes, rather than silently changing another part of a tool. */
export function presentationAdapters(): Plugin {
  return {
    name: 'local-studio-presentation',
    enforce: 'pre',
    transform(code, id) {
      const target = id.split('?')[0];
      const view = target.endsWith('/src/pages/ImageGenerationPage.tsx')
        ? { state: 'showSidebar', setter: 'setShowSidebar' }
        : target.endsWith('/src/pages/TopModelPage.tsx')
          ? { state: 'sidebarOpen', setter: 'setSidebarOpen' }
          : null;
      if (!view) return;
      const original = `const [${view.state}, ${view.setter}] = useState(true);`;
      if (!code.includes(original)) throw new Error(`Local UI preview needs its sidebar adapter updated: ${target}`);
      const replacement = `const [${view.state}, ${view.setter}] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const sync = () => ${view.setter}(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);`;
      let adapted = code.replace(original, replacement);
      // The original image drawer has an icon-only toggle. Give it a name and
      // expanded state for keyboard/screen-reader use in the preview.
      if (view.state === 'showSidebar') adapted = adapted.replace(
        'onClick={() => setShowSidebar(!showSidebar)}',
        'aria-label="图片生成历史" aria-expanded={showSidebar} onClick={() => setShowSidebar(!showSidebar)}',
      );
      return { code: adapted, map: null };
    },
  };
}
