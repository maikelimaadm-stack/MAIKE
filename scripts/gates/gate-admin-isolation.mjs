#!/usr/bin/env node
/**
 * gate:admin-isolation — o MAIKE Admin é uma aplicação SEPARADA (D-PROD-70).
 *
 * Reprova se:
 *  ADM-01 código da SPA dos clientes (`src/`) importa algo de `apps/admin`;
 *  ADM-02 `src/` chama a API administrativa (`/admin-maike`, `/catalogo-global/admin`)
 *         ou declara o cabeçalho CSRF do admin;
 *  ADM-03 `apps/admin` importa módulos da SPA dos clientes (`@/` ou `src/`) — o admin
 *         não reusa serviços/escritas do cliente nem o cliente reusa os do admin;
 *  ADM-04 `src/` ou `apps/admin` contém credencial server-only (service_role, DATABASE_URL…);
 *  ADM-05 a SPA dos clientes registra página/rota de catálogo ou admin
 *         (`src/pages.config.js`, `vercel.json` da raiz);
 *  ADM-06 um build já gerado vaza: `dist/` (cliente) com rota admin, ou
 *         `apps/admin/dist/` com credencial server-only.
 *
 * Esconder rota não é isolamento: por isso a checagem é de código e de bundle.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.env.ADMIN_ISOLATION_ROOT || process.cwd();
const falhas = [];
const registrar = (codigo, msg) => falhas.push(`[${codigo}] ${msg}`);

const listar = (dir, exts) => {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  const andar = (d) => {
    for (const nome of readdirSync(d)) {
      if (nome === 'node_modules') continue;
      const p = join(d, nome);
      if (statSync(p).isDirectory()) andar(p);
      else if (exts.some((e) => nome.endsWith(e))) out.push(p);
    }
  };
  andar(abs);
  return out;
};
const rel = (p) => relative(ROOT, p);
const ler = (p) => readFileSync(p, 'utf8');

const FONTE = ['.js', '.jsx', '.mjs', '.ts', '.tsx'];
const SEGREDOS = /service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|POSTGRES_PRISMA_URL|MIGRATION_DATABASE_URL|ADMIN_MAIKE_CHAVE/;
const ROTA_ADMIN = /\/admin-maike\b|\/catalogo-global\/admin\b|x-maike-admin-csrf/;
const IMPORT = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g;

const cliente = listar('src', FONTE);
for (const arq of cliente) {
  const txt = ler(arq);
  for (const m of txt.matchAll(IMPORT)) {
    if (/apps\/admin/.test(m[1])) registrar('ADM-01', `${rel(arq)} importa ${m[1]}`);
  }
  if (ROTA_ADMIN.test(txt)) registrar('ADM-02', `${rel(arq)} referencia a API administrativa`);
  if (SEGREDOS.test(txt)) registrar('ADM-04', `${rel(arq)} contém nome de credencial server-only`);
}

const admin = listar('apps/admin/src', FONTE);
if (!admin.length) registrar('ADM-03', 'apps/admin/src ausente — o MAIKE Admin precisa existir como app próprio');
for (const arq of admin) {
  const txt = ler(arq);
  for (const m of txt.matchAll(IMPORT)) {
    if (m[1].startsWith('@/') || /(^|\/)src\//.test(m[1]) && m[1].startsWith('../../')) {
      registrar('ADM-03', `${rel(arq)} importa módulo da SPA dos clientes: ${m[1]}`);
    }
  }
  if (SEGREDOS.test(txt)) registrar('ADM-04', `${rel(arq)} contém nome de credencial server-only`);
}

const pages = join(ROOT, 'src/pages.config.js');
if (existsSync(pages) && /CatalogoGlobal|MaikeAdmin|AdminMaike/i.test(ler(pages))) {
  registrar('ADM-05', 'src/pages.config.js registra página de catálogo/admin na SPA dos clientes');
}
const vercelCliente = join(ROOT, 'vercel.json');
if (existsSync(vercelCliente) && /catalogoglobal|admin-maike|maikeadmin/i.test(ler(vercelCliente))) {
  registrar('ADM-05', 'vercel.json da SPA dos clientes tem rota de catálogo/admin');
}

for (const arq of listar('dist', ['.js', '.html'])) {
  if (ROTA_ADMIN.test(ler(arq))) registrar('ADM-06', `bundle do cliente ${rel(arq)} contém rota administrativa`);
}
for (const arq of listar('apps/admin/dist', ['.js', '.html'])) {
  if (SEGREDOS.test(ler(arq))) registrar('ADM-06', `bundle do admin ${rel(arq)} contém credencial server-only`);
}

if (falhas.length) {
  console.error(`gate:admin-isolation — FALHOU (${falhas.length})`);
  falhas.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  `gate:admin-isolation — PASSOU (${cliente.length} arquivo(s) do cliente, ${admin.length} do admin; nenhuma ponte entre os dois)`
);
