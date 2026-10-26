import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const api = process.env.FLEXPOS_API ?? 'http://localhost:4100';
const edition = process.env.FLEXPOS_EDITION === 'lite' ? 'lite' : 'full';
const appName = edition === 'lite' ? 'FlexPOS Lite' : 'FlexPOS';

export default defineConfig({
  plugins: [
    react(),
    // index.html carries %APP_NAME% and the manifest is renamed on build, so each edition installs under its own name.
    {
      name: 'edition-name',
      transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', appName),
      writeBundle(opts) {
        const file = `${opts.dir}/manifest.webmanifest`;
        const m = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(file, JSON.stringify({ ...m, name: appName, short_name: appName }, null, 2));
      },
    },
  ],
  define: { __FLEXPOS_EDITION__: JSON.stringify(edition) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    host: true,
    proxy: { '/api': { target: api, ws: true, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], query: ['@tanstack/react-query'] },
      },
    },
  },
});
