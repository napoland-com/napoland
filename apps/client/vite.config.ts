import { defineConfig } from 'vite';

// In development the game server runs on :8080 and Vite on :5173; the WebSocket goes through Vite.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/health': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
});
