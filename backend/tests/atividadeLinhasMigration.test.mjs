/**
 * D-PROD-202 — a migration EXPAND `20261114600000_atividade_linhas_produto_maquina` (as linhas que geram custo no
 * apontamento do dia: AtividadeApontamentoProduto, AtividadeApontamentoProdutoConsumoLote e AtividadeApontamentoMaquina,
 * e duas colunas anuláveis, sem DEFAULT, em BemPatrimonial e TipoPatrimonial) de ponta a ponta, contra PostgreSQL real,
 * em bancos PRÓPRIOS criados e apagados por este teste (o banco da suíte não é tocado; os nomes começam pelo nome do
 * banco da suíte).
 *
 * Partida (banco MODELO): as 53 migrations de nome ANTERIOR a esta (produção hoje: a última, a CONTRACT da Atividade
 * cabeçalho, D-PROD-200), pelo Prisma a partir de uma cópia temporária, e sementes em SQL cru: 2 clientes, 2 fazendas
 * no primeiro, uma atividade ABERTA com um apontamento CONFIRMADO do dia, uma máquina com horímetro, um implemento e a
 * máquina de outra fazenda, os tipos patrimoniais, um produto com local, lote e a saída (mais um estorno), e o produto,
 * o lote e o usuário do outro cliente. Os bancos do teste são cópias dele (CREATE DATABASE … TEMPLATE).
 *
 * O portão: o classificador diz EXPAND (sem violação, as 3 tabelas e as 2 colunas), o arquivo é o pinado e a
 * conferência do histórico do alvo vê só esta (e a D-PROD-203, abaixo) pendente, sem CONTRACT a autorizar.
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`) com a conferência de alvo exigida e SEM
 * MIGRATION_CONTRACT_AUTORIZADO (EXPAND não pede): 54/0, 87 tabelas (55/0 e 90 com a D-PROD-203, abaixo), RLS sem FORCE nas 3, a política do backend e
 * nenhum grant para anon/authenticated, as 2 colunas DECIMAL(14,4) anuláveis sem DEFAULT (o bem e o tipo de antes com
 * NULL), as constraints e os índices das outras tabelas intactos, `migrate diff` vazio e o postcheck do runbook
 * APLICADA. Depois: os CHECKs (status, valores, medidor, implemento ≠ bem, estorno ≠ saída), as FKs compostas pelo
 * tenant e pela fazenda, os únicos e o RESTRICT; reaplicar o arquivo falha sem mudar nada; 2ª execução sem pendência.
 *
 * Caminho B: o preflight, o envelope e o postcheck de `MAIKE-ATIVIDADE-LINHAS-RUNBOOK-RELEASE.md` (entre os marcadores
 * `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local: o envelope com o de produção
 * recusa; histórico fora de 53/0 ou a D-PROD-200 com outro checksum recusa antes do DDL; o envelope aplica (53 → 54,
 * checksum = SHA-256 do arquivo, applied_steps_count 1, o mesmo schema do runner), o Prisma não vê pendência, `migrate
 * diff` vazio e o postcheck APLICADA; repetir o envelope recusa.
 *
 * D-PROD-203: a EXPAND `20261114700000_cadformulacao` (Formulações: 3 tabelas novas, nada em tabela antiga), da
 * release SEGUINTE, é a única de nome posterior a esta e não existia no dia desta: fica fora da partida (que é só o
 * que vem ANTES desta) e sobe nos GREEN que aplicam tudo o que pende no diretório real — o runner oficial, logo depois
 * desta (pela ordem dos nomes; EXPAND, sem autorização), e, no caminho B, o runner depois do envelope. O postcheck do
 * runbook fixa o histórico de produção naquele dia (54 / 0, 87 tabelas): passa inteiro no banco do caminho B antes do
 * runner e, no banco do runner, só as duas linhas de contagem mudam (55 / 0 e 90).
 *
 * D-PROD-205: a EXPAND `20261115100000_leitura_cocho` (1 tabela nova, LEITURACOCHO; nada em tabela antiga), de nome
 * ainda posterior, segue a mesma regra da D-PROD-203: fora da partida, sobe nos GREEN depois dela. As contagens no
 * banco do runner passam a 56 / 0 e 91.
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
  MIGRATIONS_APROVADAS, MIGRATIONS_CONTRACT_APROVADAS, classificarMigrations, conferirHistoricoRemoto, contractsPendentes,
} from '../../scripts/deploy/premergeMigrateLib.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const NOME = '20261114600000_atividade_linhas_produto_maquina';
const ARQUIVO = join(MIGRATIONS, NOME, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** D-PROD-200: a anterior, a última que produção concluiu (o preflight e o envelope conferem o checksum dela). */
const NOME_ANTERIOR = '20261114500000_atividade_cabecalho';
const CHECKSUM_ANTERIOR = 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb';
/** Pastas do repositório: a partida é o que vem ANTES desta (produção hoje); o GREEN, todas. */
const PASTAS = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME));
const TOTAL_MIGRATIONS = PASTAS.length;
const NOVAS = Object.freeze(['AtividadeApontamentoMaquina', 'AtividadeApontamentoProduto', 'AtividadeApontamentoProdutoConsumoLote']);
/** D-PROD-203: a EXPAND das Formulações, de nome posterior; não existia no dia desta (ver o cabeçalho). */
const NOME_FORMULACOES = '20261114700000_cadformulacao';
const TABELAS_FORMULACOES = Object.freeze(['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA']);
/** Constraints, índices e políticas das 3 tabelas das Formulações (só nos bancos em que o runner as aplicou). */
/** D-PROD-205: a EXPAND da Leitura de cocho, de nome ainda posterior (ver o cabeçalho). */
const NOME_LEITURA = '20261115100000_leitura_cocho';
const TABELAS_POSTERIORES = Object.freeze([...TABELAS_FORMULACOES, 'LEITURACOCHO']);
const daFormulacao = (l) => /^(CADFORMULACAO|LEITURACOCHO)/.test(l);
const COLUNAS = Object.freeze([['BemPatrimonial', 'custo_uso_unitario'], ['TipoPatrimonial', 'salto_maximo_medidor']]);

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-ATIVIDADE-LINHAS-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const C1 = 'alm-c1';
const C2 = 'alm-c2';
const E1 = `${C1}-e1`;
const E2 = `${C1}-e2`;
const U1 = `${C1}-u1`;
const AP = `${C1}-ap1`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-202: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
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
const aplicarAnteriores = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-alm-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of ANTERIORES) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-202: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Sementes em SQL cru (o Prisma Client é o do schema novo; a partida ainda não tem as colunas novas). */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${C1}', 'alm1', 'Cliente ALM', now()), ('${C2}', 'alm2', 'Cliente ALM 2', now())`);
  await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES
    ('${E1}', '${C1}', 1, 'F1', 'Fazenda 1', now()), ('${E2}', '${C1}', 2, 'F2', 'Fazenda 2', now()), ('${C2}-e1', '${C2}', 1, 'G1', 'Granja 1', now())`);
  await ins(`INSERT INTO "Usuario" (id, cliente_id, nome, login, senha_hash, "updatedAt") VALUES
    ('${U1}', '${C1}', 'Operador', 'operador.alm', 'x', now()), ('${C2}-u1', '${C2}', 'Gerente', 'gerente.alm', 'x', now())`);
  await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${C1}-g1', '${C1}', 'Tratos', now())`);
  await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, "updatedAt") VALUES ('${C1}-t1', '${C1}', 'PULVERIZAR', '${C1}-g1', 'Tratos', now())`);
  await ins(`INSERT INTO "Atividade" (id, cliente_id, empresa_id, numero, nome, tipo_atividade_id, tipo_atividade_nome, grupo_atividade_id, grupo_atividade_nome,
      data_inicio, criado_por_usuario_id, "updatedAt")
    VALUES ('${C1}-atv1', '${C1}', '${E1}', '1', 'CIGARRINHA PASTO 01', '${C1}-t1', 'PULVERIZAR', '${C1}-g1', 'Tratos', '2026-11-14', '${U1}', now())`);
  await ins(`INSERT INTO "AtividadeApontamento" (id, cliente_id, empresa_id, atividade_id, data_operacional, sequencia, operador_usuario_id, criado_por_usuario_id, "updatedAt")
    VALUES ('${AP}', '${C1}', '${E1}', '${C1}-atv1', '2026-11-14', 1, '${U1}', '${U1}', now())`);
  await ins(`INSERT INTO "FamiliaPatrimonial" (id, cliente_id, codigo, nome, natureza, "updatedAt") VALUES
    ('${C1}-fm', '${C1}', 'TRATORES', 'Tratores', 'MAQUINA', now()), ('${C1}-fi', '${C1}', 'GRADES', 'Grades', 'IMPLEMENTO', now())`);
  await ins(`INSERT INTO "TipoPatrimonial" (id, cliente_id, familia_id, codigo, nome, "updatedAt") VALUES
    ('${C1}-tm', '${C1}', '${C1}-fm', 'TRATOR', 'Trator', now()), ('${C1}-ti', '${C1}', '${C1}-fi', 'GRADE', 'Grade', now())`);
  await ins(`INSERT INTO "BemPatrimonial" (id, cliente_id, empresa_id, numero, nome, natureza, familia_id, tipo_id, medidor_tipo, medidor_unidade,
      medidor_leitura_inicial, medidor_leitura_atual, medidor_data_leitura, medidor_origem, "updatedAt") VALUES
    ('${C1}-b1', '${C1}', '${E1}', '1', 'Trator 01', 'MAQUINA', '${C1}-fm', '${C1}-tm', 'HORIMETRO', 'h', 100, 100, '2026-11-01', 'CADASTRO_INICIAL', now()),
    ('${C1}-b3', '${C1}', '${E2}', '3', 'Trator da F2', 'MAQUINA', '${C1}-fm', '${C1}-tm', 'HORIMETRO', 'h', 10, 10, '2026-11-01', 'CADASTRO_INICIAL', now())`);
  await ins(`INSERT INTO "BemPatrimonial" (id, cliente_id, empresa_id, numero, nome, natureza, familia_id, tipo_id, "updatedAt") VALUES
    ('${C1}-b2', '${C1}', '${E1}', '2', 'Grade 01', 'IMPLEMENTO', '${C1}-fi', '${C1}-ti', now()),
    ('${C1}-b4', '${C1}', '${E2}', '4', 'Grade da F2', 'IMPLEMENTO', '${C1}-fi', '${C1}-ti', now())`);
  for (const [c, e] of [[C1, E1], [C2, `${C2}-e1`]]) {
    await ins(`INSERT INTO "Produto" (id, cliente_id, empresa_id, numero_produto, nome_produto, unidade_principal_estoque, estoque_atual, "updatedAt")
      VALUES ('${c}-p1', '${c}', '${e}', '1', 'HERBICIDA', 'L', 8, now())`);
    await ins(`INSERT INTO "LocalEstoque" (id, cliente_id, numero_local, nome, "updatedAt") VALUES ('${c}-l1', '${c}', '1', 'GALPÃO', now())`);
    await ins(`INSERT INTO "EstoqueLoteNota" (id, cliente_id, empresa_id, produto_id, local_estoque_id, custo_unitario, quantidade_entrada, quantidade_disponivel, "updatedAt")
      VALUES ('${c}-lt1', '${c}', '${e}', '${c}-p1', '${c}-l1', 5, 10, 8, now())`);
  }
  await ins(`INSERT INTO "MovimentacaoEstoque" (id, cliente_id, empresa_id, numero_movimentacao, tipo_movimentacao, data_movimentacao, produto_id, quantidade,
      unidade_medida, valor_unitario, valor_total, "updatedAt") VALUES
    ('${C1}-mv1', '${C1}', '${E1}', '1', 'Saída', '2026-11-14 12:00:00', '${C1}-p1', 2, 'L', 5, 10, now()),
    ('${C1}-mv2', '${C1}', '${E1}', '2', 'Entrada', '2026-11-14 13:00:00', '${C1}-p1', 2, 'L', 5, 10, now()),
    ('${C1}-mv3', '${C1}', '${E1}', '3', 'Saída', '2026-11-14 14:00:00', '${C1}-p1', 1, 'L', 5, 5, now()),
    ('${C1}-mv4', '${C1}', '${E1}', '4', 'Saída', '2026-11-14 15:00:00', '${C1}-p1', 1, 'L', 5, 5, now())`);
};

/** Retrato do que a migration toca (e do que uma recusa não pode deixar): tabelas, constraints, índices, políticas, colunas e o histórico. */
const SQL_RETRATO = `SELECT
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')) AS tabelas,
  (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY k.conname) FROM pg_constraint k WHERE k.connamespace = 'public'::regnamespace) AS constraints,
  (SELECT string_agg(indexname || ':' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public') AS indices,
  (SELECT coalesce(string_agg(c.relname || ':' || p.polname, ',' ORDER BY c.relname, p.polname), '-') FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid) AS politicas,
  (SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_name, ordinal_position)
     FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('BemPatrimonial', 'TipoPatrimonial')) AS colunas,
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
/** Só o que pertence às 3 novas (constraints e índices delas). */
const dasNovas = (texto) => texto.split('\n').filter((l) => /^AtividadeApontamento(Produto|Maquina)/.test(l));

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
  BANCO_MODELO = `${PREFIXO}_alm_modelo`;
  for (const b of [`${PREFIXO}_alm`, `${PREFIXO}_alm_b`, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(comBanco(BASE_URL, BANCO_MODELO));
  const modelo = new PrismaClient({ datasourceUrl: comBanco(BASE_URL, BANCO_MODELO) });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  URL_T = await clonar(`${PREFIXO}_alm`);
  URL_B = await clonar(`${PREFIXO}_alm_b`);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  for (const b of [`${PREFIXO}_alm`, `${PREFIXO}_alm_b`, BANCO_MODELO]) if (PREFIXO) await apagar(b);
  await closePrismaClient();
});

describe('D-PROD-202 — migration EXPAND das linhas de produto e de máquina do apontamento (PostgreSQL real)', () => {
  test('LM-01 partida: as 53 migrations de nome anterior a esta (a última a D-PROD-200), 84 tabelas, as 3 novas e as 2 colunas ausentes; o preflight do runbook diz PRONTO e, com o system_identifier de produção, PARAR', async () => {
    assert.equal(ANTERIORES.length, 53, 'produção hoje: 53 migrations');
    assert.equal(ANTERIORES.at(-1), NOME_ANTERIOR);
    // D-PROD-203 (ver o cabeçalho): só a EXPAND das Formulações tem nome posterior a esta, e fica fora da partida.
    assert.deepEqual(PASTAS.filter((n) => n > NOME), [NOME_FORMULACOES, NOME_LEITURA], 'só as EXPAND da D-PROD-203 e da D-PROD-205 têm nome posterior a esta');
    assert.equal(TOTAL_MIGRATIONS, 56);
    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [53, 0, 0]);
    const tabelas = partida.tabelas.split(',');
    assert.equal(tabelas.length, 84);
    for (const t of NOVAS) assert.ok(!tabelas.includes(t), t);
    for (const [t, c] of COLUNAS) assert.ok(!partida.colunas.includes(`${t}.${c}:`), `${t}.${c}`);
    const { checksum } = await um(db, `SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_ANTERIOR}'`);
    assert.equal(checksum, CHECKSUM_ANTERIOR, 'a anterior com o checksum que produção registrou');

    const q = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    // As 2 últimas (travas e transações longas de outras sessões) só avisam: aqui podem pegar outra suíte no mesmo cluster.
    for (const [item, v] of Object.entries(q)) if (item !== 'VEREDITO') assert.ok(v.status === 'OK' || v.status.startsWith('ATENÇÃO'), `${item}: ${v.status} (${v.valor})`);
    for (const [item, v] of Object.entries(q)) if (!/^(VEREDITO|travas|transações)/.test(item)) assert.equal(v.status, 'OK', `${item}: ${v.status} (${v.valor})`);
    assert.equal(q['migrations concluídas / em aberto'].valor, '53 / 0');
    assert.equal(q['tabelas em public'].valor, '84');
    assert.equal(q['chaves compostas que as FKs novas referenciam'].valor, '7');
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    const producao = quadro(await consulta(URL_T, blocoDoRunbook('preflight')));
    assert.equal(producao['alvo: system_identifier'].status, 'PARAR');
    assert.match(producao.VEREDITO.valor, /^PARAR/);
    assert.deepEqual(await retrato(db), partida, 'o preflight só lê');
  });

  test('LM-02 o portão: o classificador diz EXPAND sem violação (as 3 tabelas e as 2 colunas), o arquivo é o pinado, sem entrada CONTRACT; o histórico real da partida confere com só esta (e, depois dela, a EXPAND da D-PROD-203) pendente e nenhum CONTRACT a autorizar', async () => {
    const c = classificarMigrations([{ nome: NOME, sql: SQL_MIGRATION }]);
    assert.deepEqual(c.violacoes, []);
    assert.deepEqual([c.ok, c.expand, c.modo], [true, true, 'EXPAND']);
    assert.deepEqual(c.contract, []);
    assert.deepEqual(c.tabelas_novas, [...NOVAS]);
    assert.deepEqual(c.colunas_novas_em_tabelas_antigas, COLUNAS.map(([t, col]) => `${t}.${col}`));
    assert.equal(MIGRATIONS_APROVADAS[NOME], CHECKSUM);
    assert.equal(CHECKSUM, 'e374c81d448711894a19825e319ed0d760128c9b77a02953647e4cf7a09a5489');
    assert.equal(Object.prototype.hasOwnProperty.call(MIGRATIONS_CONTRACT_APROVADAS, NOME), false);

    const linhas = await db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
    const locais = PASTAS.map((n) => ({ nome: n, checksum: createHash('sha256').update(readFileSync(join(MIGRATIONS, n, 'migration.sql'), 'utf8')).digest('hex') }));
    const h = conferirHistoricoRemoto({ locais, linhas });
    assert.deepEqual(h, { ok: true, codigo: null, pendentes: [NOME, NOME_FORMULACOES, NOME_LEITURA], falhas: [] });
    assert.deepEqual(contractsPendentes({ locais: PASTAS, linhas }), []);
  });

  test('LM-03 GREEN pelo runner oficial (alvo conferido, SEM MIGRATION_CONTRACT_AUTORIZADO): esta e depois a EXPAND da D-PROD-203, 55/0, 87 tabelas mais as 3 das Formulações, RLS sem FORCE e a política nas 3, nenhum grant público, as 2 colunas DECIMAL(14,4) anuláveis sem DEFAULT (o bem e o tipo de antes com NULL), o resto intacto e migrate diff vazio', async () => {
    const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID } });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /alvo conferido nas duas conexões/);
    assert.ok(r.saida.includes(`Applying migration \`${NOME}\``), r.saida);
    // D-PROD-203: a EXPAND das Formulações, pendente também, sobe logo depois desta (sem autorização).
    assert.ok(r.saida.includes(`Applying migration \`${NOME_FORMULACOES}\``), r.saida);
    assert.ok(r.saida.indexOf(`Applying migration \`${NOME}\``) < r.saida.indexOf(`Applying migration \`${NOME_FORMULACOES}\``), 'esta antes da D-PROD-203');
    assert.ok(r.saida.indexOf(`Applying migration \`${NOME_FORMULACOES}\``) < r.saida.indexOf(`Applying migration \`${NOME_LEITURA}\``), 'a D-PROD-203 antes da D-PROD-205');
    assert.doesNotMatch(r.saida, /CONTRACT autorizado/);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [TOTAL_MIGRATIONS, 0, 1]);
    const linha = await um(db, `SELECT checksum, applied_steps_count::int AS passos FROM _prisma_migrations WHERE migration_name = '${NOME}' AND rolled_back_at IS NULL`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1 });

    const depois = await retrato(db);
    const tabelas = depois.tabelas.split(',');
    // 84 + as 3 desta = 87; + as 3 das Formulações (D-PROD-203) e a LEITURACOCHO (D-PROD-205), aplicadas depois = 91.
    assert.equal(tabelas.length, 91);
    assert.deepEqual(tabelas.filter((t) => !TABELAS_POSTERIORES.includes(t)), [...partida.tabelas.split(','), ...NOVAS].sort());
    for (const t of TABELAS_POSTERIORES) assert.ok(tabelas.includes(t), t);
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
    // As 2 colunas: anuláveis, sem DEFAULT, e nenhuma linha preenchida (nada é migrado).
    const colunas = await db.$queryRawUnsafe(`SELECT table_name::text AS t, column_name::text AS c, data_type::text AS tipo, numeric_precision::int AS p,
        numeric_scale::int AS s, is_nullable::text AS nula, column_default AS padrao
      FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (('BemPatrimonial', 'custo_uso_unitario'), ('TipoPatrimonial', 'salto_maximo_medidor'))
      ORDER BY 1`);
    assert.deepEqual(colunas, COLUNAS.map(([t, c]) => ({ t, c, tipo: 'numeric', p: 14, s: 4, nula: 'YES', padrao: null })));
    assert.deepEqual(await um(db, `SELECT (SELECT count(*)::int FROM "BemPatrimonial" WHERE custo_uso_unitario IS NOT NULL) AS bens,
      (SELECT count(*)::int FROM "BemPatrimonial") AS total_bens, (SELECT count(*)::int FROM "TipoPatrimonial" WHERE salto_maximo_medidor IS NOT NULL) AS tipos`), { bens: 0, total_bens: 4, tipos: 0 });
    // As colunas de antes, as constraints e os índices das outras tabelas continuam (os novos são todos das 3 novas).
    const colunasAntes = partida.colunas.split(',');
    assert.ok(colunasAntes.every((c) => depois.colunas.split(',').includes(c)), 'as colunas de antes continuam iguais');
    assert.deepEqual(depois.colunas.split(',').filter((c) => !colunasAntes.includes(c)), COLUNAS.map(([t, c]) => `${t}.${c}:numeric:YES`));
    // As da D-PROD-203 (todas com nome começando por CADFORMULACAO) ficam fora: são da release seguinte.
    const novasConstraints = depois.constraints.split('\n').filter((c) => !partida.constraints.split('\n').includes(c) && !daFormulacao(c));
    assert.ok(partida.constraints.split('\n').every((c) => depois.constraints.split('\n').includes(c)), 'nenhuma constraint antiga mudou');
    assert.deepEqual(novasConstraints, dasNovas(depois.constraints));
    assert.equal(novasConstraints.length, 3 + 9 + 17, '3 pkeys, 9 CHECKs e 17 FKs');
    const novosIndices = depois.indices.split('\n').filter((i) => !partida.indices.split('\n').includes(i) && !daFormulacao(i));
    assert.ok(partida.indices.split('\n').every((i) => depois.indices.split('\n').includes(i)), 'nenhum índice antigo mudou');
    assert.deepEqual(novosIndices, dasNovas(depois.indices));
    assert.equal(novosIndices.length, 3 + 20, '3 pkeys e 20 índices');
    for (const i of novosIndices.filter((x) => !/_pkey:/.test(x))) assert.match(i, /USING btree \(cliente_id[,)]/, `R10: ${i}`);

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('LM-04 postcheck do runbook no banco aplicado pelo runner: tudo OK/CONFIRA menos as duas contagens que a D-PROD-203, posterior, muda (55 / 0 e 90 tabelas); o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    // O postcheck foi escrito para o dia desta (54 / 0, 87 tabelas); aqui a EXPAND da D-PROD-203 também está aplicada
    // (ver o cabeçalho). O postcheck inteiro, APLICADA, é provado no banco do caminho B (TB-03) antes do runner.
    const CONTAGENS = { 'migrations concluídas / em aberto': `${TOTAL_MIGRATIONS} / 0`, 'tabelas em public': '91' };
    assert.equal(TOTAL_MIGRATIONS, 56);
    for (const [item, v] of Object.entries(pos)) {
      if (item === 'VEREDITO') continue;
      if (item in CONTAGENS) assert.deepEqual([v.valor, v.status], [CONTAGENS[item], 'PARAR'], item);
      else assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    }
    assert.match(pos.VEREDITO.valor, /^PARAR/);
    assert.equal(pos['tabelas novas presentes / linhas nelas'].valor, '3 / 0');
    assert.equal(pos['bens com custo de uso / tipos com teto de salto (antes do código novo)'].valor, '0 / 0');
    assert.equal(pos['FKs: total / compostas pelo cliente, RESTRICT/CASCADE e validadas'].valor, '17 / 17');
    assert.equal(pos['índices (sem as pkeys): total / começando por cliente_id / únicos'].valor, '20 / 20 / 13');
    const pre = quadro(await consulta(URL_T, comSidLocal(blocoDoRunbook('preflight'), SID)));
    for (const item of ['20261114600000_atividade_linhas_produto_maquina já registrada', 'tabelas novas já presentes', 'migrations concluídas / em aberto', 'tabelas em public']) {
      assert.equal(pre[item].status, 'PARAR', item);
    }
    assert.equal(pre['colunas novas já presentes (BemPatrimonial.custo_uso_unitario, TipoPatrimonial.salto_maximo_medidor)'].valor, '2');
    assert.match(pre.VEREDITO.valor, /^PARAR/);
  });

  test('LM-05 CHECKs das 3 novas (23514): status e cancelamento, valores, unidade, operation_id, estorno ≠ saída, medidor (tipo, leituras, uso = final − inicial, sem medidor sem leitura) e implemento ≠ bem; as linhas válidas passam', async () => {
    const produto = (campos = {}) => {
      const v = { id: "'alm-x'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, apontamento_id: `'${AP}'`, ordem: 1, status: "'CONFIRMADO'", produto_id: `'${C1}-p1'`,
        local_estoque_id: `'${C1}-l1'`, quantidade: 2, unidade: "'L'", custo_unitario: 5, custo_total: 10, operation_id: "'alm-op-produto-x'",
        movimentacao_estoque_id: `'${C1}-mv1'`, criado_por_usuario_id: `'${U1}'`, '"updatedAt"': 'now()', ...campos };
      return `INSERT INTO "AtividadeApontamentoProduto" (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`;
    };
    const cancelado = { status: "'CANCELADO'", movimentacao_estorno_id: `'${C1}-mv2'`, cancelado_em: 'now()', motivo_cancelamento: "'lançado errado'", cancelamento_origem: "'LINHA'" };
    await recusa(db, produto({ status: "'RASCUNHO'" }), '23514', 'AtividadeApontamentoProduto_status_check');
    await recusa(db, produto({ status: "'CANCELADO'" }), '23514', 'AtividadeApontamentoProduto_status_check');
    await recusa(db, produto({ movimentacao_estorno_id: `'${C1}-mv2'` }), '23514', 'AtividadeApontamentoProduto_status_check');
    await recusa(db, produto({ ...cancelado, cancelamento_origem: "'SISTEMA'" }), '23514', 'AtividadeApontamentoProduto_status_check');
    await recusa(db, produto({ ...cancelado, motivo_cancelamento: 'NULL' }), '23514', 'AtividadeApontamentoProduto_status_check');
    await recusa(db, produto({ quantidade: 0 }), '23514', 'AtividadeApontamentoProduto_valores_check');
    await recusa(db, produto({ custo_unitario: -1 }), '23514', 'AtividadeApontamentoProduto_valores_check');
    await recusa(db, produto({ dose_ha: -0.5 }), '23514', 'AtividadeApontamentoProduto_valores_check');
    await recusa(db, produto({ ordem: 0 }), '23514', 'AtividadeApontamentoProduto_valores_check');
    await recusa(db, produto({ unidade: "'SACO'" }), '23514', 'AtividadeApontamentoProduto_valores_check');
    await recusa(db, produto({ operation_id: "'curto'" }), '23514', 'AtividadeApontamentoProduto_textos_check');
    await recusa(db, produto({ operation_id: "'tem espaço no meio'" }), '23514', 'AtividadeApontamentoProduto_textos_check');
    // O estorno nunca é o próprio movimento de saída.
    await recusa(db, produto({ ...cancelado, movimentacao_estorno_id: `'${C1}-mv1'` }), '23514', 'AtividadeApontamentoProduto_movimentos_check');
    // As válidas: uma confirmada com dose e uma cancelada com o estorno (outro movimento) e o cancelamento completo.
    await db.$executeRawUnsafe(produto({ id: "'alm-prod-1'", operation_id: "'alm-op-produto-1'", dose_ha: '0.25' }));
    await db.$executeRawUnsafe(produto({ id: "'alm-prod-2'", ordem: 2, operation_id: "'alm-op-produto-2'", movimentacao_estoque_id: `'${C1}-mv3'`, ...cancelado, movimentacao_estorno_id: `'${C1}-mv2'` }));

    const fatia = (campos = {}) => {
      const v = { id: "'alm-f-x'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, linha_id: "'alm-prod-1'", estoque_lote_nota_id: `'${C1}-lt1'`, ordem: 1, quantidade: 2,
        custo_unitario: 5, '"updatedAt"': 'now()', ...campos };
      return `INSERT INTO "AtividadeApontamentoProdutoConsumoLote" (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`;
    };
    await recusa(db, fatia({ quantidade: 0 }), '23514', 'AtividadeApontamentoProdutoConsumoLote_valores_check');
    await recusa(db, fatia({ custo_unitario: -1 }), '23514', 'AtividadeApontamentoProdutoConsumoLote_valores_check');
    await recusa(db, fatia({ ordem: 0 }), '23514', 'AtividadeApontamentoProdutoConsumoLote_valores_check');
    await db.$executeRawUnsafe(fatia({ id: "'alm-fatia-1'" }));

    const maquina = (campos = {}) => {
      const v = { id: "'alm-m-x'", cliente_id: `'${C1}'`, empresa_id: `'${E1}'`, apontamento_id: `'${AP}'`, ordem: 1, status: "'CONFIRMADO'", bem_id: `'${C1}-b1'`,
        medidor_tipo: "'HORIMETRO'", medidor_unidade: "'h'", leitura_inicial: 100, leitura_final: 108, quantidade_uso: 8, operation_id: "'alm-op-maquina-x'",
        criado_por_usuario_id: `'${U1}'`, '"updatedAt"': 'now()', ...campos };
      return `INSERT INTO "AtividadeApontamentoMaquina" (${Object.keys(v).join(', ')}) VALUES (${Object.values(v).join(', ')})`;
    };
    await recusa(db, maquina({ status: "'ABERTO'" }), '23514', 'AtividadeApontamentoMaquina_status_check');
    await recusa(db, maquina({ status: "'CANCELADO'", cancelado_em: 'now()', cancelamento_origem: "'LINHA'" }), '23514', 'AtividadeApontamentoMaquina_status_check');
    await recusa(db, maquina({ cancelado_em: 'now()' }), '23514', 'AtividadeApontamentoMaquina_status_check');
    await recusa(db, maquina({ medidor_tipo: "'GPS'" }), '23514', 'AtividadeApontamentoMaquina_medidor_check');
    await recusa(db, maquina({ leitura_final: 'NULL' }), '23514', 'AtividadeApontamentoMaquina_medidor_check');
    await recusa(db, maquina({ leitura_final: 99, quantidade_uso: 0 }), '23514', 'AtividadeApontamentoMaquina_medidor_check');
    await recusa(db, maquina({ quantidade_uso: 7 }), '23514', 'AtividadeApontamentoMaquina_medidor_check');
    await recusa(db, maquina({ sem_medidor: 'true', quantidade_uso: 8 }), '23514', 'AtividadeApontamentoMaquina_medidor_check');
    await recusa(db, maquina({ implemento_bem_id: `'${C1}-b1'` }), '23514', 'AtividadeApontamentoMaquina_valores_check');
    await recusa(db, maquina({ custo_unitario_uso: -1 }), '23514', 'AtividadeApontamentoMaquina_valores_check');
    await recusa(db, maquina({ sem_medidor: 'true', medidor_tipo: "'SEM_MEDIDOR'", leitura_inicial: 'NULL', leitura_final: 'NULL', quantidade_uso: -1 }), '23514', 'AtividadeApontamentoMaquina_valores_check');
    await recusa(db, maquina({ ordem: 0 }), '23514', 'AtividadeApontamentoMaquina_valores_check');
    await recusa(db, maquina({ operation_id: "'x'" }), '23514', 'AtividadeApontamentoMaquina_textos_check');
    // As válidas: com horímetro e implemento (uso = final − inicial, custo), e sem medidor (horas direto, sem leitura).
    await db.$executeRawUnsafe(maquina({ id: "'alm-maq-1'", operation_id: "'alm-op-maquina-1'", implemento_bem_id: `'${C1}-b2'`, custo_unitario_uso: 150, custo_total: 1200 }));
    await db.$executeRawUnsafe(maquina({ id: "'alm-maq-2'", ordem: 2, operation_id: "'alm-op-maquina-2'", medidor_tipo: "'SEM_MEDIDOR'", medidor_unidade: 'NULL', sem_medidor: 'true',
      leitura_inicial: 'NULL', leitura_final: 'NULL', quantidade_uso: 3, justificativa_salto: "'sem horímetro no dia'" }));
    const n = await um(db, `SELECT (SELECT count(*)::int FROM "AtividadeApontamentoProduto") AS p, (SELECT count(*)::int FROM "AtividadeApontamentoProdutoConsumoLote") AS f,
      (SELECT count(*)::int FROM "AtividadeApontamentoMaquina") AS m`);
    assert.deepEqual(n, { p: 2, f: 1, m: 2 }, 'só as válidas foram gravadas');
  });

  test('LM-06 FKs compostas pelo tenant e pela fazenda (23503), os únicos (23505) e o RESTRICT: nada do que as linhas usam sai', async () => {
    const produto = (id, campos) => `INSERT INTO "AtividadeApontamentoProduto" (id, cliente_id, empresa_id, apontamento_id, ordem, status, produto_id, local_estoque_id, quantidade,
        unidade, custo_unitario, custo_total, operation_id, movimentacao_estoque_id, "updatedAt")
      VALUES ('${id}', ${campos.cliente ?? `'${C1}'`}, ${campos.empresa ?? `'${E1}'`}, '${AP}', ${campos.ordem ?? 9}, 'CONFIRMADO', ${campos.produto ?? `'${C1}-p1'`},
        ${campos.local ?? `'${C1}-l1'`}, 1, 'L', 5, 5, '${campos.op ?? `alm-op-${id}`}', ${campos.mov ?? `'${C1}-mv4'`}, now())`;
    // O apontamento é da MESMA fazenda por construção: (cliente, empresa, apontamento) → AtividadeApontamento.
    await recusa(db, produto('alm-fk1', { empresa: `'${E2}'` }), '23503', 'AtividadeApontamentoProduto_apontamento_fkey');
    // Produto, local e movimento de outro cliente (ou inexistentes) não servem.
    await recusa(db, produto('alm-fk2', { produto: `'${C2}-p1'` }), '23503', 'AtividadeApontamentoProduto_cliente_id_produto_id_fkey');
    await recusa(db, produto('alm-fk3', { local: `'${C2}-l1'` }), '23503', 'AtividadeApontamentoProduto_cliente_id_local_estoque_id_fkey');
    await recusa(db, produto('alm-fk4', { mov: "'nao-existe'" }), '23503', 'AtividadeApontamentoProduto_movimentacao_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoProduto" SET criado_por_usuario_id = '${C2}-u1' WHERE id = 'alm-prod-1'`, '23503', 'AtividadeApontamentoProduto_criado_por_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoProduto" SET movimentacao_estorno_id = 'nao-existe' WHERE id = 'alm-prod-2'`, '23503', 'AtividadeApontamentoProduto_estorno_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoProdutoConsumoLote" SET estoque_lote_nota_id = '${C2}-lt1' WHERE id = 'alm-fatia-1'`, '23503', 'AtividadeApontamentoProdutoConsumoLote_lote_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoProdutoConsumoLote" SET empresa_id = '${E2}' WHERE id = 'alm-fatia-1'`, '23503', 'AtividadeApontamentoProdutoConsumoLote_linha_fkey');
    // A máquina e o implemento são da MESMA fazenda do apontamento: (cliente, empresa, bem) → BemPatrimonial.
    await recusa(db, `UPDATE "AtividadeApontamentoMaquina" SET bem_id = '${C1}-b3' WHERE id = 'alm-maq-1'`, '23503', 'AtividadeApontamentoMaquina_bem_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoMaquina" SET implemento_bem_id = '${C1}-b4' WHERE id = 'alm-maq-1'`, '23503', 'AtividadeApontamentoMaquina_implemento_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoMaquina" SET empresa_id = '${E2}' WHERE id = 'alm-maq-2'`, '23503', 'AtividadeApontamentoMaquina_apontamento_fkey');
    await recusa(db, `UPDATE "AtividadeApontamentoMaquina" SET cancelado_por_usuario_id = '${C2}-u1' WHERE id = 'alm-maq-2'`, '23503', 'AtividadeApontamentoMaquina_cancelado_por_fkey');
    // Os únicos (o Prisma devolve só o DETAIL do 23505: a chave o identifica): a mesma operation_id, o mesmo movimento, a
    // mesma ordem no apontamento, o mesmo lote na linha.
    await recusa(db, produto('alm-uq1', { op: 'alm-op-produto-1' }), '23505', 'Key (cliente_id, operation_id)');
    await recusa(db, produto('alm-uq2', { mov: `'${C1}-mv1'` }), '23505', 'Key (cliente_id, movimentacao_estoque_id)');
    await recusa(db, `UPDATE "AtividadeApontamentoProduto" SET ordem = 1 WHERE id = 'alm-prod-2'`, '23505', 'Key (cliente_id, apontamento_id, ordem)');
    await recusa(db, `INSERT INTO "AtividadeApontamentoProdutoConsumoLote" (id, cliente_id, empresa_id, linha_id, estoque_lote_nota_id, ordem, quantidade, custo_unitario, "updatedAt")
      VALUES ('alm-fatia-dup', '${C1}', '${E1}', 'alm-prod-1', '${C1}-lt1', 2, 1, 5, now())`, '23505', 'Key (cliente_id, linha_id, estoque_lote_nota_id)');
    await recusa(db, `UPDATE "AtividadeApontamentoMaquina" SET operation_id = 'alm-op-maquina-1' WHERE id = 'alm-maq-2'`, '23505', 'Key (cliente_id, operation_id)');
    await recusa(db, `UPDATE "AtividadeApontamentoMaquina" SET ordem = 1 WHERE id = 'alm-maq-2'`, '23505', 'Key (cliente_id, apontamento_id, ordem)');
    // RESTRICT: o apontamento, a linha com fatia, o lote, os movimentos, o produto, o local, o bem, o implemento e o usuário usados não saem.
    for (const [sql, nome] of [
      [`DELETE FROM "AtividadeApontamento" WHERE id = '${AP}'`, 'AtividadeApontamento'],
      [`DELETE FROM "AtividadeApontamentoProduto" WHERE id = 'alm-prod-1'`, 'AtividadeApontamentoProdutoConsumoLote_linha_fkey'],
      [`DELETE FROM "EstoqueLoteNota" WHERE id = '${C1}-lt1'`, 'AtividadeApontamentoProdutoConsumoLote_lote_fkey'],
      [`DELETE FROM "MovimentacaoEstoque" WHERE id = '${C1}-mv1'`, 'AtividadeApontamentoProduto_movimentacao_fkey'],
      [`DELETE FROM "MovimentacaoEstoque" WHERE id = '${C1}-mv2'`, 'AtividadeApontamentoProduto_estorno_fkey'],
      [`DELETE FROM "LocalEstoque" WHERE id = '${C1}-l1'`, null],
      [`DELETE FROM "BemPatrimonial" WHERE id = '${C1}-b1'`, 'AtividadeApontamentoMaquina_bem_fkey'],
      [`DELETE FROM "BemPatrimonial" WHERE id = '${C1}-b2'`, 'AtividadeApontamentoMaquina_implemento_fkey'],
      [`DELETE FROM "Usuario" WHERE id = '${U1}'`, null],
    ]) await recusa(db, sql, '23503', nome ?? undefined);
    const n = await um(db, `SELECT (SELECT count(*)::int FROM "AtividadeApontamentoProduto") AS p, (SELECT count(*)::int FROM "AtividadeApontamentoProdutoConsumoLote") AS f,
      (SELECT count(*)::int FROM "AtividadeApontamentoMaquina") AS m, (SELECT count(*)::int FROM "AtividadeApontamento") AS a`);
    assert.deepEqual(n, { p: 2, f: 1, m: 2, a: 1 }, 'nada foi gravado nem apagado nas recusas');
  });

  test('LM-07 reaplicar o migration.sql (psql, uma transação) falha (as tabelas já existem) e NADA muda; a 2ª execução do runner não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    assert.match(r.saida, /42701|42P07/, 'coluna ou tabela já existente');
    assert.deepEqual(await retrato(db), antes);
    const segunda = await aplicarPeloRunner(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
  });
});

