/**
 * Provas do `gate:admin-isolation` (D-PROD-70): MAIKE Admin e SPA dos clientes
 * não se importam, não compartilham API administrativa nem credenciais.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { makeTempDir, cleanup, writeFile, runGate } from './helpers.mjs';

const GATE = 'gate-admin-isolation.mjs';
const rodar = (dir) => runGate(GATE, { env: { ADMIN_ISOLATION_ROOT: dir } });

const base = (dir) => {
  writeFile(dir, 'src/pages.config.js', "export const PAGES = { MapaGeral: null };\n");
  writeFile(dir, 'src/services/x.js', "export const ler = () => fetch('/api/native/catalogo-global/icones');\n");
  writeFile(dir, 'apps/admin/src/api.js', "export const ler = () => fetch('/api/native/admin-maike/catalogo');\n");
  writeFile(dir, 'vercel.json', '{"rewrites":[]}\n');
};

const caso = (nome, mutar, codigo) =>
  test(nome, () => {
    const dir = makeTempDir();
    try {
      base(dir);
      mutar(dir);
      const r = rodar(dir);
      if (!codigo) return assert.equal(r.status, 0, r.output);
      assert.equal(r.status, 1, r.output);
      assert.match(r.output, new RegExp(codigo));
    } finally {
      cleanup(dir);
    }
  });

describe('gate:admin-isolation', () => {
  caso('ADM-OK estrutura separada passa', () => {}, null);
  caso('ADM-01 cliente importando o admin reprova', (d) => writeFile(d, 'src/a.js', "import x from '../apps/admin/src/api.js';\n"), 'ADM-01');
  caso('ADM-02 cliente chamando rota admin reprova', (d) => writeFile(d, 'src/b.js', "fetch('/api/native/catalogo-global/admin/tipos');\n"), 'ADM-02');
  caso('ADM-03 admin importando módulo do cliente reprova', (d) => writeFile(d, 'apps/admin/src/c.js', "import y from '@/services/x';\n"), 'ADM-03');
  caso('ADM-03 sem app admin reprova', (d) => cleanup(`${d}/apps`), 'ADM-03');
  caso('ADM-04 credencial server-only no admin reprova', (d) => writeFile(d, 'apps/admin/src/d.js', 'const k = "SUPABASE_SERVICE_ROLE_KEY";\n'), 'ADM-04');
  caso('ADM-05 página de catálogo na SPA reprova', (d) => writeFile(d, 'src/pages.config.js', 'export const PAGES = { CatalogoGlobalMaike: 1 };\n'), 'ADM-05');
  caso('ADM-05 rewrite admin no vercel.json do cliente reprova', (d) => writeFile(d, 'vercel.json', '{"rewrites":[{"source":"/CatalogoGlobalMaike"}]}\n'), 'ADM-05');
  caso('ADM-06 bundle do cliente com rota admin reprova', (d) => writeFile(d, 'dist/assets/i.js', 'x("/admin-maike/sessao")\n'), 'ADM-06');
});
