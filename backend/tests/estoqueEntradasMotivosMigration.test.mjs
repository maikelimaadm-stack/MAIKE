/**
 * D-PROD-259 — a migration CONTRACT `20261119200000_estoque_entradas_motivos` (o motivo da Entrada vem do cadastro
 * MotivoEntradaEstoque; fornecedor, centros, lote e validade) de ponta a ponta, contra PostgreSQL real, num banco
 * PRÓPRIO criado e apagado por este teste (o banco da suíte não é tocado).
 *
 * Partida: todas as pastas menos esta CONTRACT, pelo Prisma a partir de uma cópia temporária (hoje, a de produção: as
 * Entradas do Estoque, D-PROD-257, por último). D-PROD-264: a saída manual do Estoque (EXPAND, `20261120100000_estoque_saidas`)
 * veio depois desta e fica fora da partida (produção a aplica depois dela); sobe no GREEN, junto, pela ordem dos nomes.
 *
 * RED (nada muda; a falha aberta é resolvida com `migrate resolve --rolled-back`): uma entrada já gravada (as 3 tabelas
 * têm de estar VAZIAS) e uma coluna nova já presente. Toda recusa começa com `guarda:`.
 *
 * GREEN: aplicada, o histórico fecha com todas as pastas, a tabela nova nasce com RLS sem FORCE (e a política do papel
 * do backend quando ele existe), o CHECK do motivo tem as 2 naturezas, a justificativa não é mais exigida, o CHECK do
 * fornecedor recusa fornecedor na implantação e o `migrate diff` contra o schema do repositório é vazio.
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
const NOME_CONTRACT = '20261119200000_estoque_entradas_motivos';
const PASTAS = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
/** D-PROD-264: a EXPAND da saída manual do Estoque, posterior a esta CONTRACT (fora da partida, como em produção). */
const NOME_SAIDAS = '20261120100000_estoque_saidas';
/** A partida de produção no dia desta CONTRACT: as pastas anteriores a ela (a D-PROD-264 ainda não existia). */
const PARTIDA = Object.freeze(PASTAS.filter((n) => n < NOME_CONTRACT));
const existeSaidas = async () => (await db.$queryRawUnsafe(`SELECT to_regclass('public."SaidaEstoque"') IS NOT NULL AS e`))[0].e;
/** D-PROD-265: a CONTRACT aditiva da data de término do apontamento, também posterior (fora da partida). */
const NOME_DATA_TERMINO = '20261120200000_apontamento_data_termino';
/** D-PROD-273: a EXPAND dos campos por tipo, também posterior (fora da partida). */
const NOME_CAMPOS_POR_TIPO = '20261121100000_atividade_campos_por_tipo';
const BANCO = 'maike_eem_teste';
const PAPEL_BACKEND = 'maike_vercel';

/** @type {string} */ let URL_T;
/** @type {PrismaClient} */ let db;
let criouPapel = false;
let comPapel = false;

