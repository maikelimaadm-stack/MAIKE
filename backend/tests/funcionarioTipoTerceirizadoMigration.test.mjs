/**
 * D-PROD-209 — a migration CONTRACT `20261116100000_funcionario_tipo_terceirizado` (o tipo do funcionário, papel do
 * parceiro, passa a ser Mensalista, Diarista ou Terceirizado: o CHECK "Fornecedor_funcionario_check" volta igual, com
 * TERCEIRIZADO no lugar de TAREFEIRO) de ponta a ponta, contra PostgreSQL real, em bancos PRÓPRIOS criados e apagados por
 * este teste (o banco da suíte não é tocado; os nomes começam pelo nome do banco da suíte).
 *
 * Partida (banco MODELO): as 59 migrations de nome ANTERIOR a esta (produção hoje: a última, a CONTRACT D-PROD-208),
 * pelo Prisma a partir de uma cópia temporária, e sementes em SQL cru: 2 clientes, os parceiros (um funcionário
 * MENSALISTA, um funcionário ainda sem tipo e um prestador). Os bancos do teste são cópias dele (CREATE DATABASE …
 * TEMPLATE).
 *
 * Schema × banco: o schema.prisma não muda (o Prisma não modela CHECK): `migrate diff` vazio antes e depois.
 *
 * RED (num banco NOVO, recusado pela guarda `guarda: …` e NADA muda): um parceiro com funcionario_tipo = TAREFEIRO; e o
 * runner com a conferência de alvo exigida e SEM MIGRATION_CONTRACT_AUTORIZADO=D-PROD-209 exato recusa antes de
 * qualquer DDL.
 *
 * GREEN pelo runner oficial (alvo conferido + decisão exata): 60/0, 94 tabelas, só o CHECK de Fornecedor mudou (com
 * TERCEIRIZADO no lugar de TAREFEIRO), o CHECK novo aceita MENSALISTA, DIARISTA e TERCEIRIZADO e recusa TAREFEIRO
 * (23514), `migrate diff` vazio e o postcheck do runbook APLICADA; reaplicar o arquivo é recusado pela guarda sem mudar
 * nada; 2ª execução sem pendência.
 *
 * Caminho B: o preflight, o envelope e o postcheck de `MAIKE-FUNCIONARIO-TIPO-RUNBOOK-RELEASE.md` (entre os marcadores
 * `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local: o envelope com o de produção
 * recusa; histórico fora de 59/0, a D-PROD-208 com outro checksum ou um parceiro TAREFEIRO recusa antes do DDL; o
 * envelope aplica (59 → 60, checksum = SHA-256 do arquivo, applied_steps_count 1, o mesmo schema do runner), o Prisma
 * não vê pendência, `migrate diff` vazio e o postcheck APLICADA; repetir o envelope recusa.
 *
 * D-PROD-210: a CONTRACT `20261116200000_formulacao_base_consumo` (base do consumo; altera só as 3 tabelas das
 * Formulações) e D-PROD-211: a CONTRACT `20261116300000_abastecimento_atividade` (o abastecimento ligado à atividade:
 * colunas, CHECKs e FKs em AbastecimentoBem), de nome posterior, não existiam no dia desta e mudam o schema.prisma.
 * Este teste fica NO DIA DA D-PROD-209: o runner oficial roda sobre um espelho do repositório com só as pastas até esta
 * (`runnerDoDia`, ver `espelhoDoRunner.mjs`), e o `migrate diff` contra o schema.prisma de hoje acusa a diferença das
 * duas (exit 2) até elas subirem. O FT-08 prova a ordem de produção, num banco à parte: esta pelo runner do dia, depois
 * a D-PROD-210 pelo runner do dia dela (espelho até ela; 61/0) e, por último, pelo runner do repositório com a decisão
 * exata, a D-PROD-211 (62/0, 94 tabelas, `migrate diff` vazio); no caminho B, o runner do repositório (alvo local)
 * sobe as duas depois do envelope e o `migrate diff` fica vazio. D-PROD-215: a EXPAND `20261116500000_cadculturas`
 * (tabela nova CADCULTURAS), ainda posterior, não pede decisão.
 *
 * D-PROD-216: a CONTRACT aditiva `20261117000000_area_cultura` (a Área ligada à Cultura) e D-PROD-217: a CONTRACT
 * `20261117100000_abastecimento_fk_apontamento_atividade` (o reforço: UNIQUE em AtividadeApontamento e a FK do
 * apontamento de AbastecimentoBem com a atividade), de nomes posteriores ao da CADCULTURAS, também. No FT-08 a
 * D-PROD-211 passa a subir pelo runner do dia dela (espelho até ela; 62/0); pelo runner do dia da D-PROD-216 (espelho
 * até ela), com a decisão dela, a D-PROD-215 (sem decisão) e depois a D-PROD-216 (64/0); por último, pelo runner do
 * repositório com a decisão exata da D-PROD-217, o reforço, a ordem de produção (65/0, 95 tabelas, `migrate diff`
 * vazio); no caminho B, o runner do repositório sobe as cinco.
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

const NOME = '20261116100000_funcionario_tipo_terceirizado';
const DECISAO = 'D-PROD-209';
const ARQUIVO = join(MIGRATIONS, NOME, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** D-PROD-208: a anterior, a última que produção concluiu (o preflight e o envelope conferem o checksum dela). */
const NOME_ANTERIOR = '20261116000000_mao_obra_parceiro';
const CHECKSUM_ANTERIOR = '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0';
/** Pastas do repositório: a partida é o que vem ANTES desta; o GREEN, até esta (no dia da D-PROD-209). */
const PASTAS_HOJE = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
/** D-PROD-210: a CONTRACT da base do consumo, de nome posterior (ver o cabeçalho); fica fora do dia desta. */
const NOME_BASE = '20261116200000_formulacao_base_consumo';
/** D-PROD-211: a CONTRACT do abastecimento ligado à atividade, de nome posterior (ver o cabeçalho); fica fora do dia desta. */
const NOME_ABASTECIMENTO = '20261116300000_abastecimento_atividade';
/** D-PROD-215: a EXPAND do Cadastro de Culturas (tabela nova CADCULTURAS), ainda posterior; o runner do repositório a sobe sem decisão. */
const NOME_CULTURAS = '20261116500000_cadculturas';
/** D-PROD-216: a CONTRACT aditiva da Área ligada à Cultura (coluna, UNIQUE em CADCULTURAS e FK), ainda posterior. */
const NOME_AREA_CULTURA = '20261117000000_area_cultura';
/** D-PROD-217: a CONTRACT do reforço, ainda posterior (ver o cabeçalho); fica fora do dia desta. */
const NOME_REFORCO = '20261117100000_abastecimento_fk_apontamento_atividade';
/** D-PROD-219: a EXPAND da Medição de Forragem (tabela nova MEDICAOFORRAGEM), ainda posterior (depois da D-PROD-217); o runner do repositório a sobe sem decisão. */
const NOME_MEDICAO_FORRAGEM = '20261117200000_medicao_forragem';
const PASTAS = Object.freeze(PASTAS_HOJE.filter((n) => n <= NOME));
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME));
const TOTAL_MIGRATIONS = PASTAS.length;

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-FUNCIONARIO-TIPO-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const C1 = 'ftt-c1';
const C2 = 'ftt-c2';
const E1 = `${C1}-e1`;
/** O parceiro funcionário ainda sem tipo (os testes de dados mexem nele). */
const FU = `${C1}-fu2`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-209: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
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
/** D-PROD-210 — o runner oficial NO DIA DA D-PROD-209 (espelho com as pastas até esta; ver `espelhoDoRunner.mjs`). */
let ESPELHO;
const runnerDoDia = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-211 — o runner oficial NO DIA DA D-PROD-210 (espelho com as pastas até a base do consumo), para o FT-08. */
let ESPELHO_210;
const runnerAteBase = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_210,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-217 — o runner oficial NO DIA DA D-PROD-211 (espelho com as pastas até o abastecimento), para o FT-08. */
let ESPELHO_211;
const runnerAteAbastecimento = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    cwd: ESPELHO_211,
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
/** D-PROD-216 — o runner oficial NO DIA DA D-PROD-216 (espelho com as pastas até a Área ligada à Cultura), para o FT-08. */
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
  const dir = mkdtempSync(join(tmpdir(), 'maike-ftt-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of ANTERIORES) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-209: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Sementes em SQL cru: os parceiros (um funcionário mensalista, um funcionário sem tipo e um prestador) de 2 clientes. */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C1}', 'ftt1', 'Cliente FTT', now()), ('${C2}', 'ftt2', 'Cliente FTT 2', now())`);
  await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES
    ('${E1}', '${C1}', 1, 'F1', 'Fazenda 1', now()), ('${C2}-e1', '${C2}', 1, 'G1', 'Granja 1', now())`);
  await ins(`INSERT INTO "Fornecedor" (id, cliente_id, empresa_id, numero_cadastro, tipo_pessoa, nome, tipos, funcionario_tipo, funcionario_custo_hora, "updatedAt") VALUES
    ('${C1}-fu1', '${C1}', '${E1}', '1', 'Física', 'JOÃO DA SILVA', ARRAY['funcionario'], 'MENSALISTA', 25, now()),
    ('${FU}', '${C1}', '${E1}', '2', 'Física', 'ANA SOUZA', ARRAY['funcionario'], NULL, NULL, now()),
    ('${C2}-pr1', '${C2}', '${C2}-e1', '1', 'Jurídica', 'PRESTADOR DO OUTRO', ARRAY['prestador_servico'], NULL, NULL, now())`);
};

