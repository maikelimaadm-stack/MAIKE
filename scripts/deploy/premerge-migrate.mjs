#!/usr/bin/env node
/**
 * PR174-R6/R7 (D-PROD-107) — aplicação ONE-SHOT das migrations ANTES do merge.
 *
 * `workflow_dispatch` só pode ser disparado para workflow que já está na main,
 * então `.github/workflows/release-migrate.yml` não é caminho pré-merge. Este
 * runner é: o operador autorizado roda numa máquina/runner protegido, com
 * checkout EXATO do SHA aprovado; os segredos vêm do ambiente dele.
 *
 * Barreiras (fail-closed; exit 3 = recusado, nada aplicado):
 *  1. `--sha` 40 hex = `git rev-parse HEAD`; árvore limpa.
 *  2. Base FIXA `origin/main`, conferida contra o remoto (`git ls-remote`):
 *     origin/main local defasada → recusa. Não há `--base`.
 *  3. Nenhuma migration da main alterada/removida/renomeada; as novas são
 *     EXATAMENTE as do manifesto (premergeMigrateLib.MIGRATIONS_APROVADAS) e
 *     passam na allowlist estrutural fechada.
 *  4. `--verificar-alvo` / `--aplicar`: conexão de MIGRATION (somente leitura)
 *     com system_identifier = MIGRATION_EXPECTED_SYSTEM_IDENTIFIER e
 *     `_prisma_migrations` coerente (sem extra, divergente ou parcial; pendentes
 *     ⊆ manifesto) — senão PREMERGE_MIGRATIONS_NAO_COMPROVADAS.
 *  5. Só `--aplicar` executa o runner oficial `npm run deploy:migrate` (que
 *     refaz a conferência de alvo e recusa o pooler). Nenhum segundo executor de DDL.
 * Sem credenciais: análise local apenas, declarada "alvo remoto NÃO verificado".
 * Nunca imprime URL, host, usuário ou senha.
 *
 *   node scripts/deploy/premerge-migrate.mjs --sha <40hex>                    (análise local)
 *   node scripts/deploy/premerge-migrate.mjs --sha <40hex> --verificar-alvo   (+ alvo, só leitura)
 *   node scripts/deploy/premerge-migrate.mjs --sha <40hex> --aplicar          (+ alvo, aplica)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

import { MIGRATIONS_APROVADAS, classificarMigrations, conferirHistoricoRemoto, migrationsDoManifestoFaltando, sha256 } from './premergeMigrateLib.mjs';
import { CONSULTA_HISTORICO, executorPrisma, lerIdentidade } from './alvoBancoLib.mjs';

const args = process.argv.slice(2);
const valor = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const recusar = (codigo, motivo) => {
  console.error(`premerge-migrate: RECUSADO ${codigo} — ${motivo}; nada aplicado`);
  process.exit(3);
};
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

if (args.includes('--base')) recusar('BASE_FIXA', 'a base da release é sempre origin/main conferida no remoto');
const sha = valor('--sha');
const aplicar = args.includes('--aplicar');
const verificarAlvo = aplicar || args.includes('--verificar-alvo');
if (!sha || !/^[0-9a-f]{40}$/.test(sha)) recusar('SHA_INVALIDO', '--sha com 40 caracteres hexadecimais é obrigatório');
if (git('rev-parse', 'HEAD') !== sha) recusar('HEAD_DIVERGENTE', 'HEAD não é o SHA aprovado (faça checkout exato dele)');
if (git('status', '--porcelain')) recusar('ARVORE_SUJA', 'árvore suja');
let mainLocal;
let mainRemota;
try {
  mainLocal = git('rev-parse', 'origin/main');
  mainRemota = git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0];
} catch {
  recusar('MAIN_INDISPONIVEL', 'origin/main ou o remoto indisponível (git fetch origin main)');
}
if (!mainRemota || mainLocal !== mainRemota) recusar('MAIN_DEFASADA', 'origin/main local difere da main remota (rode git fetch origin main)');
const alteradas = git('diff', '--name-only', '--diff-filter=MDRT', 'origin/main...HEAD', '--', 'backend/prisma/migrations');
if (alteradas) recusar('MIGRATION_BASE_ALTERADA', 'migration já existente na main foi alterada/removida/renomeada');
const novas = git('diff', '--name-only', '--diff-filter=A', 'origin/main...HEAD', '--', 'backend/prisma/migrations').split('\n').filter((f) => f.endsWith('migration.sql'));
const nomesNovas = novas.map((f) => f.split('/').at(-2)).sort();
const c = classificarMigrations(novas.map((f) => ({ nome: f.split('/').at(-2), sql: readFileSync(f, 'utf8') })));
// D-PROD-113: migration do manifesto que já está na main foi liberada antes; não "falta".
const naMain = (n) => { try { git('cat-file', '-e', `origin/main:backend/prisma/migrations/${n}/migration.sql`); return true; } catch { return false; } };
const faltamNoDiff = migrationsDoManifestoFaltando(MIGRATIONS_APROVADAS, nomesNovas, naMain);
console.log(JSON.stringify({ sha, main: mainRemota, migrations_novas: nomesNovas, expand: c.expand, tabelas_novas: c.tabelas_novas, colunas_novas_em_tabelas_antigas: c.colunas_novas_em_tabelas_antigas, violacoes: c.violacoes }, null, 2));
if (!c.expand) recusar('MIGRATIONS_NAO_EXPAND', 'migrations fora da allowlist/manifesto da release');
if (faltamNoDiff.length) recusar('MANIFESTO_INCOMPLETO', `manifesto cita migration ausente da release: ${faltamNoDiff.join(', ')}`);
if (!verificarAlvo) {
  console.log('premerge-migrate: ANÁLISE LOCAL OK — alvo remoto NÃO verificado (isto não autoriza aplicar; use --verificar-alvo)');
  process.exit(0);
}
const faltando = ['MIGRATION_DATABASE_URL', 'MIGRATION_EXPECTED_SYSTEM_IDENTIFIER'].filter((k) => !process.env[k]);
if (faltando.length) recusar('ALVO_SEM_CONFIGURACAO', `ambiente sem ${faltando.join(', ')} (configure no runner protegido; nunca no repositório)`);
const url = process.env.MIGRATION_DATABASE_URL;
const id = await lerIdentidade(url, executorPrisma);
if (!id.ok) recusar('PREMERGE_MIGRATIONS_NAO_COMPROVADAS', `alvo indisponível ou sem permissão (${id.erro})`);
if (id.sid !== String(process.env.MIGRATION_EXPECTED_SYSTEM_IDENTIFIER)) recusar('ALVO_DIVERGENTE', 'system_identifier do alvo difere do esperado');
if (!id.tem_historico) recusar('PREMERGE_MIGRATIONS_NAO_COMPROVADAS', 'public._prisma_migrations ausente (banco errado ou vazio)');
let linhas;
try {
  linhas = await executorPrisma(url, CONSULTA_HISTORICO);
} catch (e) {
  recusar('PREMERGE_MIGRATIONS_NAO_COMPROVADAS', `histórico ilegível (${e?.code ?? 'erro'})`);
}
const raiz = 'backend/prisma/migrations';
const locais = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ nome: d.name, checksum: sha256(readFileSync(`${raiz}/${d.name}/migration.sql`, 'utf8')) }));
const h = conferirHistoricoRemoto({ locais, linhas });
console.log(JSON.stringify({ alvo: { banco: id.banco, migrations_aplicadas: id.migrations, historico: id.historico }, pendentes: h.pendentes, falhas: h.falhas }, null, 2));
if (!h.ok) recusar(h.codigo, 'histórico do alvo não confere com a release');
if (!aplicar) {
  console.log(`premerge-migrate: ALVO VERIFICADO — ${h.pendentes.length} pendente(s) do manifesto; nada aplicado (use --aplicar)`);
  process.exit(0);
}
if (!h.pendentes.length) {
  console.log('premerge-migrate: nada pendente — schema já aplicado');
  process.exit(0);
}
const r = spawnSync('npm', ['run', 'deploy:migrate'], { stdio: 'inherit', env: { ...process.env, MIGRATION_EXIGIR_CONFERENCIA: 'sim' } });
process.exit(r.status ?? 1);
