/**
 * D-PROD-197 — a migration CONTRACT `20261114300000_tipo_atividade_defaults` (o Tipo de Atividade ganha 5 padrões
 * anuláveis, 8 flags BOOLEAN NOT NULL DEFAULT false, 3 FKs compostas pelo tenant com RESTRICT e 2 CHECKs; ADITIVA, sem
 * DROP) de ponta a ponta, contra PostgreSQL real, em bancos PRÓPRIOS criados e apagados por este teste (o banco da
 * suíte não é tocado; os nomes começam pelo nome do banco da suíte).
 *
 * Partida (banco MODELO): as migrations de nome ANTERIOR a esta (50: produção depois da curva obrigatória na Categoria
 * de Manejo, D-PROD-195), pelo Prisma a partir de uma cópia temporária; 2 clientes, cada um com 2 fazendas, um centro
 * de custo e um de resultado por fazenda, 2 unidades, 2 grupos e 3 tipos de atividade (um inativo; o mesmo nome em
 * dois grupos). As sementes entram depois das migrations e não têm categoria de manejo: a guarda da D-PROD-195 (uma
 * CURVA PADRÃO em cada fazenda COM categoria) passa sem curva nenhuma. Os bancos do teste são cópias dele (CREATE
 * DATABASE … TEMPLATE).
 *
 * RED (cada um recusado com a mensagem própria, `tipo_atividade_defaults:`, e NADA muda): TipoAtividade ausente;
 * coluna, constraint ou índice novo já existente; alvo das FKs ausente ou sem índice único exatamente em
 * (cliente_id, id) — sem índice, invertido, parcial, não-único ou com 3 colunas; trava concorrente (55P03 pelo
 * lock_timeout de 5 s da guarda). O arquivo roda pelo psql numa transação, como o caminho B; a coluna já existente
 * roda pelo runner oficial (falha aberta → `migrate resolve --rolled-back`). E o runner com a conferência de alvo
 * exigida e SEM MIGRATION_CONTRACT_AUTORIZADO=D-PROD-197 recusa antes de qualquer DDL.
 *
 * GREEN pelo runner oficial (alvo conferido + decisão exata): todas concluídas, as 13 colunas com tipo/nulidade/DEFAULT
 * exatos, linhas antigas intactas (flags false, padrões null), as 5 constraints, os 3 índices, FKs (mesmo cliente
 * aceita, outro cliente recusa, RESTRICT barra apagar o padrão, UPDATE em cascata), CHECKs, unicidade mantida,
 * `migrate diff` vazio; reaplicar o arquivo é recusado pela guarda sem mudar nada; 2ª execução sem pendência.
 *
 * D-PROD-198: a EXPAND `20261114400000_cadcategoria_peso_objetivo` (CADCATEGORIA.peso_objetivo_kg), de nome
 * posterior, não existia no dia desta CONTRACT. Fica fora da partida (que é só o que vem ANTES desta) e fora da subida
 * fora de ordem da D-PROD-200 (abaixo), e sobe nos GREEN que aplicam tudo o que pende no diretório real (runner
 * oficial), depois desta e sem autorização (é EXPAND). O postcheck do runbook fixa o histórico de produção naquele dia
 * (51 / 0, 85 tabelas).
 *
 * Runbook: o preflight, o envelope do caminho B e o postcheck de `MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md`
 * (entre os marcadores `sql:…`) rodam como estão, trocando só o system_identifier de produção pelo local.
 *
 * D-PROD-200: a CONTRACT seguinte (`20261114500000_atividade_cabecalho`, Atividade cabeçalho), de nome POSTERIOR,
 * entrou no repositório depois desta. O runner oficial nunca aplica duas CONTRACT de uma vez; por isso, logo antes do
 * caminho do runner (TA-02), ela sobe FORA DE ORDEM pelo Prisma direto (a guarda dela só olha as 3 tabelas do
 * apontamento antigo, vazias aqui, e ela não toca TipoAtividade): 51 migrations e 84 tabelas nessa partida, e só a
 * D-PROD-197 pende no runner como CONTRACT (a EXPAND da D-PROD-198 sobe com ela; em produção a ordem é a inversa: esta
 * e a D-PROD-198 já estão aplicadas e a D-PROD-200 entra depois). O preflight e os RED rodam antes, no estado de
 * produção do dia desta (50 / 0, 85 tabelas); o postcheck do runbook, escrito para 51 / 0 e 85 tabelas, passa inteiro
 * no banco do caminho B, que fica nesse estado, e no banco do runner só as duas linhas de contagem mudam (53 / 0 e 84).
 * No caminho B, a 2ª execução do runner aplica só a D-PROD-198 e a D-PROD-200.
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

import { getPrismaClient } from '../src/database/prismaClient.js';
import { encerrar } from './helpers.mjs';
import { motivoAlvoProtegido } from '../../scripts/auth/alvoProtegido.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const NOME_CONTRACT = '20261114300000_tipo_atividade_defaults';
const DECISAO = 'D-PROD-197';
const ARQUIVO = join(MIGRATIONS, NOME_CONTRACT, 'migration.sql');
const SQL_MIGRATION = readFileSync(ARQUIVO, 'utf8');
const CHECKSUM = createHash('sha256').update(SQL_MIGRATION).digest('hex');
/** As CONTRACT anteriores, concluídas na partida como em produção. */
const CONTRACTS_ANTERIORES = Object.freeze([
  '20261110300000_patrimonio_simplifica', '20261113200000_tipo_tarefa_drop_colunas',
  '20261113500000_categoria_manejo_cadcategoria', '20261114100000_cadcurvaganho_mensal',
  '20261114200000_cadcategoria_curva_ganho',
]);
/** Pastas do repositório: a partida é o que vem ANTES desta (produção hoje); o GREEN, todas. */
const PASTAS = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const ANTERIORES = Object.freeze(PASTAS.filter((n) => n < NOME_CONTRACT));
const TOTAL_MIGRATIONS = PASTAS.length;
/** D-PROD-198: a EXPAND do peso objetivo, de nome posterior; não existia no dia desta CONTRACT (ver o cabeçalho). */
const NOME_PESO_OBJETIVO = '20261114400000_cadcategoria_peso_objetivo';
/**
 * D-PROD-200: as CONTRACT de nome POSTERIOR a esta (a Atividade cabeçalho), que sobem fora de ordem antes do runner (ver
 * o cabeçalho); a EXPAND da D-PROD-198 fica de fora e sobe pelo runner, depois desta.
 */
/**
 * D-PROD-203: a EXPAND das Formulações (3 tabelas novas), de nome posterior, também não existia no dia desta CONTRACT:
 * fica fora (como a D-PROD-198) e sobe pelo runner por último, pela ordem dos nomes.
 */
const NOME_FORMULACOES = '20261114700000_cadformulacao';
const TABELAS_FORMULACOES = Object.freeze(['CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA']);
const POSTERIORES = Object.freeze(PASTAS.filter((n) => n > NOME_CONTRACT && n !== NOME_PESO_OBJETIVO && n !== NOME_FORMULACOES));
/** Migrations concluídas na ordem REAL de aplicação (finished_at). */
const ordemDeAplicacao = async (db) =>
  (await db.$queryRawUnsafe(`SELECT migration_name AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
                              ORDER BY finished_at, started_at, migration_name`)).map((x) => x.n);

