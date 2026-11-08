import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/**
 * Keep the real App/router untouched: only swap the two pages that this
 * seasonal skin owns, plus the auth module used by the offline preview.
 */
function springPageOverrides(): Plugin {
  return {
    name: 'spring-page-overrides',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer) return null;
      const normalizedImporter = importer.split('?')[0];
      if (!normalizedImporter.endsWith('/src/App.tsx')) return null;

      if (source === './pages/LoginPage') {
        return path.join(here, '..', 'src', 'pages', 'spring', 'SpringLoginPage.tsx');
      }
      if (source === './pages/HomePage') {
        return path.join(here, '..', 'src', 'pages', 'spring', 'SpringHomePage.tsx');
      }
      if (source === './lib/auth') {
        return path.join(here, 'demoAuth.ts');
      }
      return null;
    },
  };
}

function previewApi() {
  return {
    name: 'festive-preview-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const pathname = url.pathname;
        if (pathname === '/') {
          res.writeHead(302, { Location: `/festive-preview/${url.search}` }).end();
          return;
        }
        if (!pathname.startsWith('/api/')) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');

        if (req.method === 'GET' && pathname === '/api/video-library/summary') {
          res.end(JSON.stringify({ items: [] }));
          return;
        }

        if (pathname === '/api/home/culture-mottos') {
          if (req.method === 'GET') {
            res.end(JSON.stringify({ mottos: ['多试试总没错', '7+3=七分专注，三分探索'] }));
            return;
          }
          if (req.method === 'PUT') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
            });
            req.on('end', () => {
              try {
                const json = JSON.parse(body || '{}');
                const mottos = Array.isArray(json?.mottos)
                  ? json.mottos.map(String).map((item: string) => item.trim()).filter(Boolean).slice(0, 4)
                  : [];
                res.end(JSON.stringify({ mottos }));
              } catch {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: '标语格式不正确。' }));
              }
            });
            return;
          }
        }

        res.statusCode = 503;
        res.end(JSON.stringify({ error: '本地预览未接入业务后台。' }));
      });
    },
  };
}

export default defineConfig({
  root,
  cacheDir: path.join(tmpdir(), 'kelong-festive-preview-cache'),
  plugins: [springPageOverrides(), react(), tailwindcss(), previewApi()],
  resolve: {
    alias: [{ find: '@', replacement: root }],
  },
  server: {
    host: '127.0.0.1',
    port: 5177,
    strictPort: true,
  },
  build: {
    outDir: path.join(tmpdir(), 'kelong-festive-preview-build'),
    emptyOutDir: true,
    rollupOptions: { input: path.join(here, 'index.html') },
  },
});
