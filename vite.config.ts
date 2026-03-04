import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  // Vite serves index.html at root; all non-API routes fall back to it
  // (SPA mode — worker handles the true fallback in production)
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  // Ensure maplibre-gl and other CJS deps are pre-bundled
  optimizeDeps: {
    include: ['maplibre-gl'],
  },
});
