/**
 * D-PROD-194 — a migration CONTRACT `20261114100000_cadcurvaganho_mensal` (a
 * Curva de Ganho de Peso troca os 3 GMD por estação, gmd_aguas, gmd_transicao e
 * gmd_seca, por 12 GMD mensais, gmd_jan a gmd_dez) de ponta a ponta, contra
 * PostgreSQL real, em bancos PRÓPRIOS criados e apagados por este teste (o
 * banco da suíte não é tocado).
 *
 * Partida: as 48 migrations de nome anterior ao desta CONTRACT (inclui as
 * CONTRACT da D-PROD-162, da D-PROD-183 e da D-PROD-187, já concluídas como em
 * produção; a da D-PROD-187 renomeia CategoriaManejo para CADCATEGORIA e não
 * cria nem apaga tabela; e as EXPAND `20261113300000_estoque_p1_03_indices`,
 * só índices, `20261113700000_apontamento_atividade`, D-PROD-190, que cria a
 * tabela ApontamentoAtividade, e `20261113800000_apontamento_atividade_item`,
 * D-PROD-193, que cria ApontamentoAtividadeItem e
 * ApontamentoAtividadeItemConsumoLote), pelo Prisma a partir de uma cópia
 * temporária; 85 tabelas; CADCURVAGANHO VAZIA com a estrutura por estação; um Cliente e uma
 * Empresa reais. A CONTRACT da release seguinte (D-PROD-195,
 * `20261114200000_cadcategoria_curva_ganho`: CADCATEGORIA.curva_ganho_id com FK
 * composta para CADCURVAGANHO) fica FORA da partida: aplicada antes desta, a FK
 * dela faria a guarda desta recusar ("outra tabela referencia CADCURVAGANHO").
 * Em produção esta já está concluída e a D-PROD-195 entra depois.
 *
 * RED pelo runner (alvo local; nada muda e a falha aberta é resolvida com
 * `migrate resolve --rolled-back`): 1 curva cadastrada, FK de outra tabela,
 * gatilho de usuário, política extra, função citando gmd_seca em caixa mista e
 * migration já aplicada (gmd_jan existente). Toda mensagem começa com
 * `cadcurvaganho_mensal:`.
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`): com a conferência de alvo
 * exigida e MIGRATION_CONTRACT_AUTORIZADO=D-PROD-194 ele RECUSA, porque a
 * D-PROD-195 também pende (nunca duas CONTRACT de uma vez; nada muda); no alvo
 * local, sem a conferência, aplica esta e depois a D-PROD-195 (a guarda dela
 * passa: nenhuma categoria): 50/0, as 12 colunas mensais na ordem, sem as
 * antigas, RLS sem FORCE, maike_backend_all, CHECK de -2 a 3, os mesmos índices
 * mais o UNIQUE (cliente_id, empresa_id, id) da D-PROD-195, mesmas 85 tabelas e
 * `migrate diff` vazio. Sem a decisão exata, num banco à parte, o runner recusa
 * antes de qualquer DDL.
 *
 * As funções seguem as do ensaio da D-PROD-183
 * (`scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs`), copiadas aqui com o nome
 * desta CONTRACT.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

const NOME_CONTRACT = '20261114100000_cadcurvaganho_mensal';
const DECISAO = 'D-PROD-194';
/** D-PROD-195: a CONTRACT da release seguinte, de nome posterior; fora da partida, aplicada pelo runner no GREEN. */
const NOME_CURVA_NA_CATEGORIA = '20261114200000_cadcategoria_curva_ganho';
const POSTERIORES = Object.freeze(readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name > NOME_CONTRACT).map((d) => d.name).sort());
/** Pastas do repositório: a partida (as de nome anterior) e o total depois do GREEN (esta e as posteriores). */
const TOTAL_MIGRATIONS = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
const MIGRATIONS_PARTIDA = TOTAL_MIGRATIONS - 1 - POSTERIORES.length;
const CONTRACTS_ANTERIORES = Object.freeze(['20261110300000_patrimonio_simplifica', '20261113200000_tipo_tarefa_drop_colunas', '20261113500000_categoria_manejo_cadcategoria']);
const BANCO = 'maike_ccg_mensal_teste';
/** Banco à parte para a recusa sem MIGRATION_CONTRACT_AUTORIZADO (o principal já terá aplicado a CONTRACT). */
const BANCO_SEM_AUTORIZACAO = 'maike_ccg_mensal_teste_sem_aut';
const PAPEL_BACKEND = 'maike_vercel';

