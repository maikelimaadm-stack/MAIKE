/**
 * D-PROD-208 — a migration CONTRACT `20261116000000_mao_obra_parceiro` (ajuste da Fatia 4: o funcionário vira PAPEL do
 * parceiro, com tipo, cargo e custos em colunas anuláveis de "Fornecedor"; a linha de mão de obra aponta para o parceiro,
 * com a origem FUNCIONARIO/TERCEIRO; a tabela "Funcionario", vazia, sai) de ponta a ponta, contra PostgreSQL real, em
 * bancos PRÓPRIOS criados e apagados por este teste (o banco da suíte não é tocado; os nomes começam pelo nome do banco
 * da suíte).
 *
 * Partida (banco MODELO): as 58 migrations de nome ANTERIOR a esta (produção hoje: a última, a EXPAND da Fatia 4,
 * D-PROD-207), pelo Prisma a partir de uma cópia temporária, e sementes em SQL cru: 2 clientes, 2 fazendas no primeiro,
 * uma atividade ABERTA com um apontamento do dia, os parceiros (um prestador e um futuro funcionário na primeira
 * fazenda, um no outro cliente) e os usuários. "Funcionario" e "AtividadeApontamentoMaoObra" VAZIAS, como em produção.
 * Os bancos do teste são cópias dele (CREATE DATABASE … TEMPLATE).
 *
 * Schema × banco: na partida o `migrate diff` contra o schema.prisma acusa a diferença (exit 2); depois, vazio.
 *
 * RED (cada um num banco NOVO, recusado pela guarda `guarda: …` e NADA muda): uma linha em "Funcionario"; uma linha em
 * "AtividadeApontamentoMaoObra" (gravada sem o gatilho da FK, para provar a conferência dela sozinha); e o runner com a
 * conferência de alvo exigida e SEM MIGRATION_CONTRACT_AUTORIZADO=D-PROD-208 exato recusa antes de qualquer DDL.
 *
 * GREEN pelo runner oficial (alvo conferido + decisão exata): 59/0, 94 tabelas (de tenant, 80 → 79), "Funcionario" e
 * `funcionario_id` ausentes, as 6 colunas com o tipo e a nulidade do contrato, os 2 CHECKs (23514), a FK nova pelo
 * tenant e RESTRICT (23503), o índice com `cliente_id` na frente, `migrate diff` vazio e o postcheck do runbook
 * APLICADA; reaplicar o arquivo é recusado pela guarda sem mudar nada; 2ª execução sem pendência.
 *
 * Caminho B: o preflight, o envelope e o postcheck de `MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md` (entre os
 * marcadores `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local: o envelope com o de
 * produção recusa; histórico fora de 58/0, a D-PROD-207 com outro checksum ou uma linha em qualquer das duas tabelas
 * recusa antes do DDL; o envelope aplica (58 → 59, checksum = SHA-256 do arquivo, applied_steps_count 1, o mesmo
 * schema do runner), o Prisma não vê pendência, `migrate diff` vazio e o postcheck APLICADA; repetir o envelope recusa.
 *
 * D-PROD-209: a CONTRACT `20261116100000_funcionario_tipo_terceirizado`, de nome posterior, troca o CHECK de Fornecedor
 * que esta cria (TERCEIRIZADO no lugar de TAREFEIRO). Este teste fica NO DIA DA D-PROD-208: o runner oficial roda sobre
 * um espelho do repositório com só as pastas até esta (`runnerDoDia`, ver `espelhoDoRunner.mjs`), e o CHECK fica o desta
 * (com TAREFEIRO). O schema.prisma não muda com a D-PROD-209 (o Prisma não modela CHECK): o `migrate diff` segue vazio. O
 * MP-08 prova a ordem de produção, num banco à parte: esta pelo runner do dia e depois, pelo runner do repositório com a
 * decisão exata, a D-PROD-209 (60/0, 94 tabelas, o CHECK com TERCEIRIZADO).
 *
 * D-PROD-210: a CONTRACT `20261116200000_formulacao_base_consumo` (base do consumo nas 3 tabelas das Formulações) e
 * D-PROD-211: a CONTRACT `20261116300000_abastecimento_atividade` (o abastecimento ligado à atividade), ainda
 * posteriores, MUDAM o schema.prisma: o `migrate diff` do banco desta (59) e da D-PROD-209 (60) contra o schema.prisma
 * de hoje acusa só as diferenças delas (exit 2). O MP-08 segue a ordem de produção até o fim: esta pelo runner do dia,
 * a D-PROD-209 pelo espelho até ela (`runnerAte209`) com a decisão dela, a D-PROD-210 pelo espelho até ela
 * (`runnerAte210`) com a decisão dela e a D-PROD-211 pelo runner do repositório com a decisão DELA (62/0, 94 tabelas,
 * `migrate diff` vazio). No caminho B, o runner do repositório (alvo local) sobe as três depois do envelope e o
 * `migrate diff` fica vazio. D-PROD-215: a EXPAND `20261116500000_cadculturas` (tabela nova CADCULTURAS), ainda
 * posterior, não pede decisão.
 *
 * D-PROD-216: a CONTRACT aditiva `20261117000000_area_cultura` (a Área ligada à Cultura) e D-PROD-217: a CONTRACT
 * `20261117100000_abastecimento_fk_apontamento_atividade` (o reforço: UNIQUE em AtividadeApontamento e a FK do
 * apontamento de AbastecimentoBem com a atividade), de nomes posteriores ao da CADCULTURAS, também: no MP-08 a
 * D-PROD-211 passa a subir pelo espelho até ela (`runnerAte211`); pelo espelho até a D-PROD-216 (`runnerAte216`), com a
 * decisão dela, a D-PROD-215 (sem decisão) e depois a D-PROD-216; por fim, pelo runner do repositório com a decisão da
 * D-PROD-217, o reforço, a ordem de produção (65/0, 95 tabelas, `migrate diff` vazio). No caminho B, o runner do
 * repositório sobe as seis.
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

const NOME = '20261116000000_mao_obra_parceiro';
const DECISAO = 'D-PROD-208';
const ARQUIVO = join(MIGRATIONS, NOME, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** D-PROD-207: a anterior, a última que produção concluiu (o preflight e o envelope conferem o checksum dela). */
const NOME_ANTERIOR = '20261115900000_atividade_mao_obra_servico';
const CHECKSUM_ANTERIOR = '79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725';
/** Pastas do repositório: a partida é o que vem ANTES desta; o GREEN, até esta (no dia da D-PROD-208). */
const PASTAS_HOJE = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
/** D-PROD-209: a CONTRACT do tipo Terceirizado, de nome posterior (ver o cabeçalho); fica fora do dia desta. */
const NOME_TIPO = '20261116100000_funcionario_tipo_terceirizado';
/** D-PROD-210: a CONTRACT da base do consumo, ainda posterior (ver o cabeçalho); muda o schema.prisma. */
const NOME_BASE = '20261116200000_formulacao_base_consumo';
/** D-PROD-211: a CONTRACT do abastecimento ligado à atividade, ainda posterior (ver o cabeçalho); muda o schema.prisma. */
const NOME_ABASTECIMENTO = '20261116300000_abastecimento_atividade';
/** D-PROD-215: a EXPAND do Cadastro de Culturas (tabela nova CADCULTURAS), ainda posterior; o runner do repositório a sobe sem decisão. */
const NOME_CULTURAS = '20261116500000_cadculturas';
/** D-PROD-216: a CONTRACT aditiva da Área ligada à Cultura (coluna, UNIQUE em CADCULTURAS e FK), ainda posterior. */
const NOME_AREA_CULTURA = '20261117000000_area_cultura';
/** D-PROD-217: a CONTRACT do reforço, ainda posterior (ver o cabeçalho); muda o schema.prisma. */
const NOME_REFORCO = '20261117100000_abastecimento_fk_apontamento_atividade';
/** D-PROD-219: a EXPAND da Medição de Forragem (tabela nova MEDICAOFORRAGEM), ainda posterior (depois da D-PROD-217); o runner do repositório a sobe sem decisão. */
const NOME_MEDICAO_FORRAGEM = '20261117200000_medicao_forragem';
const NOME_DIAS_DESCANSO = '20261117300000_descanso_e_alturas_por_area'; // D-PROD-223: EXPAND, coluna em CADCULTURAS, depois da D-PROD-219.
const PASTAS = Object.freeze(PASTAS_HOJE.filter((n) => n <= NOME));
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME));
const TOTAL_MIGRATIONS = PASTAS.length;
/** As 2 tabelas antigas que mudam de forma (e cujas colunas o retrato guarda). */
const TOCADAS = Object.freeze(['AtividadeApontamentoMaoObra', 'Fornecedor']);
const COLUNAS_NOVAS = Object.freeze([
  ['AtividadeApontamentoMaoObra', 'parceiro_id', 'character varying', 64, null, 'NO'],
  ['AtividadeApontamentoMaoObra', 'origem', 'character varying', 12, null, 'NO'],
  ['Fornecedor', 'funcionario_tipo', 'character varying', 16, null, 'YES'],
  ['Fornecedor', 'funcionario_cargo', 'character varying', 120, null, 'YES'],
  ['Fornecedor', 'funcionario_custo_hora', 'numeric', null, '14,4', 'YES'],
  ['Fornecedor', 'funcionario_custo_diaria', 'numeric', null, '14,4', 'YES'],
]);

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const C1 = 'amp-c1';
const C2 = 'amp-c2';
const E1 = `${C1}-e1`;
const E2 = `${C1}-e2`;
const U1 = `${C1}-u1`;
const AP = `${C1}-ap1`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-208: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
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