/** Retrato do que a migration toca (e do que uma recusa não pode deixar): tabelas, constraints, índices, colunas, linhas e histórico. */
const SQL_RETRATO = `SELECT
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')) AS tabelas,
  (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace) AS constraints,
  (SELECT string_agg(indexname || ':' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public') AS indices,
  (SELECT coalesce(string_agg(c.relname || ':' || p.polname, ',' ORDER BY c.relname, p.polname), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid) AS politicas,
  (SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_name, ordinal_position)
     FROM information_schema.columns WHERE table_schema = 'public') AS colunas,
  (SELECT string_agg(id || ':' || coalesce(funcionario_tipo, '-'), ',' ORDER BY id) FROM "Fornecedor") AS parceiros,
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
const definicaoDoCheck = async (db) =>
  (await um(db, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'Fornecedor_funcionario_check' AND conrelid = '"Fornecedor"'::regclass`))?.d;
/** Executa um SQL que TEM de falhar com o SQLSTATE (e, se dado, citando o nome da constraint). */
const recusa = async (db, sql, sqlstate, nome) => {
  await assert.rejects(db.$executeRawUnsafe(sql), (e) => {
    const texto = `${e.message} ${JSON.stringify(e.meta ?? {})}`;
    assert.ok(texto.includes(sqlstate), `${sql}\n→ ${texto}`);
    if (nome) assert.ok(texto.includes(nome), `${sql}\n→ ${texto}`);
    return true;
  });
};
const tipoDo = (id, tipo) => `UPDATE "Fornecedor" SET funcionario_tipo = ${tipo === null ? 'NULL' : `'${tipo}'`} WHERE id = '${id}'`;

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
  const banco = `${PREFIXO}_ftt_${sufixo}`;
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
  ESPELHO_210 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_BASE }).dir;
  ESPELHO_211 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_ABASTECIMENTO }).dir;
  ESPELHO_216 = criarEspelhoDoRunner({ raiz: RAIZ, ate: NOME_AREA_CULTURA }).dir;
  PREFIXO = new URL(BASE_URL).pathname.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'maike';
  BANCO_MODELO = `${PREFIXO}_ftt_modelo`;
  for (const b of [`${PREFIXO}_ftt`, `${PREFIXO}_ftt_b`, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(comBanco(BASE_URL, BANCO_MODELO));
  const modelo = new PrismaClient({ datasourceUrl: comBanco(BASE_URL, BANCO_MODELO) });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  URL_T = await clonar(`${PREFIXO}_ftt`);
  URL_B = await clonar(`${PREFIXO}_ftt_b`);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  for (const b of [`${PREFIXO}_ftt`, `${PREFIXO}_ftt_b`, `${PREFIXO}_ftt_ordem`, BANCO_MODELO]) if (PREFIXO) await apagar(b);
  for (const e of [ESPELHO, ESPELHO_210, ESPELHO_211, ESPELHO_216]) if (e) rmSync(e, { recursive: true, force: true });
  await closePrismaClient();
});