/** O runbook desta release: os blocos SQL rodam como estão, com o system_identifier local no lugar do de produção. */
const RUNBOOK = readFileSync(join(RAIZ, 'docs/engineering/MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md'), 'utf8');
const SID_PRODUCAO = '7692130048193495360';
const MARCA_MIGRATION = '-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>';
const blocoDoRunbook = (nome) => {
  const m = RUNBOOK.match(new RegExp(`<!-- sql:${nome} -->\\n\`\`\`sql\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /sql:${nome} -->`));
  assert.ok(m, `o runbook tem o bloco sql:${nome}`);
  return m[1];
};

const FLAGS = Object.freeze(['exige_area', 'exige_safra', 'exige_maquina', 'permite_implemento', 'permite_produto', 'permite_servico', 'permite_mao_obra', 'exige_producao']);
const PADROES = Object.freeze(['categoria', 'centro_custo_padrao_id', 'centro_resultado_padrao_id', 'unidade_producao_id', 'coeficiente_padrao']);
/** As 9 colunas da D-PROD-182, na ordem física; as 13 novas entram depois delas, na ordem da migration. */
const COLUNAS_ANTES = Object.freeze(['id', 'cliente_id', 'nome_tipo', 'grupo_atividade_id', 'grupo_atividade_nome', 'ativo', 'descricao', 'createdAt', 'updatedAt']);
const COLUNAS_NOVAS = Object.freeze([
  ['categoria', 'character varying(24)', false, null],
  ['centro_custo_padrao_id', 'character varying(64)', false, null],
  ['centro_resultado_padrao_id', 'character varying(64)', false, null],
  ['unidade_producao_id', 'character varying(64)', false, null],
  ['coeficiente_padrao', 'numeric(14,4)', false, null],
  ...FLAGS.map((f) => [f, 'boolean', true, 'false']),
]);
const CATEGORIAS = Object.freeze(['PREPARO_SOLO', 'PLANTIO', 'TRATO_CULTURAL', 'APLICACAO', 'COLHEITA', 'PASTAGEM', 'BENFEITORIA', 'MANEJO_ANIMAL', 'OUTROS']);
const FKS = Object.freeze([
  ['TipoAtividade_cliente_id_centro_custo_padrao_id_fkey', 'centro_custo_padrao_id', 'CentroCusto'],
  ['TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey', 'centro_resultado_padrao_id', 'CentroResultado'],
  ['TipoAtividade_cliente_id_unidade_producao_id_fkey', 'unidade_producao_id', 'UnidadeMedida'],
]);
const INDICES_NOVOS = Object.freeze(FKS.map(([, coluna]) => `TipoAtividade_cliente_id_${coluna}_idx`));

const C1 = 'tad-c1';
const C2 = 'tad-c2';

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-197: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
  return url;
};
/** Mesma URL, outro banco lógico. */
const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
/** Nem a URL inteira nem o par usuário:senha podem aparecer na saída. */
const vazou = (saida, url) => {
  const u = new URL(url);
  return saida.includes(url) || (u.password !== '' && saida.includes(`${u.username}:${u.password}@`));
};

/** Executa um processo sem shell e devolve status, saída e duração (assíncrono: o laço de eventos segue vivo). */
const rodar = (comando, args, { env = process.env, cwd = RAIZ } = {}) =>
  new Promise((resolve) => {
    const inicio = Date.now();
    const filho = spawn(comando, args, { cwd, env, shell: false });
    let stdout = '';
    let stderr = '';
    filho.stdout.on('data', (d) => (stdout += d));
    filho.stderr.on('data', (d) => (stderr += d));
    filho.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr, saida: `${stdout}\n${stderr}`, ms: Date.now() - inicio }));
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
const resolverRevertida = (url) => prisma(['migrate', 'resolve', '--rolled-back', NOME_CONTRACT, '--schema', SCHEMA], url);
const migrateDiff = (url) => prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', SCHEMA, '--exit-code'], url);

/** psql sem .psqlrc, saída crua e SQLSTATE nas mensagens de erro. */
const psql = (url, args) => {
  const u = new URL(url);
  u.search = '';
  return rodar('psql', [u.toString(), '-X', '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', ...args], { env: ambienteBase() });
};
/** O migration.sql numa transação só (como o caminho B do runbook). */
const aplicarArquivo = (url) => psql(url, ['-1', '-f', ARQUIVO]);
/** Um texto inteiro numa só consulta (como o execute_sql do conector). */
const consulta = (url, sql) => psql(url, ['-c', sql]);
/** Linhas `item|valor|esperado|status` do preflight/postcheck do runbook. */
const quadro = (r) => Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => {
  const [item, valor, esperado, status] = l.split('|');
  return [item, { valor, esperado, status }];
}));

