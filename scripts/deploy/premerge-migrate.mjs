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
 *  6. Modo CONTRACT (D-PROD-162): a migration CONTRACT tem de ser a ÚNICA nova
 *     (CONTRACT_NAO_ISOLADO); `--verificar-alvo`/`--aplicar` exigem
 *     `--contract <decisão>` exato (CONTRACT_NAO_AUTORIZADO), ANTES de qualquer
 *     conexão; `--contract` sem CONTRACT na release é CONTRACT_INESPERADO. Só
 *     este runner define MIGRATION_CONTRACT_AUTORIZADO para o `deploy:migrate`.
 * Sem credenciais: análise local apenas, declarada "alvo remoto NÃO verificado".
 * Nunca imprime URL, host, usuário ou senha.
 *
 *   node scripts/deploy/premerge-migrate.mjs --sha <40hex>                    (análise local)
 *   node scripts/deploy/premerge-migrate.mjs --sha <40hex> --verificar-alvo   (+ alvo, só leitura)
 *   node scripts/deploy/premerge-migrate.mjs --sha <40hex> --aplicar          (+ alvo, aplica)
 *   … --verificar-alvo --contract D-PROD-162 / … --aplicar --contract D-PROD-162   (release CONTRACT)
 *   … --verificar-alvo --contract D-PROD-183 / … --aplicar --contract D-PROD-183   (DROP COLUMN de TipoTarefa)
 *   … --verificar-alvo --contract D-PROD-187 / … --aplicar --contract D-PROD-187   (CategoriaManejo → CADCATEGORIA)
 *   … --verificar-alvo --contract D-PROD-194 / … --aplicar --contract D-PROD-194   (CADCURVAGANHO mensal)
 *   … --verificar-alvo --contract D-PROD-197 / … --aplicar --contract D-PROD-197   (padrões e flags de TipoAtividade, aditiva)
 *   … --verificar-alvo --contract D-PROD-200 / … --aplicar --contract D-PROD-200   (Atividade cabeçalho: conversão e DROP das 3 tabelas antigas)
 *   … --verificar-alvo --contract D-PROD-208 / … --aplicar --contract D-PROD-208   (funcionário como papel do parceiro: DROP de Funcionario, vazia, no fim)
 *   … --verificar-alvo --contract D-PROD-209 / … --aplicar --contract D-PROD-209   (tipo do funcionário: TERCEIRIZADO no lugar de TAREFEIRO no CHECK de Fornecedor)
 *   … --verificar-alvo --contract D-PROD-210 / … --aplicar --contract D-PROD-210   (base do consumo na Formulação: base_consumo, %PV anulável, g_cab_dia e CHECKs, tabelas vazias)
 *   … --verificar-alvo --contract D-PROD-211 / … --aplicar --contract D-PROD-211   (abastecimento ligado à atividade: colunas, backfill, CHECKs e FKs em AbastecimentoBem)
 *   … --verificar-alvo --contract D-PROD-214 / … --aplicar --contract D-PROD-214   (reforço: o apontamento do abastecimento é da atividade dele; UNIQUE e FK de 4 colunas)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