/** D-PROD-209 — o runner oficial NO DIA DA D-PROD-208 (espelho com as pastas até esta; ver `espelhoDoRunner.mjs`). */
let ESPELHO;
const runnerDoDia = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-210 — o runner oficial NO DIA DA D-PROD-209 (espelho com as pastas até ela), para o 2º passo do MP-08. */
let ESPELHO_209;
const runnerAte209 = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_209,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-211 — o runner oficial NO DIA DA D-PROD-210 (espelho com as pastas até ela), para o 3º passo do MP-08. */
let ESPELHO_210;
const runnerAte210 = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_210,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-217 — o runner oficial NO DIA DA D-PROD-211 (espelho com as pastas até ela), para o 4º passo do MP-08. */
let ESPELHO_211;
const runnerAte211 = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_211,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-216 — o runner oficial NO DIA DA D-PROD-216 (espelho com as pastas até ela), para o 5º passo do MP-08. */
let ESPELHO_216;
const runnerAte216 = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_216,
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
  const dir = mkdtempSync(join(tmpdir(), 'maike-amp-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of ANTERIORES) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-208: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Sementes em SQL cru (o Prisma Client é o do schema novo; a partida ainda não tem as colunas novas). */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C1}', 'amp1', 'Cliente AMP', now()), ('${C2}', 'amp2', 'Cliente AMP 2', now())`);
  await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES
    ('${E1}', '${C1}', 1, 'F1', 'Fazenda 1', now()), ('${E2}', '${C1}', 2, 'F2', 'Fazenda 2', now()), ('${C2}-e1', '${C2}', 1, 'G1', 'Granja 1', now())`);
  await ins(`INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, "updatedAt") VALUES
    ('${U1}', '${C1}', 'Operador', 'operador.amp', 'x', now()), ('${C2}-u1', '${C2}', 'Gerente', 'gerente.amp', 'x', now())`);
  await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${C1}-g1', '${C1}', 'Tratos', now())`);
  await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, permite_mao_obra, permite_servico, "updatedAt")
    VALUES ('${C1}-t1', '${C1}', 'ROÇADA', '${C1}-g1', 'Tratos', true, true, now())`);
  await ins(`INSERT INTO "Atividade" (id, cliente_id, empresa_id, numero, nome, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id, grupo_atividade_nome,
      data_inicio, criado_por_usuario_id, "updatedAt") VALUES
    ('${C1}-atv1', '${C1}', '${E1}', '1', 'ROÇADA PASTO 01', '${C1}-t1', 'ROÇADA', '${C1}-g1', 'Tratos', '2026-11-16', '${U1}', now())`);
  await ins(`INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, operador_usuario_id, criado_por_usuario_id, "updatedAt") VALUES
    ('${AP}', '${C1}', '${E1}', '${C1}-atv1', '2026-11-16', 1, '${U1}', '${U1}', now())`);
  // Os parceiros: um prestador (terceiro) e um que vai ganhar o papel funcionário, na F1, e um prestador do outro cliente.
  await ins(`INSERT INTO "Fornecedor" (id, cliente_id, empresa_id, numero_cadastro, tipo_pessoa, nome, tipos, "updatedAt") VALUES
    ('${C1}-pr1', '${C1}', '${E1}', '1', 'Jurídica', 'ROÇADAS LTDA', ARRAY['prestador_servico'], now()),
    ('${C1}-fu1', '${C1}', '${E1}', '2', 'Física', 'JOÃO DA SILVA', ARRAY['funcionario'], now()),
    ('${C2}-pr1', '${C2}', '${C2}-e1', '1', 'Jurídica', 'PRESTADOR DO OUTRO', ARRAY['prestador_servico'], now())`);
};

/** Retrato do que a migration toca (e do que uma recusa não pode deixar): tabelas, constraints, índices, colunas das tocadas, linhas e histórico. */
const SQL_RETRATO = `SELECT
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')) AS tabelas,
  (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace) AS constraints,
  (SELECT string_agg(indexname || ':' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public') AS indices,
  (SELECT coalesce(string_agg(c.relname || ':' || p.polname, ',' ORDER BY c.relname, p.polname), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid) AS politicas,
  (SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_name, ordinal_position)
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${TOCADAS.map((t) => `'${t}'`).join(', ')})) AS colunas,
  (SELECT count(*)::int FROM "Fornecedor") AS parceiros,
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
/** Monta um INSERT a partir de um objeto coluna → expressão SQL. */
const inserir = (tabela, v) => `INSERT INTO "${tabela}" (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`;
/** Uma linha de mão de obra no formato da Fatia 4 (com funcionario_id) e um funcionário, para os RED. */
const FUNCIONARIO_ANTIGO = inserir('Funcionario', { id: "'amp-fun-1'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, numero: "'1'", nome: "'JOÃO'",
  tipo: "'DIARISTA'", custo_diaria: 120, '"updatedAt"': 'now()' });
const MAO_OBRA_ANTIGA = inserir('AtividadeApontamentoMaoObra', { id: "'amp-mo-antiga'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, apontamento_id: `'${AP}'`,
  ordem: 1, status: "'CONFIRMADO'", funcionario_id: "'amp-fun-x'", tipo_medida: "'DIARIA'", quantidade: 1, custo_unitario: 120, custo_total: 120,
  operation_id: "'amp-op-mao-obra-antiga'", criado_por_usuario_id: `'${U1}'`, '"updatedAt"': 'now()' });

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
  const banco = `${PREFIXO}_amp_${sufixo}`;
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
  ESPELHO_209 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_TIPO }).dir;
  ESPELHO_210 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_BASE }).dir;
  ESPELHO_211 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_ABASTECIMENTO }).dir;
  ESPELHO_216 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_AREA_CULTURA }).dir;
  PREFIXO = new URL(BASE_URL).pathname.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'maike';
  BANCO_MODELO = `${PREFIXO}_amp_modelo`;
  for (const b of [`${PREFIXO}_amp`, `${PREFIXO}_amp_b`, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(comBanco(BASE_URL, BANCO_MODELO));
  const modelo = new PrismaClient({ datasourceUrl: comBanco(BASE_URL, BANCO_MODELO) });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  URL_T = await clonar(`${PREFIXO}_amp`);
  URL_B = await clonar(`${PREFIXO}_amp_b`);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  for (const b of [`${PREFIXO}_amp`, `${PREFIXO}_amp_b`, `${PREFIXO}_amp_ordem`, BANCO_MODELO]) if (PREFIXO) await apagar(b);
  for (const e of [ESPELHO, ESPELHO_209, ESPELHO_210, ESPELHO_211, ESPELHO_216]) if (e) rmSync(e, { recursive: true, force: true });
  await closePrismaClient();
});