/** Cópia temporária das pastas dadas (por padrão, as da partida: as de nome anterior a esta) aplicada pelo Prisma. */
const aplicarAnteriores = async (url, pastas = ANTERIORES) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-tad-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of pastas) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    if (existsSync(join(MIGRATIONS, 'migration_lock.toml'))) cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-197: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** Sementes em SQL cru (o Prisma Client já é o do schema novo; a partida ainda não tem as colunas). */
const semear = async (db) => {
  const ins = (sql) => db.$executeRawUnsafe(sql);
  for (const c of [C1, C2]) {
    await ins(`INSERT INTO "Cliente" (id, codigo, nome, "updatedAt") VALUES ('${c}', '${c}', 'Cliente ${c}', now())`);
    for (const n of [1, 2]) {
      await ins(`INSERT INTO "Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES ('${c}-e${n}', '${c}', ${n}, 'F${n}', 'Fazenda ${n}', now())`);
      await ins(`INSERT INTO "CentroCusto" (id, cliente_id, empresa_id, numero, nome, "updatedAt") VALUES ('${c}-cc${n}', '${c}', '${c}-e${n}', '${n}', 'Custeio ${n}', now())`);
      await ins(`INSERT INTO "CentroResultado" (id, cliente_id, empresa_id, numero, nome, "updatedAt") VALUES ('${c}-cr${n}', '${c}', '${c}-e${n}', '${n}', 'Pecuária ${n}', now())`);
    }
    await ins(`INSERT INTO "UnidadeMedida" (id, cliente_id, numero_unidade, sigla, descricao, "updatedAt") VALUES ('${c}-ha', '${c}', '1', 'HA', 'Hectare', now()), ('${c}-h', '${c}', '2', 'H', 'Hora', now())`);
    await ins(`INSERT INTO "GrupoAtividade" (id, cliente_id, nome_grupo, "updatedAt") VALUES ('${c}-g1', '${c}', 'Preparo', now()), ('${c}-g2', '${c}', 'Tratos', now())`);
    await ins(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, ativo, descricao, "updatedAt") VALUES
      ('${c}-t1', '${c}', 'Gradear', '${c}-g1', 'Preparo', true, 'Grade aradora', now()),
      ('${c}-t2', '${c}', 'Subsolar', '${c}-g1', 'Preparo', false, NULL, now()),
      ('${c}-t3', '${c}', 'Gradear', '${c}-g2', 'Tratos', true, NULL, now())`);
  }
};

/**
 * Retrato do que a migration toca (e do que um RED não pode deixar): colunas, constraints e índices de TipoAtividade
 * e dos 3 alvos, as linhas de TipoAtividade nas colunas da D-PROD-182, tabelas, histórico (não revertido), RLS e
 * políticas. Lido por to_regclass: roda mesmo com a tabela renomeada (os campos dela saem nulos).
 */
const SQL_RETRATO = `WITH t AS (SELECT to_regclass('public."TipoAtividade"')::oid AS oid)
SELECT
  (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), E'\\n' ORDER BY a.attnum)
     FROM t JOIN pg_attribute a ON a.attrelid = t.oid LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attnum > 0 AND NOT a.attisdropped) AS colunas,
  (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), E'\\n' ORDER BY k.conname) FROM t JOIN pg_constraint k ON k.conrelid = t.oid) AS constraints,
  (SELECT string_agg(indexname || ':' || indexdef, E'\\n' ORDER BY indexname) FROM pg_indexes
    WHERE schemaname = 'public' AND tablename IN ('TipoAtividade', 'CentroCusto', 'CentroResultado', 'UnidadeMedida')) AS indices,
  (SELECT string_agg(c.relname, ',' ORDER BY c.relname) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')) AS tabelas,
  (SELECT count(*)::int FROM _prisma_migrations WHERE rolled_back_at IS NULL) AS historico,
  (SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
  (SELECT c.relrowsecurity || '/' || c.relforcerowsecurity FROM t JOIN pg_class c ON c.oid = t.oid) AS rls,
  (SELECT coalesce(string_agg(p.polname, ',' ORDER BY p.polname), '-') FROM t JOIN pg_policy p ON p.polrelid = t.oid) AS politicas`;
const SQL_LINHAS_ANTIGAS = `SELECT count(*)::int AS n, md5(coalesce(string_agg(ROW(t.id, t.cliente_id, t.nome_tipo, t.grupo_atividade_id, t.grupo_atividade_nome, t.ativo, t.descricao, t."createdAt", t."updatedAt")::text, E'\\n' ORDER BY t.id), '')) AS md5
  FROM public."TipoAtividade" t`;
/** Sobras dos cenários RED: tudo o que eles criam tem "intrus" no nome, ou é uma das colunas/constraints/índices novos. */
const SQL_INTRUSOS = `SELECT n FROM (
  SELECT relname::text AS n FROM pg_class WHERE relname LIKE '%intrus%' OR relname IN (${INDICES_NOVOS.map((i) => `'${i}'`).join(', ')})
  UNION ALL SELECT conname::text FROM pg_constraint WHERE conname LIKE '%intrus%' OR conname IN (${[...FKS.map(([n]) => n), 'TipoAtividade_categoria_check', 'TipoAtividade_coeficiente_padrao_check'].map((n) => `'${n}'`).join(', ')})
  UNION ALL SELECT attname::text FROM pg_attribute WHERE attrelid = to_regclass('public."TipoAtividade"') AND attnum > 0 AND NOT attisdropped
                                                   AND attname IN (${COLUNAS_NOVAS.map(([c]) => `'${c}'`).join(', ')})
) x ORDER BY 1`;

const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
const retrato = async (db) => ({ ...(await um(db, SQL_RETRATO)), linhas: await um(db, SQL_LINHAS_ANTIGAS) });
const retratoSemLinhas = (db) => um(db, SQL_RETRATO);
const intrusos = async (db) => (await db.$queryRawUnsafe(SQL_INTRUSOS)).map((x) => x.n);
const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
const historico = (db) =>
  um(db, `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS contract_concluida,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NULL AND rolled_back_at IS NULL)::int AS contract_aberta
            FROM "_prisma_migrations"`);
const colunasNovas = (db) => db.$queryRawUnsafe(`SELECT a.attname::text AS nome, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS nao_nula, pg_get_expr(d.adbin, d.adrelid) AS padrao
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attrelid = 'public."TipoAtividade"'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`);
/** Executa um SQL que TEM de falhar com o SQLSTATE (e, se dado, citando o nome da constraint). */
const recusa = async (db, sql, sqlstate, nome) => {
  await assert.rejects(db.$executeRawUnsafe(sql), (e) => {
    const texto = `${e.message} ${JSON.stringify(e.meta ?? {})}`;
    assert.ok(texto.includes(sqlstate), `${sql}\n→ ${texto}`);
    if (nome) assert.ok(texto.includes(nome), `${sql}\n→ ${texto}`);
    return true;
  });
};

/** Uma sessão concorrente segura ACCESS SHARE em TipoAtividade até `soltar()` (a guarda pede ACCESS EXCLUSIVE). */
const segurarTrava = async (db) => {
  let soltar;
  const ate = new Promise((r) => (soltar = r));
  let travou;
  const travado = new Promise((r) => (travou = r));
  const tx = db.$transaction(async (t) => {
    await t.$executeRawUnsafe('LOCK TABLE "TipoAtividade" IN ACCESS SHARE MODE');
    travou();
    await ate;
  }, { timeout: 120_000, maxWait: 20_000 });
  await Promise.race([travado, tx]);
  return async () => {
    soltar();
    await tx;
  };
};

const guarda = (trecho) => new RegExp(`P0001: tipo_atividade_defaults: ${trecho}`);
const SEM_UNICO = guarda('public\\.UnidadeMedida sem índice único em \\(cliente_id, id\\): a FK composta não teria alvo; nada foi alterado');
const UNICO_ORIGINAL = 'CREATE UNIQUE INDEX "UnidadeMedida_cliente_id_id_key" ON "UnidadeMedida"("cliente_id", "id")';
/** O índice único de (cliente_id, id) de UnidadeMedida trocado por outro (nada referencia a UnidadeMedida antes desta migration). */
const trocarUnicoDaUnidade = (id, ddl) => ({
  id,
  esperado: SEM_UNICO,
  preparar: async (db) => {
    await db.$executeRawUnsafe('DROP INDEX "UnidadeMedida_cliente_id_id_key"');
    if (ddl) await db.$executeRawUnsafe(ddl);
  },
  desfazer: async (db) => {
    if (ddl) await db.$executeRawUnsafe(`DROP INDEX "${ddl.match(/INDEX "([^"]+)"/)[1]}"`);
    await db.$executeRawUnsafe(UNICO_ORIGINAL);
  },
});