/** As 3 colunas por estação (primeira fatia, D-PROD-189). */
const COLUNAS_ESTACAO = Object.freeze(['gmd_aguas', 'gmd_transicao', 'gmd_seca']);
/** Os 12 GMD mensais, de janeiro a dezembro. */
const COLUNAS_MESES = Object.freeze(['gmd_jan', 'gmd_fev', 'gmd_mar', 'gmd_abr', 'gmd_mai', 'gmd_jun', 'gmd_jul', 'gmd_ago', 'gmd_set', 'gmd_out', 'gmd_nov', 'gmd_dez']);
const ESCOPO = Object.freeze(['id', 'cliente_id', 'empresa_id', 'nome']);
const RESTO = Object.freeze(['observacoes', 'ativo', 'createdAt', 'updatedAt']);
/** Colunas de CADCURVAGANHO na ordem física (attnum), antes e depois da CONTRACT. */
const COLUNAS_ANTES = Object.freeze([...ESCOPO, ...COLUNAS_ESTACAO, ...RESTO]);
const COLUNAS_DEPOIS = Object.freeze([...ESCOPO, ...COLUNAS_MESES, ...RESTO]);
/** Índices (as uniques do Prisma são índices) e constraints: os mesmos nomes antes e depois desta CONTRACT. */
const INDICES = Object.freeze(['CADCURVAGANHO_cliente_id_empresa_id_ativo_idx', 'CADCURVAGANHO_cliente_id_empresa_id_nome_key', 'CADCURVAGANHO_cliente_id_id_key', 'CADCURVAGANHO_pkey']);
/** Depois de todas as migrations: + o UNIQUE (cliente_id, empresa_id, id) que a FK composta da D-PROD-195 exige. */
const INDICES_TODAS = Object.freeze(['CADCURVAGANHO_cliente_id_empresa_id_ativo_idx', 'CADCURVAGANHO_cliente_id_empresa_id_id_key', 'CADCURVAGANHO_cliente_id_empresa_id_nome_key', 'CADCURVAGANHO_cliente_id_id_key', 'CADCURVAGANHO_pkey']);
const CONSTRAINTS = Object.freeze(['CADCURVAGANHO_cliente_id_empresa_id_fkey:f', 'CADCURVAGANHO_cliente_id_fkey:f', 'CADCURVAGANHO_gmd_check:c', 'CADCURVAGANHO_pkey:p']);

const CLIENTE = 'ccg-c1';
const EMPRESA = 'ccg-c1-emp-1';

const SQL_COLUNAS = `SELECT a.attname::text AS nome FROM pg_attribute a WHERE a.attrelid = 'public."CADCURVAGANHO"'::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`;
const SQL_TABELAS_PUBLIC = `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')`;
const SQL_INDICES = `SELECT indexname::text AS n FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'CADCURVAGANHO' ORDER BY indexname COLLATE "C"`;
const SQL_CONSTRAINTS = `SELECT conname::text || ':' || contype::text AS n FROM pg_constraint WHERE conrelid = 'public."CADCURVAGANHO"'::regclass ORDER BY conname COLLATE "C"`;
const SQL_SEGURANCA = `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force, c.oid::int AS oid FROM pg_class c WHERE c.oid = 'public."CADCURVAGANHO"'::regclass`;
const SQL_POLITICAS = `SELECT p.polname::text AS nome, p.polcmd::text AS cmd, array_to_string(ARRAY(SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY (p.polroles) ORDER BY r.rolname), ',') AS papeis
  FROM pg_policy p WHERE p.polrelid = 'public."CADCURVAGANHO"'::regclass ORDER BY p.polname COLLATE "C"`;