describe('D-PROD-209 — migration CONTRACT do tipo do funcionário com TERCEIRIZADO no lugar de TAREFEIRO (PostgreSQL real)', () => {
  test('FT-01 partida: as 59 migrations de nome anterior a esta (a última a D-PROD-208), 94 tabelas, o CHECK com TAREFEIRO; schema × banco: só as diferenças da base do consumo e do abastecimento (D-PROD-210 e D-PROD-211, posteriores; o Prisma não modela CHECK); o preflight do runbook diz PRONTO e, com o system_identifier de produção, PARAR', async () => {
    assert.equal(ANTERIORES.length, 59, 'produção hoje: 59 migrations');
    assert.equal(ANTERIORES.at(-1), NOME_ANTERIOR);
    assert.equal(PASTAS.at(-1), NOME, 'no dia da D-PROD-209, esta era a migration de nome mais recente');
    assert.equal(TOTAL_MIGRATIONS, 60);
    assert.deepEqual(PASTAS_HOJE.filter((n) => n > NOME), [NOME_BASE, NOME_ABASTECIMENTO, NOME_CULTURAS, NOME_AREA_CULTURA, NOME_REFORCO, NOME_MEDICAO_FORRAGEM], 'D-PROD-210, D-PROD-211, D-PROD-215, D-PROD-216 e D-PROD-217: só a base do consumo, o abastecimento ligado à atividade, o Cadastro de Culturas, a Área ligada à Cultura e o reforço têm nome posterior a esta');
    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [59, 0, 0]);
    assert.equal(partida.tabelas.split(',').length, 94);
    const { checksum } = await um(db, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_ANTERIOR}'`);
    assert.equal(checksum, CHECKSUM_ANTERIOR, 'a anterior com o checksum que produção registrou');
    const def = await definicaoDoCheck(db);
    assert.ok(def.includes("'TAREFEIRO'") && !def.includes("'TERCEIRIZADO'"), def);
    // O CHECK de hoje ainda aceita TAREFEIRO e recusa TERCEIRIZADO (numa transação desfeita, nada fica).
    await recusa(db, tipoDo(FU, 'TERCEIRIZADO'), '23514', 'Fornecedor_funcionario_check');
    // D-PROD-210 e D-PROD-211 (ver o cabeçalho): o schema.prisma de hoje já tem a base do consumo e as colunas novas do
    // abastecimento.
    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 2, diff.saida);
    assert.match(diff.stdout, /AbastecimentoBem/);

    const q = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const [item, v] of Object.entries(q)) if (item !== 'VEREDITO') assert.ok(v.status === 'OK' || v.status.startsWith('ATENÇÃO'), `${item}: ${v.status} (${v.valor})`);
    for (const [item, v] of Object.entries(q)) if (!/^(VEREDITO|travas|transações)/.test(item)) assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.equal(q['migrations concluídas / em aberto'].valor, '59 / 0');
    assert.equal(q['a anterior (D-PROD-208) concluída com o checksum do repositório'].valor, '1');
    assert.equal(q['parceiros com funcionario_tipo = TAREFEIRO (tem de ser 0)'].valor, '0');
    assert.equal(q['CHECK Fornecedor_funcionario_check no formato anterior (com TAREFEIRO)'].valor, '1');
    assert.equal(q['tabelas em public'].valor, '94');
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    const producao = quadro(await consulta(URL_T, blocoDoRunbook('preflight')));
    assert.equal(producao['alvo: system_identifier'].status, 'PARAR');
    assert.match(producao.VEREDITO.valor, /^PARAR/);
    assert.match(quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID))).VEREDITO.valor, /^PARAR/);
    assert.deepEqual(await retrato(db), partida, 'o preflight e o postcheck só leem');
  });

  test('FT-02 o portão: o classificador diz CONTRACT D-PROD-209 sem violação, o arquivo e a guarda são os pinados; o histórico real da partida confere com só esta pendente, e é a CONTRACT a autorizar', async () => {
    const c = classificarMigrations([{ nome: NOME, sql: SQL_MIGRATION }]);
    assert.deepEqual(c.violacoes, []);
    assert.deepEqual([c.ok, c.expand, c.modo], [true, false, 'CONTRACT']);
    assert.deepEqual(c.tabelas_novas, []);
    assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
    assert.equal(c.contract.length, 1);
    assert.equal(c.contract[0].decisao, DECISAO);
    assert.deepEqual(c.contract[0].tabelas_removidas, []);
    assert.deepEqual(c.contract[0].constraints_alargadas, ['Fornecedor.Fornecedor_funcionario_check']);
    assert.deepEqual([c.contract[0].colunas_adicionadas, c.contract[0].colunas_removidas, c.contract[0].conversoes], [[], [], []]);
    assert.equal(MIGRATIONS_APROVADAS[NOME], CHECKSUM);
    assert.equal(CHECKSUM, '44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6');
    assert.doesNotMatch(SQL_MIGRATION, /D-PROD-\d+/, 'o número da decisão fica fora do arquivo');

    const linhas = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    const locais = PASTAS.map((n) => ({ nome: n, checksum: createHash('sha256').update(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8')).digest('hex') }));
    assert.deepEqual(conferirHistoricoRemoto({ locais, linhas }), { ok: true, codigo: null, pendentes: [NOME], falhas: [] });
    assert.deepEqual(contractsPendentes({ locais: PASTAS, linhas }), [{ nome: NOME, decisao: DECISAO }]);
    // Hoje, com as pastas do repositório, a base do consumo, o abastecimento, a Área ligada à Cultura e o reforço também pendem: são cinco CONTRACT pendentes.
    assert.deepEqual(contractsPendentes({ locais: PASTAS_HOJE, linhas }), [{ nome: NOME, decisao: DECISAO }, { nome: NOME_BASE, decisao: 'D-PROD-210' }, { nome: NOME_ABASTECIMENTO, decisao: 'D-PROD-211' }, { nome: NOME_AREA_CULTURA, decisao: 'D-PROD-216' }, { nome: NOME_REFORCO, decisao: 'D-PROD-217' }]);
  });

  test('FT-RED-1 um parceiro com funcionario_tipo = TAREFEIRO (num banco novo) → a guarda recusa e NADA muda', async () => {
    await emBancoNovo('r1', async (dbr, url) => {
      await dbr.$executeRawUnsafe(tipoDo(FU, 'TAREFEIRO'));
      const antes = await retrato(dbr);
      const r = await aplicarArquivo(url);
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, /guarda: há parceiro com funcionario_tipo = TAREFEIRO/);
      assert.deepEqual(await retrato(dbr), antes, 'nada da migration ficou');
      assert.ok((await definicaoDoCheck(dbr)).includes("'TAREFEIRO'"), 'o CHECK continua o anterior');
      // O runner (alvo local) também falha na guarda, e a linha da tentativa fica aberta (o caminho A manda resolver).
      const runner = await runnerDoDia(url);
      assert.notEqual(runner.status, 0, runner.saida);
      assert.match(runner.saida, /guarda: há parceiro com funcionario_tipo = TAREFEIRO/);
      const depois = await retrato(dbr);
      assert.deepEqual([depois.constraints, depois.parceiros], [antes.constraints, antes.parceiros]);
    });
  });

  test('FT-03 runner do dia com a conferência de alvo exigida e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando só a D-PROD-209, antes de qualquer DDL', async () => {
    const linhasAntes = (await um(db, 'SELECT count(*)::int AS n FROM _prisma_migrations')).n;
    // D-PROD-208 criou o CHECK que esta troca: não autoriza esta; nem a decisão em minúsculas (comparação exata).
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-208' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-209' }, { MIGRATION_CONTRACT_AUTORIZADO: ' D-PROD-209 ' }]) {
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

  test('FT-04 GREEN pelo runner oficial do dia (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-209): 60/0, 94 tabelas, só o CHECK de Fornecedor mudou (TERCEIRIZADO no lugar de TAREFEIRO), nenhum dado mudou; migrate diff só com as diferenças da base do consumo e do abastecimento (D-PROD-210 e D-PROD-211)', async () => {
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
    assert.deepEqual([depois.tabelas, depois.indices, depois.politicas, depois.colunas, depois.parceiros], [partida.tabelas, partida.indices, partida.politicas, partida.colunas, partida.parceiros]);
    assert.equal(depois.tabelas.split(',').length, 94);
    const antes = partida.constraints.split('\n');
    const agora = depois.constraints.split('\n');
    const sairam = antes.filter((c) => !agora.includes(c));
    const entraram = agora.filter((c) => !antes.includes(c));
    assert.equal(sairam.length, 1, sairam.join('\n'));
    assert.equal(entraram.length, 1, entraram.join('\n'));
    assert.ok(sairam[0].startsWith('Fornecedor_funcionario_check:') && entraram[0].startsWith('Fornecedor_funcionario_check:'));
    // Exatamente UMA troca no texto do CHECK: o resto (MENSALISTA, DIARISTA, os 2 custos ≥ 0) é o mesmo.
    assert.equal(entraram[0], sairam[0].split("'TAREFEIRO'").join("'TERCEIRIZADO'"));
    assert.notEqual(entraram[0], sairam[0]);
    const { validado } = await um(db, `SELECT convalidated AS validado FROM pg_constraint WHERE conname = 'Fornecedor_funcionario_check'`);
    assert.equal(validado, true);

    // D-PROD-210 e D-PROD-211 (ver o cabeçalho): até elas subirem, o schema.prisma de hoje acusa só as diferenças delas.
    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 2, diff.saida);
    assert.match(diff.stdout, /AbastecimentoBem/);
    assert.doesNotMatch(diff.stdout, /Fornecedor/);
  });

  test('FT-05 postcheck do runbook no banco aplicado pelo runner: tudo OK e VEREDITO APLICADA; o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
    assert.equal(pos['migrations concluídas / em aberto'].valor, '60 / 0');
    assert.equal(pos['CHECK Fornecedor_funcionario_check novo (TERCEIRIZADO, sem TAREFEIRO), validado'].valor, '1');
    assert.equal(pos['tabelas em public'].valor, '94');
    const pre = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const item of ['migrations concluídas / em aberto', '20261116100000_funcionario_tipo_terceirizado já registrada', 'CHECK Fornecedor_funcionario_check no formato anterior (com TAREFEIRO)']) {
      assert.equal(pre[item].status, 'PARAR', item);
    }
    assert.match(pre.VEREDITO.valor, /^PARAR/);
  });

  test('FT-06 o CHECK novo (23514): aceita MENSALISTA, DIARISTA, TERCEIRIZADO e nulo; recusa TAREFEIRO, outro valor, minúsculas e custo negativo', async () => {
    await recusa(db, tipoDo(FU, 'TAREFEIRO'), '23514', 'Fornecedor_funcionario_check');
    await recusa(db, tipoDo(FU, 'CLT'), '23514', 'Fornecedor_funcionario_check');
    await recusa(db, tipoDo(FU, 'terceirizado'), '23514', 'Fornecedor_funcionario_check');
    await recusa(db, `UPDATE "Fornecedor" SET funcionario_custo_hora = -1 WHERE id = '${FU}'`, '23514', 'Fornecedor_funcionario_check');
    await recusa(db, `UPDATE "Fornecedor" SET funcionario_custo_diaria = -0.01 WHERE id = '${FU}'`, '23514', 'Fornecedor_funcionario_check');
    for (const tipo of ['MENSALISTA', 'DIARISTA', null, 'TERCEIRIZADO']) await db.$executeRawUnsafe(tipoDo(FU, tipo));
    assert.equal((await um(db, `SELECT funcionario_tipo AS t FROM "Fornecedor" WHERE id = '${FU}'`)).t, 'TERCEIRIZADO');
    await db.$executeRawUnsafe(tipoDo(FU, null));
  });

  test('FT-07 reaplicar o migration.sql (psql, uma transação) é recusado pela guarda (o CHECK já não tem TAREFEIRO) e NADA muda; a 2ª execução do runner do dia não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /guarda: o CHECK "Fornecedor_funcionario_check" não está no formato do ajuste anterior/);
    assert.deepEqual(await retrato(db), antes);
    const segunda = await runnerDoDia(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
  });
});

