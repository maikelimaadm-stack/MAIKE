#!/usr/bin/env node
// Roda todos os gates + lint + typecheck + build, na ordem.
// Retorna 1 se qualquer etapa falhar. Nenhuma etapa é convertida em sucesso.

import { spawnSync } from 'node:child_process';

const ETAPAS = [
  ['governance-paths', 'node', ['scripts/gates/gate-governance-paths.mjs']],
  ['product-scope', 'node', ['scripts/gates/gate-product-scope.mjs']],
  ['import-integrity', 'node', ['scripts/gates/gate-import-integrity.mjs']],
  ['no-secrets', 'node', ['scripts/gates/gate-no-hardcoded-secrets.mjs']],
  ['base44', 'node', ['scripts/gates/gate-base44-ratchet.mjs']],
  ['lint', 'npm', ['run', '--silent', 'lint']],
  ['typecheck', 'npm', ['run', '--silent', 'typecheck']],
  ['build', 'npm', ['run', '--silent', 'build']],
];

let falhou = 0;
const resultado = [];

for (const [nome, cmd, args] of ETAPAS) {
  console.log(`\n${'='.repeat(60)}\nETAPA: ${nome}\n${'='.repeat(60)}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  const ok = r.status === 0;
  resultado.push([nome, ok]);
  if (!ok) falhou += 1;
}

console.log(`\n${'='.repeat(60)}\nRESUMO\n${'='.repeat(60)}`);
resultado.forEach(([n, ok]) => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}`));
console.log(`\n${falhou === 0 ? 'TODAS AS ETAPAS PASSARAM' : `${falhou} ETAPA(S) FALHARAM`}\n`);
process.exit(falhou === 0 ? 0 : 1);
