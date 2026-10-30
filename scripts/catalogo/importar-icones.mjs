#!/usr/bin/env node
/**
 * Importação local de ícones oficiais do catálogo global — CONTINGÊNCIA
 * (D-PROD-69/70). A via normal é o app MAIKE Admin.
 *
 * Padrão: --dry-run (valida arquivos e mostra o plano; não escreve nada).
 * Escrita só com --apply E --confirmar=<host da API>, e SÓ contra API local
 * (localhost/127.0.0.1): remoto fica restrito ao dry-run. Autentica como o
 * Administrador Principal (senha + TOTP), pela mesma API admin do app.
 * Runbook: docs/engineering/MAIKE-CATALOGO-OPERACAO-SUPABASE.md
 *
 * Variáveis (nunca impressas):
 *   MAIKE_API_URL            ex.: http://127.0.0.1:3333
 *   MAIKE_ADMIN_LOGIN        login do proprietário
 *   MAIKE_ADMIN_SENHA        senha do proprietário
 *   MAIKE_ADMIN_ORIGIN       origin permitida do admin (padrão http://localhost:5174)
 *   MAIKE_ADMIN_TOTP         código de 6 dígitos (se ausente, é pedido no terminal)
 *
 * Uso:
 *   node scripts/catalogo/importar-icones.mjs --manifesto caminho/manifesto.json
 *   node scripts/catalogo/importar-icones.mjs --manifesto caminho/manifesto.json --apply --confirmar=127.0.0.1
 */

import { aplicar, carregarManifesto, planejar } from './importarIconesLib.mjs';

const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.findIndex((a) => a === nome || a.startsWith(`${nome}=`));
  if (i < 0) return null;
  return args[i].includes('=') ? args[i].slice(args[i].indexOf('=') + 1) : args[i + 1] ?? null;
};
const sair = (msg) => {
  console.error(`importar-icones: ${msg}`);
  process.exit(1);
};

const manifestoPath = valor('--manifesto');
const aplicarAgora = args.includes('--apply');
if (!manifestoPath) sair('informe --manifesto <arquivo.json>');

const manifesto = await carregarManifesto(manifestoPath);
console.log(`manifesto: tipo "${manifesto.tipo.codigo}", ${manifesto.itens.length} item(ns)`);
for (const item of manifesto.itens) {
  console.log(`  - ${item.categoria.codigo}: ${item.arquivo} (${item.mime ?? '?'}, ${item.buffer.length} B, sha256 ${item.sha256.slice(0, 16)}…)`);
}
if (manifesto.erros.length) {
  manifesto.erros.forEach((e) => console.error(`  ERRO ${e}`));
  sair(`${manifesto.erros.length} erro(s) no manifesto — nada foi enviado`);
}

const apiUrl = process.env.MAIKE_API_URL?.trim()?.replace(/\/+$/, '');
if (!apiUrl) {
  console.log('MAIKE_API_URL ausente: só validação local (dry-run).');
  process.exit(0);
}
const host = new URL(apiUrl).hostname;

const LOCAIS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
if (aplicarAgora && !LOCAIS.has(host)) {
  sair(`--apply só contra API local; em ${host} use o MAIKE Admin (este comando fica em dry-run)`);
}

const login = process.env.MAIKE_ADMIN_LOGIN?.trim();
const senha = process.env.MAIKE_ADMIN_SENHA;
const origin = process.env.MAIKE_ADMIN_ORIGIN?.trim() || 'http://localhost:5174';
if (!login || !senha) sair('MAIKE_ADMIN_LOGIN e MAIKE_ADMIN_SENHA são obrigatórias para ler o estado e aplicar');

const perguntar = async (texto) => {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(texto)).trim();
  } finally {
    rl.close();
  }
};

let cookie = '';
let csrf = '';
/** @param {{ method: string, url: string, payload?: any }} req */
const http = async ({ method, url, payload }) => {
  const r = await fetch(`${apiUrl}${url}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-maike-admin-csrf': csrf } : {}),
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const setCookie = r.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const texto = await r.text();
  let body = null;
  try {
    body = texto ? JSON.parse(texto) : null;
  } catch {
    body = { message: texto.slice(0, 200) };
  }
  if (body?.csrf_token) csrf = body.csrf_token;
  return { status: r.status, body };
};

const passo1 = await http({ method: 'POST', url: '/admin-maike/auth/login', payload: { login, senha } });
if (passo1.status !== 200) sair(`login recusado (HTTP ${passo1.status})`);
if (passo1.body.etapa !== 'mfa') sair('o segundo fator ainda não foi ativado: entre primeiro pelo MAIKE Admin');
const codigo = process.env.MAIKE_ADMIN_TOTP?.trim() || (await perguntar('Código do autenticador (6 dígitos): '));
const passo2 = await http({ method: 'POST', url: '/admin-maike/auth/mfa', payload: { codigo } });
if (passo2.status !== 200) sair(`segundo fator recusado (HTTP ${passo2.status})`);

const plano = await planejar(manifesto, http);
console.log(`\nplano contra ${host}:`);
if (!plano.tipo) console.log(`  criar tipo "${manifesto.tipo.codigo}"`);
for (const p of plano.passos) {
  console.log(`  ${p.item.categoria.codigo}: ${p.acao}${p.icone ? ` (ícone ${p.icone.id})` : ''}${p.categoria ? '' : ' + criar categoria'}`);
}

if (!aplicarAgora) {
  await http({ method: 'POST', url: '/admin-maike/auth/logout', payload: {} });
  console.log('\nDRY-RUN: nada foi gravado. Para aplicar: --apply --confirmar=<host da API>.');
  process.exit(0);
}
if (valor('--confirmar') !== host) sair(`--apply exige --confirmar=${host} (confirmação explícita do ambiente)`);

let aplicado;
try {
  aplicado = await aplicar(manifesto, http, (l) => console.log(`  ${l}`));
} catch (erro) {
  sair(`${erro.message}\n  (interrompido; o que já foi aplicado está auditado — reexecutar é seguro)`);
}
await http({ method: 'POST', url: '/admin-maike/auth/logout', payload: {} });
const { tipo_id, resultado } = aplicado;
console.log(`\naplicado. tipo_id=${tipo_id}`);
for (const r of resultado) console.log(`  ${r.categoria}: ${r.acao} — categoria_visual_id=${r.categoria_id} icone_id=${r.icone_id}`);