describe('D-PROD-209 — ordem de produção com a D-PROD-210, a D-PROD-211, a D-PROD-215, a D-PROD-216 e a D-PROD-217 (posteriores)', () => {
  test('FT-08 num banco à parte com a mesma partida: esta pelo runner do dia (60/0); com o alvo conferido, as quatro CONTRACT posteriores pendem juntas e a decisão desta recusa antes de qualquer DDL; a D-PROD-210 e a D-PROD-211 pelo runner do dia de cada uma (61/0, 62/0); a D-PROD-216, com a decisão dela e depois da EXPAND da D-PROD-215 (sem decisão), pelo runner do dia dela (64/0); depois, pelo runner do repositório, só a D-PROD-217 pende: sem a decisão exata recusa, com ela 65/0, 95 tabelas, o CHECK com TERCEIRIZADO intacto e migrate diff vazio', async () => {
    const url = await clonar(`${PREFIXO}_ftt_ordem`);
    const dbo = new PrismaClient({ datasourceUrl: url });
    try {
      const conferencia = { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID };
      const dia = await runnerDoDia(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      assert.equal(dia.status, 0, dia.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [60, 0]);
      const check = await definicaoDoCheck(dbo);
      assert.ok(check.includes("'TERCEIRIZADO'") && !check.includes("'TAREFEIRO'"), check);
      const temBase = async () => (await um(dbo, `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADFORMULACAO' AND column_name = 'base_consumo'`)).n;
      assert.equal(await temBase(), 0);
      const juntas = await aplicarPeloRunner(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
      assert.equal(juntas.status, 1, juntas.saida);
      assert.ok(juntas.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_BASE} (D-PROD-210), ${NOME_ABASTECIMENTO} (D-PROD-211), ${NOME_AREA_CULTURA} (D-PROD-216), ${NOME_REFORCO} (D-PROD-217).`), juntas.saida);
      assert.match(juntas.saida, /Nenhuma migration foi executada/);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [60, 0]);
      // D-PROD-210, no dia dela (espelho até ela), com a decisão DELA.
      const base = await runnerAteBase(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-210' } });
      assert.equal(base.status, 0, base.saida);
      assert.ok(base.saida.includes(`CONTRACT autorizado: ${NOME_BASE} (D-PROD-210).`), base.saida);
      assert.ok(base.saida.includes(`Applying migration \`${NOME_BASE}\``), base.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [61, 0]);
      assert.equal(await temBase(), 1);
      // D-PROD-211, no dia dela (espelho até ela), com a decisão DELA.
      const abastecimento = await runnerAteAbastecimento(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-211' } });
      assert.equal(abastecimento.status, 0, abastecimento.saida);
      assert.ok(abastecimento.saida.includes(`CONTRACT autorizado: ${NOME_ABASTECIMENTO} (D-PROD-211).`), abastecimento.saida);
      assert.ok(abastecimento.saida.includes(`Applying migration \`${NOME_ABASTECIMENTO}\``), abastecimento.saida);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [62, 0]);
      // D-PROD-216, no dia dela (espelho até ela), com a decisão DELA: a EXPAND da D-PROD-215 (CADCULTURAS, sem decisão) e
      // depois a Área ligada à Cultura, no mesmo passo.
      const area = await runnerAte216(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-216' } });
      assert.equal(area.status, 0, area.saida);
      assert.ok(area.saida.includes(`CONTRACT autorizado: ${NOME_AREA_CULTURA} (D-PROD-216).`), area.saida);
      assert.ok(area.saida.includes(`Applying migration \`${NOME_CULTURAS}\``), area.saida);
      assert.ok(area.saida.indexOf(`Applying migration \`${NOME_CULTURAS}\``) < area.saida.indexOf(`Applying migration \`${NOME_AREA_CULTURA}\``), 'a D-PROD-215 antes da D-PROD-216');
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [64, 0]);
      // D-PROD-217, por último, pelo runner do repositório: sem a decisão exata recusa; com ela, aplica: a ordem de produção.
      const semDecisao = await aplicarPeloRunner(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-216' } });
      assert.equal(semDecisao.status, 1, semDecisao.saida);
      assert.ok(semDecisao.saida.includes(`migration CONTRACT pendente no alvo: ${NOME_REFORCO} (D-PROD-217).`), semDecisao.saida);
      assert.match(semDecisao.saida, /Nenhuma migration foi executada/);
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [64, 0]);
      const r = await aplicarPeloRunner(url, { runtime: url, extras: { ...conferencia, MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-217' } });
      assert.equal(r.status, 0, r.saida);
      assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME_REFORCO} (D-PROD-217).`), r.saida);
      assert.ok(r.saida.includes(`Applying migration \`${NOME_REFORCO}\``), r.saida);
      assert.ok(r.saida.includes(`Applying migration \`${NOME_MEDICAO_FORRAGEM}\``), r.saida);
      assert.ok(![NOME, NOME_BASE, NOME_ABASTECIMENTO, NOME_CULTURAS, NOME_AREA_CULTURA].some((n) => r.saida.includes(`Applying migration \`${n}\``)), r.saida);
      assert.ok(!vazou(r.saida, url));
      // D-PROD-219: a EXPAND da Medição de Forragem sobe no mesmo passo, depois do reforço, sem decisão.
      assert.deepEqual(Object.values(await historico(dbo)).slice(0, 2), [66, 0]);
      assert.equal((await retrato(dbo)).tabelas.split(',').length, 96);
      assert.equal(await definicaoDoCheck(dbo), check);
      const diff = await migrateDiff(url);
      assert.equal(diff.status, 0, diff.saida);
    } finally {
      await dbo.$disconnect();
      await apagar(`${PREFIXO}_ftt_ordem`);
    }
  });
});