/** Grants para os papéis da Data API (o REVOKE da migration) e para PUBLIC. */
const SQL_GRANTS = `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = 'CADCURVAGANHO' AND grantee IN ('anon', 'authenticated', 'PUBLIC')`;
/** Sobras dos cenários RED (tudo o que eles criam tem "intrus" no nome). */
const SQL_INTRUSOS = `SELECT n FROM (
  SELECT relname::text AS n FROM pg_class WHERE relname LIKE '%intrus%'
  UNION ALL SELECT polname::text FROM pg_policy WHERE polname LIKE '%intrus%'
  UNION ALL SELECT proname::text FROM pg_proc WHERE proname LIKE '%intrus%'
  UNION ALL SELECT tgname::text FROM pg_trigger WHERE tgname LIKE '%intrus%'
  UNION ALL SELECT conname::text FROM pg_constraint WHERE conname LIKE '%intrus%'
) x ORDER BY 1`;

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-194: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
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

/** As 48 migrations anteriores (as pastas de nome anterior ao desta CONTRACT), aplicadas pelo Prisma a partir de uma cópia temporária. */
const aplicarMigrationsAnteriores = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-ccg-mensal-main-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of readdirSync(MIGRATIONS)) if (d < NOME_CONTRACT) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    const r = await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
    if (r.status !== 0) throw new Error(`teste D-PROD-194: as migrations anteriores não subiram (exit ${r.status})\n${r.saida}`);
    return r;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** O runner oficial (`npm run deploy:migrate`). `runtime` é a conexão do runtime (DATABASE_URL) quando a conferência de alvo é exigida. */
const aplicarPeloRunner = (urlMigracao, { runtime, extras = {} } = {}) =>
  rodar(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'deploy:migrate'], {
    env: { ...ambienteBase(), MIGRATION_DATABASE_URL: urlMigracao, DATABASE_URL: runtime ?? urlMigracao, ...extras },
  });
const resolverRevertida = (url) => prisma(['migrate', 'resolve', '--rolled-back', NOME_CONTRACT, '--schema', SCHEMA], url);
const migrateDiff = (url) => prisma(['migrate', 'diff', '--from-url', url, '--to-schema-datamodel', SCHEMA, '--exit-code'], url);

const um = async (db, sql) => (await db.$queryRawUnsafe(sql))[0];
const lista = async (db, sql) => (await db.$queryRawUnsafe(sql)).map((x) => x.n);
const colunasCurva = async (db) => (await db.$queryRawUnsafe(SQL_COLUNAS)).map((c) => c.nome);
const intrusos = (db) => lista(db, SQL_INTRUSOS);
const sistema = async (db) => (await um(db, 'SELECT system_identifier::text AS sid FROM pg_control_system()')).sid;
const historico = async (db) =>
  um(db, `SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
                 count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS abertas,
                 count(*) FILTER (WHERE migration_name IN (${CONTRACTS_ANTERIORES.map((n) => `'${n}'`).join(', ')}) AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS contracts_anteriores,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS contract_concluida,
                 count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NULL AND rolled_back_at IS NULL)::int AS contract_aberta,
                 count(*) FILTER (WHERE migration_name = '${NOME_CURVA_NA_CATEGORIA}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS posterior_concluida
            FROM "_prisma_migrations"`);
/** Migrations concluídas na ordem REAL de aplicação (finished_at). */
const ordemDeAplicacao = async (db) =>
  (await db.$queryRawUnsafe(`SELECT migration_name AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
                              ORDER BY finished_at, started_at, migration_name`)).map((x) => x.n);

/**
 * Retrato de CADCURVAGANHO: tabelas de public, colunas na ordem, curvas, índices, constraints, RLS/FORCE e o oid
 * (um RED que apagasse e recriasse a tabela mudaria o oid) e as políticas.
 */
const retrato = async (db) => ({
  tabelas: (await um(db, SQL_TABELAS_PUBLIC)).n,
  colunas: await colunasCurva(db),
  curvas: (await um(db, `SELECT count(*)::int AS n FROM public."CADCURVAGANHO"`)).n,
  indices: await lista(db, SQL_INDICES),
  constraints: await lista(db, SQL_CONSTRAINTS),
  seguranca: await um(db, SQL_SEGURANCA),
  politicas: await db.$queryRawUnsafe(SQL_POLITICAS),
});

/** Cliente e Empresa reais (as FKs da curva valem: nada de session_replication_role). */
const semear = async (db) => {
  await db.$executeRawUnsafe(`INSERT INTO public."Cliente" (id, codigo, nome, "updatedAt") VALUES ('${CLIENTE}', '${CLIENTE}', 'Cliente de ensaio D-PROD-194', now())`);
  await db.$executeRawUnsafe(`INSERT INTO public."Empresa" (id, cliente_id, numero_empresa, apelido, nome, "updatedAt") VALUES ('${EMPRESA}', '${CLIENTE}', 1, 'Fazenda 1', 'Fazenda de ensaio D-PROD-194', now())`);
};