const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`teste D-PROD-259: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
  return url;
};
const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
const rodar = (comando, args, { env = process.env, cwd = RAIZ } = {}) =>
  new Promise((resolve) => {
    const filho = spawn(comando, args, { cwd, env, shell: false });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('close', (status) => resolve({ status: status ?? 1, saida }));
  });
const ambienteBase = () => {
  const env = { ...process.env };
  for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'MIGRATION_DATABASE_URL', 'MIGRATION_EXIGIR_CONFERENCIA', 'MIGRATION_EXPECTED_SYSTEM_IDENTIFIER', 'MIGRATION_CONTRACT_AUTORIZADO']) delete env[k];
  return env;
};
const prisma = (args, url) => rodar(process.execPath, [PRISMA_CLI, ...args], { env: { ...ambienteBase(), DATABASE_URL: url } });

/** Aplica as pastas `nomes` (cópia temporária) pelo Prisma. */
const aplicarPastas = async (url, nomes) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-eem-'));
  try {
    mkdirSync(join(dir, 'migrations'));
    for (const d of nomes) cpSync(join(MIGRATIONS, d), join(dir, 'migrations', d), { recursive: true });
    cpSync(join(MIGRATIONS, 'migration_lock.toml'), join(dir, 'migrations', 'migration_lock.toml'));
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    return await prisma(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const resolverRevertida = async (url) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-eem-r-'));
  try {
    writeFileSync(join(dir, 'schema.prisma'), 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n');
    mkdirSync(join(dir, 'migrations'));
    cpSync(join(MIGRATIONS, NOME_CONTRACT), join(dir, 'migrations', NOME_CONTRACT), { recursive: true });
    const r = await prisma(['migrate', 'resolve', '--rolled-back', NOME_CONTRACT, '--schema', join(dir, 'schema.prisma')], url);
    assert.equal(r.status, 0, r.saida);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const colunas = async (tabela) => (await db.$queryRawUnsafe(`SELECT a.attname::text AS n FROM pg_attribute a WHERE a.attrelid = 'public."${tabela}"'::regclass AND a.attnum > 0 AND NOT a.attisdropped`)).map((r) => r.n);
const historico = async () => (await db.$queryRawUnsafe(`SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS concluidas,
  count(*) FILTER (WHERE migration_name = '${NOME_CONTRACT}' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS esta FROM _prisma_migrations`))[0];
const existeMotivos = async () => (await db.$queryRawUnsafe(`SELECT to_regclass('public."MotivoEntradaEstoque"') IS NOT NULL AS e`))[0].e;

before(async () => {
  const p = getPrismaClient();
  URL_T = comBanco(exigirUrlLocal(process.env.DATABASE_URL), BANCO);
  const superusuario = (await p.$queryRawUnsafe(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`))[0].rolsuper;
  comPapel = (await p.$queryRawUnsafe(`SELECT 1 FROM pg_roles WHERE rolname = '${PAPEL_BACKEND}'`)).length > 0;
  if (!comPapel && superusuario) {
    await p.$executeRawUnsafe(`CREATE ROLE ${PAPEL_BACKEND} NOLOGIN`);
    criouPapel = true;
    comPapel = true;
  }
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO}`);
  const r = await aplicarPastas(URL_T, PARTIDA);
  assert.equal(r.status, 0, r.saida);
  db = new PrismaClient({ datasourceUrl: URL_T });
});

after(async () => {
  await db?.$disconnect();
  const p = getPrismaClient();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  if (criouPapel) await p.$executeRawUnsafe(`DROP ROLE IF EXISTS ${PAPEL_BACKEND}`);
  await encerrar();
});

describe('D-PROD-259 — migration CONTRACT dos motivos das Entradas (PostgreSQL real)', () => {
  test('EEM-01 partida: todas as pastas anteriores a esta concluídas (as 69 de produção no dia dela); a tabela dos motivos, as colunas novas e a saída manual (D-PROD-264, posterior) não existem', async () => {
    const h = await historico();
    assert.deepEqual(PASTAS.filter((n) => n > NOME_CONTRACT), [NOME_SAIDAS, NOME_DATA_TERMINO, NOME_CAMPOS_POR_TIPO], 'D-PROD-264, D-PROD-265 e D-PROD-273: as pastas posteriores a esta são a saída manual do Estoque, a data de término do apontamento e os campos por tipo');
    assert.equal(PARTIDA.length, PASTAS.length - 4);
    assert.equal(PARTIDA.length, 69);
    assert.equal(h.concluidas, PARTIDA.length);
    assert.equal(h.esta, 0);
    assert.equal(await existeSaidas(), false);
    assert.equal(await existeMotivos(), false);
    assert.ok(!(await colunas('EntradaEstoque')).includes('motivo_id'));
  });

  test('EEM-02 RED: com uma entrada já gravada a guarda recusa e NADA muda; resolvida, a migration volta a pender', async () => {
    await db.$transaction([
      db.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
      db.$executeRawUnsafe(`INSERT INTO "EntradaEstoque" (id, cliente_id, empresa_id, numero, status, motivo, data_entrada, "updatedAt", confirmada_em)
        VALUES ('eem-x', 'c-x', 'e-x', '1', 'CONFIRMADA', 'SALDO_IMPLANTACAO', DATE '2026-11-19', now(), now())`),
    ]);
    const r = await aplicarPastas(URL_T, PASTAS);
    assert.notEqual(r.status, 0, 'a guarda tinha de recusar');
    assert.match(r.saida, /guarda: as Entradas do Estoque já têm lançamentos/);
    assert.equal(await existeMotivos(), false, 'nada foi criado');
    assert.equal(await existeSaidas(), false, 'D-PROD-264: a posterior não sobe sem esta');
    assert.ok(!(await colunas('EntradaEstoque')).includes('fornecedor_id'));
    await resolverRevertida(URL_T);
    await db.$executeRawUnsafe(`DELETE FROM "EntradaEstoque" WHERE id = 'eem-x'`);
  });

  test('EEM-03 RED: com uma coluna nova já presente a guarda recusa e nada muda', async () => {
    await db.$executeRawUnsafe(`ALTER TABLE "EntradaEstoqueItem" ADD COLUMN "lote_fabricante" VARCHAR(64)`);
    const r = await aplicarPastas(URL_T, PASTAS);
    assert.notEqual(r.status, 0);
    assert.match(r.saida, /guarda: coluna nova já presente nas Entradas/);
    assert.equal(await existeMotivos(), false);
    await resolverRevertida(URL_T);
    await db.$executeRawUnsafe(`ALTER TABLE "EntradaEstoqueItem" DROP COLUMN "lote_fabricante"`);
  });

  test('EEM-04 GREEN: aplica; histórico fechado; tabela nova com RLS sem FORCE; CHECKs novos; justificativa livre; migrate diff vazio', async () => {
    const r = await aplicarPastas(URL_T, PASTAS);
    assert.equal(r.status, 0, r.saida);
    const h = await historico();
    assert.equal(h.concluidas, PASTAS.length);
    assert.equal(h.esta, 1);
    assert.equal(await existeSaidas(), true, 'D-PROD-264: a saída manual (EXPAND) sobe depois desta, pela ordem dos nomes');
    assert.ok((await colunas('AtividadeApontamento')).includes('data_termino'), 'D-PROD-265: a data de término sobe depois, pela ordem dos nomes');
    for (const c of ['motivo_id', 'fornecedor_id', 'centro_custo_id', 'centro_resultado_id']) assert.ok((await colunas('EntradaEstoque')).includes(c), c);
    for (const c of ['lote_fabricante', 'data_validade']) assert.ok((await colunas('EntradaEstoqueItem')).includes(c), c);
    const [seg] = await db.$queryRawUnsafe(`SELECT relrowsecurity AS rls, relforcerowsecurity AS force FROM pg_class WHERE oid = 'public."MotivoEntradaEstoque"'::regclass`);
    assert.deepEqual(seg, { rls: true, force: false });
    if (comPapel) {
      const pol = await db.$queryRawUnsafe(`SELECT polname::text AS n FROM pg_policy WHERE polrelid = 'public."MotivoEntradaEstoque"'::regclass`);
      assert.deepEqual(pol.map((x) => x.n), ['maike_backend_all']);
    }
    const checks = await db.$queryRawUnsafe(`SELECT conname::text AS n, pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = 'public."EntradaEstoque"'::regclass AND contype = 'c' ORDER BY conname`);
    const porNome = Object.fromEntries(checks.map((c) => [c.n, c.d]));
    assert.match(porNome.EntradaEstoque_motivo_check, /SALDO_IMPLANTACAO.*ENTRADA/);
    assert.ok(!porNome.EntradaEstoque_motivo_check.includes('DOACAO'));
    assert.equal(porNome.EntradaEstoque_justificativa_check, undefined, 'a justificativa não é mais exigida pelo banco');
    assert.ok(porNome.EntradaEstoque_fornecedor_check);
    const diff = await prisma(['migrate', 'diff', '--from-url', URL_T, '--to-schema-datamodel', SCHEMA, '--exit-code'], URL_T);
    assert.equal(diff.status, 0, `migrate diff não está vazio:\n${diff.saida}`);
  });

  test('EEM-05 2ª execução: nada pendente e nada muda', async () => {
    const r = await aplicarPastas(URL_T, PASTAS);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /No pending migrations to apply/);
    assert.equal((await historico()).concluidas, PASTAS.length);
  });
});
