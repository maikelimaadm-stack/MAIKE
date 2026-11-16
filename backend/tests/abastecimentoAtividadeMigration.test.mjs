/**
 * D-PROD-211 — a migration CONTRACT `20261116300000_abastecimento_atividade` (Fatia 5 do Lançamento de Atividades: o
 * abastecimento do bem ganha origem ESTOQUE | EXTERNO, o vínculo com o apontamento e a atividade, o snapshot do centro
 * de custo, da leitura anterior, do delta e do intervalo confiável; local e movimento passam a anuláveis; o CHECK de
 * status é recriado e entram 3 CHECKs, 3 FKs e 3 índices) de ponta a ponta, contra PostgreSQL real, em bancos PRÓPRIOS
 * criados e apagados por este teste (o banco da suíte não é tocado; os nomes começam pelo nome do banco da suíte).
 *
 * Partida (banco MODELO): as 61 migrations de nome ANTERIOR a esta (produção hoje: a última, a CONTRACT D-PROD-210),
 * pelo Prisma a partir de uma cópia temporária, e sementes em SQL cru: 2 clientes; no 1º, um centro de custo, uma
 * atividade com um lançamento (apontamento), um trator com horímetro e centro de custo, uma grade sem medidor e sem
 * centro, os tanques, o diesel aceito, um local, os movimentos e 2 abastecimentos (um CONFIRMADO no trator e um
 * CANCELADO, com estorno, na grade); no 2º, um trator com centro de custo e um abastecimento CONFIRMADO. Os bancos do
 * teste são cópias dele (CREATE DATABASE … TEMPLATE).
 *
 * Schema × banco: o schema.prisma do repositório já é o desta fatia: o `migrate diff` da partida acusa a diferença
 * (exit 2) e, depois, fica vazio.
 *
 * RED (num banco NOVO, recusado pela guarda `guarda: …` e NADA muda): uma coluna nova já presente; local_estoque_id já
 * anulável. E o runner com a conferência de alvo exigida e SEM MIGRATION_CONTRACT_AUTORIZADO=D-PROD-211 exato recusa
 * antes de qualquer DDL.
 *
 * GREEN pelo runner oficial (alvo conferido + decisão exata): 62/0, 94 tabelas, as 7 colunas, os 2 NOT NULL a menos, o
 * CHECK de status recriado, os 3 CHECKs, as 3 FKs e os 3 índices novos, nada mais mudou; o backfill (o centro de custo
 * de cada abastecimento é o do bem, por cliente; ESTOQUE e intervalo false; anterior e delta nulos); as formas que os
 * CHECKs aceitam e recusam (23514/23503); `migrate diff` vazio e o postcheck do runbook APLICADA; reaplicar o arquivo é
 * recusado pela guarda sem mudar nada; 2ª execução sem pendência.
 *
 * Caminho B: o preflight, o envelope e o postcheck de `MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md` (entre os
 * marcadores `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local: o envelope com o de
 * produção recusa; histórico fora de 61/0, a D-PROD-210 com outro checksum ou uma coluna nova já presente recusa antes
 * do DDL; o envelope aplica (61 → 62, checksum = SHA-256 do arquivo, applied_steps_count 1, o mesmo schema do runner),
 * o Prisma não vê pendência, `migrate diff` vazio e o postcheck APLICADA; repetir o envelope recusa.
 *
 * D-PROD-213: a CONTRACT `20261116400000_abastecimento_fk_apontamento_atividade` (o reforço: UNIQUE em
 * AtividadeApontamento e a FK do apontamento de AbastecimentoBem com a atividade), de nome posterior, muda o
 * schema.prisma. Este teste fica NO DIA DA D-PROD-211: o runner oficial roda sobre um espelho do repositório com só as
 * pastas até esta (`runnerDoDia`, ver `espelhoDoRunner.mjs`), e o `migrate diff` contra o schema.prisma de hoje acusa
 * só a diferença do reforço (exit 2) até a D-PROD-213 subir. O AA-08 prova a ordem de produção, num banco à parte: esta
 * pelo runner do dia e depois, pelo runner do repositório com a decisão exata, a D-PROD-213 (63/0, 94 tabelas,
 * `migrate diff` vazio); no caminho B, o runner do repositório sobe a D-PROD-213 depois do envelope e o `migrate diff`
 * fica vazio.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

// Só o cliente Prisma da suíte (para criar e apagar os bancos próprios), sem os helpers: eles carregam o app inteiro,
// e este teste não depende de rota nem de serviço.
import { closePrismaClient, getPrismaClient } from '../src/database/prismaClient.js';
import { motivoAlvoProtegido } from '../../scripts/auth/alvoProtegido.mjs';
import { criarEspelhoDoRunner } from './espelhoDoRunner.mjs';
import {
  MIGRATIONS_APROVADAS, MIGRATIONS_CONTRACT_APROVADAS, classificarMigrations, conferirHistoricoRemoto, contractsPendentes,
} from '../../scripts/deploy/premergeMigrateLib.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const NOME = '20261116300000_abastecimento_atividade';
const DECISAO = 'D-PROD-211';
const ARQUIVO = join(MIGRATIONS, NOME, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** D-PROD-210: a anterior, a última que produção concluiu (o preflight e o envelope conferem o checksum dela). */
const NOME_ANTERIOR = '20261116200000_formulacao_base_consumo';
const CHECKSUM_ANTERIOR = 'a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171';
/** Pastas do repositório: a partida é o que vem ANTES desta; o GREEN, até esta (no dia da D-PROD-211). */
const PASTAS_HOJE = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
/** D-PROD-213: a CONTRACT do reforço, de nome posterior (ver o cabeçalho); fica fora do dia desta. */
const NOME_REFORCO = '20261116400000_abastecimento_fk_apontamento_atividade';
const PASTAS = Object.freeze(PASTAS_HOJE.filter((n) => n <= NOME));
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME));
const TOTAL_MIGRATIONS = PASTAS.length;
const COLUNAS_NOVAS = Object.freeze(['origem', 'atividade_id', 'apontamento_id', 'centro_custo_id', 'medidor_leitura_anterior', 'medidor_delta', 'intervalo_confiavel']);

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const C1 = 'aba-c1';
const C2 = 'aba-c2';
const E1 = `${C1}-e1`;
const E2 = `${C1}-e2`;
const U1 = `${C1}-u1`;
const CC1 = `${C1}-cc1`;
/** Centro de custo da OUTRA fazenda do mesmo cliente (a FK composta pela empresa o recusa). */
const CC_E2 = `${C1}-cc2`;
const ATV = `${C1}-atv1`;
const AP = `${C1}-ap1`;
/** O abastecimento CONFIRMADO no trator (horímetro 120, centro do bem CC1), o CANCELADO na grade e o do 2º cliente. */
const A1 = `${C1}-a1`;
const A2 = `${C1}-a2`;
const A3 = `${C2}-a1`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-211: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
  return url;
};
/** Mesma URL, outro banco lógico. */
const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
/** Nem a URL inteira nem o par usuário:senha podem aparecer na saída. */
const vazou = (saida, url) => {
  const u = new URL(url);
  return saida.includes(url) || (u.password !== '' && saida.includes(`${u.username}:${u.password}@`));
};