/** Uma curva no schema mensal; `gmd` sobrescreve meses (o resto vale 0,5). */
const inserirCurvaMensal = (db, id, gmd = {}) => {
  const valores = COLUNAS_MESES.map((c) => (c in gmd ? gmd[c] : 0.5));
  return db.$executeRawUnsafe(
    `INSERT INTO public."CADCURVAGANHO" (id, cliente_id, empresa_id, nome, ${COLUNAS_MESES.join(', ')}, "updatedAt")
     VALUES ('${id}', '${CLIENTE}', '${EMPRESA}', 'Curva ${id}', ${valores.join(', ')}, now())`
  );
};

const recusa = (trecho) => new RegExp(`cadcurvaganho_mensal: ${trecho}`);

/** Cenários RED: cada um prepara um estado, tem de ser RECUSADO pela guarda com a mensagem própria e não pode mudar nada. */
const CENARIOS_RED = Object.freeze([
  {
    id: 'curva_cadastrada',
    esperado: recusa('CADCURVAGANHO tem 1 curvas cadastradas: esta migration só troca a estrutura da tabela vazia'),
    preparar: (db) => db.$executeRawUnsafe(`INSERT INTO public."CADCURVAGANHO" (id, cliente_id, empresa_id, nome, gmd_aguas, gmd_transicao, gmd_seca, "updatedAt")
      VALUES ('ccg-curva-1', '${CLIENTE}', '${EMPRESA}', 'Recria', 0.8, 0.4, -0.1, now())`),
    desfazer: (db) => db.$executeRawUnsafe(`DELETE FROM public."CADCURVAGANHO" WHERE id = 'ccg-curva-1'`),
  },
  {
    id: 'fk_externa',
    esperado: recusa('outra tabela referencia CADCURVAGANHO \\(fk_intrusa em intrusa_ccg\\)'),
    preparar: (db) => db.$executeRawUnsafe(`CREATE TABLE intrusa_ccg (id text PRIMARY KEY, curva_id text CONSTRAINT fk_intrusa REFERENCES public."CADCURVAGANHO" (id))`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP TABLE intrusa_ccg`),
  },
  {
    id: 'gatilho',
    esperado: recusa('gatilho criado fora das migrations em CADCURVAGANHO \\(tg_intruso\\)'),
    preparar: async (db) => {
      await db.$executeRawUnsafe(`CREATE FUNCTION f_tg_intruso() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER tg_intruso BEFORE INSERT ON public."CADCURVAGANHO" FOR EACH ROW EXECUTE FUNCTION f_tg_intruso()`);
    },
    desfazer: async (db) => {
      await db.$executeRawUnsafe(`DROP TRIGGER tg_intruso ON public."CADCURVAGANHO"`);
      await db.$executeRawUnsafe(`DROP FUNCTION f_tg_intruso()`);
    },
  },
  {
    id: 'politica',
    esperado: recusa('política criada fora das migrations em CADCURVAGANHO \\(p_intrusa\\)'),
    preparar: (db) => db.$executeRawUnsafe(`CREATE POLICY p_intrusa ON public."CADCURVAGANHO" FOR SELECT USING (ativo)`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP POLICY p_intrusa ON public."CADCURVAGANHO"`),
  },
  // Caixa mista: sem aspas, c.GMD_Seca É a coluna gmd_seca; a busca da guarda ignora maiúsculas.
  {
    id: 'funcao',
    esperado: recusa('função ou procedure cita as colunas por estação \\(f_intrusa\\(\\)\\)'),
    preparar: (db) => db.$executeRawUnsafe(`CREATE FUNCTION f_intrusa() RETURNS numeric LANGUAGE plpgsql STABLE AS $f$ BEGIN RETURN (SELECT max(c.GMD_Seca) FROM public."CADCURVAGANHO" c); END $f$`),
    desfazer: (db) => db.$executeRawUnsafe(`DROP FUNCTION f_intrusa()`),
  },
  // Uma coluna mensal já presente: a migration já rodou (ou o schema está fora do esperado).
  {
    id: 'ja_aplicada',
    esperado: recusa('CADCURVAGANHO tem 3 das 3 colunas por estação e 1 outras colunas gmd: migration já aplicada'),
    preparar: (db) => db.$executeRawUnsafe(`ALTER TABLE public."CADCURVAGANHO" ADD COLUMN gmd_jan DECIMAL(6,3)`),
    desfazer: (db) => db.$executeRawUnsafe(`ALTER TABLE public."CADCURVAGANHO" DROP COLUMN gmd_jan`),
    colunasPreparadas: [...COLUNAS_ANTES, 'gmd_jan'],
  },
]);