describe('D-PROD-209 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
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

  test('TB-02 histórico fora de 59/0 (uma revertida ou uma em aberto), a anterior (D-PROD-208) com checksum divergente ou um parceiro TAREFEIRO recusa antes do DDL; restaurado, nada mudou', async () => {
    const tentar = async (esperado) => {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, esperado);
    };
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 58 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    }
    await dbB.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('ftt-aberta', 'x', '20261199000000_aberta', now(), 0)`);
    try {
      await tentar(/RELEASE_BLOCKED: histórico com 59 concluídas e 1 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'ftt-aberta'`);
    }
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${NOME_ANTERIOR}'`);
    try {
      await tentar(/RELEASE_BLOCKED: a anterior \(D-PROD-208\) ausente ou com checksum divergente/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${CHECKSUM_ANTERIOR}' WHERE migration_name = '${NOME_ANTERIOR}'`);
    }
    await dbB.$executeRawUnsafe(tipoDo(FU, 'TAREFEIRO'));
    try {
      await tentar(/RELEASE_BLOCKED: há parceiro com funcionario_tipo = TAREFEIRO/);
      // E o preflight diz PARAR na linha do TAREFEIRO.
      const q = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
      assert.deepEqual([q['parceiros com funcionario_tipo = TAREFEIRO (tem de ser 0)'].valor, q['parceiros com funcionario_tipo = TAREFEIRO (tem de ser 0)'].status], ['1', 'PARAR']);
      assert.match(q.VEREDITO.valor, /^PARAR/);
    } finally {
      await dbB.$executeRawUnsafe(tipoDo(FU, null));
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (59 → 60, checksum = SHA-256 do arquivo, applied_steps_count 1); o mesmo schema do runner; postcheck APLICADA; o Prisma do dia não vê pendência; o do repositório sobe a D-PROD-210 e a D-PROD-211 e o migrate diff fica vazio', async () => {
    const pre = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
    assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);

    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.equal(r.status, 0, r.stderr);
    const h = await historico(dbB);
    assert.deepEqual([h.concluidas, h.abertas, h.esta, h.linhas_esta], [ANTERIORES.length + 1, 0, 1, 1]);
    const linha = await um(dbB, `SELECT checksum, applied_steps_count::int AS passos, logs, finished_at IS NOT NULL AS concluida FROM _prisma_migrations WHERE migration_name = '${NOME}'`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1, logs: null, concluida: true });

    // O mesmo schema que o runner deixou no outro banco.
    const b = await retrato(dbB);
    const t = await retrato(db);
    assert.deepEqual([b.tabelas, b.constraints, b.indices, b.politicas, b.colunas], [t.tabelas, t.constraints, t.indices, t.politicas, t.colunas]);

    const pos = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);

    const runner = await runnerDoDia(URL_B);
    assert.equal(runner.status, 0, runner.saida);
    assert.match(runner.saida, /No pending migrations to apply/);
    // D-PROD-210 e D-PROD-211 (ver o cabeçalho): o runner do repositório (alvo local, sem a conferência) sobe as
    // posteriores; o schema bate.
    const hoje = await aplicarPeloRunner(URL_B);
    assert.equal(hoje.status, 0, hoje.saida);
    for (const n of [NOME_BASE, NOME_ABASTECIMENTO, NOME_CULTURAS, NOME_AREA_CULTURA, NOME_REFORCO, NOME_MEDICAO_FORRAGEM]) assert.ok(hoje.saida.includes(`Applying migration \`${n}\``), hoje.saida);
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
