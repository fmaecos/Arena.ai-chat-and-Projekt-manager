import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createApi } from './server/api.mjs';
import { zipExtension } from './scripts/extension-archive.mjs';

function demoApi() {
  const sessions = new Map();
  const install = (server) => {
    server.middlewares.use((req, res, next) => {
      if (req.method === 'GET' && req.url === '/kontext-chrome.zip') {
        return zipExtension().then((zip) => {
          res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="kontext-chrome.zip"' });
          res.end(zip);
        }).catch(next);
      }
      if (!req.url?.startsWith('/api/')) return next();
      const key = req.headers['x-kontext-demo'];
      if (typeof key !== 'string' || !/^[a-f0-9]{32}$/.test(key)
        || req.headers['sec-fetch-site'] === 'cross-site') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Für die Demo ist eine gültige Browser-Sitzung erforderlich.' }));
      }
      const existing = sessions.get(key);
      if (existing) {
        sessions.delete(key);
        sessions.set(key, existing);
        return existing.handler(req, res);
      }
      if (sessions.size >= 12) {
        // Let an in-flight upload or request finish if its session was just displaced.
        sessions.delete(sessions.keys().next().value);
      }
      const api = createApi({ demo: true });
      sessions.set(key, api);
      return api.handler(req, res);
    });
    server.httpServer?.once('close', () => { for (const api of sessions.values()) api.store.close(); });
  };
  return { name: 'kontext-demo-api', configureServer: install, configurePreviewServer: install };
}

export default defineConfig({
  base: './',
  build: { rollupOptions: { output: { manualChunks: (id) => id.includes('/highlight.js/') ? 'syntax' : undefined } } },
  plugins: [react(), demoApi()],
  server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
  preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
});