let URL_T;
let URL_S;
let db;
let partida;
/** O papel do backend só é criado (e apagado no fim) se não existia e o usuário do teste é superusuário. */
let criouPapel = false;
let comPapel = false;

before(async () => {
  const p = getPrismaClient();
  const base = exigirUrlLocal(process.env.DATABASE_URL);
  URL_T = comBanco(base, BANCO);
  URL_S = comBanco(base, BANCO_SEM_AUTORIZACAO);
  const superusuario = (await p.$queryRawUnsafe(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`))[0].rolsuper;
  comPapel = (await p.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${PAPEL_BACKEND}'`)).length > 0;
  if (!comPapel && superusuario) {
    // Com o papel no cluster, a D-PROD-189 cria a maike_backend_all na partida (a guarda tem de aceitá-la) e a CONTRACT a recria.
    await p.$executeRawUnsafe(`CREATE ROLE ${PAPEL_BACKEND} NOLOGIN`);
    criouPapel = true;
    comPapel = true;
  }
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_SEM_AUTORIZACAO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO}`);
  await aplicarMigrationsAnteriores(URL_T);
  db = new PrismaClient({ datasourceUrl: URL_T });
  await semear(db);
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  const p = getPrismaClient();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_SEM_AUTORIZACAO} WITH (FORCE)`);
  if (criouPapel) await p.$executeRawUnsafe(`DROP ROLE IF EXISTS ${PAPEL_BACKEND}`);
  await encerrar();
});