/** Executa um processo sem shell e devolve status e saída (assíncrono: o laço de eventos segue vivo). */
const rodar = (comando, args, { env = process.env, cwd = RAIZ } = {}) =>
  new Promise((resolve) => {
    const filho = spawn(comando, args, { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr, saida: `${stdout}\n${stderr}` }));
  });

/** Ambiente limpo para o runner: sem as conexões herdadas do shell do operador. */
const ambienteBase = () => {
  const env = { ...process.env };
  for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'MIGRATION_DATABASE_URL', 'MIGRATION_EXIGIR_CONFERENCIA', 'MIGRATION_EXPECTED_SYSTEM_IDENTIFIER', 'MIGRATION_CONTRACT_AUTORIZADO']) delete env[k];
  return env;
};
const prisma = (args, url) => rodar(process.execPath, [PRISMA_CLI, ...args], { env: { ...ambienteBase(), DATABASE_URL: url } });
/** O runner oficial (`npm run deploy:migrate`). `runtime` é a conexão do runtime quando a conferência de alvo é exigida. */
const aplicarPeloRunner = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
const migrateDiff = (url) => prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', SCHEMA, '--exit-code'], url);
/** D-PROD-213 — o runner oficial NO DIA DA D-PROD-211 (espelho com as pastas até esta; ver `espelhoDoRunner.mjs`). */
let ESPELHO;
const runnerDoDia = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-213 (ver o cabeçalho): até o reforço subir, o schema.prisma de hoje acusa só a diferença dele. */
const DIFERENCA_DO_REFORCO = [
  '[*] Changed the `AbastecimentoBem` table',
  '  [-] Removed foreign key on columns (cliente_id, empresa_id, apontamento_id)',
  '  [+] Added foreign key on columns (cliente_id, empresa_id, atividade_id, apontamento_id)',
  '',
  '[*] Changed the `AtividadeApontamento` table',
  '  [+] Added unique index on columns (cliente_id, empresa_id, atividade_id, id)',
].join('\n');
const soDiferencaDoReforco = (diff) => {
  assert.equal(diff.status, 2, diff.saida);
  assert.equal(diff.stdout.trim(), DIFERENCA_DO_REFORCO, diff.saida);
};

/** psql sem .psqlrc, saída crua e SQLSTATE nas mensagens de erro. */
const psql = (url, args) => {
  const u = new URL(url);
  u.search = '';
  return rodar('psql', [u.toString(), '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...args], { env: ambienteBase() });
};
/** O migration.sql numa transação só. */
const aplicarArquivo = (url) => psql(url, ['-1', '-f', ARQUIVO]);
/** Um texto inteiro numa só consulta (como o execute_sql do conector). */
const consulta = (url, sql) => psql(url, ['-c', sql]);
/** Linhas `item|valor|esperado|status` do preflight/postcheck do runbook. */
const quadro = (r) => Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => {
  const [item, valor, esperado, status] = l.split('|');
  return [item, { valor, esperado, status }];
}));
const comSidLocal = (sql, sid) => sql.split(SID_PRODUCAO).join(sid);
/** O envelope do caminho B do runbook com o migration.sql integral no lugar marcado. */
const envelope = () => {
  const e = blocoDoRunbook('caminho-b');
  assert.equal(e.split(MARCA_MIGRATION).length, 2, 'o envelope tem o lugar do migration.sql');
  return e.replace(MARCA_MIGRATION, () => SQL_MIGRATION);
};

