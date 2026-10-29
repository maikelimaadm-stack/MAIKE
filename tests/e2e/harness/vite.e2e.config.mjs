import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dir = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(dir, "../../..");
const stub = (n) => path.resolve(dir, "stubs", n);

/** Harness E2E (WebGL real): serviços de dados trocados por stubs locais. */
export default defineConfig({
  root: dir,
  plugins: [react()],
  server: { port: 5199, strictPort: true, fs: { allow: [raiz] } },
  resolve: {
    alias: [
      { find: /^@\/services\/mapaCacheService(\.js)?$/, replacement: stub("mapaCacheService.js") },
      { find: /^@\/services\/sessionService(\.js)?$/, replacement: stub("sessionService.js") },
      { find: /^@\/services\/mapaService(\.js)?$/, replacement: stub("mapaService.js") },
      { find: /^@\/services\/bebedouroDataService(\.js)?$/, replacement: stub("bebedouroDataService.js") },
      { find: /^@\/hooks\/useEmpresaSelecionadaId(\.js)?$/, replacement: stub("useEmpresaSelecionadaId.js") },
      { find: "@", replacement: path.resolve(raiz, "src") },
    ],
  },
});