describe('D-PROD-194 — migration CONTRACT que troca CADCURVAGANHO para 12 GMD mensais (PostgreSQL real)', () => {
  test('CM-01 partida: 48 migrations (as CONTRACT da D-PROD-162, da D-PROD-183 e da D-PROD-187 concluídas; a D-PROD-195, posterior, ainda não), 85 tabelas, CADCURVAGANHO vazia com gmd_aguas/gmd_transicao/gmd_seca', async () => {
    assert.deepEqual(POSTERIORES, [NOME_CURVA_NA_CATEGORIA], 'só a CONTRACT da D-PROD-195 tem nome posterior a esta');
    assert.equal(MIGRATIONS_PARTIDA, 48);
    assert.equal(TOTAL_MIGRATIONS, 50);
    const h = await historico(db);
    assert.equal(h.concluidas, MIGRATIONS_PARTIDA);
    assert.equal(h.posterior_concluida, 0);
    assert.equal(h.abertas, 0);
    assert.equal(h.contracts_anteriores, 3);
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    assert.equal(partida.tabelas, 85, 'as 85 da main (com ApontamentoAtividade, D-PROD-190, e os 2 de itens do apontamento, D-PROD-193)');
    assert.deepEqual(partida.colunas, [...COLUNAS_ANTES]);
    assert.equal(partida.curvas, 0);
    assert.deepEqual(partida.indices, [...INDICES]);
    assert.deepEqual(partida.constraints, [...CONSTRAINTS]);
    assert.equal(partida.seguranca.rls, true);
    assert.equal(partida.seguranca.force, false);
    assert.deepEqual(partida.politicas, comPapel ? [{ nome: 'maike_backend_all', cmd: '*', papeis: PAPEL_BACKEND }] : []);
    assert.deepEqual(await intrusos(db), []);
  });

  for (const cenario of CENARIOS_RED) {
    test(`CM-02 ${cenario.id}: a guarda recusa (cadcurvaganho_mensal:) e NADA muda (colunas por estação, mesma tabela, histórico 48 e a D-PROD-195 nem começa, migration aberta → resolvida)`, async () => {
      await cenario.preparar(db);
      let r;
      let antes;
      let depois;
      let hist;
      let resolvida = null;
      try {
        antes = await retrato(db);
        r = await aplicarPeloRunner(URL_T);
        depois = await retrato(db);
        hist = await historico(db);
        if (hist.contract_aberta) resolvida = await resolverRevertida(URL_T);
      } finally {
        await cenario.desfazer(db);
      }
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, cenario.esperado);
      assert.deepEqual(antes.colunas, cenario.colunasPreparadas ?? [...COLUNAS_ANTES]);
      assert.deepEqual(depois, antes, 'nenhuma coluna, linha, índice ou política mudou; a tabela é a mesma (oid)');
      assert.equal(hist.concluidas, MIGRATIONS_PARTIDA);
      assert.equal(hist.posterior_concluida, 0, 'o deploy para na primeira que falha');
      assert.equal(hist.contract_concluida, 0);
      assert.equal(hist.contract_aberta, 1, 'a linha da migration fica com finished_at NULL');
      assert.equal(resolvida?.status, 0, resolvida?.saida);
      const h = await historico(db);
      assert.equal(h.concluidas, MIGRATIONS_PARTIDA);
      assert.equal(h.contract_aberta, 0);
      assert.deepEqual(await intrusos(db), [], 'o objeto do cenário foi removido');
      assert.deepEqual(await retrato(db), partida, 'o cenário foi desfeito por inteiro');
      assert.ok(!vazou(r.saida, URL_T), 'a URL nunca aparece na saída');
    });
  }

  test('CM-03 GREEN pelo runner oficial: com o alvo conferido e MIGRATION_CONTRACT_AUTORIZADO=D-PROD-194 recusa (a D-PROD-195 também pende; nada muda); no alvo local aplica esta e a D-PROD-195: 50/0, as 12 colunas mensais na ordem, sem as antigas, RLS sem FORCE, maike_backend_all, CHECK, índices e migrate diff vazio', async () => {
    const sid = await sistema(db);
    // Nunca duas CONTRACT de uma vez: com esta e a D-PROD-195 pendentes, a decisão desta não basta (e a da D-PROD-195 também não).
    for (const autorizada of [DECISAO, 'D-PROD-195']) {
      const recusada = await aplicarPeloRunner(URL_T, { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, MIGRATION_CONTRACT_AUTORIZADO: autorizada } });
      assert.equal(recusada.status, 1, recusada.saida);
      assert.match(recusada.saida, /alvo conferido nas duas conexões/);
      assert.match(recusada.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(recusada.saida.includes(autorizada === DECISAO ? `${NOME_CURVA_NA_CATEGORIA} (D-PROD-195)` : `${NOME_CONTRACT} (${DECISAO})`), recusada.saida);
      assert.match(recusada.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(recusada.saida, URL_T));
      assert.equal((await historico(db)).concluidas, MIGRATIONS_PARTIDA);
      assert.deepEqual(await retrato(db), partida, 'nada mudou');
    }

    // Alvo local (sem a conferência exigida): o runner aplica as pendentes pela ordem dos nomes, esta e depois a D-PROD-195.
    const r = await aplicarPeloRunner(URL_T);
    assert.equal(r.status, 0, r.saida);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.equal(h.concluidas, TOTAL_MIGRATIONS);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    assert.equal(h.posterior_concluida, 1);
    assert.deepEqual((await ordemDeAplicacao(db)).slice(-2), [NOME_CONTRACT, NOME_CURVA_NA_CATEGORIA]);

    const depois = await retrato(db);
    assert.deepEqual(depois.colunas, [...COLUNAS_DEPOIS]);
    for (const c of COLUNAS_ESTACAO) assert.ok(!depois.colunas.includes(c), `${c} saiu`);
    assert.equal(depois.curvas, 0, 'a tabela volta vazia');
    assert.equal(depois.tabelas, partida.tabelas, 'nenhuma tabela a mais nem a menos (85)');
    assert.notEqual(depois.seguranca.oid, partida.seguranca.oid, 'a tabela foi recriada');
    assert.equal(depois.seguranca.rls, true, 'RLS ligado');
    assert.equal(depois.seguranca.force, false, 'sem FORCE');
    assert.deepEqual(depois.politicas, comPapel ? [{ nome: 'maike_backend_all', cmd: '*', papeis: PAPEL_BACKEND }] : []);
    assert.equal((await um(db, SQL_GRANTS)).n, 0, 'nenhum grant para anon/authenticated/PUBLIC');
    // Os índices desta CONTRACT voltam com os mesmos nomes; o UNIQUE (cliente_id, empresa_id, id) é o da D-PROD-195.
    assert.deepEqual(depois.indices, [...INDICES_TODAS]);
    assert.deepEqual(depois.constraints, [...CONSTRAINTS], 'a FK composta da D-PROD-195 mora em CADCATEGORIA');

    // Tipo DECIMAL(6,3) NOT NULL nos 12 meses.
    const tipos = await db.$queryRawUnsafe(`SELECT column_name::text AS c, numeric_precision::int AS p, numeric_scale::int AS s, is_nullable::text AS nulo
      FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADCURVAGANHO' AND column_name LIKE 'gmd%' ORDER BY ordinal_position`);
    assert.deepEqual(tipos, COLUNAS_MESES.map((c) => ({ c, p: 6, s: 3, nulo: 'NO' })));

    // CHECK de -2 a 3 em cada mês: o definido no banco cita os 12 e barra o valor fora da faixa.
    const check = (await um(db, `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'CADCURVAGANHO_gmd_check'`)).def;
    for (const c of COLUNAS_MESES) assert.ok(check.includes(`${c} >=`) && check.includes(`${c} <=`), `${c} no CHECK: ${check}`);
    await inserirCurvaMensal(db, 'ccg-limites', { gmd_jan: 3, gmd_jul: -2 });
    for (const [mes, valor] of [['gmd_ago', 3.001], ['gmd_dez', -2.001]]) {
      await assert.rejects(inserirCurvaMensal(db, `ccg-fora-${mes}`, { [mes]: valor }), /CADCURVAGANHO_gmd_check/);
    }
    await db.$executeRawUnsafe(`DELETE FROM public."CADCURVAGANHO" WHERE id = 'ccg-limites'`);

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('CM-04 runner com a conferência de alvo exigida e SEM a decisão exata (banco à parte, 48 migrations) → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED citando D-PROD-194 (e a D-PROD-195, também pendente) antes de qualquer DDL', async () => {
    const p = getPrismaClient();
    await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_SEM_AUTORIZACAO}`);
    await aplicarMigrationsAnteriores(URL_S);
    const dbS = new PrismaClient({ datasourceUrl: URL_S });
    try {
      const partidaS = await retrato(dbS);
      assert.deepEqual(partidaS.colunas, [...COLUNAS_ANTES]);
      const sid = await sistema(dbS);
      const linhasAntes = (await historico(dbS)).total;
      // D-PROD-190 e D-PROD-191 são os números antigos desta CONTRACT (hoje da PR #269, Apontamento de Atividade, e da
      // PR #271, ícones de lote): também têm de ser recusados; e a D-PROD-193 (PR #274, itens do apontamento), a EXPAND
      // mais recente da main.
      for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-183' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-187' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-190' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-191' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-193' }, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-195' }]) {
        const r = await aplicarPeloRunner(URL_S, { runtime: URL_S, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, ...extra } });
        assert.equal(r.status, 1, r.saida);
        assert.match(r.saida, /alvo conferido nas duas conexões/);
        assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
        assert.ok(r.saida.includes(`${NOME_CONTRACT} (${DECISAO})`), r.saida);
        for (const anterior of CONTRACTS_ANTERIORES) assert.ok(!r.saida.includes(anterior), `${anterior} já está concluída: só a D-PROD-194 e a D-PROD-195 pendem`);
        assert.match(r.saida, /Nenhuma migration foi executada/);
        assert.ok(!vazou(r.saida, URL_S));
      }
      const h = await historico(dbS);
      assert.equal(h.total, linhasAntes, 'nenhuma linha nova no histórico');
      assert.equal(h.concluidas, MIGRATIONS_PARTIDA);
      assert.deepEqual(await retrato(dbS), partidaS, 'nada mudou');
    } finally {
      await dbS.$disconnect();
    }
  });

  test('CM-05 2ª execução do runner: nada pendente e nada muda', async () => {
    const antes = await retrato(db);
    const r = await aplicarPeloRunner(URL_T);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
    assert.equal((await historico(db)).concluidas, TOTAL_MIGRATIONS);
  });
});