/** Cópia temporária das pastas da partida (as de nome anterior a esta) aplicada pelo Prisma. */
const aplicarAnteriores = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-aba-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of ANTERIORES) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-211: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Sementes em SQL cru (o Prisma Client é o do schema novo; a partida ainda não tem as colunas novas). */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C1}', 'aba1', 'Cliente ABA', now()), ('${C2}', 'aba2', 'Cliente ABA 2', now())`);
  await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES
    ('${E1}', '${C1}', 1, 'F1', 'Fazenda 1', now()), ('${E2}', '${C1}', 2, 'F2', 'Fazenda 2', now()), ('${C2}-e1', '${C2}', 1, 'G1', 'Granja 1', now())`);
  await ins(`INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, "updatedAt") VALUES ('${U1}', '${C1}', 'Operador', 'operador.aba', 'x', now())`);
  await ins(`INSERT INTO "CentroCusto" (id, cliente_id, empresa_id, numero, nome, "updatedAt") VALUES
    ('${CC1}', '${C1}', '${E1}', '1', 'MECANIZAÇÃO', now()), ('${CC_E2}', '${C1}', '${E2}', '2', 'MECANIZAÇÃO F2', now()),
    ('${C2}-cc1', '${C2}', '${C2}-e1', '1', 'FROTA', now())`);
  await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${C1}-g1', '${C1}', 'Tratos', now())`);
  await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, "updatedAt") VALUES ('${C1}-t1', '${C1}', 'GRADEAR', '${C1}-g1', 'Tratos', now())`);
  await ins(`INSERT INTO "Atividade" (id, cliente_id, empresa_id, numero, nome, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id, grupo_atividade_nome,
      data_inicio, criado_por_usuario_id, "updatedAt")
    VALUES ('${ATV}', '${C1}', '${E1}', '1', 'GRADEAÇÃO PASTO 01', '${C1}-t1', 'GRADEAR', '${C1}-g1', 'Tratos', '2026-11-14', '${U1}', now())`);
  await ins(`INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, operador_usuario_id, criado_por_usuario_id, "updatedAt")
    VALUES ('${AP}', '${C1}', '${E1}', '${ATV}', '2026-11-14', 1, '${U1}', '${U1}', now())`);
  for (const [c, e, centro] of [[C1, E1, CC1], [C2, `${C2}-e1`, `${C2}-cc1`]]) {
    await ins(`INSERT INTO "FamiliaPatrimonial" (id, cliente_id, codigo, nome, natureza, "updatedAt") VALUES
      ('${c}-fm', '${c}', 'TRATORES', 'Tratores', 'MAQUINA', now()), ('${c}-fi', '${c}', 'GRADES', 'Grades', 'IMPLEMENTO', now())`);
    await ins(`INSERT INTO "TipoPatrimonial" (id, cliente_id, familia_id, codigo, nome, "updatedAt") VALUES
      ('${c}-tm', '${c}', '${c}-fm', 'TRATOR', 'Trator', now()), ('${c}-ti', '${c}', '${c}-fi', 'GRADE', 'Grade', now())`);
    await ins(`INSERT INTO "BemPatrimonial" (id, cliente_id, empresa_id, numero, nome, natureza, familia_id, tipo_id, centro_custo_id, medidor_tipo, medidor_unidade,
        medidor_leitura_inicial, medidor_leitura_atual, medidor_data_leitura, medidor_origem, "updatedAt") VALUES
      ('${c}-b1', '${c}', '${e}', '1', 'Trator 01', 'MAQUINA', '${c}-fm', '${c}-tm', '${centro}', 'HORIMETRO', 'h', 100, 100, '2026-11-01', 'CADASTRO_INICIAL', now())`);
    await ins(`INSERT INTO "BemPatrimonial" (id, cliente_id, empresa_id, numero, nome, natureza, familia_id, tipo_id, "updatedAt") VALUES
      ('${c}-b2', '${c}', '${e}', '2', 'Grade 01', 'IMPLEMENTO', '${c}-fi', '${c}-ti', now())`);
    await ins(`INSERT INTO "TanqueBem" (id, cliente_id, bem_id, identificador, capacidade_litros, "updatedAt") VALUES
      ('${c}-tq1', '${c}', '${c}-b1', 'PRINCIPAL', 200, now()), ('${c}-tq2', '${c}', '${c}-b2', 'AUXILIAR', 50, now())`);
    await ins(`INSERT INTO "Produto" (id, cliente_id, empresa_id, numero_produto, nome_produto, unidade_principal_estoque, estoque_atual, "updatedAt")
      VALUES ('${c}-p1', '${c}', '${e}', '1', 'DIESEL S10', 'L', 500, now())`);
    await ins(`INSERT INTO "TanqueBemProduto" (id, cliente_id, tanque_id, produto_id, "updatedAt") VALUES
      ('${c}-ac1', '${c}', '${c}-tq1', '${c}-p1', now()), ('${c}-ac2', '${c}', '${c}-tq2', '${c}-p1', now())`);
    await ins(`INSERT INTO "LocalEstoque" (id, cliente_id, numero_local, nome, "updatedAt") VALUES ('${c}-l1', '${c}', '1', 'TANQUE DA SEDE', now())`);
    await ins(`INSERT INTO "MovimentacaoEstoque" (id, cliente_id, empresa_id, numero_movimentacao, tipo_movimentacao, data_movimentacao, produto_id, quantidade,
        unidade_medida, valor_unitario, valor_total, "updatedAt") VALUES
      ('${c}-mv1', '${c}', '${e}', '1', 'Saída', '2026-11-14 12:00:00', '${c}-p1', 50, 'L', 6, 300, now()),
      ('${c}-mv2', '${c}', '${e}', '2', 'Saída', '2026-11-14 13:00:00', '${c}-p1', 10, 'L', 6, 60, now()),
      ('${c}-mv3', '${c}', '${e}', '3', 'Entrada', '2026-11-14 14:00:00', '${c}-p1', 10, 'L', 6, 60, now()),
      ('${c}-mv4', '${c}', '${e}', '4', 'Saída', '2026-11-14 15:00:00', '${c}-p1', 5, 'L', 6, 30, now())`);
  }
  await ins(`INSERT INTO "AbastecimentoBem" (id, cliente_id, empresa_id, numero, status, bem_id, tanque_id, produto_id, local_estoque_id, data_operacional,
       quantidade, unidade, custo_total, custo_unitario, medidor_tipo, medidor_unidade, medidor_leitura, medidor_origem, operation_id,
       movimentacao_estoque_id, movimentacao_estorno_id, cancelado_em, motivo_cancelamento, "updatedAt") VALUES
     ('${A1}', '${C1}', '${E1}', '1', 'CONFIRMADO', '${C1}-b1', '${C1}-tq1', '${C1}-p1', '${C1}-l1', '2026-11-14', 50, 'L', 300, 6,
      'HORIMETRO', 'h', 120, 'ABASTECIMENTO', 'op-aba-a1-0001', '${C1}-mv1', NULL, NULL, NULL, now()),
     ('${A2}', '${C1}', '${E1}', '2', 'CANCELADO', '${C1}-b2', '${C1}-tq2', '${C1}-p1', '${C1}-l1', '2026-11-14', 10, 'L', 60, 6,
      'SEM_MEDIDOR', NULL, NULL, NULL, 'op-aba-a2-0001', '${C1}-mv2', '${C1}-mv3', now(), 'lançado no bem errado', now()),
     ('${A3}', '${C2}', '${C2}-e1', '1', 'CONFIRMADO', '${C2}-b1', '${C2}-tq1', '${C2}-p1', '${C2}-l1', '2026-11-14', 50, 'L', 300, 6,
      'HORIMETRO', 'h', 130, 'ABASTECIMENTO', 'op-aba-a3-0001', '${C2}-mv1', NULL, NULL, NULL, now())`);
};

/** Retrato do que a migration toca (e do que uma recusa não pode deixar): tabelas, constraints, índices, colunas, linhas e histórico. */
const SQL_RETRATO = `SELECT
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')) AS tabelas,
  (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace) AS constraints,
  (SELECT string_agg(indexname || ':' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public') AS indices,
  (SELECT coalesce(string_agg(c.relname || ':' || p.polname, ',' ORDER BY c.relname, p.polname), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid) AS politicas,
  (SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' ORDER BY table_name, ordinal_position)
     FROM information_schema.columns WHERE table_schema = 'public') AS colunas,
  (SELECT string_agg(row_to_json(a)::text, E'\\n' ORDER BY a.id) FROM "AbastecimentoBem" a) AS abastecimentos,
  (SELECT count(*)::int FROM _prisma_migrations WHERE rolled_back_at IS NULL) AS historico,
  (SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas`;
const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
const retrato = (db) => um(db, SQL_RETRATO).then((r) => ({ ...r }));
const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
const historico = (db) =>
  um(db, `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE migration_name = '${NOME}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS esta,
                 count(*) FILTER (WHERE migration_name = '${NOME}')::int AS linhas_esta
            FROM "_prisma_migrations"`);
/** Executa um SQL que TEM de falhar com o SQLSTATE (e, se dado, citando o nome da constraint). */
const recusa = async (db, sql, sqlstate, nome) => {
  await assert.rejects(db.$executeRawUnsafe(sql), (e) => {
    const texto = `${e.message} ${JSON.stringify(e.meta ?? {})}`;
    assert.ok(texto.includes(sqlstate), `${sql}\n→ ${texto}`);
    if (nome) assert.ok(texto.includes(nome), `${sql}\n→ ${texto}`);
    return true;
  });
};
/** Executa os SQLs numa transação desfeita no fim (ROLLBACK): passa se TODOS forem aceitos; nada fica. */
const aceita = async (db, ...sqls) => {
  const ROLLBACK = new Error('rollback intencional');
  await assert.rejects(db.$transaction(async (tx) => {
    for (const sql of sqls) await tx.$executeRawUnsafe(sql);
    throw ROLLBACK;
  }), (e) => {
    assert.equal(e, ROLLBACK, `${sqls.join(';\n')}\n→ ${e.message}`);
    return true;
  });
};
const ATUALIZA = (id, set) => `UPDATE "AbastecimentoBem" SET ${set} WHERE id = '${id}'`;
/** Um abastecimento novo do posto externo (sem local, sem movimento, sem estorno), no trator do 1º cliente; `com` troca um deles. */
const externo = (id, { local = 'NULL', movimento = 'NULL', estorno = 'NULL' } = {}) =>
  `INSERT INTO "AbastecimentoBem" (id, cliente_id, empresa_id, numero, status, bem_id, tanque_id, produto_id, local_estoque_id, data_operacional,
     quantidade, unidade, custo_total, custo_unitario, medidor_tipo, medidor_unidade, medidor_leitura, medidor_origem, operation_id,
     movimentacao_estoque_id, movimentacao_estorno_id, origem, "updatedAt")
   VALUES ('${id}', '${C1}', '${E1}', '${id}', 'CONFIRMADO', '${C1}-b1', '${C1}-tq1', '${C1}-p1', ${local}, '2026-11-15', 40, 'L', 250, 6.25,
     'HORIMETRO', 'h', 130, 'ABASTECIMENTO', 'op-${id}-0001', ${movimento}, ${estorno}, 'EXTERNO', now())`;

let BASE_URL;
let PREFIXO;
let BANCO_MODELO;
let URL_T;
let URL_B;
let SID;
let db;
let partida;

/** Um banco novo, cópia do modelo (o modelo não pode ter conexão aberta). */
const clonar = async (banco) => {
  const p = getPrismaClient();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
  await p.$queryRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BANCO_MODELO}' AND pid <> pg_backend_pid()`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${banco} TEMPLATE ${BANCO_MODELO}`);
  return comBanco(BASE_URL, banco);
};
const apagar = (banco) => getPrismaClient().$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
/** Roda `fn` num banco novo, cópia da partida, e o apaga no fim. */
const emBancoNovo = async (sufixo, fn) => {
  const banco = `${PREFIXO}_aba_${sufixo}`;
  const url = await clonar(banco);
  const dbr = new PrismaClient({ datasourceUrl: url });
  try {
    await fn(dbr, url);
  } finally {
    await dbr.$disconnect();
    await apagar(banco);
  }
};

before(async () => {
  const p = getPrismaClient();
  BASE_URL = exigirUrlLocal(process.env.DATABASE_URL);
  ESPELHO = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME }).dir;
  PREFIXO = new URL(BASE_URL).pathname.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'maike';
  BANCO_MODELO = `${PREFIXO}_aba_modelo`;
  for (const b of [`${PREFIXO}_aba`, `${PREFIXO}_aba_b`, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(comBanco(BASE_URL, BANCO_MODELO));
  const modelo = new PrismaClient({ datasourceUrl: comBanco(BASE_URL, BANCO_MODELO) });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  URL_T = await clonar(`${PREFIXO}_aba`);
  URL_B = await clonar(`${PREFIXO}_aba_b`);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  for (const b of [`${PREFIXO}_aba`, `${PREFIXO}_aba_b`, `${PREFIXO}_aba_ordem`, BANCO_MODELO]) if (PREFIXO) await apagar(b);
  if (ESPELHO) rmSync(ESPELHO, { recursive: true, force: true });
  await closePrismaClient();
});

describe('D-PROD-211 — migration CONTRACT do abastecimento ligado à atividade (PostgreSQL real)', () => {
  test('AA-01 partida: as 61 migrations de nome anterior a esta (a última a D-PROD-210), 94 tabelas, os 3 abastecimentos no formato de antes; schema × banco acusa a diferença; o preflight do runbook diz PRONTO e, com o system_identifier de produção, PARAR', async () => {
    assert.equal(ANTERIORES.length, 61, 'produção hoje: 61 migrations');
    assert.equal(ANTERIORES.at(-1), NOME_ANTERIOR);
    assert.equal(PASTAS.at(-1), NOME, 'no dia da D-PROD-211, esta era a migration de nome mais recente');
    assert.equal(TOTAL_MIGRATIONS, 62);
    assert.deepEqual(PASTAS_HOJE.filter((n) => n > NOME), [NOME_REFORCO], 'D-PROD-213: só o reforço tem nome posterior a esta');
    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [61, 0, 0]);
    assert.equal(partida.tabelas.split(',').length, 94);
    const { checksum } = await um(db, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_ANTERIOR}'`);
    assert.equal(checksum, CHECKSUM_ANTERIOR, 'a anterior com o checksum que produção registrou');
    for (const c of COLUNAS_NOVAS) assert.ok(!partida.colunas.includes(`AbastecimentoBem.${c}:`), c);
    for (const c of ['local_estoque_id', 'movimentacao_estoque_id']) assert.match(partida.colunas, new RegExp(`AbastecimentoBem\\.${c}:character varying:NO:`), c);
    // O CHECK de hoje exige o estorno no cancelado e o local/movimento são NOT NULL (numa transação desfeita, nada fica).
    await recusa(db, ATUALIZA(A2, 'movimentacao_estorno_id = NULL'), '23514', 'AbastecimentoBem_status_check');
    await recusa(db, ATUALIZA(A1, 'local_estoque_id = NULL'), '23502');
    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 2, `o schema.prisma já é o desta fatia: a diferença aparece\n${diff.saida}`);

    const q = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const [item, v] of Object.entries(q)) if (item !== 'VEREDITO') assert.ok(v.status === 'OK' || v.status.startsWith('ATENÇÃO'), `${item}: ${v.status} (${v.valor})`);
    for (const [item, v] of Object.entries(q)) if (!/^(VEREDITO|travas|transações)/.test(item)) assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.equal(q['migrations concluídas / em aberto'].valor, '61 / 0');
    assert.equal(q['a anterior (D-PROD-210) concluída com o checksum do repositório'].valor, '1');
    assert.equal(q['colunas novas já presentes em AbastecimentoBem (tem de ser 0)'].valor, '0');
    assert.equal(q['local_estoque_id e movimentacao_estoque_id ainda NOT NULL'].valor, '2');
    assert.equal(q['CHECK AbastecimentoBem_status_check no formato anterior (sem origem) / CHECKs novos ausentes'].valor, '1 / 0');
    // 3 abastecimentos; 2 com centro de custo no bem (os tratores dos 2 clientes; a grade não tem).
    assert.equal(q['abastecimentos / com centro de custo no bem (o backfill)'].valor, '3 / 2');
    assert.equal(q['tabelas em public'].valor, '94');
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    const producao = quadro(await consulta(URL_T, blocoDoRunbook('preflight')));
    assert.equal(producao['alvo: system_identifier'].status, 'PARAR');
    assert.match(producao.VEREDITO.valor, /^PARAR/);
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    assert.match(pos.VEREDITO.valor, /^PARAR/);
    assert.equal(pos['abastecimentos com centro de custo diferente do do bem (o backfill)'].valor, 'ausente');
    assert.deepEqual(await retrato(db), partida, 'o preflight e o postcheck só leem');
  });

  test('AA-02 o portão: o classificador diz CONTRACT D-PROD-211 sem violação, o arquivo e a guarda são os pinados; o histórico real da partida confere com só esta pendente, e é a CONTRACT a autorizar', async () => {
    const c = classificarMigrations([{ nome: NOME, sql: SQL_MIGRATION }]);
    assert.deepEqual(c.violacoes, []);
    assert.deepEqual([c.ok, c.expand, c.modo], [true, false, 'CONTRACT']);
    assert.deepEqual(c.tabelas_novas, []);
    assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
    assert.equal(c.contract.length, 1);
    assert.equal(c.contract[0].decisao, DECISAO);
    assert.deepEqual(c.contract[0].tabelas_removidas, []);
    assert.deepEqual(c.contract[0].constraints_alargadas, ['AbastecimentoBem.AbastecimentoBem_status_check']);
    assert.deepEqual(c.contract[0].colunas_adicionadas, COLUNAS_NOVAS.map((x) => `AbastecimentoBem.${x}`));
    assert.deepEqual([c.contract[0].colunas_removidas, c.contract[0].conversoes], [[], []]);
    assert.equal(MIGRATIONS_APROVADAS[NOME], CHECKSUM);
    assert.equal(MIGRATIONS_CONTRACT_APROVADAS[NOME].decisao, DECISAO);
    assert.equal(CHECKSUM, '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436');
    assert.doesNotMatch(SQL_MIGRATION, /D-PROD-\d+/, 'o número da decisão fica fora do arquivo');

    const linhas = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    const locais = PASTAS.map((n) => ({ nome: n, checksum: createHash('sha256').update(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8')).digest('hex') }));
    assert.deepEqual(conferirHistoricoRemoto({ locais, linhas }), { ok: true, codigo: null, pendentes: [NOME], falhas: [] });
    assert.deepEqual(contractsPendentes({ locais: PASTAS, linhas }), [{ nome: NOME, decisao: DECISAO }]);
    // Hoje (D-PROD-213), com as pastas do repositório, o reforço também pende: são duas CONTRACT pendentes.
    assert.deepEqual(contractsPendentes({ locais: PASTAS_HOJE, linhas }), [{ nome: NOME, decisao: DECISAO }, { nome: NOME_REFORCO, decisao: 'D-PROD-213' }]);
  });

  test('AA-RED-1 uma coluna nova já presente (num banco novo) → a guarda recusa e NADA muda; o runner local também falha na guarda', async () => {
    await emBancoNovo('r1', async (dbr, url) => {
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" ADD COLUMN "origem" VARCHAR(8)`);
      const antes = await retrato(dbr);
      const r = await aplicarArquivo(url);
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, /guarda: o abastecimento não está no formato anterior/);
      assert.deepEqual(await retrato(dbr), antes, 'nada da migration ficou');
      const runner = await runnerDoDia(url);
      assert.notEqual(runner.status, 0, runner.saida);
      assert.match(runner.saida, /guarda: o abastecimento não está no formato anterior/);
      const depois = await retrato(dbr);
      assert.deepEqual([depois.constraints, depois.colunas, depois.abastecimentos], [antes.constraints, antes.colunas, antes.abastecimentos]);
    });
  });

  test('AA-RED-2 local_estoque_id já anulável, ou o CHECK de status já com origem (num banco novo) → a guarda recusa e NADA muda', async () => {
    await emBancoNovo('r2', async (dbr, url) => {
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" ALTER COLUMN "local_estoque_id" DROP NOT NULL`);
      const antes = await retrato(dbr);
      const r = await aplicarArquivo(url);
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, /guarda: o abastecimento não está no formato anterior/);
      assert.deepEqual(await retrato(dbr), antes);
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" ALTER COLUMN "local_estoque_id" SET NOT NULL`);
      // O CHECK de status trocado por um com "origem" no texto (como se já tivesse rodado): recusa nos CHECKs.
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_status_check"`);
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "AbastecimentoBem_status_check" CHECK ("status" IN ('CONFIRMADO', 'CANCELADO') AND 'origem' <> '')`);
      const antes2 = await retrato(dbr);
      const r2 = await aplicarArquivo(url);
      assert.notEqual(r2.status, 0, r2.saida);
      assert.match(r2.saida, /guarda: os CHECKs do abastecimento não estão no formato anterior/);
      assert.deepEqual(await retrato(dbr), antes2);
    });
  });

  test('AA-03 runner do dia com a conferência de alvo exigida e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando só a D-PROD-211, antes de qualquer DDL', async () => {
    const linhasAntes = (await um(db, 'SELECT count(*)::int AS n FROM _prisma_migrations')).n;
    // D-PROD-210 é a CONTRACT anterior e D-PROD-200 criou a atividade: nenhuma autoriza esta; nem a decisão em minúsculas.
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-210' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-209' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-200' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-211' }, { MIGRATION_CONTRACT_AUTORIZADO: ' D-PROD-211 ' }]) {
      const r = await runnerDoDia(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.saida.includes(`${NOME} (${DECISAO})`), r.saida);
      for (const outra of Object.keys(MIGRATIONS_CONTRACT_APROVADAS).filter((n) => n !== NOME)) assert.ok(!r.saida.includes(outra), `${outra} já está concluída`);
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(r.saida, URL_T));
    }
    assert.equal((await um(db, 'SELECT count(*)::int AS n FROM _prisma_migrations')).n, linhasAntes, 'nenhuma linha nova no histórico');
    assert.deepEqual(await retrato(db), partida);
  });

  test('AA-04 GREEN pelo runner oficial do dia (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-211): 62/0, 94 tabelas, as 7 colunas, local e movimento anuláveis, o CHECK de status recriado, 3 CHECKs, 3 FKs e 3 índices novos, nada mais mudou; o backfill do centro de custo vindo do bem; migrate diff só com a diferença do reforço (D-PROD-213)', async () => {
    const r = await runnerDoDia(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /alvo conferido nas duas conexões/);
    assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME} (${DECISAO})`), r.saida);
    assert.ok(r.saida.includes(`Applying migration \`${NOME}\``), r.saida);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [TOTAL_MIGRATIONS, 0, 1]);
    const linha = await um(db, `SELECT checksum, applied_steps_count::int AS passos FROM _prisma_migrations WHERE migration_name = '${NOME}' AND rolled_back_at IS NULL`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1 });

    const depois = await retrato(db);
    assert.deepEqual([depois.tabelas, depois.politicas], [partida.tabelas, partida.politicas]);
    assert.equal(depois.tabelas.split(',').length, 94);
    // Colunas: as 7 novas em AbastecimentoBem e os 2 NOT NULL a menos; nenhuma outra tabela muda.
    const colunasAntes = partida.colunas.split(',');
    const colunasAgora = depois.colunas.split(',');
    assert.deepEqual(colunasAntes.filter((c) => !colunasAgora.includes(c)).sort(), [
      'AbastecimentoBem.local_estoque_id:character varying:NO:-', 'AbastecimentoBem.movimentacao_estoque_id:character varying:NO:-',
    ]);
    assert.deepEqual(colunasAgora.filter((c) => !colunasAntes.includes(c)).sort(), [
      'AbastecimentoBem.apontamento_id:character varying:YES:-',
      'AbastecimentoBem.atividade_id:character varying:YES:-',
      'AbastecimentoBem.centro_custo_id:character varying:YES:-',
      'AbastecimentoBem.intervalo_confiavel:boolean:NO:false',
      'AbastecimentoBem.local_estoque_id:character varying:YES:-',
      'AbastecimentoBem.medidor_delta:numeric:YES:-',
      'AbastecimentoBem.medidor_leitura_anterior:numeric:YES:-',
      'AbastecimentoBem.movimentacao_estoque_id:character varying:YES:-',
      "AbastecimentoBem.origem:character varying:NO:'ESTOQUE'::character varying",
    ]);
    // Constraints: só o CHECK de status sai e volta (com a origem), e entram os 3 CHECKs e as 3 FKs.
    const antes = partida.constraints.split('\n');
    const agora = depois.constraints.split('\n');
    const sairam = antes.filter((c) => !agora.includes(c));
    const entraram = agora.filter((c) => !antes.includes(c));
    assert.equal(sairam.length, 1, sairam.join('\n'));
    assert.ok(sairam[0].startsWith('AbastecimentoBem_status_check:'));
    assert.deepEqual(entraram.map((c) => c.split(':')[0]).sort(), [
      'AbastecimentoBem_apontamento_fkey', 'AbastecimentoBem_atividade_check', 'AbastecimentoBem_atividade_fkey', 'AbastecimentoBem_centro_custo_fkey',
      'AbastecimentoBem_intervalo_check', 'AbastecimentoBem_origem_check', 'AbastecimentoBem_status_check',
    ]);
    for (const fk of entraram.filter((c) => c.includes('_fkey:'))) {
      assert.match(fk, /FOREIGN KEY \(cliente_id, empresa_id, [a-z_]+_id\) REFERENCES "?[A-Za-z]+"?\(cliente_id, empresa_id, id\) ON UPDATE CASCADE ON DELETE RESTRICT$/, fk);
    }
    const { invalidas } = await um(db, `SELECT count(*)::int AS invalidas FROM pg_constraint WHERE conrelid = '"AbastecimentoBem"'::regclass AND NOT convalidated`);
    assert.equal(invalidas, 0);
    // Índices: os 3 novos, não-únicos, pelo cliente e pela empresa; nenhum outro muda.
    const indicesAntes = partida.indices.split('\n');
    const indicesAgora = depois.indices.split('\n');
    assert.deepEqual(indicesAntes.filter((i) => !indicesAgora.includes(i)), []);
    assert.deepEqual(indicesAgora.filter((i) => !indicesAntes.includes(i)), ['atividade', 'apontamento', 'centro_custo'].sort().map((c) =>
      `AbastecimentoBem_${c}_idx:CREATE INDEX "AbastecimentoBem_${c}_idx" ON public."AbastecimentoBem" USING btree (cliente_id, empresa_id, ${c}_id)`));

    // Backfill: o centro de custo de cada abastecimento é o do bem (por cliente); o resto no formato de antes.
    const linhas = await db.$queryRawUnsafe(`SELECT id, origem, centro_custo_id, atividade_id, apontamento_id, medidor_leitura_anterior::text AS anterior,
        medidor_delta::text AS delta, intervalo_confiavel, local_estoque_id, movimentacao_estoque_id, status FROM "AbastecimentoBem" ORDER BY id`);
    assert.deepEqual(linhas.map((l) => ({ ...l })), [
      { id: A1, origem: 'ESTOQUE', centro_custo_id: CC1, atividade_id: null, apontamento_id: null, anterior: null, delta: null, intervalo_confiavel: false, local_estoque_id: `${C1}-l1`, movimentacao_estoque_id: `${C1}-mv1`, status: 'CONFIRMADO' },
      { id: A2, origem: 'ESTOQUE', centro_custo_id: null, atividade_id: null, apontamento_id: null, anterior: null, delta: null, intervalo_confiavel: false, local_estoque_id: `${C1}-l1`, movimentacao_estoque_id: `${C1}-mv2`, status: 'CANCELADO' },
      { id: A3, origem: 'ESTOQUE', centro_custo_id: `${C2}-cc1`, atividade_id: null, apontamento_id: null, anterior: null, delta: null, intervalo_confiavel: false, local_estoque_id: `${C2}-l1`, movimentacao_estoque_id: `${C2}-mv1`, status: 'CONFIRMADO' },
    ]);

    soDiferencaDoReforco(await migrateDiff(URL_T));
  });

  test('AA-05 postcheck do runbook no banco aplicado pelo runner: tudo OK e VEREDITO APLICADA; o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
    assert.equal(pos['migrations concluídas / em aberto'].valor, '62 / 0');
    assert.equal(pos['as 7 colunas novas com o tipo, a nulidade e o DEFAULT do contrato'].valor, '7');
    assert.equal(pos['CHECKs status (com origem), origem, atividade e intervalo, validados'].valor, '4');
    assert.equal(pos['CHECKs em "AbastecimentoBem" (nenhum a mais nem a menos)'].valor, '10');
    assert.equal(pos['FKs atividade, apontamento e centro de custo (compostas, RESTRICT), validadas'].valor, '3');
    assert.equal(pos['índices novos não-únicos começando por (cliente_id, empresa_id)'].valor, '3');
    assert.equal(pos['abastecimentos com centro de custo diferente do do bem (o backfill)'].valor, '0');
    assert.equal(pos['tabelas em public'].valor, '94');
    const pre = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const item of ['migrations concluídas / em aberto', '20261116300000_abastecimento_atividade já registrada', 'colunas novas já presentes em AbastecimentoBem (tem de ser 0)',
      'local_estoque_id e movimentacao_estoque_id ainda NOT NULL', 'CHECK AbastecimentoBem_status_check no formato anterior (sem origem) / CHECKs novos ausentes']) {
      assert.equal(pre[item].status, 'PARAR', item);
    }
    assert.match(pre.VEREDITO.valor, /^PARAR/);
  });

  test('AA-06 os CHECKs e as FKs novos: EXTERNO sem local e sem movimento entra, e cancela sem estorno; ESTOQUE sem movimento ou sem local, EXTERNO com local, outra origem, CANCELADO ESTOQUE sem estorno, apontamento sem atividade e delta incoerente são recusados (23514); apontamento ou centro de outra fazenda, recusados (23503)', async () => {
    const antes = await retrato(db);
    // Aceitas (numa transação desfeita: nada fica).
    await aceita(db, externo(`${C1}-x1`));
    await aceita(db, externo(`${C1}-x2`), ATUALIZA(`${C1}-x2`, `status = 'CANCELADO', cancelado_em = now(), motivo_cancelamento = 'nota do posto errada'`));
    await aceita(db, ATUALIZA(A1, `atividade_id = '${ATV}', apontamento_id = '${AP}'`));
    await aceita(db, ATUALIZA(A1, `atividade_id = '${ATV}'`));
    await aceita(db, ATUALIZA(A1, 'medidor_leitura_anterior = 100, medidor_delta = 20'));
    await aceita(db, ATUALIZA(A1, 'medidor_leitura_anterior = 100, medidor_delta = 20, intervalo_confiavel = true'));
    await aceita(db, ATUALIZA(A1, 'medidor_leitura_anterior = 130, medidor_delta = -10'));
    // ESTOQUE sem movimento, sem local, ou EXTERNO com local/movimento/estorno, ou outra origem.
    await recusa(db, ATUALIZA(A1, 'movimentacao_estoque_id = NULL'), '23514', 'AbastecimentoBem_origem_check');
    await recusa(db, ATUALIZA(A1, 'local_estoque_id = NULL'), '23514', 'AbastecimentoBem_origem_check');
    await recusa(db, ATUALIZA(A1, `origem = 'EXTERNO'`), '23514', 'AbastecimentoBem_origem_check');
    await recusa(db, ATUALIZA(A1, `origem = 'EXTERNO', local_estoque_id = NULL`), '23514', 'AbastecimentoBem_origem_check');
    await recusa(db, ATUALIZA(A1, `origem = 'POSTO', local_estoque_id = NULL, movimentacao_estoque_id = NULL`), '23514', 'AbastecimentoBem_origem_check');
    await recusa(db, externo(`${C1}-x3`, { local: `'${C1}-l1'` }), '23514', 'AbastecimentoBem_origem_check');
    await recusa(db, externo(`${C1}-x4`, { movimento: `'${C1}-mv4'` }), '23514', 'AbastecimentoBem_origem_check');
    // CANCELADO: ESTOQUE sem estorno recusa (o EXTERNO sem estorno entrou acima).
    await recusa(db, ATUALIZA(A2, 'movimentacao_estorno_id = NULL'), '23514', 'AbastecimentoBem_status_check');
    await recusa(db, ATUALIZA(A1, `status = 'CANCELADO', cancelado_em = now(), motivo_cancelamento = 'sem estorno'`), '23514', 'AbastecimentoBem_status_check');
    // Apontamento sem atividade.
    await recusa(db, ATUALIZA(A1, `apontamento_id = '${AP}'`), '23514', 'AbastecimentoBem_atividade_check');
    // Leitura anterior, delta e intervalo: delta incoerente, um sem o outro, sem medidor, confiável sem delta positivo.
    await recusa(db, ATUALIZA(A1, 'medidor_leitura_anterior = 100, medidor_delta = 25'), '23514', 'AbastecimentoBem_intervalo_check');
    await recusa(db, ATUALIZA(A1, 'medidor_leitura_anterior = 100'), '23514', 'AbastecimentoBem_intervalo_check');
    await recusa(db, ATUALIZA(A1, 'medidor_delta = 20'), '23514', 'AbastecimentoBem_intervalo_check');
    await recusa(db, ATUALIZA(A1, 'medidor_leitura_anterior = -5, medidor_delta = 125'), '23514', 'AbastecimentoBem_intervalo_check');
    await recusa(db, ATUALIZA(A2, 'medidor_leitura_anterior = 0, medidor_delta = 0'), '23514', 'AbastecimentoBem_intervalo_check');
    await recusa(db, ATUALIZA(A1, 'intervalo_confiavel = true'), '23514', 'AbastecimentoBem_intervalo_check');
    await recusa(db, ATUALIZA(A1, 'medidor_leitura_anterior = 120, medidor_delta = 0, intervalo_confiavel = true'), '23514', 'AbastecimentoBem_intervalo_check');
    await recusa(db, ATUALIZA(A1, 'medidor_leitura_anterior = 130, medidor_delta = -10, intervalo_confiavel = true'), '23514', 'AbastecimentoBem_intervalo_check');
    // FKs compostas pela empresa: apontamento inexistente, atividade de outro cliente, centro de outra fazenda.
    await recusa(db, ATUALIZA(A1, `atividade_id = '${ATV}', apontamento_id = 'inexistente'`), '23503', 'AbastecimentoBem_apontamento_fkey');
    await recusa(db, ATUALIZA(A3, `atividade_id = '${ATV}'`), '23503', 'AbastecimentoBem_atividade_fkey');
    await recusa(db, ATUALIZA(A1, `centro_custo_id = '${CC_E2}'`), '23503', 'AbastecimentoBem_centro_custo_fkey');
    // RESTRICT: o apontamento e o centro com abastecimento ligado não saem.
    await assert.rejects(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(ATUALIZA(A1, `atividade_id = '${ATV}', apontamento_id = '${AP}'`));
      await tx.$executeRawUnsafe(`DELETE FROM "AtividadeApontamento" WHERE id = '${AP}'`);
    }), (e) => /23503|AbastecimentoBem_apontamento_fkey/.test(`${e.message} ${JSON.stringify(e.meta ?? {})}`));
    await recusa(db, `DELETE FROM "CentroCusto" WHERE id = '${CC1}'`, '23503');
    // Nada ficou.
    assert.deepEqual(await retrato(db), antes);
  });

  test('AA-07 reaplicar o migration.sql (psql, uma transação) é recusado pela guarda (as colunas já existem) e NADA muda; a 2ª execução do runner do dia não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /guarda: o abastecimento não está no formato anterior/);
    assert.deepEqual(await retrato(db), antes);
    const segunda = await runnerDoDia(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
  });
});

