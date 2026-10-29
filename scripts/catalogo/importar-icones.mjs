#!/usr/bin/env node
/**
 * Importação local de ícones oficiais do catálogo global (D-PROD-69).
 *
 * Padrão: --dry-run (valida arquivos e mostra o plano; não escreve nada).
 * Escrita só com --apply E --confirmar=<host da API>, autenticando como um
 * OperadorProdutoMaike pela API administrativa existente. Runbook:
 * docs/engineering/MAIKE-CATALOGO-OPERACAO-SUPABASE.md
 *
 * Variáveis (nunca impressas):
 *   MAIKE_API_URL            ex.: http://127.0.0.1:3333 (local) ou a URL do backend de staging
 *   MAIKE_OPERADOR_LOGIN     login do usuário operador de produto
 *   MAIKE_OPERADOR_SENHA     senha desse usuário
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

const login = process.env.MAIKE_OPERADOR_LOGIN?.trim();
const senha = process.env.MAIKE_OPERADOR_SENHA;
if (!login || !senha) sair('MAIKE_OPERADOR_LOGIN e MAIKE_OPERADOR_SENHA são obrigatórias para ler o estado e aplicar');

const respostaLogin = await fetch(`${apiUrl}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ login, senha }),
});
if (!respostaLogin.ok) sair(`login recusado (HTTP ${respostaLogin.status})`);
const { token } = await respostaLogin.json();

/** @param {{ method: string, url: string, payload?: any }} req */
const http = async ({ method, url, payload }) => {
  const r = await fetch(`${apiUrl}${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const texto = await r.text();
  let body = null;
  try {
    body = texto ? JSON.parse(texto) : null;
  } catch {
    body = { message: texto.slice(0, 200) };
  }
  return { status: r.status, body };
};

const plano = await planejar(manifesto, http);
console.log(`\nplano contra ${host}:`);
if (!plano.tipo) console.log(`  criar tipo "${manifesto.tipo.codigo}"`);
for (const p of plano.passos) {
  console.log(`  ${p.item.categoria.codigo}: ${p.acao}${p.icone ? ` (ícone ${p.icone.id})` : ''}${p.categoria ? '' : ' + criar categoria'}`);
}

if (!aplicarAgora) {
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
const { tipo_id, resultado } = aplicado;
console.log(`\naplicado. tipo_id=${tipo_id}`);
for (const r of resultado) console.log(`  ${r.categoria}: ${r.acao} — categoria_visual_id=${r.categoria_id} icone_id=${r.icone_id}`);
