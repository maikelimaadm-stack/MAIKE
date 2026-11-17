/**
 * D-PROD-217 — a migration CONTRACT `20261117100000_abastecimento_fk_apontamento_atividade` (o reforço da D-PROD-211:
 * o apontamento gravado no abastecimento tem de ser DA atividade gravada nele; UNIQUE (cliente_id, empresa_id,
 * atividade_id, id) em AtividadeApontamento e a FK "AbastecimentoBem_apontamento_fkey" recriada, com o mesmo nome, com
 * 4 colunas) de ponta a ponta, contra PostgreSQL real, em bancos PRÓPRIOS criados e apagados por este teste (o banco da
 * suíte não é tocado; os nomes começam pelo nome do banco da suíte).
 *
 * Partida (banco MODELO): as 64 migrations de nome ANTERIOR a esta (a partida da aplicação em produção, em 2026-11-17,
 * na mesma ordem: a CONTRACT D-PROD-211, a EXPAND D-PROD-215, `20261116500000_cadculturas`, e, por último, a CONTRACT
 * aditiva D-PROD-216, `20261117000000_area_cultura`), pelo Prisma a partir de uma cópia temporária, e sementes em SQL cru: 2 clientes; no 1º, duas atividades, cada uma com
 * um lançamento (apontamento), um trator, o tanque, o diesel aceito, um local, os movimentos e 3 abastecimentos (um
 * ESTOQUE ligado ao apontamento da PRÓPRIA atividade, um ESTOQUE sem vínculo e um EXTERNO sem vínculo); no 2º, um
 * abastecimento ESTOQUE sem vínculo. Os bancos do teste são cópias dele (CREATE DATABASE … TEMPLATE).
 *
 * A brecha (antes): as duas FKs da D-PROD-211 são independentes, e o banco ACEITA um abastecimento cujo apontamento é
 * de OUTRA atividade (só o servidor deriva a atividade do apontamento).
 *
 * Schema × banco: o schema.prisma do repositório já é o desta release: o `migrate diff` da partida acusa só a diferença
 * do reforço (exit 2) e, depois, fica vazio.
 *
 * RED (num banco NOVO, recusado pela guarda `guarda: …` e NADA muda): um abastecimento ligado a apontamento de outra
 * atividade; a FK já com 4 colunas, o UNIQUE já presente ou o CHECK da atividade ausente. E o runner com a conferência
 * de alvo exigida e SEM MIGRATION_CONTRACT_AUTORIZADO=D-PROD-217 exato recusa antes de qualquer DDL.
 *
 * Concorrência: a transação do app na ordem da confirmação do abastecimento (lê o apontamento, depois grava o
 * abastecimento) não fecha deadlock com a migration: a guarda já trava "AtividadeApontamento" em ACCESS EXCLUSIVE (o
 * modo que o DROP CONSTRAINT pede nela), espera o app sem segurar "AbastecimentoBem" e aplica depois do COMMIT dele.
 *
 * GREEN pelo runner oficial (alvo conferido + decisão exata): 65/0, 95 tabelas, só a FK do apontamento (recriada, 4
 * colunas) e o UNIQUE novo mudam, nenhum dado; o banco RECUSA (23503) o apontamento de outra atividade e aceita o
 * vínculo certo e os abastecimentos sem vínculo (ESTOQUE e EXTERNO); RESTRICT e o CASCADE da atividade do apontamento;
 * `migrate diff` vazio e o postcheck do runbook APLICADA; reaplicar o arquivo é recusado pela guarda sem mudar nada; 2ª
 * execução sem pendência.
 *
 * Caminho B: o preflight, o envelope e o postcheck de `MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md` (entre os
 * marcadores `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local: o envelope com o de
 * produção recusa; histórico fora de 64/0, a D-PROD-216 (a anterior) ou a D-PROD-211 com outro checksum ou o UNIQUE já
 * presente recusa antes do DDL; o envelope aplica (64 → 65, checksum = SHA-256 do arquivo, applied_steps_count 1, o mesmo schema do runner), o Prisma
 * não vê pendência, `migrate diff` vazio e o postcheck APLICADA; repetir o envelope recusa.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { criarEspelhoDoRunner } from './espelhoDoRunner.mjs';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

// Só o cliente Prisma da suíte (para criar e apagar os bancos próprios), sem os helpers: eles carregam o app inteiro,
// e este teste não depende de rota nem de serviço.
import { closePrismaClient, getPrismaClient } from '../src/database/prismaClient.js';
import { motivoAlvoProtegido } from '../../scripts/auth/alvoProtegido.mjs';
import {
  MIGRATIONS_APROVADAS, MIGRATIONS_CONTRACT_APROVADAS, classificarMigrations, conferirHistoricoRemoto, contractsPendentes,
} from '../../scripts/deploy/premergeMigrateLib.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const NOME = '20261117100000_abastecimento_fk_apontamento_atividade';
const DECISAO = 'D-PROD-217';
const ARQUIVO = join(MIGRATIONS, NOME, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** D-PROD-216: a anterior, a última que produção concluiu antes desta (o preflight e o envelope conferem o checksum dela). */
const NOME_ANTERIOR = '20261117000000_area_cultura';
const CHECKSUM_ANTERIOR = 'e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26';
/** D-PROD-215: a EXPAND do Cadastro de Culturas, entre a D-PROD-211 e a anterior. */
const NOME_CULTURAS = '20261116500000_cadculturas';
/** D-PROD-211: o vínculo que este reforço completa, concluída antes da D-PROD-215 (o preflight e o envelope também a conferem). */
const NOME_ABASTECIMENTO = '20261116300000_abastecimento_atividade';
const CHECKSUM_ABASTECIMENTO = '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436';
/** Pastas do repositório: a partida é o que vem ANTES desta (a partida de produção); o GREEN, todas (produção hoje). */
/** D-PROD-219: a EXPAND da Medição de Forragem veio depois desta (a 66ª); os testes são "no dia desta", com o espelho do runner. */
const NOME_MEDICAO_FORRAGEM = '20261117200000_medicao_forragem';
const NOME_DIAS_DESCANSO = '20261117300000_cultura_dias_descanso'; // D-PROD-223: EXPAND, coluna em CADCULTURAS, depois da D-PROD-219.
const PASTAS_HOJE = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const PASTAS = Object.freeze(PASTAS_HOJE.filter((n) => n <= NOME));
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME));
const TOTAL_MIGRATIONS = PASTAS.length;
const FK = 'AbastecimentoBem_apontamento_fkey';
const UNICO = 'AtividadeApontamento_empresa_atividade_id_key';
const FK_ANTES = `${FK}:FOREIGN KEY (cliente_id, empresa_id, apontamento_id) REFERENCES "AtividadeApontamento"(cliente_id, empresa_id, id) ON UPDATE CASCADE ON DELETE RESTRICT`;
const FK_DEPOIS = `${FK}:FOREIGN KEY (cliente_id, empresa_id, atividade_id, apontamento_id) REFERENCES "AtividadeApontamento"(cliente_id, empresa_id, atividade_id, id) ON UPDATE CASCADE ON DELETE RESTRICT`;
const UNICO_DEPOIS = `${UNICO}:CREATE UNIQUE INDEX "${UNICO}" ON public."AtividadeApontamento" USING btree (cliente_id, empresa_id, atividade_id, id)`;
/** O `migrate diff` da partida contra o schema.prisma de hoje: só o reforço. */
const DIFERENCA_DO_REFORCO = [
  '[*] Changed the `AbastecimentoBem` table',
  '  [-] Removed foreign key on columns (cliente_id, empresa_id, apontamento_id)',
  '  [+] Added foreign key on columns (cliente_id, empresa_id, atividade_id, apontamento_id)',
  '',
  '[*] Changed the `AtividadeApontamento` table',
  '  [+] Added unique index on columns (cliente_id, empresa_id, atividade_id, id)',
].join('\n');

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const C1 = 'afk-c1';
const C2 = 'afk-c2';
const E1 = `${C1}-e1`;
const U1 = `${C1}-u1`;
/** Duas atividades da mesma fazenda, cada uma com o seu lançamento (apontamento). */
const ATV1 = `${C1}-atv1`;
const ATV2 = `${C1}-atv2`;
const AP1 = `${C1}-ap1`;
const AP2 = `${C1}-ap2`;
/** ESTOQUE ligado a AP1 (da ATV1), ESTOQUE sem vínculo, EXTERNO sem vínculo, e o ESTOQUE sem vínculo do 2º cliente. */
const A1 = `${C1}-a1`;
const A2 = `${C1}-a2`;
const A3 = `${C1}-a3`;
const A4 = `${C2}-a1`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-217: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
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
/** D-PROD-219: o schema.prisma já tem a MedicaoForragem (posterior a esta): os blocos dela saem do diff "no dia desta". */
const semMedicao = (texto) => texto.trim().split(/\n\s*\n/).filter((b) => !b.includes('MEDICAOFORRAGEM')).join('\n\n').trim();
/** D-PROD-219: o runner oficial no espelho com as pastas até esta (no dia dela); criado no `before`. */
let ESPELHO_217;
const runnerAte217 = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_217,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });

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
  const dir = mkdtempSync(join(tmpdir(), 'maike-afk-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of ANTERIORES) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-217: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Um abastecimento novo no trator do 1º cliente: `vinculo` = [atividade, apontamento] (SQL cru ou NULL); `externo` sem local/movimento. */
const novo = (id, { atividade = 'NULL', apontamento = 'NULL', externo = false, movimento = `'${C1}-mv4'` } = {}) =>
  `INSERT INTO "AbastecimentoBem" (id, cliente_id, empresa_id, numero, status, bem_id, tanque_id, produto_id, local_estoque_id, data_operacional,
     quantidade, unidade, custo_total, custo_unitario, medidor_tipo, medidor_unidade, medidor_leitura, medidor_origem, operation_id,
     movimentacao_estoque_id, origem, atividade_id, apontamento_id, "updatedAt")
   VALUES ('${id}', '${C1}', '${E1}', '${id}', 'CONFIRMADO', '${C1}-b1', '${C1}-tq1', '${C1}-p1', ${externo ? 'NULL' : `'${C1}-l1'`}, '2026-11-15', 40, 'L', 250, 6.25,
     'HORIMETRO', 'h', 140, 'ABASTECIMENTO', 'op-${id}-0001', ${externo ? 'NULL' : movimento}, '${externo ? 'EXTERNO' : 'ESTOQUE'}', ${atividade}, ${apontamento}, now())`;

/** Sementes em SQL cru (a partida já tem as colunas da D-PROD-211). */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C1}', 'afk1', 'Cliente AFK', now()), ('${C2}', 'afk2', 'Cliente AFK 2', now())`);
  await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES
    ('${E1}', '${C1}', 1, 'F1', 'Fazenda 1', now()), ('${C2}-e1', '${C2}', 1, 'G1', 'Granja 1', now())`);
  await ins(`INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, "updatedAt") VALUES ('${U1}', '${C1}', 'Operador', 'operador.afk', 'x', now())`);
  await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${C1}-g1', '${C1}', 'Tratos', now())`);
  await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, "updatedAt") VALUES ('${C1}-t1', '${C1}', 'GRADEAR', '${C1}-g1', 'Tratos', now())`);
  await ins(`INSERT INTO "Atividade" (id, cliente_id, empresa_id, numero, nome, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id, grupo_atividade_nome,
      data_inicio, criado_por_usuario_id, "updatedAt") VALUES
    ('${ATV1}', '${C1}', '${E1}', '1', 'GRADEAÇÃO PASTO 01', '${C1}-t1', 'GRADEAR', '${C1}-g1', 'Tratos', '2026-11-14', '${U1}', now()),
    ('${ATV2}', '${C1}', '${E1}', '2', 'GRADEAÇÃO PASTO 02', '${C1}-t1', 'GRADEAR', '${C1}-g1', 'Tratos', '2026-11-14', '${U1}', now())`);
  await ins(`INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, operador_usuario_id, criado_por_usuario_id, "updatedAt") VALUES
    ('${AP1}', '${C1}', '${E1}', '${ATV1}', '2026-11-14', 1, '${U1}', '${U1}', now()),
    ('${AP2}', '${C1}', '${E1}', '${ATV2}', '2026-11-14', 1, '${U1}', '${U1}', now())`);
  for (const [c, e] of [[C1, E1], [C2, `${C2}-e1`]]) {
    await ins(`INSERT INTO "FamiliaPatrimonial" (id, cliente_id, codigo, nome, natureza, "updatedAt") VALUES ('${c}-fm', '${c}', 'TRATORES', 'Tratores', 'MAQUINA', now())`);
    await ins(`INSERT INTO "TipoPatrimonial" (id, cliente_id, familia_id, codigo, nome, "updatedAt") VALUES ('${c}-tm', '${c}', '${c}-fm', 'TRATOR', 'Trator', now())`);
    await ins(`INSERT INTO "BemPatrimonial" (id, cliente_id, empresa_id, numero, nome, natureza, familia_id, tipo_id, medidor_tipo, medidor_unidade,
        medidor_leitura_inicial, medidor_leitura_atual, medidor_data_leitura, medidor_origem, "updatedAt") VALUES
      ('${c}-b1', '${c}', '${e}', '1', 'Trator 01', 'MAQUINA', '${c}-fm', '${c}-tm', 'HORIMETRO', 'h', 100, 100, '2026-11-01', 'CADASTRO_INICIAL', now())`);
    await ins(`INSERT INTO "TanqueBem" (id, cliente_id, bem_id, identificador, capacidade_litros, "updatedAt") VALUES ('${c}-tq1', '${c}', '${c}-b1', 'PRINCIPAL', 200, now())`);
    await ins(`INSERT INTO "Produto" (id, cliente_id, empresa_id, numero_produto, nome_produto, unidade_principal_estoque, estoque_atual, "updatedAt")
      VALUES ('${c}-p1', '${c}', '${e}', '1', 'DIESEL S10', 'L', 500, now())`);
    await ins(`INSERT INTO "TanqueBemProduto" (id, cliente_id, tanque_id, produto_id, "updatedAt") VALUES ('${c}-ac1', '${c}', '${c}-tq1', '${c}-p1', now())`);
    await ins(`INSERT INTO "LocalEstoque" (id, cliente_id, numero_local, nome, "updatedAt") VALUES ('${c}-l1', '${c}', '1', 'TANQUE DA SEDE', now())`);
    await ins(`INSERT INTO "MovimentacaoEstoque" (id, cliente_id, empresa_id, numero_movimentacao, tipo_movimentacao, data_movimentacao, produto_id, quantidade,
        unidade_medida, valor_unitario, valor_total, "updatedAt") VALUES
      ('${c}-mv1', '${c}', '${e}', '1', 'Saída', '2026-11-14 12:00:00', '${c}-p1', 50, 'L', 6, 300, now()),
      ('${c}-mv2', '${c}', '${e}', '2', 'Saída', '2026-11-14 13:00:00', '${c}-p1', 10, 'L', 6, 60, now()),
      ('${c}-mv4', '${c}', '${e}', '4', 'Saída', '2026-11-14 15:00:00', '${c}-p1', 5, 'L', 6, 30, now())`);
  }
  await ins(`INSERT INTO "AbastecimentoBem" (id, cliente_id, empresa_id, numero, status, bem_id, tanque_id, produto_id, local_estoque_id, data_operacional,
       quantidade, unidade, custo_total, custo_unitario, medidor_tipo, medidor_unidade, medidor_leitura, medidor_origem, operation_id,
       movimentacao_estoque_id, origem, atividade_id, apontamento_id, "updatedAt") VALUES
     ('${A1}', '${C1}', '${E1}', '1', 'CONFIRMADO', '${C1}-b1', '${C1}-tq1', '${C1}-p1', '${C1}-l1', '2026-11-14', 50, 'L', 300, 6,
      'HORIMETRO', 'h', 120, 'ABASTECIMENTO', 'op-afk-a1-0001', '${C1}-mv1', 'ESTOQUE', '${ATV1}', '${AP1}', now()),
     ('${A2}', '${C1}', '${E1}', '2', 'CONFIRMADO', '${C1}-b1', '${C1}-tq1', '${C1}-p1', '${C1}-l1', '2026-11-14', 10, 'L', 60, 6,
      'HORIMETRO', 'h', 125, 'ABASTECIMENTO', 'op-afk-a2-0001', '${C1}-mv2', 'ESTOQUE', NULL, NULL, now()),
     ('${A3}', '${C1}', '${E1}', '3', 'CONFIRMADO', '${C1}-b1', '${C1}-tq1', '${C1}-p1', NULL, '2026-11-14', 30, 'L', 190, 6.3333,
      'HORIMETRO', 'h', 130, 'ABASTECIMENTO', 'op-afk-a3-0001', NULL, 'EXTERNO', NULL, NULL, now()),
     ('${A4}', '${C2}', '${C2}-e1', '1', 'CONFIRMADO', '${C2}-b1', '${C2}-tq1', '${C2}-p1', '${C2}-l1', '2026-11-14', 50, 'L', 300, 6,
      'HORIMETRO', 'h', 130, 'ABASTECIMENTO', 'op-afk-a4-0001', '${C2}-mv1', 'ESTOQUE', NULL, NULL, now())`);
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
  (SELECT string_agg(row_to_json(p)::text, E'\\n' ORDER BY p.id) FROM "AtividadeApontamento" p) AS apontamentos,
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
/** Executa os SQLs numa transação desfeita no fim (ROLLBACK): passa se TODOS forem aceitos; nada fica. Devolve o que `ler` leu antes do ROLLBACK. */
const aceita = async (db, sqls, ler) => {
  const ROLLBACK = new Error('rollback intencional');
  let lido;
  await assert.rejects(db.$transaction(async (tx) => {
    for (const sql of sqls) await tx.$executeRawUnsafe(sql);
    if (ler) lido = await tx.$queryRawUnsafe(ler);
    throw ROLLBACK;
  }), (e) => {
    assert.equal(e, ROLLBACK, `${sqls.join(';\n')}\n→ ${e.message}`);
    return true;
  });
  return lido;
};
const ATUALIZA = (id, set) => `UPDATE "AbastecimentoBem" SET ${set} WHERE id = '${id}'`;

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
  const banco = `${PREFIXO}_afk_${sufixo}`;
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
  ESPELHO_217 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME }).dir;
  PREFIXO = new URL(BASE_URL).pathname.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'maike';
  BANCO_MODELO = `${PREFIXO}_afk_modelo`;
  for (const b of [`${PREFIXO}_afk`, `${PREFIXO}_afk_b`, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(comBanco(BASE_URL, BANCO_MODELO));
  const modelo = new PrismaClient({ datasourceUrl: comBanco(BASE_URL, BANCO_MODELO) });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  URL_T = await clonar(`${PREFIXO}_afk`);
  URL_B = await clonar(`${PREFIXO}_afk_b`);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  if (ESPELHO_217) rmSync(ESPELHO_217, { recursive: true, force: true });
  for (const b of [`${PREFIXO}_afk`, `${PREFIXO}_afk_b`, BANCO_MODELO]) if (PREFIXO) await apagar(b);
  await closePrismaClient();
});

describe('D-PROD-217 — migration CONTRACT do reforço da FK do apontamento do abastecimento (PostgreSQL real)', () => {
  test('AF-01 partida: as 64 migrations de nome anterior a esta (a D-PROD-211, a D-PROD-215 e, por último, a D-PROD-216), 95 tabelas, a FK de 3 colunas; o banco ainda ACEITA o apontamento de outra atividade; schema × banco acusa só o reforço; o preflight do runbook diz PRONTO e, com o system_identifier de produção, PARAR', async () => {
    assert.equal(ANTERIORES.length, 64, 'a partida de produção: 64 migrations');
    assert.deepEqual(ANTERIORES.slice(-3), [NOME_ABASTECIMENTO, NOME_CULTURAS, NOME_ANTERIOR], 'a ordem dos nomes é a de produção: a D-PROD-211, a D-PROD-215 e depois a D-PROD-216');
    assert.equal(PASTAS.at(-1), NOME, 'no dia desta, era a migration de nome mais recente');
    assert.equal(TOTAL_MIGRATIONS, 65);
    assert.deepEqual(PASTAS_HOJE.filter((n) => n > NOME), [NOME_MEDICAO_FORRAGEM, NOME_DIAS_DESCANSO], 'D-PROD-219: só a Medição de Forragem tem nome posterior a esta');
    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [64, 0, 0]);
    assert.equal(partida.tabelas.split(',').length, 95);
    assert.ok(partida.tabelas.split(',').includes('CADCULTURAS'));
    const { checksum } = await um(db, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_ANTERIOR}'`);
    assert.equal(checksum, CHECKSUM_ANTERIOR, 'a anterior com o checksum que produção registrou');
    const { checksum: checksum211 } = await um(db, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_ABASTECIMENTO}'`);
    assert.equal(checksum211, CHECKSUM_ABASTECIMENTO, 'a D-PROD-211 com o checksum que produção registrou');
    assert.ok(partida.constraints.split('\n').includes(FK_ANTES), 'a FK do apontamento é a de 3 colunas');
    assert.ok(!partida.indices.includes(UNICO));
    // A brecha: o abastecimento ligado à ATV1 com o apontamento da ATV2 entra (numa transação desfeita, nada fica).
    await aceita(db, [ATUALIZA(A1, `apontamento_id = '${AP2}'`)]);
    await aceita(db, [novo(`${C1}-x0`, { atividade: `'${ATV1}'`, apontamento: `'${AP2}'` })]);
    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 2, diff.saida);
    assert.equal(semMedicao(diff.stdout), DIFERENCA_DO_REFORCO, 'o schema.prisma já é o desta release (com a D-PROD-219 depois): só o reforço aparece');

    const q = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const [item, v] of Object.entries(q)) if (item !== 'VEREDITO') assert.ok(v.status === 'OK' || v.status.startsWith('ATENÇÃO'), `${item}: ${v.status} (${v.valor})`);
    for (const [item, v] of Object.entries(q)) if (!/^(VEREDITO|travas|transações)/.test(item)) assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.equal(q['migrations concluídas / em aberto'].valor, '64 / 0');
    assert.equal(q['a anterior (D-PROD-216, area_cultura) concluída com o checksum do repositório'].valor, '1');
    assert.equal(q['a D-PROD-211 (abastecimento ligado à atividade) concluída com o checksum do repositório'].valor, '1');
    assert.equal(q['FK AbastecimentoBem_apontamento_fkey ainda a de 3 colunas'].valor, '1');
    assert.equal(q['UNIQUE AtividadeApontamento_empresa_atividade_id_key já presente (tem de ser 0)'].valor, '0');
    assert.equal(q['CHECK AbastecimentoBem_atividade_check (apontamento ⇒ atividade) presente'].valor, '1');
    // 4 abastecimentos; 1 ligado (A1, ao apontamento da própria atividade); nenhum de outra atividade.
    assert.equal(q['abastecimentos / ligados a apontamento / ligados a apontamento de OUTRA atividade'].valor, '4 / 1 / 0');
    assert.equal(q['tabelas em public'].valor, '95');
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    const producao = quadro(await consulta(URL_T, blocoDoRunbook('preflight')));
    assert.equal(producao['alvo: system_identifier'].status, 'PARAR');
    assert.match(producao.VEREDITO.valor, /^PARAR/);
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    assert.match(pos.VEREDITO.valor, /^PARAR/);
    assert.equal(pos['FK AbastecimentoBem_apontamento_fkey com 4 colunas (com a atividade), RESTRICT, validada'].status, 'PARAR');
    assert.deepEqual(await retrato(db), partida, 'o preflight e o postcheck só leem');
  });

  test('AF-02 o portão: o classificador diz CONTRACT D-PROD-217 sem violação, o arquivo e a guarda são os pinados; o histórico real da partida confere com só esta pendente, e é a CONTRACT a autorizar', async () => {
    const c = classificarMigrations([{ nome: NOME, sql: SQL_MIGRATION }]);
    assert.deepEqual(c.violacoes, []);
    assert.deepEqual([c.ok, c.expand, c.modo], [true, false, 'CONTRACT']);
    assert.deepEqual(c.tabelas_novas, []);
    assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
    assert.equal(c.contract.length, 1);
    assert.equal(c.contract[0].decisao, DECISAO);
    assert.deepEqual(c.contract[0].tabelas_removidas, []);
    assert.deepEqual(c.contract[0].constraints_alargadas, [`AbastecimentoBem.${FK}`]);
    assert.deepEqual([c.contract[0].colunas_adicionadas, c.contract[0].constraints_adicionadas, c.contract[0].colunas_removidas, c.contract[0].conversoes], [[], [], [], []]);
    assert.equal(MIGRATIONS_APROVADAS[NOME], CHECKSUM);
    assert.equal(MIGRATIONS_CONTRACT_APROVADAS[NOME].decisao, DECISAO);
    assert.equal(CHECKSUM, '1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e');
    assert.doesNotMatch(SQL_MIGRATION, /D-PROD-\d+/, 'o número da decisão fica fora do arquivo');

    const linhas = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    const locais = PASTAS.map((n) => ({ nome: n, checksum: createHash('sha256').update(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8')).digest('hex') }));
    assert.deepEqual(conferirHistoricoRemoto({ locais, linhas }), { ok: true, codigo: null, pendentes: [NOME], falhas: [] });
    assert.deepEqual(contractsPendentes({ locais: PASTAS, linhas }), [{ nome: NOME, decisao: DECISAO }]);
  });

  test('AF-RED-1 um abastecimento ligado a apontamento de OUTRA atividade (num banco novo) → a guarda recusa e NADA muda; o runner local também falha na guarda', async () => {
    await emBancoNovo('r1', async (dbr, url) => {
      // A1 continua na ATV1, mas com o apontamento da ATV2 (o banco de hoje aceita).
      await dbr.$executeRawUnsafe(ATUALIZA(A1, `apontamento_id = '${AP2}'`));
      const antes = await retrato(dbr);
      const r = await aplicarArquivo(url);
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, /guarda: há abastecimento ligado a um apontamento de outra atividade/);
      assert.deepEqual(await retrato(dbr), antes, 'nada da migration ficou');
      // O preflight diz PARAR na linha do conteúdo.
      const q = quadro(await consulta(url, comSidLocal(blocoDoRunbook('preflight'), SID)));
      const linha = q['abastecimentos / ligados a apontamento / ligados a apontamento de OUTRA atividade'];
      assert.deepEqual([linha.valor, linha.status], ['4 / 1 / 1', 'PARAR']);
      assert.match(q.VEREDITO.valor, /^PARAR/);
      const runner = await aplicarPeloRunner(url);
      assert.notEqual(runner.status, 0, runner.saida);
      assert.match(runner.saida, /guarda: há abastecimento ligado a um apontamento de outra atividade/);
      const depois = await retrato(dbr);
      assert.deepEqual([depois.constraints, depois.indices, depois.colunas, depois.abastecimentos], [antes.constraints, antes.indices, antes.colunas, antes.abastecimentos]);
    });
  });

  test('AF-RED-2 o UNIQUE novo já presente, a FK já com 4 colunas ou o CHECK da atividade ausente (num banco novo) → a guarda recusa no formato e NADA muda', async () => {
    await emBancoNovo('r2', async (dbr, url) => {
      const tentar = async () => {
        const antes = await retrato(dbr);
        const r = await aplicarArquivo(url);
        assert.notEqual(r.status, 0, r.saida);
        assert.match(r.saida, /guarda: o vínculo do abastecimento com o apontamento não está no formato anterior/);
        assert.deepEqual(await retrato(dbr), antes);
      };
      // Só o UNIQUE.
      await dbr.$executeRawUnsafe(`CREATE UNIQUE INDEX "${UNICO}" ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id")`);
      await tentar();
      // O UNIQUE e a FK de 4 colunas (como se já tivesse rodado à mão).
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "${FK}"`);
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "${FK}" FOREIGN KEY ("cliente_id", "empresa_id", "atividade_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE`);
      await tentar();
      // A FK de volta ao formato anterior, sem o UNIQUE, mas sem o CHECK da atividade.
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "${FK}"`);
      await dbr.$executeRawUnsafe(`DROP INDEX "${UNICO}"`);
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" ADD CONSTRAINT "${FK}" FOREIGN KEY ("cliente_id", "empresa_id", "apontamento_id") REFERENCES "AtividadeApontamento"("cliente_id", "empresa_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE`);
      await dbr.$executeRawUnsafe(`ALTER TABLE "AbastecimentoBem" DROP CONSTRAINT "AbastecimentoBem_atividade_check"`);
      await tentar();
    });
  });

  test('AF-RED-3 concorrência (num banco novo): a transação do app que lê o apontamento e DEPOIS toca o abastecimento (a ordem da confirmação do abastecimento) não fecha deadlock com a migration — ela espera o app, que termina, e só então aplica', async () => {
    await emBancoNovo('c1', async (dbr, url) => {
      const NOVO = `${C1}-cc1`;
      let migracao;
      await dbr.$transaction(async (tx) => {
        // 1. O app lê o apontamento (ACCESS SHARE em "AtividadeApontamento" até o COMMIT).
        await tx.$queryRawUnsafe(`SELECT id, atividade_id FROM "AtividadeApontamento" WHERE id = '${AP1}'`);
        // 2. A migration começa e fica esperando a trava de "AtividadeApontamento" (sem segurar "AbastecimentoBem").
        migracao = aplicarArquivo(url);
        let esperando = 0;
        for (let i = 0; i < 100 && esperando === 0; i += 1) {
          await new Promise((r) => setTimeout(r, 20));
          ({ n: esperando } = await um(dbr, `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND relation = '"AtividadeApontamento"'::regclass`));
        }
        assert.equal(esperando, 1, 'a migration espera a trava de "AtividadeApontamento" já na guarda');
        const { n: noAbastecimento } = await um(dbr, `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity s ON s.pid = l.pid
          WHERE l.relation = '"AbastecimentoBem"'::regclass AND s.application_name = 'psql'`);
        assert.equal(noAbastecimento, 0, 'enquanto espera, a migration não segura "AbastecimentoBem"');
        // 3. O app grava o abastecimento (antes, com SHARE ROW EXCLUSIVE na guarda, isto fechava o ciclo: deadlock).
        await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "AbastecimentoBem" WHERE apontamento_id = '${AP1}'`);
        await tx.$executeRawUnsafe(novo(NOVO, { atividade: `'${ATV1}'`, apontamento: `'${AP1}'` }));
      }, { timeout: 20000 });
      // 4. Com o COMMIT do app, a migration segue e aplica (dentro do lock_timeout de 5 s).
      const r = await migracao;
      assert.equal(r.status, 0, r.saida);
      assert.doesNotMatch(r.saida, /deadlock/);
      const depois = await retrato(dbr);
      assert.ok(depois.constraints.split('\n').includes(FK_DEPOIS));
      assert.ok(depois.indices.includes(UNICO));
      assert.ok(depois.abastecimentos.includes(`"id":"${NOVO}"`), 'a gravação do app ficou');
    });
  });

  test('AF-03 runner com a conferência de alvo exigida e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando só a D-PROD-217, antes de qualquer DDL', async () => {
    const linhasAntes = (await um(db, 'SELECT count(*)::int AS n FROM _prisma_migrations')).n;
    // D-PROD-211 é a CONTRACT que o reforço completa e D-PROD-212 não é CONTRACT: nenhuma autoriza esta; nem a decisão em minúsculas.
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-211' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-212' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-216' }, { MIGRATION_CONTRACT_AUTORIZADO: ' D-PROD-217 ' }]) {
      const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, ...extra } });
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

  test('AF-04 GREEN pelo runner oficial (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-217): 65/0, 95 tabelas, só a FK do apontamento (4 colunas, mesmo nome) e o UNIQUE novo mudam; nenhum dado muda; migrate diff vazio', async () => {
    const r = await runnerAte217(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
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
    assert.deepEqual([depois.tabelas, depois.politicas, depois.colunas, depois.abastecimentos, depois.apontamentos],
      [partida.tabelas, partida.politicas, partida.colunas, partida.abastecimentos, partida.apontamentos], 'nenhuma tabela, política, coluna ou dado muda');
    assert.equal(depois.tabelas.split(',').length, 95);
    // Constraints: só a FK do apontamento sai e volta, com o mesmo nome e a atividade.
    const antes = partida.constraints.split('\n');
    const agora = depois.constraints.split('\n');
    assert.deepEqual(antes.filter((c) => !agora.includes(c)), [FK_ANTES]);
    assert.deepEqual(agora.filter((c) => !antes.includes(c)), [FK_DEPOIS]);
    const { invalidas } = await um(db, `SELECT count(*)::int AS invalidas FROM pg_constraint WHERE conrelid = '"AbastecimentoBem"'::regclass AND NOT convalidated`);
    assert.equal(invalidas, 0);
    // Índices: só o UNIQUE novo, começando por cliente_id; nenhum outro muda.
    const indicesAntes = partida.indices.split('\n');
    const indicesAgora = depois.indices.split('\n');
    assert.deepEqual(indicesAntes.filter((i) => !indicesAgora.includes(i)), []);
    assert.deepEqual(indicesAgora.filter((i) => !indicesAntes.includes(i)), [UNICO_DEPOIS]);

    const diff = await migrateDiff(URL_T);
    assert.equal(semMedicao(diff.stdout), '', diff.saida);
  });

  test('AF-05 postcheck do runbook no banco aplicado pelo runner: tudo OK e VEREDITO APLICADA; o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
    assert.equal(pos['migrations concluídas / em aberto'].valor, '65 / 0');
    assert.equal(pos['FK AbastecimentoBem_apontamento_fkey com 4 colunas (com a atividade), RESTRICT, validada'].valor, '1');
    assert.equal(pos['FK AbastecimentoBem_atividade_fkey intacta (3 colunas, RESTRICT)'].valor, '1');
    assert.equal(pos['FKs / CHECKs em "AbastecimentoBem" (nenhuma a mais nem a menos)'].valor, '14 / 10');
    assert.equal(pos['UNIQUE AtividadeApontamento_empresa_atividade_id_key (cliente_id, empresa_id, atividade_id, id)'].valor, '1');
    assert.equal(pos['abastecimentos ligados a apontamento de OUTRA atividade'].valor, '0');
    assert.equal(pos['tabelas em public'].valor, '95');
    const pre = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const item of ['migrations concluídas / em aberto', '20261117100000_abastecimento_fk_apontamento_atividade já registrada', 'FK AbastecimentoBem_apontamento_fkey ainda a de 3 colunas',
      'UNIQUE AtividadeApontamento_empresa_atividade_id_key já presente (tem de ser 0)']) {
      assert.equal(pre[item].status, 'PARAR', item);
    }
    assert.match(pre.VEREDITO.valor, /^PARAR/);
  });

  test('AF-06 o reforço: o banco RECUSA (23503) o apontamento de outra atividade, por UPDATE ou INSERT, e a troca só da atividade; aceita o vínculo certo, a troca do par inteiro e os abastecimentos sem vínculo (ESTOQUE e EXTERNO); o CHECK da atividade segue; RESTRICT no apontamento ligado; mudar a atividade do apontamento leva junto a do abastecimento (CASCADE)', async () => {
    const antes = await retrato(db);
    // Recusadas: apontamento de outra atividade, por UPDATE e por INSERT (ESTOQUE e EXTERNO), e a troca só da atividade.
    await recusa(db, ATUALIZA(A1, `apontamento_id = '${AP2}'`), '23503', FK);
    await recusa(db, ATUALIZA(A1, `atividade_id = '${ATV2}'`), '23503', FK);
    await recusa(db, ATUALIZA(A2, `atividade_id = '${ATV1}', apontamento_id = '${AP2}'`), '23503', FK);
    await recusa(db, novo(`${C1}-x1`, { atividade: `'${ATV1}'`, apontamento: `'${AP2}'` }), '23503', FK);
    await recusa(db, novo(`${C1}-x2`, { atividade: `'${ATV2}'`, apontamento: `'${AP1}'`, externo: true }), '23503', FK);
    // Apontamento inexistente continua recusado; apontamento sem atividade continua no CHECK.
    await recusa(db, ATUALIZA(A2, `atividade_id = '${ATV1}', apontamento_id = 'inexistente'`), '23503', FK);
    await recusa(db, ATUALIZA(A2, `apontamento_id = '${AP1}'`), '23514', 'AbastecimentoBem_atividade_check');
    // Aceitas (numa transação desfeita: nada fica): o par certo, a troca do par inteiro, só a atividade, e os sem vínculo.
    await aceita(db, [ATUALIZA(A2, `atividade_id = '${ATV1}', apontamento_id = '${AP1}'`)]);
    await aceita(db, [ATUALIZA(A1, `atividade_id = '${ATV2}', apontamento_id = '${AP2}'`)]);
    await aceita(db, [ATUALIZA(A1, 'atividade_id = NULL, apontamento_id = NULL')]);
    await aceita(db, [ATUALIZA(A2, `atividade_id = '${ATV2}'`)]);
    await aceita(db, [novo(`${C1}-x3`, { atividade: `'${ATV2}'`, apontamento: `'${AP2}'` })]);
    await aceita(db, [novo(`${C1}-x4`, { atividade: `'${ATV2}'`, apontamento: `'${AP2}'`, externo: true })]);
    await aceita(db, [novo(`${C1}-x5`)]);
    await aceita(db, [novo(`${C1}-x6`, { externo: true })]);
    // RESTRICT: o apontamento com abastecimento ligado não sai.
    await recusa(db, `DELETE FROM "AtividadeApontamento" WHERE id = '${AP1}'`, '23503', FK);
    // ON UPDATE CASCADE: a atividade do apontamento muda e a do abastecimento vai junto (o par continua coerente).
    const [{ atividade_id: cascata }] = await aceita(db, [`UPDATE "AtividadeApontamento" SET atividade_id = '${ATV2}', sequencia = 2 WHERE id = '${AP1}'`],
      `SELECT atividade_id FROM "AbastecimentoBem" WHERE id = '${A1}'`);
    assert.equal(cascata, ATV2);
    // Nada ficou.
    assert.deepEqual(await retrato(db), antes);
  });

  test('AF-07 reaplicar o migration.sql (psql, uma transação) é recusado pela guarda (a FK já tem 4 colunas) e NADA muda; a 2ª execução do runner não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /guarda: o vínculo do abastecimento com o apontamento não está no formato anterior/);
    assert.deepEqual(await retrato(db), antes);
    const segunda = await runnerAte217(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
  });
});

describe('D-PROD-217 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
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

  test('TB-02 histórico fora de 64/0 (uma revertida ou uma em aberto), a anterior (D-PROD-216) ou a D-PROD-211 com checksum divergente ou o UNIQUE novo já presente recusa antes do DDL; restaurado, nada mudou', async () => {
    const tentar = async (esperado) => {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, esperado);
    };
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 63 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    }
    await dbB.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('afk-aberta', 'x', '20261199000000_aberta', now(), 0)`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 64 concluídas e 1 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'afk-aberta'`);
    }
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${NOME_ANTERIOR}'`);
    try {
      await tentar(/RELEASE_BLOCKED: a anterior \(D-PROD-216\) ausente ou com checksum divergente/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${CHECKSUM_ANTERIOR}' WHERE migration_name = '${NOME_ANTERIOR}'`);
    }
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${NOME_ABASTECIMENTO}'`);
    try {
      await tentar(/RELEASE_BLOCKED: a D-PROD-211 ausente ou com checksum divergente/);
      // E o preflight diz PARAR na linha da D-PROD-211.
      const q = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
      const linha = q['a D-PROD-211 (abastecimento ligado à atividade) concluída com o checksum do repositório'];
      assert.deepEqual([linha.valor, linha.status], ['0', 'PARAR']);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${CHECKSUM_ABASTECIMENTO}' WHERE migration_name = '${NOME_ABASTECIMENTO}'`);
    }
    await dbB.$executeRawUnsafe(`CREATE UNIQUE INDEX "${UNICO}" ON "AtividadeApontamento"("cliente_id", "empresa_id", "atividade_id", "id")`);
    try {
      await tentar(/RELEASE_BLOCKED: o UNIQUE novo já existe em AtividadeApontamento/);
      // E o preflight diz PARAR na linha do UNIQUE.
      const q = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
      const linha = q['UNIQUE AtividadeApontamento_empresa_atividade_id_key já presente (tem de ser 0)'];
      assert.deepEqual([linha.valor, linha.status], ['1', 'PARAR']);
      assert.match(q.VEREDITO.valor, /^PARAR/);
    } finally {
      await dbB.$executeRawUnsafe(`DROP INDEX "${UNICO}"`);
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (64 → 65, checksum = SHA-256 do arquivo, applied_steps_count 1); o mesmo schema do runner; postcheck APLICADA; o Prisma não vê pendência; migrate diff vazio', async () => {
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
    assert.deepEqual([b.abastecimentos, b.apontamentos], [partidaB.abastecimentos, partidaB.apontamentos]);

    const pos = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);

    const runner = await runnerAte217(URL_B);
    assert.equal(runner.status, 0, runner.saida);
    assert.match(runner.saida, /No pending migrations to apply/);
    const diff = await migrateDiff(URL_B);
    assert.equal(semMedicao(diff.stdout), '', diff.saida);
  });

  test('TB-04 repetir o envelope recusa (migration já registrada) e nada muda', async () => {
    const antes = await retrato(dbB);
    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /RELEASE_BLOCKED: migration já registrada/);
    assert.deepEqual(await retrato(dbB), antes);
  });
});