describe('D-PROD-211 — ordem de produção com a D-PROD-213 (posterior)', () => {
  test('AA-08 num banco à parte com a mesma partida: esta pelo runner do dia (62/0) e depois, pelo runner do repositório com o alvo conferido, só a D-PROD-213 pende; sem a decisão exata recusa antes de qualquer DDL; com ela, 63/0, 94 tabelas e migrate diff vazio', async () => {
    const url = await clonar(`${PREFIXO}_aba_ordem`);
    const dbo = new PrismaClient({ datasourceUrl: url });
    try {
      const conferencia = { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID };
      // Com as pastas do repositório, as duas pendem juntas: nem a decisão desta passa.
      const juntas = await aplicarPeloRunner(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      assert.equal(juntas.status, 1, juntas.saida);
      assert.ok(juntas.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_REFORCO} (D-PROD-213).`), juntas.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [61, 0]);
      const dia = await runnerDoDia(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      assert.equal(dia.status, 0, dia.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [62, 0]);
      const semDecisao = await aplicarPeloRunner(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      assert.equal(semDecisao.status, 1, semDecisao.saida);
      assert.ok(semDecisao.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_REFORCO} (D-PROD-213).`), semDecisao.saida);
      assert.match(semDecisao.saida, /Nenhuma migration foi executada/);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [62, 0]);
      const r = await aplicarPeloRunner(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-213' } });
      assert.equal(r.status, 0, r.saida);
      assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME_REFORCO} (D-PROD-213).`), r.saida);
      assert.ok(r.saida.includes(`Applying migration \`${NOME_REFORCO}\``), r.saida);
      assert.ok(!r.saida.includes(`Applying migration \`${NOME}\``), r.saida);
      assert.ok(!vazou(r.saida, url));
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [63, 0]);
      assert.equal((await retrato(dbo)).tabelas.split(',').length, 94);
      const diff = await migrateDiff(url);
      assert.equal(diff.status, 0, diff.saida);
    } finally {
      await dbo.$disconnect();
      await apagar(`${PREFIXO}_aba_ordem`);
    }
  });
});

