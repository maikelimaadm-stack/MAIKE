import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
//
// Preview-only proxy: when BASE44_PREVIEW_MODE is "1", route /api/native
// through the Vite dev server to the backend container. This keeps the
// frontend and API on a single origin (the preview URL), which is required
// because runtimeConfig.getNativeApiUrl() prefers the browser origin for
// any https URL that differs from VITE_MAIKE_API_URL.
const previewOverrides = process.env.BASE44_PREVIEW_MODE === '1'
  ? {
      server: {
        host: '0.0.0.0',
        proxy: {
          '/api/native': {
            target: 'http://backend:3333',
            changeOrigin: true,
          },
        },
      },
    }
  : {};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  ...previewOverrides,
});