describe('D-PROD-202 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
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

  test('TB-02 histórico fora de 53/0 (uma migration revertida ou uma em aberto) ou a anterior (D-PROD-200) com checksum divergente recusa antes do DDL; restaurado, nada mudou', async () => {
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    try {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /RELEASE_BLOCKED: histórico com 52 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113300000_estoque_p1_03_indices'`);
    }
    await dbB.$executeRawUnsafe(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('alm-aberta', 'x', '20261199000000_aberta', now(), 0)`);
    try {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /RELEASE_BLOCKED: histórico com 53 concluídas e 1 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'alm-aberta'`);
    }
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = 'manual' WHERE migration_name = '${NOME_ANTERIOR}'`);
    try {
      const r = await consulta(URL_B, comSidLocal(envelope(), SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /RELEASE_BLOCKED: a anterior \(D-PROD-200\) ausente ou com checksum divergente/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET checksum = '${CHECKSUM_ANTERIOR}' WHERE migration_name = '${NOME_ANTERIOR}'`);
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (53 → 54, checksum = SHA-256 do arquivo, applied_steps_count 1); o mesmo schema do runner; postcheck APLICADA; o runner não vê esta pendente (só aplica a EXPAND da D-PROD-203) e depois nada pende; migrate diff vazio', async () => {
    const pre = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('preflight'), SID)));
    assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    assert.match(quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID))).VEREDITO.valor, /^PARAR/, 'antes de aplicar, o postcheck manda parar');

    const r = await consulta(URL_B, comSidLocal(envelope(), SID));
    assert.equal(r.status, 0, r.stderr);
    const h = await historico(dbB);
    assert.deepEqual([h.concluidas, h.abertas, h.esta], [ANTERIORES.length + 1, 0, 1]);
    const linha = await um(dbB, `SELECT checksum, applied_steps_count::int AS passos, logs, finished_at IS NOT NULL AS concluida FROM _prisma_migrations WHERE migration_name = '${NOME}'`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1, logs: null, concluida: true });

    // O mesmo schema que o runner deixou no outro banco (tabelas, constraints e índices das novas, políticas e as colunas),
    // fora as 3 das Formulações (D-PROD-203), que lá o runner aplicou depois desta.
    const b = await retrato(dbB);
    const t = await retrato(db);
    const semFormulacoes = (lista) => lista.split(',').filter((x) => !daFormulacao(x)).join(',');
    assert.deepEqual([b.tabelas, dasNovas(b.constraints), dasNovas(b.indices), b.politicas, b.colunas], [semFormulacoes(t.tabelas), dasNovas(t.constraints), dasNovas(t.indices), semFormulacoes(t.politicas), t.colunas]);

    const pos = quadro(await consulta(URL_B, comSidLocal(blocoDoRunbook('postcheck'), SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);

    // O registro manual vale para o Prisma: o runner não reaplica esta; só aplica a de nome posterior, a EXPAND da
    // D-PROD-203 (não existia no dia desta, ver o cabeçalho), e o schema bate com o schema.prisma; a 2ª execução já não
    // vê pendência.
    const runner = await aplicarPeloRunner(URL_B);
    assert.equal(runner.status, 0, runner.saida);
    assert.ok(runner.saida.includes(`Applying migration \`${NOME_FORMULACOES}\``), runner.saida);
    assert.ok(runner.saida.includes(`Applying migration \`${NOME_LEITURA}\``), runner.saida);
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
