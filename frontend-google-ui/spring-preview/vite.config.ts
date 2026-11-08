import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export default defineConfig({
  root,
  cacheDir: path.join(tmpdir(), 'kelong-spring-preview-cache'),
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'spring-preview-offline',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const pathname = req.url?.split('?')[0];
          if (pathname === '/') {
            res.writeHead(302, { Location: '/spring-preview/' }).end();
            return;
          }
          if (!pathname?.startsWith('/api/')) return next();
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          if (req.method === 'GET' && pathname === '/api/video-library/summary') {
            res.end(JSON.stringify({ items: [] }));
            return;
          }
          if (req.method === 'GET' && pathname === '/api/home/culture-mottos') {
            res.end(JSON.stringify({ mottos: ['多试试总没错', '7+3=七分专注，三分探索'] }));
            return;
          }
          res.statusCode = 503;
          res.end(JSON.stringify({ error: '本地预览未接入业务后台。' }));
        });
      },
    },
  ],
  resolve: {
    alias: [
      { find: './lib/auth', replacement: path.join(here, 'demoAuth.ts') },
      { find: '@', replacement: root },
    ],
  },
  server: { host: '127.0.0.1', port: 5176, strictPort: true },
  build: {
    outDir: path.join(tmpdir(), 'kelong-spring-preview-build'),
    emptyOutDir: true,
    rollupOptions: { input: path.join(here, 'index.html') },
  },
});
