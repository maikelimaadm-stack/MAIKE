#!/usr/bin/env node
/**
 * Executa toda a cadeia de verificação, na ordem: contratos baratos primeiro,
 * build por último.
 *
 * Nenhuma etapa tem o exit code ignorado ou convertido em sucesso.
 * Qualquer falha encerra o processo com 1.
 */

import { spawnSync } from 'node:child_process';

const npm = (script) => ({ cmd: 'npm', args: ['run', '--silent', script], label: `npm run ${script}` });

const ETAPAS = [
  ['test:gates', npm('test:gates')],
  ['governance-paths', npm('gate:governance-paths')],
  ['package-sync', npm('gate:package-sync')],
  ['product-scope', npm('gate:product-scope')],
  ['source-closure', npm('gate:source-closure')],
  ['import-integrity', npm('gate:import-integrity')],
  ['no-secrets', npm('gate:no-secrets')],
  ['base44', npm('gate:base44')],
  ['types', npm('gate:types')],
  ['lint', npm('lint')],
  ['test:smoke', npm('test:smoke')],
  ['build', npm('build')],
];

const resultado = [];
let falhou = 0;

for (const [nome, { cmd, args, label }] of ETAPAS) {
  console.log(`\n${'='.repeat(70)}\nETAPA: ${nome}\n  $ ${label}\n${'='.repeat(70)}`);
  const inicio = process.hrtime.bigint();
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  const duracaoMs = Number((process.hrtime.bigint() - inicio) / 1000000n);

  const status = r.status === null ? 1 : r.status;
  const ok = status === 0;
  resultado.push({ nome, ok, status, duracaoMs, label });
  if (!ok) falhou += 1;
}

const pad = (s, n) => String(s).padEnd(n);
const padLeft = (s, n) => String(s).padStart(n);

console.log(`\n${'='.repeat(70)}\nRESUMO\n${'='.repeat(70)}`);
console.log(`  ${pad('ETAPA', 20)} ${pad('RESULTADO', 10)} ${padLeft('EXIT', 5)} ${padLeft('DURAÇÃO', 10)}  COMANDO`);
for (const r of resultado) {
  const tempo = r.duracaoMs >= 1000 ? `${(r.duracaoMs / 1000).toFixed(1)}s` : `${r.duracaoMs}ms`;
  console.log(
    `  ${pad(r.nome, 20)} ${pad(r.ok ? 'PASS' : 'FAIL', 10)} ${padLeft(r.status, 5)} ${padLeft(tempo, 10)}  ${r.label}`
  );
}

const total = resultado.reduce((soma, r) => soma + r.duracaoMs, 0);
console.log(`\n  Total: ${(total / 1000).toFixed(1)}s`);
console.log(`\n${falhou === 0 ? 'TODAS AS ETAPAS PASSARAM' : `${falhou} ETAPA(S) FALHARAM`}\n`);

process.exit(falhou === 0 ? 0 : 1);
