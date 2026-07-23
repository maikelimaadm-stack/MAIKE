#!/usr/bin/env node
// Roda todos os gates. Retorna 1 se qualquer um falhar.

import { spawnSync } from 'node:child_process';

const GATES = [
  ['tenancy',  'scripts/gates/gate-tenancy.mjs'],
  ['indices',  'scripts/gates/gate-indices.mjs'],
  ['base44',   'scripts/gates/gate-base44.mjs'],
  ['apis',     'scripts/gates/gate-apis.mjs']
];

let falhou = 0;
const resultado = [];

for (const [nome, script] of GATES) {
  console.log(`\n${'='.repeat(60)}\nGATE: ${nome}\n${'='.repeat(60)}`);
  const r = spawnSync('node', [script], { stdio: 'inherit' });
  const ok = r.status === 0;
  resultado.push([nome, ok]);
  if (!ok) falhou++;
}

console.log(`\n${'='.repeat(60)}\nRESUMO\n${'='.repeat(60)}`);
resultado.forEach(([n, ok]) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  gate:${n}`));
console.log(`\n${falhou === 0 ? 'TODOS OS GATES PASSARAM' : `${falhou} GATE(S) FALHARAM`}\n`);
process.exit(falhou === 0 ? 0 : 1);
