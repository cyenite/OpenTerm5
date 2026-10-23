import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// The React refresh preamble is an inline script, which the production CSP forbids.
const devCsp = (): Plugin => ({
  name: 'openterm-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
});

export default defineConfig({
  base: './',
  plugins: [react(), devCsp()],
  resolve: {
    alias: [
      { find: /^@meridian\/charts$/, replacement: fileURLToPath(new URL('./packages/meridian-charts/src/index.ts', import.meta.url)) },
      { find: /^@meridian\/charts\/(.*)$/, replacement: fileURLToPath(new URL('./packages/meridian-charts/src/', import.meta.url)) + '$1' },
    ],
  },
  server: { port: 5199, strictPort: true },
  // The Pine runtime worker loads PineTS with a dynamic import, which classic workers cannot do.
  worker: { format: 'es' },
  // The phone client is a second page; the computer serves it to paired phones.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: { input: { main: fileURLToPath(new URL('./index.html', import.meta.url)), mobile: fileURLToPath(new URL('./mobile.html', import.meta.url)) } },
  },
});
