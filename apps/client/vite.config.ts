import { defineConfig } from 'vite';

// In development the game server runs on :8080 and Vite on :5173; the WebSocket goes through Vite.
// GAME_SERVER (host:port) points it at another server, e.g. a second one started for a review.
const server = process.env.GAME_SERVER ?? 'localhost:8080';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: `ws://${server}`, ws: true },
      '/health': `http://${server}`,
      '/auth-config': `http://${server}`,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
});
