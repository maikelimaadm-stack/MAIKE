/**
 * MAIKE Admin — build e servidor PRÓPRIOS (D-PROD-70), separados da SPA dos
 * clientes (`/vite.config.js`). Nada daqui entra no bundle do cliente.
 *
 * A API é chamada pela MESMA origin (`/api/native`): no desenvolvimento o Vite
 * faz proxy para o backend local; no deploy, um rewrite do projeto admin faz o
 * mesmo (runbook). Assim o cookie de sessão é first-party e não há CORS com
 * credenciais.
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const raiz = fileURLToPath(new URL('.', import.meta.url));
const api = process.env.MAIKE_ADMIN_API_PROXY || 'http://127.0.0.1:3333';

export default defineConfig({
  root: raiz,
  // Cache de dependências próprio: dividir `node_modules/.vite` com a SPA dos
  // clientes invalida o pré-bundle de um servidor quando o outro sobe.
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite-admin', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api/native': { target: api, changeOrigin: false } },
  },
  preview: { port: 5174, strictPort: true, proxy: { '/api/native': { target: api, changeOrigin: false } } },
  build: { outDir: 'dist', emptyOutDir: true },
});
