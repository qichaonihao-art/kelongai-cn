import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { presentationAdapters } from './presentationAdapters';
const here = path.dirname(fileURLToPath(import.meta.url));
// Local study only. The normal app config, auth and API routes are untouched.
const offlinePreview: Plugin = {
  name: 'local-homepage-preview',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next();
      // Empty local lists let the actual UI show its empty states. Never read
      // production data or accept a write/generation request in this server.
      const pathname = req.url.split('?')[0];
      const emptyViews: Record<string, unknown> = {
        '/api/config/status': { serverManaged: {} },
        '/api/painting/batch-runs': { runs: [] },
        '/api/person-replacement/tasks': { tasks: [] },
        '/api/video-library/folders': { folders: ['通用素材'], counts: { '通用素材': 0 } },
        '/api/video-library/videos': { items: [], folders: [] },
        '/api/video-library/summary': { items: [] },
        '/api/store-overview/graph': { nodes: [], edges: [], settings: { columnOrder: [] } },
        '/api/team-timeline': { records: [] },
        '/api/voice/archive': { records: [] },
        '/api/creative-feeding/openings': { ok: true, openings: [], total: 0 },
        '/api/creative-feeding/settings': { ok: true, settings: { businessBackground: '', targetAudience: '', productFeatures: '', stylePreference: '', conversionDirections: '', forbiddenExpressions: '', openingRules: '', outputFormat: '' } },
      };
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'GET' && Object.hasOwn(emptyViews, pathname)) {
        res.statusCode = 200;
        res.end(JSON.stringify(emptyViews[pathname]));
        return;
      }
      res.statusCode = 503;
      res.end(JSON.stringify({ error: '离线界面预览未连接业务后台，数据操作和生成任务暂不可用。' }));
    });
  },
};
export default defineConfig({
  root: path.resolve(here, '..'),
  plugins: [presentationAdapters(), react(), tailwindcss(), offlinePreview],
  resolve: { alias: [
    { find: '@/src/components/ModuleQuickNav', replacement: path.join(here, 'ModuleQuickNav.tsx') },
    { find: '@', replacement: path.resolve(here, '..') },
  ] },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  build: { outDir: '/tmp/kelong-home-preview-build', emptyOutDir: true, rollupOptions: { input: path.join(here, 'index.html') } },
});
