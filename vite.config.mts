import react from '@vitejs/plugin-react';
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
  server: { port: 5199, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
