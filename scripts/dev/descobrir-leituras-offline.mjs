#!/usr/bin/env node
/**
 * D-PROD-289 — descobre as leituras (GET) que cada tela faz ao abrir, para a
 * lista do "Baixar dados para usar sem internet" (`src/config/leiturasParaOffline.js`).
 *
 * Abre cada página de `src/pages` com os COMPONENTES REAIS (Vite dev) e um
 * BACKEND FALSO (`route` em /api/native/**, respostas vazias): nada sai para
 * banco ou API real. Imprime a lista com `{empresa}` no lugar da empresa.
 *
 * Uso (dois terminais):
 *   npx vite --port 5199 --strictPort --host 127.0.0.1
 *   node scripts/dev/descobrir-leituras-offline.mjs
 *
 * Requer `playwright` com Chromium no ambiente (não é dependência do projeto).
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.VISUAL_BASE || 'http://127.0.0.1:5199';
const EMPRESA = 'EMPRESA-X';
const FORA = new Set(['/usuarios', '/usuarios/page?limit=100', '/permissoes']);

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
}

const paginas = fs.readdirSync('src/pages').filter((f) => f.endsWith('.jsx')).map((f) => f.replace('.jsx', ''));
const browser = await chromium.launch();
const todas = new Set();
for (const pg of paginas) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((empresa) => {
    window.localStorage.setItem('maike_native_access_token', 'jwt.falso.descoberta');
    window.localStorage.setItem('empresa_selecionada_id', empresa);
    window.localStorage.setItem('empresa_selecionada_cliente_id', 'cli-1');
  }, EMPRESA);
  await ctx.route('**/api/native/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const rota = u.pathname.replace(/^\/api\/native/, '');
    if (req.method() === 'GET' && !rota.startsWith('/auth/')) todas.add(rota + u.search);
    let corpo = [];
    if (rota === '/auth/contexto') corpo = { cliente_id: 'cli-1', usuario_id: 'u1', login: 'dono', administrador_fazenda: true };
    else if (rota === '/empresas') corpo = [{ id: EMPRESA, nome: 'FAZENDA', ativo: true }];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${pg.toLowerCase()}`).catch(() => {});
  await page.waitForTimeout(3500);
  await ctx.close();
}
await browser.close();
const lista = [...todas].filter((t) => !FORA.has(t)).sort().map((t) => t.split(EMPRESA).join('{empresa}'));
console.log(JSON.stringify(lista, null, 2));
