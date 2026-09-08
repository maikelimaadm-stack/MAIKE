#!/usr/bin/env node
/**
 * Executa toda a cadeia de verificação, na ordem: contratos baratos primeiro,
 * build por último.
 *
 * Nenhuma etapa tem o exit code ignorado ou convertido em sucesso.
 * Qualquer falha encerra o processo com 1.
 */

import { spawnSync } from 'node:child_process';

const npm = (script, env) => ({
  cmd: 'npm',
  args: ['run', '--silent', script],
  label: `npm run ${script}`,
  env,
});

const ETAPAS = [
  ['test:gates', npm('test:gates')],
  ['governance-paths', npm('gate:governance-paths')],
  ['package-sync', npm('gate:package-sync')],
  ['product-scope', npm('gate:product-scope')],
  ['api-boundary', npm('gate:api-boundary')],
  // Logo depois da fronteira da Base44, porque verifica a fronteira gêmea: o
  // transporte nativo criado na P4.0. As duas respondem à mesma pergunta —
  // quem tem permissão de falar com o mundo lá fora — e ler uma ao lado da
  // outra é como se percebe que uma abriu uma porta que a outra fechou.
  ['native-api', npm('gate:native-api')],
  ['source-closure', npm('gate:source-closure')],
  ['import-integrity', npm('gate:import-integrity')],
  ['no-secrets', npm('gate:no-secrets')],
  ['base44', npm('gate:base44')],
  ['modelobase1-pecuario', npm('gate:modelobase1-pecuario')],
  ['tenancy', npm('gate:tenancy')],
  ['indices', npm('gate:indices')],
  ['types', npm('gate:types')],
  ['typecheck:backend', npm('typecheck:backend')],
  ['lint', npm('lint')],
  ['test:backend', npm('test:backend')],
  ['test:smoke', npm('test:smoke')],
  // O build roda com NODE_ENV fixado em `production`, e não com o que estiver
  // no ambiente. Build de produção medido sob outro NODE_ENV não é o artefato
  // que vai a produção: React e várias bibliotecas trocam para o bundle de
  // desenvolvimento, e a medição infla ~1 MB sem que uma linha de código tenha
  // mudado. Foi exatamente o que aconteceu na primeira versão da P3, quando o
  // workflow passou a definir `NODE_ENV: test` no nível do job.
  ['build', npm('build', { NODE_ENV: 'production' })],
];

const resultado = [];
let falhou = 0;

for (const [nome, { cmd, args, label, env }] of ETAPAS) {
  console.log(`\n${'='.repeat(70)}\nETAPA: ${nome}\n  $ ${label}\n${'='.repeat(70)}`);
  const inicio = process.hrtime.bigint();
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: env ? { ...process.env, ...env } : process.env,
  });
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
