import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const api = process.env.FLEXPOS_CLOUD_API ?? 'http://localhost:4200';

// `@/…` reuses the POS web UI kit (buttons, dialogs, dashboard view); `~/…` is this app.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
      '@': fileURLToPath(new URL('../web/src', import.meta.url)),
    },
  },
  server: { port: 5174, host: true, proxy: { '/api': { target: api, ws: true, changeOrigin: true } } },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], query: ['@tanstack/react-query'] } } },
  },
});
