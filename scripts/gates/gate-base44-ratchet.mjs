#!/usr/bin/env node
// Gate: Base44 — catraca. O acoplamento só pode diminuir.
// Regra R5/R6 · Constituição P4 · Do-Not-Do D7/D8 · Código: P01-BASE44-REGRESSION
//
// Medição em Node (sem depender de grep/awk do ambiente) e separada por eixo:
//   arquivosComSdk    arquivos em src/ que importam o SDK ou base44Client
//   importsSdk        declarações `from '@base44/sdk'`
//   entitiesRefs      ocorrências de `base44.entities`
//   authRefs          ocorrências de `base44.auth`
//   integrationsRefs  ocorrências de `base44.integrations`
//   functionsRefs     ocorrências de `base44.functions`
//   vitePlugin        1 se o plugin Base44 está em vite.config.js
//   schemas           schemas em base44/entities
//   functionsBase44   functions em base44/functions

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASELINE = 'scripts/gates/base44-baseline.json';
const SRC = 'src';
const EXTS = ['.js', '.jsx', '.ts', '.tsx'];
const atualizar = process.argv.includes('--update');

const walk = (dir, acc = []) => {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
};

const contarOcorrencias = (texto, re) => (texto.match(re) || []).length;

const arquivos = walk(SRC).filter((f) => EXTS.some((e) => f.endsWith(e)));

const atual = {
  arquivosComSdk: 0,
  importsSdk: 0,
  entitiesRefs: 0,
  authRefs: 0,
  integrationsRefs: 0,
  functionsRefs: 0,
  vitePlugin: 0,
  schemas: 0,
  functionsBase44: 0,
};

for (const arquivo of arquivos) {
  const texto = readFileSync(arquivo, 'utf8');
  if (/@base44\/sdk|base44Client/.test(texto)) atual.arquivosComSdk += 1;
  atual.importsSdk += contarOcorrencias(texto, /from\s+['"]@base44\/sdk['"]/g);
  atual.entitiesRefs += contarOcorrencias(texto, /base44\.entities\b/g);
  atual.authRefs += contarOcorrencias(texto, /base44\.auth\b/g);
  atual.integrationsRefs += contarOcorrencias(texto, /base44\.integrations\b/g);
  atual.functionsRefs += contarOcorrencias(texto, /base44\.functions\b/g);
}

if (existsSync('vite.config.js')) {
  atual.vitePlugin = /@base44\/vite-plugin/.test(readFileSync('vite.config.js', 'utf8')) ? 1 : 0;
}

if (existsSync('base44/entities')) {
  atual.schemas = readdirSync('base44/entities').filter((f) => f.endsWith('.jsonc')).length;
}

if (existsSync('base44/functions')) {
  atual.functionsBase44 = readdirSync('base44/functions')
    .filter((f) => statSync(join('base44/functions', f)).isDirectory()).length;
}

console.log('gate:base44 — medição atual:', JSON.stringify(atual));

if (!existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify(atual, null, 2) + '\n');
  console.log('gate:base44 — baseline criado.');
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const regressoes = [];
const progresso = [];

for (const chave of Object.keys(atual)) {
  const antes = base[chave];
  if (antes === undefined) continue; // eixo novo: entra no baseline na próxima gravação
  const agora = atual[chave];
  if (agora > antes) regressoes.push(`${chave}: ${antes} -> ${agora} (+${agora - antes})`);
  else if (agora < antes) progresso.push(`${chave}: ${antes} -> ${agora} (-${antes - agora})`);
}

if (regressoes.length) {
  console.error('\ngate:base44 — FALHOU: acoplamento com Base44 AUMENTOU\n');
  regressoes.forEach((r) => console.error(`  - [P01-BASE44-REGRESSION] ${r}`));
  console.error('\nRegra R5: independência é monotônica. Ver docs/constitution/00-CONSTITUICAO.md (P4).');
  process.exit(1);
}

if (progresso.length) {
  console.log('\nProgresso:');
  progresso.forEach((p) => console.log(`  - ${p}`));
  if (atualizar) {
    writeFileSync(BASELINE, JSON.stringify(atual, null, 2) + '\n');
    console.log('\nBaseline atualizado (só para baixo).');
  } else {
    console.log('\nRode com --update para gravar o novo baseline.');
  }
} else if (atualizar) {
  writeFileSync(BASELINE, JSON.stringify(atual, null, 2) + '\n');
  console.log('\nBaseline regravado (eixos novos incluídos).');
}

console.log('PASSOU');
