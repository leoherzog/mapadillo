import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-maplibre', test: /maplibre-gl/, priority: 20 },
            { name: 'vendor-webawesome', test: /@web\.awesome\.me/, priority: 15 },
          ],
        },
      },
    },
  },
  // MapLibre creates its worker with { type: 'module' }.
  worker: { format: 'es' },
  // Vite serves index.html at root; all non-API routes fall back to it
  // (SPA mode — worker handles the true fallback in production)
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});