import {
  MIGRATIONS_APROVADAS, classificarMigrations, conferirHistoricoRemoto, conferirReleaseContract, envDoDeployMigrate,
  migrationsDoManifestoFaltando, sha256,
} from './premergeMigrateLib.mjs';
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
// D-PROD-162: `--contract` sem valor conta como informado e vazio (nunca autoriza nada).
const autorizacaoContract = args.includes('--contract') ? (valor('--contract') ?? '') : undefined;
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
console.log(JSON.stringify({ sha, main: mainRemota, migrations_novas: nomesNovas, expand: c.expand, modo: c.modo, contract: c.contract, tabelas_novas: c.tabelas_novas, colunas_novas_em_tabelas_antigas: c.colunas_novas_em_tabelas_antigas, violacoes: c.violacoes }, null, 2));
// Código estável mantido: qualquer violação (EXPAND ou recorte CONTRACT) recusa com MIGRATIONS_NAO_EXPAND.
if (!c.ok) recusar('MIGRATIONS_NAO_EXPAND', 'migrations fora da allowlist/manifesto da release');
// D-PROD-162: isolamento e --contract inesperado já na análise local; a autorização só é exigida para tocar o alvo.
const rc = conferirReleaseContract({ nomesNovas, classificacao: c, autorizacao: autorizacaoContract });
if (rc.codigo === 'CONTRACT_NAO_ISOLADO') recusar(rc.codigo, 'a migration CONTRACT tem de ser a única migration nova da release');
if (rc.codigo === 'CONTRACT_INESPERADO') recusar(rc.codigo, '--contract informado, mas a release não tem migration CONTRACT');
if (faltamNoDiff.length) recusar('MANIFESTO_INCOMPLETO', `manifesto cita migration ausente da release: ${faltamNoDiff.join(', ')}`);
const [k] = c.contract;
// D-PROD-183/D-PROD-187: o rótulo cita só o que a migration CONTRACT faz (a D-PROD-162 segue "13 tabelas removidas,
// 2 CHECKs alargados"; a D-PROD-183, "4 colunas removidas (…)").
const partesContract = k ? [
  // D-PROD-200: formato CONVERSÃO — a conversão pinada vem ANTES do DROP no arquivo, e o rótulo diz na mesma ordem.
  k.conversoes?.length && `${k.conversoes.length} ${k.conversoes.length === 1 ? 'conversão' : 'conversões'} (${k.conversoes.join(', ')})`,
  k.tabelas_removidas.length && `${k.tabelas_removidas.length} ${k.tabelas_removidas.length === 1 ? 'tabela removida' : 'tabelas removidas'}`,
  k.constraints_alargadas.length && `${k.constraints_alargadas.length} CHECKs alargados`,
  k.constraints_removidas.length && `${k.constraints_removidas.length} constraints removidas (${k.constraints_removidas.join(', ')})`,
  k.indices_removidos.length && `${k.indices_removidos.length} índices removidos (${k.indices_removidos.join(', ')})`,
  k.colunas_removidas.length && `${k.colunas_removidas.length} colunas removidas (${k.colunas_removidas.join(', ')})`,
  k.tabelas_renomeadas.length && `tabela renomeada (${k.tabelas_renomeadas.join(', ')})`,
  k.nomes_renomeados.length && `${k.nomes_renomeados.length} nomes renomeados (${k.nomes_renomeados.join(', ')})`,
  // D-PROD-197: CONTRACT aditiva — colunas e constraints NOVAS em tabela antiga (nada removido nem alargado).
  k.colunas_adicionadas?.length && `${k.colunas_adicionadas.length} ${k.colunas_adicionadas.length === 1 ? 'coluna adicionada' : 'colunas adicionadas'} (${k.colunas_adicionadas.join(', ')})`,
  k.constraints_adicionadas?.length && `${k.constraints_adicionadas.length} ${k.constraints_adicionadas.length === 1 ? 'constraint adicionada' : 'constraints adicionadas'} (${k.constraints_adicionadas.join(', ')})`,
].filter(Boolean) : [];
const rotuloContract = k ? ` (CONTRACT ${k.decisao}: ${partesContract.join(', ')})` : '';
if (!verificarAlvo) {
  console.log(`premerge-migrate: ANÁLISE LOCAL OK${rotuloContract} — alvo remoto NÃO verificado (isto não autoriza aplicar; use --verificar-alvo)`);
  process.exit(0);
}
const faltando = ['MIGRATION_DATABASE_URL', 'MIGRATION_EXPECTED_SYSTEM_IDENTIFIER'].filter((x) => !process.env[x]);
if (faltando.length) recusar('ALVO_SEM_CONFIGURACAO', `ambiente sem ${faltando.join(', ')} (configure no runner protegido; nunca no repositório)`);
if (rc.codigo === 'CONTRACT_NAO_AUTORIZADO') recusar(rc.codigo, `release CONTRACT ${k.decisao}: --verificar-alvo/--aplicar exigem --contract ${k.decisao} exato`);
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
const r = spawnSync('npm', ['run', 'deploy:migrate'], { stdio: 'inherit', env: envDoDeployMigrate({ env: process.env, classificacao: c, autorizacao: autorizacaoContract }) });
process.exit(r.status ?? 1);
