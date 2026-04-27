import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    host: true,
    proxy: {
      // Same-origin proxy in dev so api.ts's default `/api` base resolves
      // against the backend without CORS. Target defaults to the host-
      // accessible port; docker-compose.override.yml sets VITE_DEV_PROXY_TARGET
      // to the compose service hostname so the container-bound dev server
      // proxies inside the docker network.
      '/api': {
        target: process.env.VITE_DEV_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3000,
    host: true,
  },
});