/** Cenários RED: cada um prepara um estado, tem de ser RECUSADO com a mensagem própria e não pode mudar nada. */
const CENARIOS_RED = Object.freeze([
  {
    id: 'tabela_ausente',
    esperado: guarda('a tabela public\\.TipoAtividade não existe: schema fora do esperado; nada foi alterado'),
    preparar: (db) => db.$executeRawUnsafe('ALTER TABLE "TipoAtividade" RENAME TO "TipoAtividade_intrusa"'),
    desfazer: (db) => db.$executeRawUnsafe('ALTER TABLE "TipoAtividade_intrusa" RENAME TO "TipoAtividade"'),
  },
  {
    // Pelo runner oficial (alvo local, sem a barreira do CONTRACT): a falha fica aberta e é resolvida como revertida.
    id: 'coluna_existente_pelo_runner',
    runner: true,
    esperado: /tipo_atividade_defaults: TipoAtividade já tem coluna nova \(exige_area\): migration já aplicada ou schema fora do esperado; nada foi alterado/,
    preparar: (db) => db.$executeRawUnsafe('ALTER TABLE "TipoAtividade" ADD COLUMN "exige_area" BOOLEAN'),
    desfazer: (db) => db.$executeRawUnsafe('ALTER TABLE "TipoAtividade" DROP COLUMN "exige_area"'),
  },
  {
    id: 'constraint_existente',
    esperado: guarda('TipoAtividade já tem constraint nova \\(TipoAtividade_categoria_check\\): migration já aplicada ou schema fora do esperado; nada foi alterado'),
    preparar: (db) => db.$executeRawUnsafe(`ALTER TABLE "TipoAtividade" ADD CONSTRAINT "TipoAtividade_categoria_check" CHECK ("nome_tipo" <> '')`),
    desfazer: (db) => db.$executeRawUnsafe('ALTER TABLE "TipoAtividade" DROP CONSTRAINT "TipoAtividade_categoria_check"'),
  },
  {
    // O nome do índice é global em public: um índice homônimo em OUTRA tabela também faria o CREATE INDEX falhar.
    id: 'indice_existente',
    esperado: guarda('índice novo já existe \\(TipoAtividade_cliente_id_unidade_producao_id_idx\\): migration já aplicada ou schema fora do esperado; nada foi alterado'),
    preparar: (db) => db.$executeRawUnsafe('CREATE INDEX "TipoAtividade_cliente_id_unidade_producao_id_idx" ON "CentroCusto"("cliente_id")'),
    desfazer: (db) => db.$executeRawUnsafe('DROP INDEX "TipoAtividade_cliente_id_unidade_producao_id_idx"'),
  },
  {
    id: 'alvo_ausente',
    esperado: guarda('a tabela public\\.UnidadeMedida não existe: a FK não teria alvo; nada foi alterado'),
    preparar: (db) => db.$executeRawUnsafe('ALTER TABLE "UnidadeMedida" RENAME TO "UnidadeMedida_intrusa"'),
    desfazer: (db) => db.$executeRawUnsafe('ALTER TABLE "UnidadeMedida_intrusa" RENAME TO "UnidadeMedida"'),
  },
  trocarUnicoDaUnidade('alvo_sem_indice_unico', null),
  trocarUnicoDaUnidade('alvo_unico_invertido', 'CREATE UNIQUE INDEX "UnidadeMedida_intrusa_id_cliente_id_key" ON "UnidadeMedida"("id", "cliente_id")'),
  trocarUnicoDaUnidade('alvo_unico_parcial', 'CREATE UNIQUE INDEX "UnidadeMedida_intrusa_parcial_key" ON "UnidadeMedida"("cliente_id", "id") WHERE "ativo"'),
  trocarUnicoDaUnidade('alvo_indice_nao_unico', 'CREATE INDEX "UnidadeMedida_intrusa_nao_unico_idx" ON "UnidadeMedida"("cliente_id", "id")'),
  trocarUnicoDaUnidade('alvo_unico_com_3_colunas', 'CREATE UNIQUE INDEX "UnidadeMedida_intrusa_tres_key" ON "UnidadeMedida"("cliente_id", "id", "sigla")'),
  {
    // 55P03 no LOCK da própria guarda: a sessão concorrente segura TipoAtividade e a transação desiste em ~5 s.
    id: 'trava_concorrente',
    trava: true,
    esperado: /55P03: canceling statement due to lock timeout[\s\S]*LOCK TABLE public\."TipoAtividade" IN ACCESS EXCLUSIVE MODE/,
  },
]);
/** O lock_timeout da guarda é 5 s; o teto cobre a partida do psql em máquina lenta de CI. */
const TETO_TRAVA_MS = 20_000;

let URL_MODELO;
let URL_T;
let URL_B;
let BANCO_MODELO;
let BANCO;
let BANCO_B;
let SID;
let db;
let partida;
let linhasPartida;