describe('D-PROD-211 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
  let dbB;
  let partidaB;
  before(async () => {
    dbB = new PrismaClient({ datasourceUrl: URL_B });
    partidaB = await retrato(dbB);
  });
  after(async () => {
    await dbB?.$disconnect();
  });

  test('TB-01 o envelope com o system_identifier de produção (texto do runbook intacto) recusa: alvo divergente, nada aplicado', async () => {
    const r = await consulta(URL_B, envelope());
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /RELEASE_BLOCKED: alvo divergente/);
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-02 histórico fora de 61/0 (uma revertida ou uma em aberto), a anterior (D-PROD-210) com checksum divergente ou uma coluna nova já presente recusa antes do DDL; restaurado, nada mudou', async () => {
    const tentar = async (esperado) => {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, esperado);
    };
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 60 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    }
    await dbB.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('aba-aberta', 'x', '20261199000000_aberta', now(), 0)`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 61 concluídas e 1 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'aba-aberta'`);
    }
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${NOME_ANTERIOR}'`);
    try {
      await tentar(/RELEASE_BLOCKED: a anterior \(D-PROD-210\) ausente ou com checksum divergente/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${CHECKSUM_ANTERIOR}' WHERE migration_name = '${NOME_ANTERIOR}'`);
    }
    await dbB.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" ADD COLUMN "intervalo_confiavel" BOOLEAN`);
    try {
      await tentar(/RELEASE_BLOCKED: AbastecimentoBem já tem coluna nova/);
      // E o preflight diz PARAR na linha das colunas novas.
      const q = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
      assert.deepEqual([q['colunas novas já presentes em AbastecimentoBem (tem de ser 0)'].valor, q['colunas novas já presentes em AbastecimentoBem (tem de ser 0)'].status], ['1', 'PARAR']);
      assert.match(q.VEREDITO.valor, /^PARAR/);
    } finally {
      await dbB.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" DROP COLUMN "intervalo_confiavel"`);
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (61 → 62, checksum = SHA-256 do arquivo, applied_steps_count 1); o mesmo schema do runner; postcheck APLICADA; o Prisma do dia não vê pendência; o do repositório sobe a D-PROD-213 e o migrate diff fica vazio', async () => {
    const pre = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
    assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);

    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.equal(r.status, 0, r.stderr);
    const h = await historico(dbB);
    assert.deepEqual([h.concluidas, h.abertas, h.esta, h.linhas_esta], [ANTERIORES.length + 1, 0, 1, 1]);
    const linha = await um(dbB, `SELECT checksum, applied_steps_count::int AS passos, logs, finished_at IS NOT NULL AS concluida FROM _prisma_migrations WHERE migration_name = '${NOME}'`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1, logs: null, concluida: true });

    // O mesmo schema e os mesmos dados que o runner deixou no outro banco.
    const b = await retrato(dbB);
    const t = await retrato(db);
    assert.deepEqual([b.tabelas, b.constraints, b.indices, b.politicas, b.colunas], [t.tabelas, t.constraints, t.indices, t.politicas, t.colunas]);
    const dados = (x) => x.abastecimentos.split('\n').map((l) => { const o = JSON.parse(l); delete o.updatedAt; delete o.createdAt; delete o.cancelado_em; return o; });
    assert.deepEqual(dados(b), dados(t));

    const pos = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);

    const runner = await runnerDoDia(URL_B);
    assert.equal(runner.status, 0, runner.saida);
    assert.match(runner.saida, /No pending migrations to apply/);
    soDiferencaDoReforco(await migrateDiff(URL_B));
    // D-PROD-213 (ver o cabeçalho): o runner do repositório (alvo local, sem a conferência) sobe a posterior; o schema bate.
    const hoje = await aplicarPeloRunner(URL_B);
    assert.equal(hoje.status, 0, hoje.saida);
    assert.ok(hoje.saida.includes(`Applying migration \`${NOME_REFORCO}\``), hoje.saida);
    assert.ok(!hoje.saida.includes(`Applying migration \`${NOME}\``), hoje.saida);
    const diff = await migrateDiff(URL_B);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('TB-04 repetir o envelope recusa (migration já registrada) e nada muda', async () => {
    const antes = await retrato(dbB);
    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /RELEASE_BLOCKED: migration já registrada/);
    assert.deepEqual(await retrato(dbB), antes);
  });
});