describe('D-PROD-208 — migration CONTRACT do funcionário como papel do parceiro (PostgreSQL real)', () => {
  test('MP-01 partida: as 58 migrations de nome anterior a esta (a última a D-PROD-207), 95 tabelas, Funcionario e a linha de mão de obra vazias; schema × banco acusa a diferença; o preflight do runbook diz PRONTO e, com o system_identifier de produção, PARAR', async () => {
    assert.equal(ANTERIORES.length, 58, 'produção hoje: 58 migrations');
    assert.equal(ANTERIORES.at(-1), NOME_ANTERIOR);
    assert.equal(PASTAS.at(-1), NOME, 'no dia da D-PROD-208, esta era a migration de nome mais recente');
    assert.equal(TOTAL_MIGRATIONS, 59);
    assert.deepEqual(PASTAS_HOJE.filter((n) => n > NOME), [NOME_TIPO, NOME_BASE, NOME_ABASTECIMENTO, NOME_CULTURAS, NOME_AREA_CULTURA, NOME_REFORCO, NOME_MEDICAO_FORRAGEM, NOME_DIAS_DESCANSO], 'D-PROD-209, D-PROD-210, D-PROD-211, D-PROD-215, D-PROD-216 e D-PROD-217: só o tipo Terceirizado, a base do consumo, o abastecimento ligado à atividade, o Cadastro de Culturas, a Área ligada à Cultura e o reforço têm nome posterior a esta');
    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [58, 0, 0]);
    const tabelas = partida.tabelas.split(',');
    assert.equal(tabelas.length, 95);
    assert.ok(tabelas.includes('Funcionario'));
    const { checksum } = await um(db, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_ANTERIOR}'`);
    assert.equal(checksum, CHECKSUM_ANTERIOR, 'a anterior com o checksum que produção registrou');
    // Schema × banco: o schema.prisma já é o do ajuste; a partida (o banco de produção hoje) ainda não.
    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 2, `o diff acusa a diferença (exit 2):\n${diff.saida}`);

    const q = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const [item, v] of Object.entries(q)) if (item !== 'VEREDITO') assert.ok(v.status === 'OK' || v.status.startsWith('ATENÇÃO'), `${item}: ${v.status} (${v.valor})`);
    for (const [item, v] of Object.entries(q)) if (!/^(VEREDITO|travas|transações)/.test(item)) assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.equal(q['migrations concluídas / em aberto'].valor, '58 / 0');
    assert.equal(q['a anterior (D-PROD-207) concluída com o checksum do repositório'].valor, '1');
    assert.equal(q['"Funcionario": linhas (tem de estar VAZIA)'].valor, '0');
    assert.equal(q['"AtividadeApontamentoMaoObra": linhas (tem de estar VAZIA)'].valor, '0');
    assert.equal(q['coluna antiga AtividadeApontamentoMaoObra.funcionario_id presente'].valor, '1');
    assert.equal(q['colunas novas já presentes (parceiro_id, origem, funcionario_*)'].valor, '0');
    assert.equal(q['chave (cliente_id, id) de Fornecedor que a FK nova referencia'].valor, '1');
    assert.equal(q['tabelas em public'].valor, '95');
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    const producao = quadro(await consulta(URL_T, blocoDoRunbook('preflight')));
    assert.equal(producao['alvo: system_identifier'].status, 'PARAR');
    assert.match(producao.VEREDITO.valor, /^PARAR/);
    // O postcheck, antes de aplicar, também manda parar (e só lê).
    assert.match(quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID))).VEREDITO.valor, /^PARAR/);
    assert.deepEqual(await retrato(db), partida, 'o preflight e o postcheck só leem');
  });

  test('MP-02 o portão: o classificador diz CONTRACT D-PROD-208 sem violação, o arquivo e a guarda são os pinados, com o DROP no fim; o histórico real da partida confere com só esta pendente, e é a CONTRACT a autorizar', async () => {
    const c = classificarMigrations([{ nome: NOME, sql: SQL_MIGRATION }]);
    assert.deepEqual(c.violacoes, []);
    assert.deepEqual([c.ok, c.expand, c.modo], [true, false, 'CONTRACT']);
    assert.deepEqual(c.tabelas_novas, []);
    assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
    assert.equal(c.contract.length, 1);
    assert.equal(c.contract[0].decisao, DECISAO);
    assert.deepEqual(c.contract[0].tabelas_removidas, ['Funcionario']);
    assert.deepEqual(c.contract[0].colunas_removidas, ['AtividadeApontamentoMaoObra.funcionario_id']);
    assert.deepEqual(c.contract[0].colunas_adicionadas, COLUNAS_NOVAS.map(([t, col]) => `${t}.${col}`));
    assert.deepEqual(c.contract[0].conversoes, []);
    assert.equal(MIGRATIONS_APROVADAS[NOME], CHECKSUM);
    assert.equal(CHECKSUM, '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0');
    assert.equal(MIGRATIONS_CONTRACT_APROVADAS[NOME].drop_no_fim, true);
    assert.doesNotMatch(SQL_MIGRATION, /D-PROD-\d+/, 'o número da decisão fica fora do arquivo');

    const linhas = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    const locais = PASTAS.map((n) => ({ nome: n, checksum: createHash('sha256').update(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8')).digest('hex') }));
    assert.deepEqual(conferirHistoricoRemoto({ locais, linhas }), { ok: true, codigo: null, pendentes: [NOME], falhas: [] });
    assert.deepEqual(contractsPendentes({ locais: PASTAS, linhas }), [{ nome: NOME, decisao: DECISAO }]);
    // Hoje (D-PROD-209), com as pastas do repositório, o tipo Terceirizado também pende: são duas CONTRACT pendentes.
    assert.deepEqual(contractsPendentes({ locais: PASTAS_HOJE, linhas }), [{ nome: NOME, decisao: DECISAO }, { nome: NOME_TIPO, decisao: 'D-PROD-209' }, { nome: NOME_BASE, decisao: 'D-PROD-210' }, { nome: NOME_ABASTECIMENTO, decisao: 'D-PROD-211' }, { nome: NOME_AREA_CULTURA, decisao: 'D-PROD-216' }, { nome: NOME_REFORCO, decisao: 'D-PROD-217' }]);
  });

  test('MP-RED-1 uma linha em "Funcionario" (num banco novo) → a guarda recusa e NADA muda', async () => {
    await emBancoNovo('r1', async (dbr, url) => {
      await dbr.$executeRawUnsafe(FUNCIONARIO_ANTIGO);
      const antes = await retrato(dbr);
      const r = await aplicarArquivo(url);
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, /guarda: "Funcionario" tem linhas/);
      assert.deepEqual(await retrato(dbr), antes, 'nada da migration ficou');
      assert.equal((await um(dbr, 'SELECT count(*)::int AS n FROM "Funcionario"')).n, 1, 'o funcionário continua');
    });
  });

  test('MP-RED-2 uma linha em "AtividadeApontamentoMaoObra" com "Funcionario" vazia (gravada sem o gatilho da FK) → a guarda recusa e NADA muda', async () => {
    await emBancoNovo('r2', async (dbr, url) => {
      // session_replication_role = replica desliga os gatilhos de FK só nesta transação: a linha aponta para um
      // funcionário que não existe, e a conferência da mão de obra é provada sozinha (a de Funcionario passa).
      await dbr.$transaction([
        dbr.$executeRawUnsafe('SET LOCAL session_replication_role = replica'),
        dbr.$executeRawUnsafe(MAO_OBRA_ANTIGA),
      ]);
      const antes = await retrato(dbr);
      const r = await aplicarArquivo(url);
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, /guarda: "AtividadeApontamentoMaoObra" tem linhas/);
      assert.deepEqual(await retrato(dbr), antes, 'nada da migration ficou');
      assert.equal((await um(dbr, 'SELECT count(*)::int AS n FROM "AtividadeApontamentoMaoObra"')).n, 1, 'a linha continua');
    });
  });

  test('MP-03 runner do dia com a conferência de alvo exigida e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando só a D-PROD-208, antes de qualquer DDL', async () => {
    const linhasAntes = (await um(db, 'SELECT count(*)::int AS n FROM _prisma_migrations')).n;
    // D-PROD-207 criou a tabela que esta apaga e D-PROD-200 é a CONTRACT anterior: nenhuma autoriza esta; nem a decisão
    // em minúsculas (comparação exata).
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-207' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-200' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-208' }, { MIGRATION_CONTRACT_AUTORIZADO: ' D-PROD-208 ' }]) {
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

  test('MP-04 GREEN pelo runner oficial do dia (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-208): 59/0, 94 tabelas (tenant 79), Funcionario e funcionario_id fora, as 6 colunas certas, a FK e o índice novos pelo cliente, nada mais mudou; migrate diff só com as diferenças da base do consumo e do abastecimento (D-PROD-210 e D-PROD-211)', async () => {
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
    const tabelas = depois.tabelas.split(',');
    assert.equal(tabelas.length, 94);
    assert.deepEqual(tabelas, partida.tabelas.split(',').filter((t) => t !== 'Funcionario'));
    const { tenant } = await um(db, `SELECT count(DISTINCT table_name)::int AS tenant FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'cliente_id' AND table_name <> 'OperadorProdutoMaike'`);
    assert.equal(tenant, 79);
    // As colunas: funcionario_id fora; as 6 novas com o tipo, o tamanho, a nulidade e sem DEFAULT; as outras iguais.
    const colunas = await db.$queryRawUnsafe(`SELECT table_name::text AS t, column_name::text AS c, data_type::text AS tipo,
        character_maximum_length::int AS tam, CASE WHEN data_type = 'numeric' THEN numeric_precision || ',' || numeric_scale END AS escala,
        is_nullable::text AS nula, column_default AS def
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ANY($1::text[])`, [...TOCADAS]);
    assert.ok(!colunas.some((x) => x.t === 'AtividadeApontamentoMaoObra' && x.c === 'funcionario_id'), 'funcionario_id saiu');
    for (const [t, c, tipo, tam, escala, nula] of COLUNAS_NOVAS) {
      const x = colunas.find((k) => k.t === t && k.c === c);
      assert.deepEqual(x && { tipo: x.tipo, tam: x.tam, escala: x.escala, nula: x.nula, def: x.def }, { tipo, tam, escala, nula, def: null }, `${t}.${c}`);
    }
    const semAsNovas = (texto) => texto.split(',').filter((x) => !COLUNAS_NOVAS.some(([t, c]) => x.startsWith(`${t}.${c}:`)) && !x.startsWith('AtividadeApontamentoMaoObra.funcionario_id:')).join(',');
    assert.equal(semAsNovas(depois.colunas), semAsNovas(partida.colunas), 'as outras colunas das 2 tocadas não mudaram');
    // Constraints: saem as do Funcionario e a FK do funcionário; entram os 2 CHECKs e a FK do parceiro; o resto igual.
    const antes = partida.constraints.split('\n');
    const agora = depois.constraints.split('\n');
    const sairam = antes.filter((c) => !agora.includes(c)).map((c) => c.split(':')[0]).sort();
    const entraram = agora.filter((c) => !antes.includes(c)).sort();
    assert.deepEqual(sairam, ['AtividadeApontamentoMaoObra_funcionario_fkey', 'Funcionario_cliente_id_empresa_id_fkey', 'Funcionario_cliente_id_fkey', 'Funcionario_pkey', 'Funcionario_valores_check']);
    assert.deepEqual(entraram.map((c) => c.split(':')[0]), ['AtividadeApontamentoMaoObra_origem_check', 'AtividadeApontamentoMaoObra_parceiro_fkey', 'Fornecedor_funcionario_check']);
    assert.ok(entraram.includes('AtividadeApontamentoMaoObra_parceiro_fkey:FOREIGN KEY (cliente_id, parceiro_id) REFERENCES "Fornecedor"(cliente_id, id) ON UPDATE CASCADE ON DELETE RESTRICT'), entraram.join('\n'));
    // Índices: saem os de Funcionario e o do funcionário na mão de obra; entra o do parceiro, com cliente_id na frente (R10).
    const idxAntes = partida.indices.split('\n');
    const idxAgora = depois.indices.split('\n');
    const idxSairam = idxAntes.filter((i) => !idxAgora.includes(i)).map((i) => i.split(':')[0]);
    assert.ok(idxSairam.every((i) => i.startsWith('Funcionario_') || i === 'AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx'), idxSairam.join(','));
    assert.ok(idxSairam.includes('AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx'));
    assert.deepEqual(idxAgora.filter((i) => !idxAntes.includes(i)),
      ['AtividadeApontamentoMaoObra_cliente_id_parceiro_id_idx:CREATE INDEX "AtividadeApontamentoMaoObra_cliente_id_parceiro_id_idx" ON public."AtividadeApontamentoMaoObra" USING btree (cliente_id, parceiro_id)']);
    // As políticas das outras tabelas continuam; só a de Funcionario saiu com ela.
    assert.deepEqual(depois.politicas.split(',').filter((x) => x !== '-'), partida.politicas.split(',').filter((x) => x !== '-' && !x.startsWith('Funcionario:')));
    assert.equal(depois.parceiros, partida.parceiros, 'nenhum parceiro a mais nem a menos');
    const { papel } = await um(db, `SELECT count(*)::int AS papel FROM "Fornecedor" WHERE funcionario_tipo IS NOT NULL OR funcionario_cargo IS NOT NULL
      OR funcionario_custo_hora IS NOT NULL OR funcionario_custo_diaria IS NOT NULL`);
    assert.equal(papel, 0, 'as colunas novas entram nulas');

    // D-PROD-210 e D-PROD-211 (ver o cabeçalho): até elas subirem, o schema.prisma de hoje acusa só as diferenças delas.
    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 2, diff.saida);
    assert.match(diff.stdout, /AbastecimentoBem/);
    assert.doesNotMatch(diff.stdout, /Funcionario|Fornecedor|AtividadeApontamentoMaoObra/);
  });

  test('MP-05 postcheck do runbook no banco aplicado pelo runner: tudo OK e VEREDITO APLICADA; o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
    assert.equal(pos['migrations concluídas / em aberto'].valor, '59 / 0');
    assert.equal(pos['tabelas em public'].valor, '94');
    assert.equal(pos['"Funcionario" presente'].valor, '0');
    assert.equal(pos['coluna AtividadeApontamentoMaoObra.funcionario_id presente'].valor, '0');
    assert.equal(pos['as 6 colunas novas com o tipo e a nulidade do contrato'].valor, '6');
    assert.equal(pos['os 2 CHECKs novos, validados'].valor, '2');
    assert.equal(pos['FK nova para o parceiro (cliente_id, parceiro_id), RESTRICT/CASCADE, validada / FK antiga do funcionário'].valor, '1 / 0');
    assert.equal(pos['índice novo (cliente_id, parceiro_id) / índice antigo do funcionário'].valor, '1 / 0');
    const pre = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const item of ['migrations concluídas / em aberto', '20261116000000_mao_obra_parceiro já registrada', '"Funcionario": linhas (tem de estar VAZIA)',
      'coluna antiga AtividadeApontamentoMaoObra.funcionario_id presente', 'colunas novas já presentes (parceiro_id, origem, funcionario_*)', 'tabelas em public']) {
      assert.equal(pre[item].status, 'PARAR', item);
    }
    assert.match(pre.VEREDITO.valor, /^PARAR/);
  });

  test('MP-06 CHECKs (23514), a FK nova pelo tenant (23503) e o RESTRICT: o papel funcionário com tipo e custos válidos, a origem FUNCIONARIO/TERCEIRO; o parceiro de outro cliente ou inexistente não serve; o parceiro usado não sai', async () => {
    const papel = (campos) => `UPDATE "Fornecedor" SET ${Object.entries(campos).map(([k, v]) => `${k} = ${v}`).join(', ')} WHERE id = '${C1}-fu1'`;
    await recusa(db, papel({ funcionario_tipo: "'CLT'" }), '23514', 'Fornecedor_funcionario_check');
    await recusa(db, papel({ funcionario_custo_hora: -1 }), '23514', 'Fornecedor_funcionario_check');
    await recusa(db, papel({ funcionario_custo_diaria: -0.01 }), '23514', 'Fornecedor_funcionario_check');
    for (const tipo of ['MENSALISTA', 'TAREFEIRO', 'DIARISTA']) await db.$executeRawUnsafe(papel({ funcionario_tipo: `'${tipo}'` }));
    await db.$executeRawUnsafe(papel({ funcionario_cargo: "'Tratorista'", funcionario_custo_hora: 25, funcionario_custo_diaria: 180 }));
    assert.deepEqual({ ...(await um(db, `SELECT funcionario_tipo AS t, funcionario_cargo AS c, funcionario_custo_hora::text AS h, funcionario_custo_diaria::text AS d FROM "Fornecedor" WHERE id = '${C1}-fu1'`)) },
      { t: 'DIARISTA', c: 'Tratorista', h: '25.0000', d: '180.0000' });

    const maoObra = (id, campos = {}) => inserir('AtividadeApontamentoMaoObra', { id: `'${id}'`, cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, apontamento_id: `'${AP}'`,
      ordem: campos.ordem ?? 1, status: "'CONFIRMADO'", parceiro_id: campos.parceiro ?? `'${C1}-fu1'`, origem: campos.origem ?? "'FUNCIONARIO'",
      tipo_medida: campos.medida ?? "'DIARIA'", quantidade: 1, custo_unitario: 180, custo_total: 180, operation_id: `'amp-op-${id}'`,
      criado_por_usuario_id: `'${U1}'`, '"updatedAt"': 'now()' });
    await recusa(db, maoObra('amp-x1', { origem: "'OUTRO'" }), '23514', 'AtividadeApontamentoMaoObra_origem_check');
    await recusa(db, maoObra('amp-x2', { origem: "'funcionario'" }), '23514', 'AtividadeApontamentoMaoObra_origem_check');
    await recusa(db, maoObra('amp-x3', { origem: 'NULL' }), '23502');
    await recusa(db, maoObra('amp-x4', { parceiro: 'NULL' }), '23502');
    // Pelo tenant: o parceiro do outro cliente e um inexistente não servem.
    await recusa(db, maoObra('amp-x5', { parceiro: `'${C2}-pr1'` }), '23503', 'AtividadeApontamentoMaoObra_parceiro_fkey');
    await recusa(db, maoObra('amp-x6', { parceiro: "'nao-existe'" }), '23503', 'AtividadeApontamentoMaoObra_parceiro_fkey');
    // As válidas: o funcionário e o terceiro (prestador), no mesmo apontamento.
    await db.$executeRawUnsafe(maoObra('amp-mo-1'));
    await db.$executeRawUnsafe(maoObra('amp-mo-2', { ordem: 2, parceiro: `'${C1}-pr1'`, origem: "'TERCEIRO'", medida: "'TAREFA'" }));
    // RESTRICT: o parceiro usado não sai; o que não tem linha sai (numa transação desfeita, nada fica).
    await recusa(db, `DELETE FROM "Fornecedor" WHERE id = '${C1}-fu1'`, '23503', 'AtividadeApontamentoMaoObra_parceiro_fkey');
    await recusa(db, `DELETE FROM "Fornecedor" WHERE id = '${C1}-pr1'`, '23503');
    const apagados = [];
    await db.$transaction(async (tx) => {
      apagados.push(await tx.$executeRawUnsafe(`DELETE FROM "Fornecedor" WHERE id = '${C2}-pr1'`));
      await tx.$executeRawUnsafe('SELECT 1/0');
    }).then(() => assert.fail('a transação deveria ter sido desfeita'), (e) => assert.match(`${e.message} ${JSON.stringify(e.meta ?? {})}`, /22012|division by zero/));
    assert.deepEqual(apagados, [1]);
    const n = await um(db, `SELECT (SELECT count(*)::int FROM "AtividadeApontamentoMaoObra") AS mo, (SELECT count(*)::int FROM "Fornecedor") AS f`);
    assert.deepEqual({ ...n }, { mo: 2, f: partida.parceiros }, 'só as válidas foram gravadas; nenhum parceiro saiu');
  });

  test('MP-07 reaplicar o migration.sql (psql, uma transação) é recusado pela guarda e NADA muda; a 2ª execução do runner não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /guarda: "Funcionario", "AtividadeApontamentoMaoObra" e "Fornecedor" têm de existir/);
    assert.deepEqual(await retrato(db), antes);
    const segunda = await runnerDoDia(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
  });
});

