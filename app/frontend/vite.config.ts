import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const CORE = resolve(import.meta.dirname, '../../assets/core');
const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.txt': 'text/plain',
};

/**
 * Dev-only: serve /core/* from assets/core so the frontend also runs in a plain
 * browser (`pnpm dev`, Playwright). In the desktop app the Go backend serves it.
 */
function coreAssets(): Plugin {
  return {
    name: 'ps2cc-core-assets',
    configureServer(server) {
      server.middlewares.use('/core', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\/+/, '');
        const full = normalize(join(CORE, rel));
        if (!full.startsWith(CORE + sep) || !existsSync(full) || statSync(full).isDirectory()) return next();
        res.setHeader('Content-Type', TYPES[extname(full)] ?? 'application/octet-stream');
        createReadStream(full).pipe(res);
      });
      // Served by the Go backend. Under `wails dev` a 404 here makes Wails hand the request to the
      // backend's asset handler; without this, Vite's SPA fallback would answer with index.html.
      for (const prefix of ['/library', '/characters']) {
        server.middlewares.use(prefix, (_req, res) => {
          res.statusCode = 404;
          res.end();
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), coreAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    target: 'es2022',
  },
  // wails dev serves the app (with the Go bindings) on 34115 and proxies to this dev server.
  server: { port: 34116, strictPort: false },
});
