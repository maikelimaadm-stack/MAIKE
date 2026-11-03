#!/usr/bin/env node
/**
 * PR174-R6 (D-PROD-107) — aplicação ONE-SHOT das migrations ANTES do merge.
 *
 * Por que existe: `workflow_dispatch` só pode ser disparado para um workflow
 * que já está na branch padrão (main). O `.github/workflows/release-migrate.yml`
 * desta PR só fica disparável DEPOIS do merge — não serve como caminho
 * pré-merge. Este runner é o caminho pré-merge: o operador autorizado roda num
 * runner/máquina protegido, com checkout EXATO do SHA aprovado, e os segredos do
 * banco vêm do ambiente dele (nunca do repositório).
 *
 * Barreiras (fail-closed; exit 3 = recusado, nada aplicado):
 *  1. `--sha` com 40 hex e `git rev-parse HEAD` igual a ele;
 *  2. árvore limpa (`git status --porcelain` vazio);
 *  3. migrations novas em relação a `--base` (padrão origin/main) PROVADAS EXPAND
 *     (premergeMigrateLib.classificarMigrations) — senão recusa;
 *  4. MIGRATION_DATABASE_URL e MIGRATION_EXPECTED_SYSTEM_IDENTIFIER presentes
 *     (só a PRESENÇA é verificada; valores nunca são lidos para saída);
 *  5. só com `--aplicar` executa `npm run deploy:migrate` (runner oficial: recusa
 *     pooler 6543, nunca cai para DATABASE_URL, confere o system_identifier),
 *     forçando MIGRATION_EXIGIR_CONFERENCIA=sim.
 * Sem `--aplicar`: só o plano (dry-run). Nunca `prisma db push`, nunca no build.
 *
 * Uso:
 *   node scripts/deploy/premerge-migrate.mjs --sha <40hex> [--base origin/main]            (plano)
 *   node scripts/deploy/premerge-migrate.mjs --sha <40hex> --aplicar                       (aplica)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { classificarMigrations } from './premergeMigrateLib.mjs';

const args = process.argv.slice(2);
const valor = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const recusar = (motivo) => {
  console.error(`premerge-migrate: RECUSADO — ${motivo}; nada aplicado`);
  process.exit(3);
};
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

const sha = valor('--sha');
const base = valor('--base') ?? 'origin/main';
const aplicar = args.includes('--aplicar');
if (!sha || !/^[0-9a-f]{40}$/.test(sha)) recusar('--sha com 40 caracteres hexadecimais é obrigatório');
if (git('rev-parse', 'HEAD') !== sha) recusar('HEAD não é o SHA aprovado (faça checkout exato dele)');
if (git('status', '--porcelain')) recusar('árvore suja');
let arquivos;
try {
  arquivos = git('diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', 'backend/prisma/migrations').split('\n').filter((f) => f.endsWith('migration.sql'));
} catch {
  recusar(`base ${base} indisponível (git fetch origin main)`);
}
const alteradas = git('diff', '--name-only', '--diff-filter=MDR', `${base}...HEAD`, '--', 'backend/prisma/migrations');
if (alteradas) recusar('migration já existente foi alterada/removida/renomeada (migrations aplicadas são imutáveis)');
const c = classificarMigrations(arquivos.map((f) => ({ nome: f.split('/').at(-2), sql: readFileSync(f, 'utf8') })));
console.log(JSON.stringify({ sha, base, migrations_novas: arquivos.map((f) => f.split('/').at(-2)), expand: c.expand, tabelas_novas: c.tabelas_novas, violacoes: c.violacoes }, null, 2));
if (!c.expand) recusar('migrations não são EXPAND comprovado — exigem estratégia de release própria');
const faltando = ['MIGRATION_DATABASE_URL', 'MIGRATION_EXPECTED_SYSTEM_IDENTIFIER'].filter((k) => !process.env[k]);
if (!aplicar) {
  console.log(`premerge-migrate: PLANO OK (dry-run). Para aplicar: --aplicar${faltando.length ? ` (faltam no ambiente: ${faltando.join(', ')})` : ''}`);
  process.exit(0);
}
if (faltando.length) recusar(`ambiente sem ${faltando.join(', ')} (configure no runner protegido; nunca no repositório)`);
const r = spawnSync('npm', ['run', 'deploy:migrate'], { stdio: 'inherit', env: { ...process.env, MIGRATION_EXIGIR_CONFERENCIA: 'sim' } });
process.exit(r.status ?? 1);