describe('D-PROD-208 — ordem de produção com a D-PROD-209, a D-PROD-210, a D-PROD-211, a D-PROD-215, a D-PROD-216 e a D-PROD-217 (posteriores)', () => {
  test('MP-08 num banco à parte com a mesma partida: esta pelo runner do dia (59/0); depois, pelo runner do dia da D-PROD-209 com o alvo conferido, só a D-PROD-209 pende; sem a decisão exata recusa antes de qualquer DDL; com ela, 60/0, 94 tabelas e o CHECK com TERCEIRIZADO no lugar de TAREFEIRO; depois, pelo runner do dia da D-PROD-210, ela com a decisão dela (61/0); depois, pelo runner do dia da D-PROD-211, só ela pende e, com a decisão dela, 62/0; depois, pelo runner do dia da D-PROD-216, com a decisão dela, a EXPAND da D-PROD-215 e a D-PROD-216 (64/0, 95 tabelas); por fim, pelo runner do repositório, só a D-PROD-217 pende e, com a decisão dela, sobe: 65/0, 95 tabelas e migrate diff vazio', async () => {
    const url = await clonar(`${PREFIXO}_amp_ordem`);
    const dbo = new PrismaClient({ datasourceUrl: url });
    try {
      const conferencia = { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID };
      const dia = await runnerDoDia(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      assert.equal(dia.status, 0, dia.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [59, 0]);
      const check = async () => (await um(dbo, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'Fornecedor_funcionario_check'`)).d;
      const antes = await check();
      assert.ok(antes.includes("'TAREFEIRO'") && !antes.includes("'TERCEIRIZADO'"), antes);
      const semDecisao = await runnerAte209(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      assert.equal(semDecisao.status, 1, semDecisao.saida);
      assert.ok(semDecisao.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_TIPO} (D-PROD-209).`), semDecisao.saida);
      assert.match(semDecisao.saida, /Nenhuma migration foi executada/);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [59, 0]);
      const r = await runnerAte209(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-209' } });
      assert.equal(r.status, 0, r.saida);
      assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME_TIPO} (D-PROD-209).`), r.saida);
      assert.ok(r.saida.includes(`Applying migration \`${NOME_TIPO}\``), r.saida);
      assert.ok(!r.saida.includes(`Applying migration \`${NOME}\``), r.saida);
      assert.ok(!vazou(r.saida, url));
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [60, 0]);
      assert.equal((await retrato(dbo)).tabelas.split(',').length, 94);
      assert.equal(await check(), antes.split("'TAREFEIRO'").join("'TERCEIRIZADO'"));
      // D-PROD-210: pelo runner do dia dela (espelho até ela), com a conferência, só ela pende; com a decisão DELA sobe.
      const r210 = await runnerAte210(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-210' } });
      assert.equal(r210.status, 0, r210.saida);
      assert.ok(r210.saida.includes(`CONTRACT autorizado: ${NOME_BASE} (D-PROD-210).`), r210.saida);
      assert.ok(!r210.saida.includes(`Applying migration \`${NOME_TIPO}\``), r210.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [61, 0]);
      // D-PROD-211: pelo runner do dia dela (espelho até ela), com a conferência, só ela pende; sem a decisão DELA recusa, com ela sobe.
      const sem211 = await runnerAte211(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-210' } });
      assert.equal(sem211.status, 1, sem211.saida);
      assert.ok(sem211.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_ABASTECIMENTO} (D-PROD-211).`), sem211.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [61, 0]);
      const r211 = await runnerAte211(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-211' } });
      assert.equal(r211.status, 0, r211.saida);
      assert.ok(r211.saida.includes(`CONTRACT autorizado: ${NOME_ABASTECIMENTO} (D-PROD-211).`), r211.saida);
      assert.ok(!r211.saida.includes(`Applying migration \`${NOME_BASE}\``), r211.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [62, 0]);
      // D-PROD-216: pelo runner do dia dela (espelho até ela), com a conferência, só ela é CONTRACT pendente; com a decisão
      // DELA sobe, depois da EXPAND da D-PROD-215 (CADCULTURAS, sem decisão), no mesmo passo.
      const r216 = await runnerAte216(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-216' } });
      assert.equal(r216.status, 0, r216.saida);
      assert.ok(r216.saida.includes(`CONTRACT autorizado: ${NOME_AREA_CULTURA} (D-PROD-216).`), r216.saida);
      assert.ok(r216.saida.indexOf(`Applying migration \`${NOME_CULTURAS}\``) >= 0, r216.saida);
      assert.ok(r216.saida.indexOf(`Applying migration \`${NOME_CULTURAS}\``) < r216.saida.indexOf(`Applying migration \`${NOME_AREA_CULTURA}\``), 'a D-PROD-215 antes da D-PROD-216');
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [64, 0]);
      // D-PROD-217: pelo runner do repositório, com a conferência, só ela é CONTRACT pendente; sem a decisão DELA recusa,
      // com ela sobe: a ordem de produção.
      const semReforco = await aplicarPeloRunner(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-216' } });
      assert.equal(semReforco.status, 1, semReforco.saida);
      assert.ok(semReforco.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_REFORCO} (D-PROD-217).`), semReforco.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [64, 0]);
      const rReforco = await aplicarPeloRunner(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-217' } });
      assert.equal(rReforco.status, 0, rReforco.saida);
      assert.ok(rReforco.saida.includes(`CONTRACT autorizado: ${NOME_REFORCO} (D-PROD-217).`), rReforco.saida);
      assert.ok(!rReforco.saida.includes(`Applying migration \`${NOME_ABASTECIMENTO}\``), rReforco.saida);
      assert.ok(!rReforco.saida.includes(`Applying migration \`${NOME_CULTURAS}\``), rReforco.saida);
      assert.ok(rReforco.saida.includes(`Applying migration \`${NOME_REFORCO}\``), rReforco.saida);
      assert.ok(rReforco.saida.includes(`Applying migration \`${NOME_MEDICAO_FORRAGEM}\``), rReforco.saida);
      assert.ok(rReforco.saida.includes(`Applying migration \`${NOME_DIAS_DESCANSO}\``), rReforco.saida);
      // D-PROD-219: a EXPAND da Medição de Forragem sobe no mesmo passo, depois do reforço, sem decisão.
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [67, 0]);
      assert.equal((await retrato(dbo)).tabelas.split(',').length, 96);
      assert.equal(await check(), antes.split("'TAREFEIRO'").join("'TERCEIRIZADO'"));
      const diff = await migrateDiff(url);
      assert.equal(diff.status, 0, diff.saida);
    } finally {
      await dbo.$disconnect();
      await apagar(`${PREFIXO}_amp_ordem`);
    }
  });
});