/** Um banco novo, cópia do modelo (o modelo não pode ter conexão aberta). */
const clonar = async (p, banco) => {
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
  await p.$queryRawUnsafe(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${BANCO_MODELO}' AND pid <> pg_backend_pid()`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${banco} TEMPLATE ${BANCO_MODELO}`);
};

before(async () => {
  const p = getPrismaClient();
  const base = exigirUrlLocal(process.env.DATABASE_URL);
  // Nomes próprios, derivados do banco da suíte (cada execução paralela com banco próprio fica isolada).
  const prefixo = new URL(base).pathname.slice(1).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'maike';
  BANCO_MODELO = `${prefixo}_tad_modelo`;
  BANCO = `${prefixo}_tad`;
  BANCO_B = `${prefixo}_tad_b`;
  URL_MODELO = comBanco(base, BANCO_MODELO);
  URL_T = comBanco(base, BANCO);
  URL_B = comBanco(base, BANCO_B);
  for (const b of [BANCO, BANCO_B, BANCO_MODELO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_MODELO}`);
  await aplicarAnteriores(URL_MODELO);
  const modelo = new PrismaClient({ datasourceUrl: URL_MODELO });
  try {
    await semear(modelo);
  } finally {
    await modelo.$disconnect();
  }
  await clonar(p, BANCO);
  await clonar(p, BANCO_B);
  db = new PrismaClient({ datasourceUrl: URL_T });
  SID = await sistema(db);
  partida = await retrato(db);
  linhasPartida = partida.linhas;
});

after(async () => {
  await db?.$disconnect();
  const p = getPrismaClient();
  for (const b of [BANCO, BANCO_B, BANCO_MODELO]) if (b) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await encerrar();
});

describe('D-PROD-197 — migration CONTRACT dos padrões e das flags do TipoAtividade (PostgreSQL real)', () => {
  test('TA-01 partida: as migrations de nome anterior a esta (as 5 CONTRACT anteriores concluídas), 85 tabelas, TipoAtividade com as 9 colunas da D-PROD-182 e nenhuma das 13 colunas, 5 constraints e 3 índices novos; o preflight do runbook diz PRONTO', async () => {
    const h = await historico(db);
    assert.equal(h.concluidas, ANTERIORES.length);
    assert.equal(ANTERIORES.length, 50, 'produção hoje: 50 migrations, a última a curva obrigatória na Categoria de Manejo (D-PROD-195)');
    assert.equal(ANTERIORES.at(-1), '20261114200000_cadcategoria_curva_ganho');
    // D-PROD-198, D-PROD-200 e D-PROD-203: a EXPAND do peso objetivo, a Atividade cabeçalho e a EXPAND das Formulações
    // têm nome posterior a esta (54 pastas no total); as três ficam fora da partida.
    assert.deepEqual(PASTAS.filter((n) => n > NOME_CONTRACT), [NOME_PESO_OBJETIVO, '20261114500000_atividade_cabecalho', NOME_FORMULACOES]);
    assert.equal(TOTAL_MIGRATIONS, 54);
    assert.equal((await ordemDeAplicacao(db)).includes(NOME_PESO_OBJETIVO), false);
    assert.equal((await ordemDeAplicacao(db)).includes(NOME_FORMULACOES), false);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    const [{ n: anteriores }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name IN (${CONTRACTS_ANTERIORES.map((n) => `'${n}'`).join(', ')}) AND finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    assert.equal(anteriores, CONTRACTS_ANTERIORES.length);
    assert.equal(partida.tabelas.split(',').length, 85);
    assert.deepEqual((await colunasNovas(db)).map((c) => c.nome), [...COLUNAS_ANTES]);
    assert.deepEqual(await intrusos(db), []);
    assert.equal(linhasPartida.n, 6, '3 tipos por cliente');

    const r = await consulta(URL_T, blocoDoRunbook('preflight').split(SID_PRODUCAO).join(SID));
    assert.equal(r.status, 0, r.stderr);
    const q = quadro(r);
    assert.equal(q['migrations concluídas / em aberto'].valor, '50 / 0');
    assert.equal(q['alvos das FKs com índice único exatamente em (cliente_id, id)'].status, 'OK');
    assert.equal(q['TipoAtividade: linhas (anote; o postcheck repete)'].valor, '6');
    for (const [item, v] of Object.entries(q)) if (item !== 'VEREDITO') assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status}`);
    assert.match(q.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    // Com o system_identifier de produção (texto do runbook intacto) o mesmo preflight manda parar.
    assert.match(quadro(await consulta(URL_T, blocoDoRunbook('preflight'))).VEREDITO.valor, /^PARAR/);
  });

  for (const cenario of CENARIOS_RED) {
    test(`TA-RED ${cenario.id}: recusado com a mensagem própria e NADA muda (colunas, constraints, índices, linhas, histórico)`, async () => {
      let r;
      let soltar = null;
      let resolvida = null;
      if (cenario.preparar) await cenario.preparar(db);
      try {
        if (cenario.trava) soltar = await segurarTrava(db);
        r = cenario.runner ? await aplicarPeloRunner(URL_T) : await aplicarArquivo(URL_T);
      } finally {
        if (soltar) await soltar();
        const h = await historico(db);
        if (h.contract_aberta) resolvida = await resolverRevertida(URL_T);
        if (cenario.desfazer) await cenario.desfazer(db);
      }
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, cenario.esperado);
      if (cenario.trava) assert.ok(r.ms < TETO_TRAVA_MS, `desistiu em ${r.ms} ms (lock_timeout de 5 s; não espera a trava)`);
      if (cenario.runner) {
        assert.equal(resolvida?.status, 0, resolvida?.saida);
        assert.ok(!vazou(r.saida, URL_T), 'a URL nunca aparece na saída');
      }
      const h = await historico(db);
      assert.equal(h.contract_concluida + h.contract_aberta, 0);
      assert.deepEqual(await intrusos(db), [], 'o objeto do cenário foi removido e nada da migration ficou');
      assert.deepEqual(await retrato(db), partida, 'o cenário foi desfeito por inteiro');
    });
  }

  test('TA-02 runner com a conferência de alvo exigida e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando só a D-PROD-197, antes de qualquer DDL', async () => {
    // D-PROD-200 (ver o cabeçalho): a CONTRACT posterior sobe fora de ordem, pelo Prisma direto, para só esta pender no runner.
    assert.deepEqual(POSTERIORES, ['20261114500000_atividade_cabecalho'], 'só a CONTRACT da D-PROD-200 tem nome posterior a esta');
    // A EXPAND da D-PROD-198 fica para o runner, depois desta (como em produção).
    await aplicarAnteriores(URL_T, PASTAS.filter((n) => n !== NOME_CONTRACT && n !== NOME_PESO_OBJETIVO && n !== NOME_FORMULACOES));
    partida = await retrato(db);
    linhasPartida = partida.linhas;
    assert.equal((await historico(db)).concluidas, ANTERIORES.length + POSTERIORES.length);
    assert.equal(partida.tabelas.split(',').length, 84, 'a D-PROD-200 troca as 3 tabelas do apontamento antigo pelas 2 da atividade');
    assert.deepEqual(await intrusos(db), []);
    const linhasAntes = (await historico(db)).total;
    // D-PROD-182 criou a tabela; D-PROD-194 e D-PROD-195 são as CONTRACT anteriores (concluídas); a decisão em minúsculas
    // também não vale (comparação exata): nenhuma autoriza esta.
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-194' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-195' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-182' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-197' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-196' }]) {
      const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.saida.includes(`${NOME_CONTRACT} (${DECISAO})`), r.saida);
      for (const outra of [...CONTRACTS_ANTERIORES, ...POSTERIORES]) assert.ok(!r.saida.includes(outra), `${outra} já está concluída: só a D-PROD-197 pende`);
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(r.saida, URL_T));
    }
    assert.equal((await historico(db)).total, linhasAntes, 'nenhuma linha nova no histórico');
    assert.deepEqual(await retrato(db), partida);
  });

  test('TA-03 GREEN pelo runner oficial (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-197): esta e depois a EXPAND da D-PROD-198, todas/0, as 13 colunas com tipo/nulidade/DEFAULT exatos depois das 9, linhas antigas intactas (flags false, padrões null), as 5 constraints, os 3 índices, mesmas tabelas/RLS e migrate diff vazio', async () => {
    const r = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: SID, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /alvo conferido nas duas conexões/);
    assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME_CONTRACT} (${DECISAO})`), r.saida);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.equal(h.concluidas, TOTAL_MIGRATIONS);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    // A EXPAND da D-PROD-198, pendente também, sobe junto e depois desta (pela ordem dos nomes; só esta pede a decisão).
    // A EXPAND da D-PROD-203 (Formulações) também, por último.
    assert.deepEqual((await ordemDeAplicacao(db)).slice(-3), [NOME_CONTRACT, NOME_PESO_OBJETIVO, NOME_FORMULACOES]);
    const [linha] = await db.$queryRawUnsafe(`SELECT checksum, applied_steps_count::int AS passos FROM _prisma_migrations WHERE migration_name = '${NOME_CONTRACT}' AND rolled_back_at IS NULL`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1 });

    // As 9 colunas de antes, intactas, e as 13 novas depois delas, na ordem da migration.
    const colunas = await colunasNovas(db);
    assert.deepEqual(colunas.slice(0, 9).map((c) => c.nome), [...COLUNAS_ANTES]);
    assert.deepEqual(colunas.slice(9).map((c) => [c.nome, c.tipo, c.nao_nula, c.padrao]), COLUNAS_NOVAS.map((c) => [...c]));
    const depois = await retrato(db);
    assert.ok(depois.colunas.startsWith(`${partida.colunas}\n`), 'as colunas antigas não mudaram (nome, tipo, nulidade, DEFAULT)');
    assert.deepEqual(depois.linhas, linhasPartida, 'as linhas nas colunas da D-PROD-182 não mudaram');
    const [novas] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n,
        count(*) FILTER (WHERE ${FLAGS.map((f) => `"${f}"`).join(' OR ')})::int AS com_flag,
        count(*) FILTER (WHERE ${PADROES.map((c) => `"${c}" IS NOT NULL`).join(' OR ')})::int AS com_padrao
      FROM "TipoAtividade"`);
    assert.deepEqual(novas, { n: 6, com_flag: 0, com_padrao: 0 }, 'as linhas que já existiam leem false e null');
    // Nenhuma tabela criada nem apagada por esta; só as 3 das Formulações (D-PROD-203), aplicadas depois.
    assert.deepEqual(depois.tabelas.split(',').filter((t) => !TABELAS_FORMULACOES.includes(t)), partida.tabelas.split(','), 'nenhuma tabela criada nem apagada');
    for (const t of TABELAS_FORMULACOES) assert.ok(depois.tabelas.split(',').includes(t), t);
    assert.equal(depois.rls, partida.rls);
    assert.equal(depois.politicas, partida.politicas);

    // As 5 constraints: 3 FKs compostas RESTRICT/CASCADE validadas e 2 CHECKs; as de antes continuam.
    const cons = await db.$queryRawUnsafe(`SELECT conname::text AS nome, contype::text AS tipo, convalidated AS validada, confdeltype::text AS ao_apagar, confupdtype::text AS ao_alterar, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conrelid = 'public."TipoAtividade"'::regclass ORDER BY conname`);
    const porNome = Object.fromEntries(cons.map((c) => [c.nome, c]));
    for (const [nome, coluna, alvo] of FKS) {
      assert.deepEqual(porNome[nome], { nome, tipo: 'f', validada: true, ao_apagar: 'r', ao_alterar: 'c', def: `FOREIGN KEY (cliente_id, ${coluna}) REFERENCES "${alvo}"(cliente_id, id) ON UPDATE CASCADE ON DELETE RESTRICT` });
    }
    assert.equal(porNome.TipoAtividade_categoria_check.tipo, 'c');
    for (const v of CATEGORIAS) assert.ok(porNome.TipoAtividade_categoria_check.def.includes(`'${v}'`), v);
    assert.equal(porNome.TipoAtividade_coeficiente_padrao_check.def, 'CHECK ((coeficiente_padrao > (0)::numeric))');
    for (const c of partida.constraints.split('\n')) assert.ok(depois.constraints.split('\n').includes(c), `continua: ${c}`);
    assert.equal(cons.length, partida.constraints.split('\n').length + 5);

    // Os 3 índices novos, não-únicos, começando por cliente_id (R10); o unique de negócio da D-PROD-182 continua.
    const indices = await db.$queryRawUnsafe(`SELECT indexname::text AS nome, indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'TipoAtividade' ORDER BY indexname`);
    for (const [, coluna] of FKS) {
      const nome = `TipoAtividade_cliente_id_${coluna}_idx`;
      assert.ok(indices.some((i) => i.nome === nome && i.def === `CREATE INDEX "${nome}" ON public."TipoAtividade" USING btree (cliente_id, ${coluna})`), nome);
    }
    assert.ok(indices.some((i) => i.def === 'CREATE UNIQUE INDEX "TipoAtividade_cliente_id_grupo_atividade_id_nome_tipo_key" ON public."TipoAtividade" USING btree (cliente_id, grupo_atividade_id, nome_tipo)'));
    for (const i of partida.indices.split('\n')) assert.ok(depois.indices.split('\n').includes(i), `continua: ${i}`);

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('TA-04 reaplicar o migration.sql (psql, uma transação) é recusado pela guarda com as 13 colunas citadas e NADA muda; a 2ª execução do runner não tem pendência', async () => {
    const antes = await retrato(db);
    const r = await aplicarArquivo(URL_T);
    assert.notEqual(r.status, 0, r.saida);
    const citadas = COLUNAS_NOVAS.map(([c]) => c).sort().join(', ');
    assert.ok(r.saida.includes(`P0001: tipo_atividade_defaults: TipoAtividade já tem coluna nova (${citadas}): migration já aplicada ou schema fora do esperado; nada foi alterado`), r.saida);
    assert.deepEqual(await retrato(db), antes);
    const segunda = await aplicarPeloRunner(URL_T);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
  });

  test('TA-05 FKs compostas pelo tenant: centro e unidade do MESMO cliente aceitos (a empresa dos centros é regra do serviço); de OUTRO cliente ou inexistentes recusados (23503)', async () => {
    await db.$executeRawUnsafe(`UPDATE "TipoAtividade" SET centro_custo_padrao_id = '${C1}-cc1', centro_resultado_padrao_id = '${C1}-cr1', unidade_producao_id = '${C1}-ha',
      categoria = 'PREPARO_SOLO', coeficiente_padrao = 1.5, exige_maquina = true, permite_implemento = true WHERE id = '${C1}-t1'`);
    const [t1] = await db.$queryRawUnsafe(`SELECT centro_custo_padrao_id, centro_resultado_padrao_id, unidade_producao_id, categoria, coeficiente_padrao::text AS coeficiente, exige_maquina, permite_implemento, exige_area
      FROM "TipoAtividade" WHERE id = '${C1}-t1'`);
    assert.deepEqual(t1, { centro_custo_padrao_id: `${C1}-cc1`, centro_resultado_padrao_id: `${C1}-cr1`, unidade_producao_id: `${C1}-ha`, categoria: 'PREPARO_SOLO', coeficiente: '1.5000', exige_maquina: true, permite_implemento: true, exige_area: false });
    // Mesmo cliente, fazendas diferentes: o banco aceita; quem exige a mesma empresa é o serviço (422 empresas_diferentes).
    await db.$executeRawUnsafe(`UPDATE "TipoAtividade" SET centro_custo_padrao_id = '${C1}-cc2', centro_resultado_padrao_id = '${C1}-cr1' WHERE id = '${C1}-t3'`);
    for (const [nome, coluna] of FKS) {
      const deOutro = { centro_custo_padrao_id: `${C2}-cc1`, centro_resultado_padrao_id: `${C2}-cr1`, unidade_producao_id: `${C2}-ha` }[coluna];
      await recusa(db, `UPDATE "TipoAtividade" SET ${coluna} = '${deOutro}' WHERE id = '${C1}-t2'`, '23503', nome);
      await recusa(db, `UPDATE "TipoAtividade" SET ${coluna} = 'nao-existe' WHERE id = '${C1}-t2'`, '23503', nome);
      await recusa(db, `INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, ${coluna}, "updatedAt")
        VALUES ('${C1}-t-outro', '${C1}', 'Outro', '${C1}-g2', 'Tratos', '${deOutro}', now())`, '23503', nome);
    }
    const [t2] = await db.$queryRawUnsafe(`SELECT ${PADROES.map((c) => `"${c}"`).join(', ')} FROM "TipoAtividade" WHERE id = '${C1}-t2'`);
    assert.deepEqual(t2, Object.fromEntries(PADROES.map((c) => [c, null])), 'nada foi gravado nas recusas');
  });

  test('TA-06 RESTRICT: a unidade e os centros usados como padrão não saem (23503); os não usados saem; ON UPDATE CASCADE leva a troca de id ao tipo', async () => {
    await recusa(db, `DELETE FROM "UnidadeMedida" WHERE id = '${C1}-ha'`, '23503', 'TipoAtividade_cliente_id_unidade_producao_id_fkey');
    await recusa(db, `DELETE FROM "CentroCusto" WHERE id = '${C1}-cc1'`, '23503', 'TipoAtividade_cliente_id_centro_custo_padrao_id_fkey');
    await recusa(db, `DELETE FROM "CentroResultado" WHERE id = '${C1}-cr1'`, '23503', 'TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey');
    const [{ n }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "UnidadeMedida" WHERE id = '${C1}-ha'`);
    assert.equal(n, 1, 'a unidade usada continua');
    assert.equal(await db.$executeRawUnsafe(`DELETE FROM "UnidadeMedida" WHERE id = '${C2}-h'`), 1, 'unidade sem uso sai');
    await db.$executeRawUnsafe(`UPDATE "UnidadeMedida" SET id = '${C1}-ha-novo' WHERE id = '${C1}-ha'`);
    const [t1] = await db.$queryRawUnsafe(`SELECT unidade_producao_id FROM "TipoAtividade" WHERE id = '${C1}-t1'`);
    assert.equal(t1.unidade_producao_id, `${C1}-ha-novo`);
    // Solto o padrão, a unidade sai (é isso que o 409 UNIDADE_MEDIDA_DELETE_BLOCKED pede ao usuário).
    await db.$executeRawUnsafe(`UPDATE "TipoAtividade" SET unidade_producao_id = NULL WHERE id = '${C1}-t1'`);
    assert.equal(await db.$executeRawUnsafe(`DELETE FROM "UnidadeMedida" WHERE id = '${C1}-ha-novo'`), 1);
  });

  test('TA-07 CHECK da categoria: os 9 valores e NULL aceitos; fora da lista, minúscula ou vazio recusados (23514); mais de 24 caracteres não cabe (22001)', async () => {
    for (const v of CATEGORIAS) await db.$executeRawUnsafe(`UPDATE "TipoAtividade" SET categoria = '${v}' WHERE id = '${C2}-t1'`);
    await db.$executeRawUnsafe(`UPDATE "TipoAtividade" SET categoria = NULL WHERE id = '${C2}-t1'`);
    for (const v of ['XYZ', 'aplicacao', '', 'PREPARO SOLO']) {
      await recusa(db, `UPDATE "TipoAtividade" SET categoria = '${v}' WHERE id = '${C2}-t1'`, '23514', 'TipoAtividade_categoria_check');
    }
    await recusa(db, `UPDATE "TipoAtividade" SET categoria = '${'A'.repeat(25)}' WHERE id = '${C2}-t1'`, '22001');
  });

  test('TA-08 CHECK do coeficiente: 0 e negativos recusados (23514); positivos e NULL aceitos, 4 casas; mais de 10 dígitos inteiros não cabe (22003)', async () => {
    for (const v of ['0', '-1', '-0.0001', '0.0000']) {
      await recusa(db, `UPDATE "TipoAtividade" SET coeficiente_padrao = ${v} WHERE id = '${C2}-t1'`, '23514', 'TipoAtividade_coeficiente_padrao_check');
    }
    for (const [v, lido] of [['0.0001', '0.0001'], ['1.23456', '1.2346'], ['9999999999.9999', '9999999999.9999']]) {
      await db.$executeRawUnsafe(`UPDATE "TipoAtividade" SET coeficiente_padrao = ${v} WHERE id = '${C2}-t1'`);
      const [t] = await db.$queryRawUnsafe(`SELECT coeficiente_padrao::text AS c FROM "TipoAtividade" WHERE id = '${C2}-t1'`);
      assert.equal(t.c, lido, v);
    }
    await db.$executeRawUnsafe(`UPDATE "TipoAtividade" SET coeficiente_padrao = NULL WHERE id = '${C2}-t1'`);
    await recusa(db, `UPDATE "TipoAtividade" SET coeficiente_padrao = 12345678901 WHERE id = '${C2}-t1'`, '22003');
  });

  test('TA-09 flags NOT NULL (23502) e com DEFAULT false num INSERT sem elas; o unique (cliente_id, grupo_atividade_id, nome_tipo) segue valendo (23505), por grupo e por cliente', async () => {
    // O Prisma devolve só o DETAIL do 23502 ("Failing row contains …"): a prova é o código e a linha que não mudou.
    for (const f of FLAGS) await recusa(db, `UPDATE "TipoAtividade" SET "${f}" = NULL WHERE id = '${C2}-t1'`, '23502');
    const [t1] = await db.$queryRawUnsafe(`SELECT ${FLAGS.map((f) => `"${f}"`).join(', ')} FROM "TipoAtividade" WHERE id = '${C2}-t1'`);
    assert.deepEqual(t1, Object.fromEntries(FLAGS.map((f) => [f, false])));
    await db.$executeRawUnsafe(`INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, "updatedAt") VALUES ('${C2}-t4', '${C2}', 'Roçar', '${C2}-g2', 'Tratos', now())`);
    const [t4] = await db.$queryRawUnsafe(`SELECT ${[...FLAGS, ...PADROES].map((c) => `"${c}"`).join(', ')} FROM "TipoAtividade" WHERE id = '${C2}-t4'`);
    assert.deepEqual(t4, Object.fromEntries([...FLAGS.map((f) => [f, false]), ...PADROES.map((c) => [c, null])]));
    await recusa(db, `INSERT INTO "TipoAtividade" (id, cliente_id, nome_tipo, grupo_atividade_id, grupo_atividade_nome, "updatedAt") VALUES ('${C1}-t-dup', '${C1}', 'Gradear', '${C1}-g1', 'Preparo', now())`, '23505', 'Key (cliente_id, grupo_atividade_id, nome_tipo)=');
    // O mesmo nome em outro grupo do mesmo cliente e no mesmo grupo de outro cliente já existia na semente.
    const [{ n }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "TipoAtividade" WHERE nome_tipo = 'Gradear'`);
    assert.equal(n, 4);
  });

  test('TA-10 postcheck do runbook no banco aplicado pelo runner: tudo OK/CONFIRA menos as duas contagens que a D-PROD-198, a D-PROD-200 e a D-PROD-203, posteriores, mudam (54 / 0 e 87 tabelas); o preflight agora manda parar', async () => {
    const pos = quadro(await consulta(URL_T, blocoDoRunbook('postcheck').split(SID_PRODUCAO).join(SID)));
    // O postcheck foi escrito para o dia desta (51 / 0, 85 tabelas); aqui a EXPAND da D-PROD-198 e a D-PROD-200 também
    // estão aplicadas (ver o cabeçalho). O postcheck inteiro, APLICADA, é provado no banco do caminho B (TB-03), que
    // fica nesse estado antes do runner.
    const CONTAGENS = { 'migrations concluídas / em aberto': `${TOTAL_MIGRATIONS} / 0`, 'tabelas em public': '87' };
    assert.equal(TOTAL_MIGRATIONS, 54);
    for (const [item, v] of Object.entries(pos)) {
      if (item === 'VEREDITO') continue;
      if (item in CONTAGENS) assert.deepEqual([v.valor, v.status], [CONTAGENS[item], 'PARAR'], item);
      // As sementes do TA-05 a TA-09 gravaram padrões e flags: só essa linha pode pedir conferência a mais.
      else if (item === 'TipoAtividade: linhas com flag true ou padrão preenchido') assert.match(v.status, /^CONFIRA/);
      else assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    }
    assert.match(pos.VEREDITO.valor, /^PARAR/);
    const pre = quadro(await consulta(URL_T, blocoDoRunbook('preflight').split(SID_PRODUCAO).join(SID)));
    assert.equal(pre['20261114300000_tipo_atividade_defaults já registrada'].status, 'PARAR');
    assert.match(pre.VEREDITO.valor, /^PARAR/);
  });
});

