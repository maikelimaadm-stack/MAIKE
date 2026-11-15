/**
 * D-PROD-207 — a migration EXPAND `20261115900000_atividade_mao_obra_servico` (os cadastros Funcionario e Servico, por
 * fazenda, e as linhas que fecham o custo do apontamento do dia: AtividadeApontamentoMaoObra e
 * AtividadeApontamentoServico; nenhuma coluna em tabela antiga) de ponta a ponta, contra PostgreSQL real, em bancos
 * PRÓPRIOS criados e apagados por este teste (o banco da suíte não é tocado; os nomes começam pelo nome do banco da
 * suíte).
 *
 * Partida (banco MODELO): as 57 migrations de nome ANTERIOR a esta (produção hoje: a última, a EXPAND da
 * faixa de tolerância da formulação, D-PROD-206), pelo Prisma a partir de uma cópia temporária, e sementes em SQL cru: 2 clientes,
 * 2 fazendas no primeiro, uma atividade ABERTA com um apontamento CONFIRMADO do dia, a unidade de medida, os centros de
 * custo das duas fazendas, os parceiros (prestador de serviço nas duas fazendas) e a unidade, o parceiro e o usuário
 * do outro cliente. Os bancos do teste são cópias dele (CREATE DATABASE … TEMPLATE).
 *
 * O portão: o classificador diz EXPAND (sem violação, as 4 tabelas, nenhuma coluna em tabela antiga), o arquivo é o
 * pinado e a conferência do histórico do alvo vê só esta pendente, sem CONTRACT a autorizar.
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`) com a conferência de alvo exigida e SEM
 * MIGRATION_CONTRACT_AUTORIZADO (EXPAND não pede): 58/0, 95 tabelas, RLS sem FORCE nas 4, a política do backend e
 * nenhum grant para anon/authenticated, as colunas, as constraints e os índices das tabelas antigas intactos,
 * `migrate diff` vazio e o postcheck do runbook APLICADA. Depois: os CHECKs (tipo e custos do funcionário, valor do
 * serviço, status e cancelamento, tipo de medida, custo com e sem snapshot, valores, operation_id), as FKs compostas
 * pelo tenant e pela fazenda (apontamento, funcionário, serviço e centro de custo da MESMA fazenda por construção; o
 * parceiro só pelo cliente, a fazenda dele é conferida no código), os únicos e o RESTRICT; reaplicar o arquivo falha
 * sem mudar nada; 2ª execução sem pendência.
 *
 * Caminho B: o preflight, o envelope e o postcheck de `MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md` (entre os
 * marcadores `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local: o envelope com o de
 * produção recusa; histórico fora de 57/0 ou a D-PROD-206 com outro checksum recusa antes do DDL; o envelope aplica
 * (57 → 58, checksum = SHA-256 do arquivo, applied_steps_count 1, o mesmo schema do runner), o Prisma não vê
 * pendência, `migrate diff` vazio e o postcheck APLICADA; repetir o envelope recusa.
 *
 * D-PROD-208: a CONTRACT `20261116000000_formulacao_base_consumo` (base do consumo na Formulação; altera só as 3
 * tabelas das Formulações, vazias aqui), da release SEGUINTE, tem nome posterior a esta e não existia no dia dela. O
 * runner com a conferência exigida não aplica CONTRACT sem a decisão exata: por isso, logo antes do runner do AM-03,
 * ela sobe FORA DE ORDEM pelo Prisma direto; o runner aplica só esta. O postcheck do runbook fixa o dia desta (58 / 0):
 * no banco do runner só a linha de contagem de migrations muda (59 / 0); APLICADA inteira é provada no caminho B
 * (TB-03), antes do runner, que lá aplica a D-PROD-208 depois do envelope.
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
import {
  DO_RLS_APROVADOS, MIGRATIONS_APROVADAS, MIGRATIONS_CONTRACT_APROVADAS, classificarMigrations, conferirHistoricoRemoto, contractsPendentes,
} from '../../scripts/deploy/premergeMigrateLib.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const NOME = '20261115900000_atividade_mao_obra_servico';
const ARQUIVO = join(MIGRATIONS, NOME, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** D-PROD-206: a anterior, a última que produção concluiu (o preflight e o envelope conferem o checksum dela). */
const NOME_ANTERIOR = '20261115200000_formulacao_faixa_tolerancia';
/** D-PROD-208: a CONTRACT da base do consumo, de nome posterior; sobe fora de ordem antes do runner (ver o cabeçalho). */
const NOME_BASE = '20261116000000_formulacao_base_consumo';
const CHECKSUM_ANTERIOR = 'bb8be379c241341e1ba45a7d7da8258aef77d5f4e089db302c8d655608d58e4c';
/** Pastas do repositório: a partida é o que vem ANTES desta (produção hoje); o GREEN, todas. */
const PASTAS = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME));
const TOTAL_MIGRATIONS = PASTAS.length;
const NOVAS = Object.freeze(['AtividadeApontamentoMaoObra', 'AtividadeApontamentoServico', 'Funcionario', 'Servico']);
/** As tabelas ANTIGAS que as FKs novas referenciam: só ganham as FKs; nenhuma coluna, constraint ou índice muda nelas. */
const REFERENCIADAS = Object.freeze(['AtividadeApontamento', 'CentroCusto', 'Cliente', 'Empresa', 'Fornecedor', 'UnidadeMedida', 'Usuario']);

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const C1 = 'amo-c1';
const C2 = 'amo-c2';
const E1 = `${C1}-e1`;
const E2 = `${C1}-e2`;
const U1 = `${C1}-u1`;
const AP = `${C1}-ap1`;
const AP2 = `${C1}-ap2`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-207: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
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
const aplicarAnteriores = async (url, pastas = ANTERIORES) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-amo-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of pastas) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-207: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Sementes em SQL cru (o Prisma Client é o do schema novo; a partida ainda não tem as tabelas novas). */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C1}', 'amo1', 'Cliente AMO', now()), ('${C2}', 'amo2', 'Cliente AMO 2', now())`);
  await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES
    ('${E1}', '${C1}', 1, 'F1', 'Fazenda 1', now()), ('${E2}', '${C1}', 2, 'F2', 'Fazenda 2', now()), ('${C2}-e1', '${C2}', 1, 'G1', 'Granja 1', now())`);
  await ins(`INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, "updatedAt") VALUES
    ('${U1}', '${C1}', 'Operador', 'operador.amo', 'x', now()), ('${C2}-u1', '${C2}', 'Gerente', 'gerente.amo', 'x', now())`);
  await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${C1}-g1', '${C1}', 'Tratos', now())`);
  await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, permite_mao_obra, permite_servico, "updatedAt")
    VALUES ('${C1}-t1', '${C1}', 'ROÇADA', '${C1}-g1', 'Tratos', true, true, now())`);
  // Uma atividade em cada fazenda, cada uma com um apontamento CONFIRMADO do dia.
  await ins(`INSERT INTO "Atividade" (id, cliente_id, empresa_id, numero, nome, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id, grupo_atividade_nome,
      data_inicio, criado_por_usuario_id, "updatedAt") VALUES
    ('${C1}-atv1', '${C1}', '${E1}', '1', 'ROÇADA PASTO 01', '${C1}-t1', 'ROÇADA', '${C1}-g1', 'Tratos', '2026-11-15', '${U1}', now()),
    ('${C1}-atv2', '${C1}', '${E2}', '2', 'ROÇADA PASTO 02', '${C1}-t1', 'ROÇADA', '${C1}-g1', 'Tratos', '2026-11-15', '${U1}', now())`);
  await ins(`INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, operador_usuario_id, criado_por_usuario_id, "updatedAt") VALUES
    ('${AP}', '${C1}', '${E1}', '${C1}-atv1', '2026-11-15', 1, '${U1}', '${U1}', now()),
    ('${AP2}', '${C1}', '${E2}', '${C1}-atv2', '2026-11-15', 1, '${U1}', '${U1}', now())`);
  // A unidade do cadastro existente (por cliente), um centro de custo em cada fazenda e os parceiros prestadores.
  await ins(`INSERT INTO "UnidadeMedida" (id, cliente_id, numero_unidade, sigla, descricao, "updatedAt") VALUES
    ('${C1}-um1', '${C1}', '1', 'HA', 'Hectare', now()), ('${C1}-um2', '${C1}', '2', 'H', 'Hora', now()), ('${C2}-um1', '${C2}', '1', 'HA', 'Hectare', now())`);
  await ins(`INSERT INTO "CentroCusto" (id, cliente_id, empresa_id, numero, nome, "updatedAt") VALUES
    ('${C1}-cc1', '${C1}', '${E1}', '1', 'PASTAGENS', now()), ('${C1}-cc2', '${C1}', '${E2}', '2', 'PASTAGENS F2', now())`);
  await ins(`INSERT INTO "Fornecedor" (id, cliente_id, empresa_id, numero_cadastro, tipo_pessoa, nome, tipos, "updatedAt") VALUES
    ('${C1}-pr1', '${C1}', '${E1}', '1', 'Jurídica', 'ROÇADAS LTDA', ARRAY['prestador_servico'], now()),
    ('${C1}-pr2', '${C1}', '${E2}', '2', 'Jurídica', 'ROÇADAS DA F2', ARRAY['prestador_servico'], now()),
    ('${C2}-pr1', '${C2}', '${C2}-e1', '1', 'Jurídica', 'PRESTADOR DO OUTRO', ARRAY['prestador_servico'], now())`);
};

/** Retrato do que a migration toca (e do que uma recusa não pode deixar): tabelas, constraints, índices, políticas, colunas das referenciadas e o histórico. */
const SQL_RETRATO = `SELECT
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')) AS tabelas,
  (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace) AS constraints,
  (SELECT string_agg(indexname || ':' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public') AS indices,
  (SELECT coalesce(string_agg(c.relname || ':' || p.polname, ',' ORDER BY c.relname, p.polname), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid) AS politicas,
  (SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_name, ordinal_position)
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${REFERENCIADAS.map((t) => `'${t}'`).join(', ')})) AS colunas,
  (SELECT count(*)::int FROM _prisma_migrations WHERE rolled_back_at IS NULL) AS historico,
  (SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas`;
const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
const retrato = (db) => um(db, SQL_RETRATO).then((r) => ({ ...r }));
const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
const historico = (db) =>
  um(db, `SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE migration_name = '${NOME}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS esta
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
/** Só o que pertence às 4 novas (constraints e índices delas). */
const dasNovas = (texto) => texto.split('\n').filter((l) => /^(Funcionario|Servico|AtividadeApontamento(MaoObra|Servico))_/.test(l));
/** Monta um INSERT a partir de um objeto coluna → expressão SQL. */
const inserir = (tabela, v) => `INSERT INTO "${tabela}" (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`;

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

before(async () => {
  const p = getPrismaClient();
  BASE_URL = exigirUrlLocal(process.env.DATABASE_URL);
  // Nomes próprios, derivados do banco da suíte (cada execução paralela com banco próprio fica isolada).
  PREFIXO = new URL(BASE_URL).pathname.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'maike';
  BANCO_MODELO = `${PREFIXO}_amo_modelo`;
  for (const b of [`${PREFIXO}_amo`, `${PREFIXO}_amo_b`, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(comBanco(BASE_URL, BANCO_MODELO));
  const modelo = new PrismaClient({ datasourceUrl: comBanco(BASE_URL, BANCO_MODELO) });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  URL_T = await clonar(`${PREFIXO}_amo`);
  URL_B = await clonar(`${PREFIXO}_amo_b`);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  for (const b of [`${PREFIXO}_amo`, `${PREFIXO}_amo_b`, BANCO_MODELO]) if (PREFIXO) await apagar(b);
  await closePrismaClient();
});

describe('D-PROD-207 — migration EXPAND da mão de obra e do serviço de terceiro do apontamento (PostgreSQL real)', () => {
  test('AM-01 partida: as 57 migrations de nome anterior a esta (a última a D-PROD-206), 91 tabelas, as 4 novas ausentes; o preflight do runbook diz PRONTO e, com o system_identifier de produção, PARAR', async () => {
    assert.equal(ANTERIORES.length, 57, 'produção hoje: 57 migrations');
    assert.equal(ANTERIORES.at(-1), NOME_ANTERIOR);
    assert.deepEqual(PASTAS.filter((n) => n > NOME), [NOME_BASE], 'só a CONTRACT da D-PROD-208 tem nome posterior a esta');
    assert.equal(TOTAL_MIGRATIONS, 59);
    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [57, 0, 0]);
    const tabelas = partida.tabelas.split(',');
    assert.equal(tabelas.length, 91);
    for (const t of NOVAS) assert.ok(!tabelas.includes(t), t);
    for (const t of REFERENCIADAS) assert.ok(tabelas.includes(t), t);
    const { checksum } = await um(db, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_ANTERIOR}'`);
    assert.equal(checksum, CHECKSUM_ANTERIOR, 'a anterior com o checksum que produção registrou');

    const q = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    // As 2 últimas (travas e transações longas de outras sessões) só avisam: aqui podem pegar outra suíte no mesmo cluster.
    for (const [item, v] of Object.entries(q)) if (item !== 'VEREDITO') assert.ok(v.status === 'OK' || v.status.startsWith('ATENÇÃO'), `${item}: ${v.status} (${v.valor})`);
    for (const [item, v] of Object.entries(q)) if (!/^(VEREDITO|travas|transações)/.test(item)) assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.equal(q['migrations concluídas / em aberto'].valor, '57 / 0');
    assert.equal(q['a anterior (D-PROD-206) concluída com o checksum do repositório'].valor, '1');
    assert.equal(q['tabelas novas já presentes'].valor, '0');
    assert.equal(q['tabelas em public'].valor, '91');
    assert.equal(q['chaves compostas que as FKs novas referenciam'].valor, '6');
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    const producao = quadro(await consulta(URL_T, blocoDoRunbook('preflight')));
    assert.equal(producao['alvo: system_identifier'].status, 'PARAR');
    assert.match(producao.VEREDITO.valor, /^PARAR/);
    assert.deepEqual(await retrato(db), partida, 'o preflight só lê');
  });

  test('AM-02 o portão: o classificador diz EXPAND sem violação (as 4 tabelas, nenhuma coluna em tabela antiga), o arquivo e o RLS são os pinados, sem entrada CONTRACT; o histórico real da partida confere com só esta pendente e nenhum CONTRACT a autorizar', async () => {
    const c = classificarMigrations([{ nome: NOME, sql: SQL_MIGRATION }]);
    assert.deepEqual(c.violacoes, []);
    assert.deepEqual([c.ok, c.expand, c.modo], [true, true, 'EXPAND']);
    assert.deepEqual(c.contract, []);
    assert.deepEqual(c.tabelas_novas, [...NOVAS]);
    assert.deepEqual(c.colunas_novas_em_tabelas_antigas, []);
    assert.equal(MIGRATIONS_APROVADAS[NOME], CHECKSUM);
    assert.equal(CHECKSUM, '79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725');
    assert.ok(DO_RLS_APROVADOS.includes('16d2680d97d675bf0bd429eaee3ebe4caf5813473c43b9564698aa15c28f8403'));
    assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME), false);
    assert.doesNotMatch(SQL_MIGRATION, /D-PROD-\d+/, 'o número da decisão fica fora do arquivo');

    const linhas = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    const locais = PASTAS.map((n) => ({ nome: n, checksum: createHash('sha256').update(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8')).digest('hex') }));
    const h = conferirHistoricoRemoto({ locais, linhas });
    assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME, NOME_BASE], falhas: [] });
    // Esta é EXPAND; a única CONTRACT pendente na pasta real é a D-PROD-208, posterior (sobe fora de ordem no AM-03).
    assert.deepEqual(contractsPendentes({ locais: PASTAS, linhas }), [{ nome: NOME_BASE, decisao: 'D-PROD-208' }]);
  });

  test('AM-03 GREEN pelo runner oficial (alvo conferido, SEM MIGRATION_CONTRACT_AUTORIZADO; a D-PROD-208 fora de ordem antes): 59/0, 95 tabelas, RLS sem FORCE e a política nas 4, nenhum grant público, nenhuma coluna nova nas tabelas antigas, as constraints e os índices antigos intactos, índices pelo cliente e migrate diff vazio', async () => {
    // D-PROD-208 (ver o cabeçalho): a CONTRACT posterior sobe fora de ordem, para só esta pender no runner.
    await aplicarAnteriores(URL_T, [...ANTERIORES, NOME_BASE]);
    partida = await retrato(db);
    const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID } });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /alvo conferido nas duas conexões/);
    assert.ok(r.saida.includes(`Applying migration \`${NOME}\``), r.saida);
    assert.ok(!r.saida.includes(`Applying migration \`${NOME_BASE}\``), r.saida);
    assert.doesNotMatch(r.saida, /CONTRACT autorizado/);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [TOTAL_MIGRATIONS, 0, 1]);
    const linha = await um(db, `SELECT checksum, applied_steps_count::int AS passos FROM _prisma_migrations WHERE migration_name = '${NOME}' AND rolled_back_at IS NULL`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1 });

    const depois = await retrato(db);
    const tabelas = depois.tabelas.split(',');
    assert.equal(tabelas.length, 95);
    assert.deepEqual(tabelas, [...partida.tabelas.split(','), ...NOVAS].sort());
    // De tenant (com cliente_id): 76 → 80; a única preservada com cliente_id continua sendo OperadorProdutoMaike.
    const { tenant } = await um(db, `SELECT count(DISTINCT table_name)::int AS tenant FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'cliente_id' AND table_name <> 'OperadorProdutoMaike'`);
    assert.equal(tenant, 80);
    // R9: cliente_id NOT NULL nas 4.
    const semCliente = await db.$queryRawUnsafe(`SELECT table_name::text AS t FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'cliente_id' AND is_nullable = 'YES' AND table_name = ANY($1::text[])`, [...NOVAS]);
    assert.deepEqual(semCliente, []);
    // RLS ligado, sem FORCE, e a política do backend quando o papel existe; nenhum grant para anon/authenticated.
    const rls = await db.$queryRawUnsafe(`SELECT relname::text AS t, relrowsecurity AS rls, relforcerowsecurity AS forcar FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1::text[]) ORDER BY relname`, [...NOVAS]);
    assert.deepEqual(rls, NOVAS.map((t) => ({ t, rls: true, forcar: false })));
    const { vercel } = await um(db, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maike_vercel') AS vercel`);
    const politicas = await db.$queryRawUnsafe(`SELECT tablename::text AS t, policyname::text AS nome, cmd, array_to_string(roles, ',') AS papeis
      FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY 1`, [...NOVAS]);
    assert.deepEqual(politicas, vercel ? NOVAS.map((t) => ({ t, nome: 'maike_backend_all', cmd: 'ALL', papeis: 'maike_vercel' })) : []);
    const [{ grants }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS grants FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = ANY($1::text[]) AND grantee IN ('anon', 'authenticated', 'PUBLIC')`, [...NOVAS]);
    assert.equal(grants, 0);
    // Nenhuma coluna nova nas tabelas antigas que as FKs referenciam (a migration só cria tabelas).
    assert.equal(depois.colunas, partida.colunas, 'as colunas das referenciadas não mudaram');
    // As constraints e os índices de antes continuam (os novos são todos das 4 novas).
    const novasConstraints = depois.constraints.split('\n').filter((c) => !partida.constraints.split('\n').includes(c));
    assert.ok(partida.constraints.split('\n').every((c) => depois.constraints.split('\n').includes(c)), 'nenhuma constraint antiga mudou');
    assert.deepEqual(novasConstraints, dasNovas(depois.constraints));
    assert.equal(novasConstraints.length, 4 + 8 + 17, '4 pkeys, 8 CHECKs e 17 FKs');
    for (const fk of novasConstraints.filter((x) => /:FOREIGN KEY /.test(x))) {
      assert.match(fk, /FOREIGN KEY \(cliente_id[,)]/, `R9/R11: FK composta pelo tenant: ${fk}`);
      assert.match(fk, /ON UPDATE CASCADE ON DELETE RESTRICT$/, `RESTRICT: ${fk}`);
    }
    const novosIndices = depois.indices.split('\n').filter((i) => !partida.indices.split('\n').includes(i));
    assert.ok(partida.indices.split('\n').every((i) => depois.indices.split('\n').includes(i)), 'nenhum índice antigo mudou');
    assert.deepEqual(novosIndices, dasNovas(depois.indices));
    assert.equal(novosIndices.length, 4 + 23, '4 pkeys e 23 índices');
    for (const i of novosIndices.filter((x) => !/_pkey:/.test(x))) assert.match(i, /USING btree \(cliente_id[,)]/, `R10: ${i}`);

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('AM-04 postcheck do runbook no banco aplicado pelo runner: tudo OK/CONFIRA menos a contagem de migrations, que a D-PROD-208, posterior, muda (59 / 0); o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    // O postcheck foi escrito para o dia desta (58 / 0); aqui a D-PROD-208 também está aplicada (ver o cabeçalho). O
    // postcheck inteiro, APLICADA, é provado no banco do caminho B (TB-03) antes do runner.
    for (const [item, v] of Object.entries(pos)) {
      if (item === 'VEREDITO') continue;
      if (item === 'migrations concluídas / em aberto') assert.deepEqual([v.valor, v.status], ['59 / 0', 'PARAR'], item);
      else assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    }
    assert.match(pos.VEREDITO.valor, /^PARAR/);
    assert.equal(pos['tabelas em public'].valor, '95');
    assert.equal(pos['tabelas novas presentes / linhas nelas'].valor, '4 / 0');
    assert.equal(pos['os 8 CHECKs, validados'].valor, '8');
    assert.equal(pos['FKs: total / compostas pelo cliente, RESTRICT/CASCADE e validadas'].valor, '17 / 17');
    assert.equal(pos['FKs da mesma fazenda (cliente_id, empresa_id, …)'].valor, '5');
    assert.equal(pos['índices (sem as pkeys): total / começando por cliente_id / únicos'].valor, '23 / 23 / 14');
    assert.equal(pos['grants para anon/authenticated/PUBLIC nas 4 novas'].valor, '0');
    const pre = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const item of ['20261115900000_atividade_mao_obra_servico já registrada', 'tabelas novas já presentes', 'migrations concluídas / em aberto', 'tabelas em public']) {
      assert.equal(pre[item].status, 'PARAR', item);
    }
    assert.match(pre.VEREDITO.valor, /^PARAR/);
  });

  test('AM-05 CHECKs das 4 novas (23514): tipo e custos do funcionário, nome e valor do serviço, status e cancelamento, tipo de medida, quantidade, custo com e sem snapshot, valores, unidade e operation_id; os registros válidos passam', async () => {
    const funcionario = (campos = {}) => inserir('Funcionario', { id: "'amo-f-x'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, numero: "'90'", nome: "'JOÃO'",
      tipo: "'DIARISTA'", custo_diaria: 120, '"updatedAt"': 'now()', ...campos });
    await recusa(db, funcionario({ tipo: "'CLT'" }), '23514', 'Funcionario_valores_check');
    await recusa(db, funcionario({ custo_hora: -1 }), '23514', 'Funcionario_valores_check');
    await recusa(db, funcionario({ custo_diaria: -0.01 }), '23514', 'Funcionario_valores_check');
    await recusa(db, funcionario({ nome: "'   '" }), '23514', 'Funcionario_valores_check');
    // Os válidos: um diarista e um mensalista (com custo/hora) na F1, e um tarefeiro sem custo na F2.
    await db.$executeRawUnsafe(funcionario({ id: "'amo-fun-1'", numero: "'1'" }));
    await db.$executeRawUnsafe(funcionario({ id: "'amo-fun-2'", numero: "'2'", nome: "'MARIA'", tipo: "'MENSALISTA'", custo_diaria: 'NULL', custo_hora: 25, cargo: "'Tratorista'" }));
    await db.$executeRawUnsafe(funcionario({ id: "'amo-fun-3'", numero: "'3'", empresa_id: `'${E2}'`, nome: "'JOSÉ'", tipo: "'TAREFEIRO'", custo_diaria: 'NULL' }));

    const servico = (campos = {}) => inserir('Servico', { id: "'amo-s-x'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, numero: "'90'", nome: "'ROÇADA MECANIZADA'",
      unidade_medida_id: `'${C1}-um1'`, centro_custo_padrao_id: `'${C1}-cc1'`, valor_referencia: 80, '"updatedAt"': 'now()', ...campos });
    await recusa(db, servico({ valor_referencia: -1 }), '23514', 'Servico_valores_check');
    await recusa(db, servico({ nome: "''" }), '23514', 'Servico_valores_check');
    await db.$executeRawUnsafe(servico({ id: "'amo-ser-1'", numero: "'1'" }));
    await db.$executeRawUnsafe(servico({ id: "'amo-ser-2'", numero: "'2'", empresa_id: `'${E2}'`, nome: "'APLICAÇÃO AÉREA'", centro_custo_padrao_id: 'NULL', valor_referencia: 'NULL' }));

    const maoObra = (campos = {}) => inserir('AtividadeApontamentoMaoObra', { id: "'amo-mo-x'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, apontamento_id: `'${AP}'`,
      ordem: 1, status: "'CONFIRMADO'", funcionario_id: "'amo-fun-1'", tipo_medida: "'DIARIA'", quantidade: 1, custo_unitario: 120, custo_total: 120,
      operation_id: "'amo-op-mao-obra-x'", criado_por_usuario_id: `'${U1}'`, '"updatedAt"': 'now()', ...campos });
    const cancelado = { status: "'CANCELADO'", cancelado_em: 'now()', motivo_cancelamento: "'lançado errado'", cancelamento_origem: "'LINHA'", cancelado_por_usuario_id: `'${U1}'` };
    await recusa(db, maoObra({ status: "'RASCUNHO'" }), '23514', 'AtividadeApontamentoMaoObra_status_check');
    await recusa(db, maoObra({ status: "'CANCELADO'" }), '23514', 'AtividadeApontamentoMaoObra_status_check');
    await recusa(db, maoObra({ cancelado_em: 'now()' }), '23514', 'AtividadeApontamentoMaoObra_status_check');
    await recusa(db, maoObra({ ...cancelado, cancelamento_origem: "'SISTEMA'" }), '23514', 'AtividadeApontamentoMaoObra_status_check');
    await recusa(db, maoObra({ ...cancelado, motivo_cancelamento: 'NULL' }), '23514', 'AtividadeApontamentoMaoObra_status_check');
    await recusa(db, maoObra({ tipo_medida: "'SEMANA'" }), '23514', 'AtividadeApontamentoMaoObra_valores_check');
    await recusa(db, maoObra({ quantidade: 0 }), '23514', 'AtividadeApontamentoMaoObra_valores_check');
    await recusa(db, maoObra({ ordem: 0 }), '23514', 'AtividadeApontamentoMaoObra_valores_check');
    await recusa(db, maoObra({ custo_unitario: -1, custo_total: -1 }), '23514', 'AtividadeApontamentoMaoObra_valores_check');
    // Custo é par: os dois nulos (sem custo no cadastro) ou os dois presentes, com total ≥ 0.
    await recusa(db, maoObra({ custo_total: 'NULL' }), '23514', 'AtividadeApontamentoMaoObra_valores_check');
    await recusa(db, maoObra({ custo_unitario: 'NULL' }), '23514', 'AtividadeApontamentoMaoObra_valores_check');
    await recusa(db, maoObra({ custo_total: -1 }), '23514', 'AtividadeApontamentoMaoObra_valores_check');
    await recusa(db, maoObra({ operation_id: "'curto'" }), '23514', 'AtividadeApontamentoMaoObra_textos_check');
    await recusa(db, maoObra({ operation_id: "'tem espaço no meio'" }), '23514', 'AtividadeApontamentoMaoObra_textos_check');
    // As válidas: diária com snapshot, hora sem custo (cadastro sem custo) e uma cancelada por edição.
    await db.$executeRawUnsafe(maoObra({ id: "'amo-mo-1'", operation_id: "'amo-op-mao-obra-1'" }));
    await db.$executeRawUnsafe(maoObra({ id: "'amo-mo-2'", ordem: 2, operation_id: "'amo-op-mao-obra-2'", funcionario_id: "'amo-fun-2'", tipo_medida: "'HORA'",
      quantidade: 8.5, custo_unitario: 'NULL', custo_total: 'NULL' }));
    await db.$executeRawUnsafe(maoObra({ id: "'amo-mo-3'", ordem: 3, operation_id: "'amo-op-mao-obra-3'", tipo_medida: "'TAREFA'", quantidade: 2,
      custo_unitario: 50, custo_total: 100, ...cancelado, cancelamento_origem: "'EDICAO'" }));

    const servicoLinha = (campos = {}) => inserir('AtividadeApontamentoServico', { id: "'amo-sl-x'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, apontamento_id: `'${AP}'`,
      ordem: 1, status: "'CONFIRMADO'", servico_id: "'amo-ser-1'", fornecedor_parceiro_id: `'${C1}-pr1'`, quantidade: 10, unidade: "'HA'", valor_unitario: 80,
      valor_total: 800, operation_id: "'amo-op-servico-x'", criado_por_usuario_id: `'${U1}'`, '"updatedAt"': 'now()', ...campos });
    await recusa(db, servicoLinha({ status: "'ABERTO'" }), '23514', 'AtividadeApontamentoServico_status_check');
    await recusa(db, servicoLinha({ status: "'CANCELADO'", cancelado_em: 'now()', cancelamento_origem: "'LINHA'" }), '23514', 'AtividadeApontamentoServico_status_check');
    await recusa(db, servicoLinha({ cancelamento_origem: "'LINHA'" }), '23514', 'AtividadeApontamentoServico_status_check');
    await recusa(db, servicoLinha({ quantidade: -1 }), '23514', 'AtividadeApontamentoServico_valores_check');
    await recusa(db, servicoLinha({ valor_unitario: -1 }), '23514', 'AtividadeApontamentoServico_valores_check');
    await recusa(db, servicoLinha({ valor_total: -0.5 }), '23514', 'AtividadeApontamentoServico_valores_check');
    await recusa(db, servicoLinha({ ordem: 0 }), '23514', 'AtividadeApontamentoServico_valores_check');
    await recusa(db, servicoLinha({ unidade: "' '" }), '23514', 'AtividadeApontamentoServico_valores_check');
    await recusa(db, servicoLinha({ operation_id: "'x'" }), '23514', 'AtividadeApontamentoServico_textos_check');
    // As válidas: com o parceiro e o documento, e sem parceiro (opcional), valor zero; e uma cancelada pela cascata.
    await db.$executeRawUnsafe(servicoLinha({ id: "'amo-sl-1'", operation_id: "'amo-op-servico-1'", documento_referencia: "'NF 123'" }));
    await db.$executeRawUnsafe(servicoLinha({ id: "'amo-sl-2'", ordem: 2, operation_id: "'amo-op-servico-2'", fornecedor_parceiro_id: 'NULL', valor_unitario: 0, valor_total: 0 }));
    await db.$executeRawUnsafe(servicoLinha({ id: "'amo-sl-3'", ordem: 3, operation_id: "'amo-op-servico-3'", ...cancelado, cancelamento_origem: "'APONTAMENTO'" }));
    const n = await um(db, `SELECT (SELECT count(*)::int FROM "Funcionario") AS f, (SELECT count(*)::int FROM "Servico") AS s,
      (SELECT count(*)::int FROM "AtividadeApontamentoMaoObra") AS mo, (SELECT count(*)::int FROM "AtividadeApontamentoServico") AS sl`);
    assert.deepEqual(n, { f: 3, s: 2, mo: 3, sl: 3 }, 'só os válidos foram gravados');
  });

  test('AM-06 FKs compostas pelo tenant e pela fazenda (23503), os únicos (23505) e o RESTRICT: nada do que as linhas e os cadastros usam sai', async () => {
    const maoObra = (id, campos) => inserir('AtividadeApontamentoMaoObra', { id: `'${id}'`, cliente_id: `'${C1}'`, empresa_id: campos.empresa ?? `'${E1}'`,
      apontamento_id: campos.apontamento ?? `'${AP}'`, ordem: campos.ordem ?? 9, status: "'CONFIRMADO'", funcionario_id: campos.funcionario ?? "'amo-fun-1'",
      tipo_medida: "'DIARIA'", quantidade: 1, custo_unitario: 120, custo_total: 120, operation_id: `'${campos.op ?? `amo-op-${id}`}'`,
      criado_por_usuario_id: campos.usuario ?? `'${U1}'`, '"updatedAt"': 'now()' });
    const servicoLinha = (id, campos) => inserir('AtividadeApontamentoServico', { id: `'${id}'`, cliente_id: `'${C1}'`, empresa_id: campos.empresa ?? `'${E1}'`,
      apontamento_id: campos.apontamento ?? `'${AP}'`, ordem: campos.ordem ?? 9, status: "'CONFIRMADO'", servico_id: campos.servico ?? "'amo-ser-1'",
      fornecedor_parceiro_id: campos.parceiro ?? 'NULL', quantidade: 1, unidade: "'HA'", valor_unitario: 80, valor_total: 80,
      operation_id: `'${campos.op ?? `amo-op-${id}`}'`, criado_por_usuario_id: campos.usuario ?? `'${U1}'`, '"updatedAt"': 'now()' });
    // Cada caso quebra UMA FK só (a ordem dos gatilhos de FK não é contrato).
    // Os cadastros são da fazenda do cliente: empresa de outro cliente, unidade de outro cliente e centro de outra fazenda não servem.
    await recusa(db, inserir('Funcionario', { id: "'amo-fk-f'", cliente_id: `'${C1}'`, empresa_id: `'${C2}-e1'`, numero: "'91'", nome: "'X'", tipo: "'DIARISTA'", '"updatedAt"': 'now()' }),
      '23503', 'Funcionario_cliente_id_empresa_id_fkey');
    await recusa(db, `UPDATE "Servico" SET unidade_medida_id = '${C2}-um1' WHERE id = 'amo-ser-1'`, '23503', 'Servico_cliente_id_unidade_medida_id_fkey');
    await recusa(db, `UPDATE "Servico" SET centro_custo_padrao_id = '${C1}-cc2' WHERE id = 'amo-ser-1'`, '23503', 'Servico_centro_custo_padrao_fkey');
    await recusa(db, `UPDATE "Servico" SET centro_custo_padrao_id = '${C1}-cc1' WHERE id = 'amo-ser-2'`, '23503', 'Servico_centro_custo_padrao_fkey');
    // Mão de obra: o apontamento e o funcionário são da MESMA fazenda por construção (cliente, empresa, id).
    await recusa(db, maoObra('amo-fk1', { empresa: `'${E2}'`, funcionario: "'amo-fun-3'" }), '23503', 'AtividadeApontamentoMaoObra_apontamento_fkey');
    await recusa(db, maoObra('amo-fk2', { funcionario: "'amo-fun-3'" }), '23503', 'AtividadeApontamentoMaoObra_funcionario_fkey');
    await recusa(db, maoObra('amo-fk3', { funcionario: "'nao-existe'" }), '23503', 'AtividadeApontamentoMaoObra_funcionario_fkey');
    await recusa(db, maoObra('amo-fk4', { usuario: `'${C2}-u1'` }), '23503', 'AtividadeApontamentoMaoObra_criado_por_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoMaoObra" SET cancelado_por_usuario_id = '${C2}-u1' WHERE id = 'amo-mo-3'`, '23503', 'AtividadeApontamentoMaoObra_cancelado_por_fkey');
    // Serviço: o apontamento e o serviço da MESMA fazenda por construção; o parceiro só pelo cliente.
    await recusa(db, servicoLinha('amo-fk5', { empresa: `'${E2}'`, servico: "'amo-ser-2'" }), '23503', 'AtividadeApontamentoServico_apontamento_fkey');
    await recusa(db, servicoLinha('amo-fk6', { servico: "'amo-ser-2'" }), '23503', 'AtividadeApontamentoServico_servico_fkey');
    await recusa(db, servicoLinha('amo-fk7', { parceiro: `'${C2}-pr1'` }), '23503', 'AtividadeApontamentoServico_parceiro_fkey');
    await recusa(db, servicoLinha('amo-fk8', { usuario: `'${C2}-u1'` }), '23503', 'AtividadeApontamentoServico_criado_por_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoServico" SET cancelado_por_usuario_id = '${C2}-u1' WHERE id = 'amo-sl-3'`, '23503', 'AtividadeApontamentoServico_cancelado_por_fkey');
    // Limite documentado (contrato §1): o parceiro só tem chave (cliente_id, id); o de OUTRA fazenda do mesmo cliente
    // passa no banco — a mesma fazenda é conferida no código (FOR KEY SHARE). Numa transação desfeita, nada fica.
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(servicoLinha('amo-limite', { parceiro: `'${C1}-pr2'` }));
      await tx.$executeRawUnsafe('SELECT 1/0');
    }).then(() => assert.fail('a transação deveria ter sido desfeita'), (e) => assert.match(`${e.message} ${JSON.stringify(e.meta ?? {})}`, /22012|division by zero/));
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM "AtividadeApontamentoServico" WHERE id = 'amo-limite'`)).n, 0);
    // Os únicos (o Prisma devolve só o DETAIL do 23505: a chave o identifica): a mesma operation_id e a mesma ordem no
    // apontamento, em cada linha; o mesmo número de funcionário e de serviço no cliente.
    await recusa(db, maoObra('amo-uq1', { op: 'amo-op-mao-obra-1' }), '23505', 'Key (cliente_id, operation_id)');
    await recusa(db, `UPDATE "AtividadeApontamentoMaoObra" SET ordem = 1 WHERE id = 'amo-mo-2'`, '23505', 'Key (cliente_id, apontamento_id, ordem)');
    await recusa(db, servicoLinha('amo-uq2', { op: 'amo-op-servico-1' }), '23505', 'Key (cliente_id, operation_id)');
    await recusa(db, `UPDATE "AtividadeApontamentoServico" SET ordem = 1 WHERE id = 'amo-sl-2'`, '23505', 'Key (cliente_id, apontamento_id, ordem)');
    await recusa(db, `UPDATE "Funcionario" SET numero = '1' WHERE id = 'amo-fun-3'`, '23505', 'Key (cliente_id, numero)');
    await recusa(db, `UPDATE "Servico" SET numero = '1' WHERE id = 'amo-ser-2'`, '23505', 'Key (cliente_id, numero)');
    // RESTRICT: o apontamento, o funcionário, o serviço, o parceiro, a unidade, o centro de custo, a fazenda e o usuário usados não saem.
    for (const [sql, nome] of [
      [`DELETE FROM "AtividadeApontamento" WHERE id = '${AP}'`, null],
      [`DELETE FROM "Funcionario" WHERE id = 'amo-fun-1'`, 'AtividadeApontamentoMaoObra_funcionario_fkey'],
      [`DELETE FROM "Servico" WHERE id = 'amo-ser-1'`, 'AtividadeApontamentoServico_servico_fkey'],
      [`DELETE FROM "Fornecedor" WHERE id = '${C1}-pr1'`, 'AtividadeApontamentoServico_parceiro_fkey'],
      [`DELETE FROM "UnidadeMedida" WHERE id = '${C1}-um1'`, 'Servico_cliente_id_unidade_medida_id_fkey'],
      [`DELETE FROM "CentroCusto" WHERE id = '${C1}-cc1'`, 'Servico_centro_custo_padrao_fkey'],
      [`DELETE FROM "Empresa" WHERE id = '${E1}'`, null],
      [`DELETE FROM "Usuario" WHERE id = '${U1}'`, null],
    ]) await recusa(db, sql, '23503', nome ?? undefined);
    // Um funcionário e um serviço SEM linha saem (nenhuma FK os prende): o RESTRICT é das linhas, não do cadastro.
    const apagados = [];
    await db.$transaction(async (tx) => {
      apagados.push(await tx.$executeRawUnsafe(`DELETE FROM "Funcionario" WHERE id = 'amo-fun-3'`));
      apagados.push(await tx.$executeRawUnsafe(`DELETE FROM "Servico" WHERE id = 'amo-ser-2'`));
      await tx.$executeRawUnsafe('SELECT 1/0');
    }).then(() => assert.fail('a transação deveria ter sido desfeita'), (e) => assert.match(`${e.message} ${JSON.stringify(e.meta ?? {})}`, /22012|division by zero/));
    assert.deepEqual(apagados, [1, 1], 'sem linha, o cadastro sairia (a transação foi desfeita)');
    const n = await um(db, `SELECT (SELECT count(*)::int FROM "Funcionario") AS f, (SELECT count(*)::int FROM "Servico") AS s,
      (SELECT count(*)::int FROM "AtividadeApontamentoMaoObra") AS mo, (SELECT count(*)::int FROM "AtividadeApontamentoServico") AS sl,
      (SELECT count(*)::int FROM "AtividadeApontamento") AS a`);
    assert.deepEqual(n, { f: 3, s: 2, mo: 3, sl: 3, a: 2 }, 'nada foi gravado nem apagado nas recusas');
  });

  test('AM-07 reaplicar o migration.sql (psql, uma transação) falha (as tabelas já existem) e NADA muda; a 2ª execução do runner não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /42P07/, 'tabela já existente');
    assert.deepEqual(await retrato(db), antes);
    const segunda = await aplicarPeloRunner(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
  });
});

describe('D-PROD-207 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
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

  test('TB-02 histórico fora de 57/0 (uma migration revertida ou uma em aberto) ou a anterior (D-PROD-206) com checksum divergente recusa antes do DDL; restaurado, nada mudou', async () => {
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    try {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /RELEASE_BLOCKED: histórico com 56 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    }
    await dbB.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('amo-aberta', 'x', '20261199000000_aberta', now(), 0)`);
    try {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /RELEASE_BLOCKED: histórico com 57 concluídas e 1 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'amo-aberta'`);
    }
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${NOME_ANTERIOR}'`);
    try {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /RELEASE_BLOCKED: a anterior \(D-PROD-206\) ausente ou com checksum divergente/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${CHECKSUM_ANTERIOR}' WHERE migration_name = '${NOME_ANTERIOR}'`);
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (57 → 58, checksum = SHA-256 do arquivo, applied_steps_count 1); o mesmo schema do runner; postcheck APLICADA; o Prisma não vê pendência; migrate diff vazio', async () => {
    const pre = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
    assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    assert.match(quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID))).VEREDITO.valor, /^PARAR/, 'antes de aplicar, o postcheck manda parar');

    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.equal(r.status, 0, r.stderr);
    const h = await historico(dbB);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [ANTERIORES.length + 1, 0, 1]);
    const linha = await um(dbB, `SELECT checksum, applied_steps_count::int AS passos, logs, finished_at IS NOT NULL AS concluida FROM _prisma_migrations WHERE migration_name = '${NOME}'`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1, logs: null, concluida: true });

    // O mesmo schema que o runner deixou no outro banco (tabelas, constraints e índices das novas, políticas e as colunas
    // das referenciadas). O banco do runner passou pelos testes de dados acima, mas nenhum deles mexe em schema.
    const b = await retrato(dbB);
    const t = await retrato(db);
    assert.deepEqual([b.tabelas, dasNovas(b.constraints), dasNovas(b.indices), b.politicas, b.colunas], [t.tabelas, dasNovas(t.constraints), dasNovas(t.indices), t.politicas, t.colunas]);

    const pos = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);

    // O registro manual vale para o Prisma: o runner não reaplica esta; só aplica a de nome posterior, a D-PROD-208 (não
    // existia no dia desta, ver o cabeçalho), e o schema bate com o schema.prisma; a 2ª execução já não vê pendência.
    const runner = await aplicarPeloRunner(URL_B);
    assert.equal(runner.status, 0, runner.saida);
    assert.ok(runner.saida.includes(`Applying migration \`${NOME_BASE}\``), runner.saida);
    assert.ok(!runner.saida.includes(`Applying migration \`${NOME}\``), runner.saida);
    const segunda = await aplicarPeloRunner(URL_B);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
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
