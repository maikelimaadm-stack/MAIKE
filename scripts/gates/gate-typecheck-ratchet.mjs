#!/usr/bin/env node
/**
 * Gate: catraca de dívida de tipos.
 *
 * O projeto é JavaScript com `checkJs: true` e sem contratos de tipo. Converter
 * a base inteira não é escopo do P0.1. A regra honesta é: **a dívida nunca
 * cresce**.
 *
 *   gate:types verde  = nenhuma regressão sobre a dívida legada versionada
 *   gate:types verde  ≠ "typecheck sem erros"
 *
 * A dívida bruta continua visível em `npm run typecheck:raw`.
 * P1 deve reduzi-la monotonicamente até zero.
 *
 * Códigos: P01-TYPE-REGRESSION · P01-TYPE-BASELINE · P01-TYPE-RUNNER
 */

import { existsSync } from 'node:fs';
import { readBaseline, writeJsonAtomic, isCount, compareMultisets } from './lib/ratchet.mjs';
import { runTypecheck, toFingerprintCounts, toFileCounts } from './lib/tsc-diagnostics.mjs';

export const BASELINE_VERSION = 1;
const BASELINE = process.env.TYPECHECK_BASELINE || 'scripts/gates/typecheck-baseline.json';
const PROJECT = process.env.TYPECHECK_PROJECT || './jsconfig.typecheck.json';
const atualizar = process.argv.includes('--update');
// Semeadura explícita: só funciona quando o baseline ainda NÃO existe.
// Execução normal nunca cria baseline (P01-TYPE-BASELINE).
const semear = process.argv.includes('--seed');

const falhar = (codigo, mensagem, extras = []) => {
  console.error('gate:types — FALHOU\n');
  console.error(`  - [${codigo}] ${mensagem}`);
  extras.forEach((e) => console.error(`      ${e}`));
  console.error('');
  process.exit(1);
};

// ── 1. Rodar o compilador ─────────────────────────────────────────────────
const run = runTypecheck({ project: PROJECT });
if (!run.ok) {
  falhar('P01-TYPE-RUNNER', `não foi possível obter diagnósticos do TypeScript (${run.reason})`, [run.detail]);
}

const atual = {
  total: run.diagnostics.length,
  byFile: toFileCounts(run.diagnostics),
  fingerprints: toFingerprintCounts(run.diagnostics),
};

console.log(`gate:types — projeto: ${PROJECT}`);
console.log(`gate:types — diagnósticos atuais: ${atual.total} em ${Object.keys(atual.byFile).length} arquivo(s)`);

// ── 2. Ler e validar o baseline ───────────────────────────────────────────
const buildPayload = () => ({
  version: BASELINE_VERSION,
  project: PROJECT,
  command: `tsc -p ${PROJECT} --pretty false --noEmit`,
  total: atual.total,
  byFile: atual.byFile,
  fingerprints: atual.fingerprints,
});

const lido = readBaseline(BASELINE, { expectedVersion: BASELINE_VERSION, code: 'P01-TYPE-BASELINE' });

if (!lido.ok) {
  // `--seed` é a única porta para criar o baseline, e só quando ele não existe.
  if (semear && existsSync(BASELINE)) {
    falhar('P01-TYPE-BASELINE', `--seed recusado: ${BASELINE} já existe. Use --update.`);
  }
  if (!semear) falhar(lido.code, lido.message);

  writeJsonAtomic(BASELINE, buildPayload());
  console.log(`\ngate:types — baseline SEMEADO conscientemente em ${BASELINE}`);
  console.log(`           ${atual.total} diagnóstico(s) de dívida legada registrados. P1 deve reduzi-los.`);
  process.exit(0);
}

if (semear) {
  falhar('P01-TYPE-BASELINE', `--seed recusado: ${BASELINE} já existe. Use --update.`);
}

const base = lido.data;

if (base.project !== PROJECT) {
  falhar(
    'P01-TYPE-BASELINE',
    `configuração divergente: baseline gravado com "${base.project}", execução atual usa "${PROJECT}"`
  );
}
if (!isCount(base.total)) {
  falhar('P01-TYPE-BASELINE', `campo "total" inválido no baseline: ${JSON.stringify(base.total)}`);
}
for (const campo of ['byFile', 'fingerprints']) {
  if (!base[campo] || typeof base[campo] !== 'object' || Array.isArray(base[campo])) {
    falhar('P01-TYPE-BASELINE', `campo "${campo}" ausente ou inválido no baseline`);
  }
  for (const [chave, valor] of Object.entries(base[campo])) {
    if (!isCount(valor) || valor === 0) {
      falhar('P01-TYPE-BASELINE', `contagem inválida em ${campo}["${chave}"]: ${JSON.stringify(valor)}`);
    }
  }
}
const somaFingerprints = Object.values(base.fingerprints).reduce((a, b) => a + b, 0);
if (somaFingerprints !== base.total) {
  falhar(
    'P01-TYPE-BASELINE',
    `baseline inconsistente: soma dos fingerprints (${somaFingerprints}) difere de "total" (${base.total})`
  );
}

// ── 3. Comparar ───────────────────────────────────────────────────────────
const { novos, aumentos, reducoes } = compareMultisets(base.fingerprints, atual.fingerprints);

const arquivosPiores = [];
for (const [arquivo, quantidade] of Object.entries(atual.byFile)) {
  const antes = base.byFile[arquivo] ?? 0;
  if (quantidade > antes) arquivosPiores.push(`${arquivo}: ${antes} -> ${quantidade}`);
}

if (novos.length || aumentos.length || arquivosPiores.length) {
  console.error('gate:types — FALHOU: a dívida de tipos AUMENTOU\n');
  novos.slice(0, 40).forEach((n) => console.error(`  - [P01-TYPE-REGRESSION] diagnóstico novo: ${n}`));
  if (novos.length > 40) console.error(`  … e mais ${novos.length - 40} diagnóstico(s) novo(s)`);
  aumentos.slice(0, 40).forEach((a) => console.error(`  - [P01-TYPE-REGRESSION] multiplicidade aumentou: ${a}`));
  arquivosPiores.slice(0, 40).forEach((a) => console.error(`  - [P01-TYPE-REGRESSION] arquivo piorou: ${a}`));
  console.error('\nA dívida legada é versionada e só pode diminuir. Ver docs/engineering/GATE-REGISTRY.md.');
  process.exit(1);
}

if (reducoes.length) {
  console.log(`\nProgresso: ${reducoes.length} diagnóstico(s) a menos que o baseline.`);
  reducoes.slice(0, 10).forEach((r) => console.log(`  - ${r}`));
  if (reducoes.length > 10) console.log(`  … e mais ${reducoes.length - 10}`);
}

// ── 4. Atualização consciente do baseline ─────────────────────────────────
if (atualizar) {
  if (!reducoes.length) {
    falhar('P01-TYPE-BASELINE', 'nada a gravar: --update exige pelo menos um diagnóstico removido.');
  }
  writeJsonAtomic(BASELINE, buildPayload());
  console.log(`\nBaseline de tipos atualizado (só para baixo): ${BASELINE}`);
} else if (reducoes.length) {
  console.log('\nRode `node scripts/gates/gate-typecheck-ratchet.mjs --update` para gravar o novo baseline.');
}

if (atual.total === 0) {
  console.log('gate:types — PASSOU (zero diagnósticos: dívida quitada)');
} else {
  console.log(
    `gate:types — PASSOU (sem regressão sobre ${base.total} diagnóstico(s) de dívida versionada; atual: ${atual.total})`
  );
  console.log('           dívida bruta visível em: npm run typecheck:raw');
}