describe('D-PROD-197 — caminho B do runbook (uma transação pelo conector), num banco à parte com a mesma partida', () => {
  const envelope = () => {
    const e = blocoDoRunbook('caminho-b');
    assert.equal(e.split(MARCA_MIGRATION).length, 2, 'o envelope tem o lugar do migration.sql');
    return e.replace(MARCA_MIGRATION, () => SQL_MIGRATION);
  };
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

  test('TB-02 histórico fora de 50/0 (uma migration revertida) recusa antes do DDL; restaurado, nada mudou', async () => {
    await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = '20261113800000_apontamento_atividade_item'`);
    try {
      const r = await consulta(URL_B, envelope().split(SID_PRODUCAO).join(SID));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /RELEASE_BLOCKED: histórico com 49 concluídas e 0 em aberto/);
    } finally {
      await dbB.$executeRawUnsafe(`UPDATE _prisma_migrations SET rolled_back_at = NULL WHERE migration_name = '20261113800000_apontamento_atividade_item'`);
    }
    assert.deepEqual(await retrato(dbB), partidaB);
  });

  test('TB-03 GREEN: preflight PRONTO; o envelope aplica numa transação (50 → 51, checksum = SHA-256 do arquivo, applied_steps_count 1); mesmo schema do runner; postcheck APLICADA com as linhas CONFIRA iguais às do preflight; o runner não vê esta pendente (só aplica a EXPAND da D-PROD-198) e depois nada pende; migrate diff vazio', async () => {
    const pre = quadro(await consulta(URL_B, blocoDoRunbook('preflight').split(SID_PRODUCAO).join(SID)));
    assert.match(pre.VEREDITO.valor, /^PRONTO PARA APLICAR/);
    assert.match(quadro(await consulta(URL_B, blocoDoRunbook('postcheck').split(SID_PRODUCAO).join(SID))).VEREDITO.valor, /^PARAR/, 'antes de aplicar, o postcheck manda parar');

    const r = await consulta(URL_B, envelope().split(SID_PRODUCAO).join(SID));
    assert.equal(r.status, 0, r.stderr);
    const h = await historico(dbB);
    assert.deepEqual([h.concluidas, h.abertas, h.contract_concluida], [ANTERIORES.length + 1, 0, 1]);
    const [linha] = await dbB.$queryRawUnsafe(`SELECT checksum, applied_steps_count::int AS passos, logs, finished_at IS NOT NULL AS concluida FROM _prisma_migrations WHERE migration_name = '${NOME_CONTRACT}'`);
    assert.deepEqual(linha, { checksum: CHECKSUM, passos: 1, logs: null, concluida: true });

    // O mesmo schema que o runner deixou no outro banco (colunas, constraints e índices).
    const b = await retratoSemLinhas(dbB);
    const t = await retratoSemLinhas(db);
    const deTipo = (x) => x.indices.split('\n').filter((i) => i.startsWith('TipoAtividade'));
    assert.deepEqual([b.colunas, b.constraints, deTipo(b)], [t.colunas, t.constraints, deTipo(t)]);
    assert.deepEqual((await retrato(dbB)).linhas, partidaB.linhas, 'as linhas nas colunas da D-PROD-182 não mudaram');

    const pos = quadro(await consulta(URL_B, blocoDoRunbook('postcheck').split(SID_PRODUCAO).join(SID)));
    for (const [item, v] of Object.entries(pos)) if (item !== 'VEREDITO') assert.ok(['OK', 'CONFIRA'].includes(v.status), `${item}: ${v.status} (${v.valor})`);
    assert.match(pos.VEREDITO.valor, /^APLICADA E CONFERIDA/);
    assert.equal(pos['TipoAtividade: linhas com flag true ou padrão preenchido'].valor, '0');
    assert.equal(pos['TipoAtividade: RLS / FORCE / políticas'].valor, pre['TipoAtividade: RLS / FORCE / políticas'].valor);
    assert.equal(pos['TipoAtividade: linhas (igual ao preflight)'].valor, pre['TipoAtividade: linhas (anote; o postcheck repete)'].valor);

    // O registro manual vale para o Prisma: o runner não reaplica a D-PROD-197; só aplica as de nome posterior, a EXPAND
    // da D-PROD-198 (não existia no dia desta CONTRACT) e a D-PROD-200 (ver o cabeçalho), e o schema bate com o
    // schema.prisma; a 2ª execução já não vê pendência.
    const runner = await aplicarPeloRunner(URL_B);
    assert.equal(runner.status, 0, runner.saida);
    assert.ok(runner.saida.includes(`Applying migration \`${NOME_PESO_OBJETIVO}\``), runner.saida);
    assert.match(runner.saida, /20261114500000_atividade_cabecalho/);
    assert.ok(runner.saida.includes(`Applying migration \`${NOME_FORMULACOES}\``), runner.saida);
    assert.ok(!runner.saida.includes(`Applying migration \`${NOME_CONTRACT}\``), runner.saida);
    const hB = await historico(dbB);
    assert.deepEqual([hB.concluidas, hB.abertas, hB.contract_concluida], [TOTAL_MIGRATIONS, 0, 1]);
    assert.deepEqual((await ordemDeAplicacao(dbB)).slice(-4), [NOME_CONTRACT, NOME_PESO_OBJETIVO, ...POSTERIORES, NOME_FORMULACOES]);
    const [linhaDepois] = await dbB.$queryRawUnsafe(`SELECT checksum FROM _prisma_migrations WHERE migration_name = '${NOME_CONTRACT}'`);
    assert.equal(linhaDepois.checksum, CHECKSUM, 'a linha do caminho B continua a mesma');
    const segunda = await aplicarPeloRunner(URL_B);
    assert.equal(segunda.status, 0, segunda.saida);
    assert.match(segunda.saida, /No pending migrations to apply/);
    const diff = await migrateDiff(URL_B);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('TB-04 repetir o envelope recusa (migration já registrada) e nada muda', async () => {
    const antes = await retrato(dbB);
    const r = await consulta(URL_B, envelope().split(SID_PRODUCAO).join(SID));
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /RELEASE_BLOCKED: migration já registrada/);
    assert.deepEqual(await retrato(dbB), antes);
  });
});
