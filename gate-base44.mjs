#!/usr/bin/env node
// Gate: Base44 — o acoplamento só pode diminuir (catraca).
// Regra R5/R6 · Constituição P4 · Do-Not-Do D7/D8

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASELINE = 'scripts/gates/base44-baseline.json';
const atualizar = process.argv.includes('--update');

function contar(cmd) {
  try { return parseInt(execSync(cmd, { encoding: 'utf8' }).trim()) || 0; }
  catch { return 0; }
}

const atual = {
  arquivosComSdk: contar("grep -rl '@base44/sdk\\|base44Client' src --include='*.js' --include='*.jsx' 2>/dev/null | wc -l"),
  importsSdk:     contar("grep -rc \"from '@base44/sdk'\" src --include='*.js' --include='*.jsx' 2>/dev/null | awk -F: '{s+=$2} END {print s+0}'"),
  chamadasSdk:    contar("grep -roE '\\.(list|filter|create|update|delete|bulkCreate)\\(' src --include='*.jsx' 2>/dev/null | wc -l")
};

if (!existsSync(BASELINE)) {
  writeFileSync(BASELINE, JSON.stringify(atual, null, 2) + '\n');
  console.log('gate:base44 — baseline criado:', JSON.stringify(atual));
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const regressoes = [];
const progresso = [];

for (const chave of Object.keys(atual)) {
  const antes = base[chave] ?? 0;
  const agora = atual[chave];
  if (agora > antes) regressoes.push(`${chave}: ${antes} -> ${agora} (+${agora - antes})`);
  else if (agora < antes) progresso.push(`${chave}: ${antes} -> ${agora} (-${antes - agora})`);
}

console.log('gate:base44 — medição atual:', JSON.stringify(atual));

if (regressoes.length) {
  console.error('\nFALHOU: acoplamento com Base44 AUMENTOU\n');
  regressoes.forEach(r => console.error(`  - ${r}`));
  console.error('\nRegra R5: independência é monotônica. Ver docs/constitution/00-CONSTITUICAO.md (P4).');
  process.exit(1);
}

if (progresso.length) {
  console.log('\nProgresso:');
  progresso.forEach(p => console.log(`  - ${p}`));
  if (atualizar) {
    writeFileSync(BASELINE, JSON.stringify(atual, null, 2) + '\n');
    console.log('\nBaseline atualizado (só para baixo).');
  } else {
    console.log('\nRode com --update para gravar o novo baseline.');
  }
}
console.log('PASSOU');