describe('D-PROD-208 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
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

  test('TB-02 histórico fora de 58/0 (uma revertida ou uma em aberto), a anterior (D-PROD-207) com checksum divergente ou uma linha em "Funcionario" ou em "AtividadeApontamentoMaoObra" recusa antes do DDL; restaurado, nada mudou', async () => {
    const tentar = async (esperado) => {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, esperado);
    };
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 57 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    }
    await dbB.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('amp-aberta', 'x', '20261199000000_aberta', now(), 0)`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 58 concluídas e 1 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'amp-aberta'`);
    }
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${NOME_ANTERIOR}'`);
    try {
      await tentar(/RELEASE_BLOCKED: a anterior \(D-PROD-207\) ausente ou com checksum divergente/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${CHECKSUM_ANTERIOR}' WHERE migration_name = '${NOME_ANTERIOR}'`);
    }
    await dbB.$executeRawUnsafe(FUNCIONARIO_ANTIGO);
    try {
      await tentar(/RELEASE_BLOCKED: "Funcionario" ou "AtividadeApontamentoMaoObra" não está vazia/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM "Funcionario" WHERE id = 'amp-fun-1'`);
    }
    await dbB.$transaction([dbB.$executeRawUnsafe('SET LOCAL session_replication_role = replica'), dbB.$executeRawUnsafe(MAO_OBRA_ANTIGA)]);
    try {
      await tentar(/RELEASE_BLOCKED: "Funcionario" ou "AtividadeApontamentoMaoObra" não está vazia/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM "AtividadeApontamentoMaoObra" WHERE id = 'amp-mo-antiga'`);
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (58 → 59, checksum = SHA-256 do arquivo, applied_steps_count 1); o mesmo schema do runner; postcheck APLICADA; o Prisma do dia não vê pendência; o do repositório sobe as posteriores e o migrate diff fica vazio', async () => {
    const pre = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
    assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);

    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.equal(r.status, 0, r.stderr);
    const h = await historico(dbB);
    assert.deepEqual([h.concluidas, h.abertas, h.esta, h.linhas_esta], [ANTERIORES.length + 1, 0, 1, 1]);
    const linha = await um(dbB, `SELECT checksum, applied_steps_count::int AS passos, logs, finished_at IS NOT NULL AS concluida FROM _prisma_migrations WHERE migration_name = '${NOME}'`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1, logs: null, concluida: true });

    // O mesmo schema que o runner deixou no outro banco (tabelas, constraints, índices, políticas e as colunas das 2
    // tocadas). O banco do runner passou pelos testes de dados acima, mas nenhum deles mexe em schema.
    const b = await retrato(dbB);
    const t = await retrato(db);
    assert.deepEqual([b.tabelas, b.constraints, b.indices, b.politicas, b.colunas], [t.tabelas, t.constraints, t.indices, t.politicas, t.colunas]);

    const pos = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);

    // O registro manual vale para o Prisma: o runner não vê pendência e o schema bate com o schema.prisma.
    const runner = await runnerDoDia(URL_B);
    assert.equal(runner.status, 0, runner.saida);
    assert.match(runner.saida, /No pending migrations to apply/);
    // D-PROD-209, D-PROD-210, D-PROD-211 e D-PROD-215 (ver o cabeçalho): o runner do repositório (alvo local) sobe as quatro; o schema bate.
    const hoje = await aplicarPeloRunner(URL_B);
    assert.equal(hoje.status, 0, hoje.saida);
    for (const n of [NOME_TIPO, NOME_BASE, NOME_ABASTECIMENTO, NOME_CULTURAS, NOME_AREA_CULTURA, NOME_REFORCO, NOME_MEDICAO_FORRAGEM, NOME_DIAS_DESCANSO]) assert.ok(hoje.saida.includes(`Applying migration \`${n}\``), hoje.saida);
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
