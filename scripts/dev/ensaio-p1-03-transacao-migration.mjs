#!/usr/bin/env node
/**
 * MAIKE-ESTOQUE-P1-03 (D-PROD-185) — ensaio REAL do escopo transacional do
 * `prisma migrate deploy` (a versão travada no package-lock) sobre um
 * PostgreSQL LOCAL e descartável. Nada aqui toca produção: toda URL passa por
 * `exigirUrlLocal` (recusa alvo protegido) e cada cenário cria e apaga o
 * próprio banco. Nunca imprime URL.
 *
 * Mecanismo provado (log do servidor, `log_statement = all`): o Prisma 6 envia
 * o `migration.sql` INTEIRO numa única mensagem Query do protocolo simples; o
 * PostgreSQL executa uma mensagem com várias instruções como UMA transação
 * implícita (sem BEGIN/COMMIT no arquivo). O registro em `_prisma_migrations`
 * (`applied_steps_count`, `finished_at`) vem DEPOIS, em instruções separadas.
 *
 * Cenários (sandbox: tabelas "T1"/"T2"; migration de ensaio no MESMO formato
 * da P1-03 — dois CREATE INDEX comuns, sem BEGIN/COMMIT):
 *  F. falha determinística no 2º CREATE INDEX → o 1º NÃO fica; a migration
 *     fica `failed` no ledger (finished_at nulo, rolled_back_at nulo, 0 passos);
 *  T. o 2º CREATE INDEX espera a trava de "T2" (uma transação aberta escreveu
 *     nela) → durante a espera, o backend do deploy SEGURA ShareLock em "T1"
 *     (concedido) e espera ShareLock em "T2"; o 1º índice não é visível;
 *     INSERT em "T1" de outra sessão é bloqueado; SELECT em "T1" segue;
 *     liberada a transação, o deploy termina e os dois índices existem;
 *  L. a mesma espera com `lock_timeout` pelas `options` da URL do deploy →
 *     o deploy FALHA (55P03) sem índice nenhum e com o ledger `failed`.
 *
 * Uso: node scripts/dev/ensaio-p1-03-transacao-migration.mjs --url <postgresql://… LOCAL com CREATEDB>
 */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

import { motivoAlvoProtegido } from '../auth/alvoProtegido.mjs';

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PRISMA_CLI = join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js');
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');
export const NOME_P103 = '20261113300000_estoque_p1_03_indices';
const SCHEMA_MINIMO = 'datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n';

/** Recusa (lança) qualquer URL que não seja desta máquina. Nunca devolve nem imprime a URL. */
export const exigirUrlLocal = (url) => {
  const motivo = motivoAlvoProtegido({}, url);
  if (!url || motivo) throw new Error(`ensaio P1-03: só banco LOCAL e descartável (${motivo ?? 'URL ausente'}); nada foi feito`);
  return url;
};
export const comBanco = (url, banco) => Object.assign(new URL(url), { pathname: `/${banco}` }).toString();
/** `options` do libpq na URL (como o runbook da D-PROD-183 passa o lock_timeout). */
export const comOpcoes = (url, opcoes) => `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(opcoes)}`;

const rodar = (args, url) =>
  new Promise((resolve) => {
    const env = { ...process.env, DATABASE_URL: url };
    for (const k of ['POSTGRES_PRISMA_URL', 'POSTGRES_URL', 'MIGRATION_DATABASE_URL', 'MIGRATION_CONTRACT_AUTORIZADO']) delete env[k];
    const filho = spawn(process.execPath, [PRISMA_CLI, ...args], { cwd: RAIZ, env, shell: false });
    let saida = '';
    filho.stdout.on('data', (d) => (saida += d));
    filho.stderr.on('data', (d) => (saida += d));
    filho.on('close', (status) => resolve({ status: status ?? 1, saida }));
  });

const cliente = (url) => new PrismaClient({ datasourceUrl: url, log: [] });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Cria um banco descartável (apaga antes) e devolve a URL dele. */
export const bancoNovo = async (admin, base, nome) => {
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${nome}`);
  return comBanco(base, nome);
};
export const apagarBanco = (admin, nome) => admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);

/** Pasta temporária com schema mínimo e as migrations dadas (`{ nome: sql }` ou cópia das reais). */
const pastaDeMigrations = (migrations) => {
  const dir = mkdtempSync(join(tmpdir(), 'maike-p103-tx-'));
  mkdirSync(join(dir, 'migrations'));
  writeFileSync(join(dir, 'schema.prisma'), SCHEMA_MINIMO);
  writeFileSync(join(dir, 'migrations', 'migration_lock.toml'), 'provider = "postgresql"\n');
  for (const [nome, sql] of Object.entries(migrations)) {
    mkdirSync(join(dir, 'migrations', nome));
    writeFileSync(join(dir, 'migrations', nome, 'migration.sql'), sql);
  }
  return dir;
};
/** `prisma migrate deploy` real sobre a pasta. */
export const deploy = async (dir, url) => rodar(['migrate', 'deploy', '--schema', join(dir, 'schema.prisma')], url);

const BASE = 'CREATE TABLE "T1" ("id" TEXT NOT NULL, "a" TEXT, CONSTRAINT "T1_pkey" PRIMARY KEY ("id"));\nCREATE TABLE "T2" ("id" TEXT NOT NULL, "b" TEXT, CONSTRAINT "T2_pkey" PRIMARY KEY ("id"));\n';
/** Mesmo formato da migration da P1-03: dois CREATE INDEX comuns, sem BEGIN/COMMIT. */
const DOIS_INDICES = 'CREATE INDEX "T1_a_idx" ON "T1"("a");\n\nCREATE INDEX "T2_b_idx" ON "T2"("b");\n';
const SEGUNDO_FALHA = 'CREATE INDEX "T1_a_idx" ON "T1"("a");\n\nCREATE INDEX "T2_x_idx" ON "T2"("coluna_que_nao_existe");\n';

const indicesDe = async (db) => (/** @type {any[]} */ (await db.$queryRawUnsafe(
  `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('T1','T2') AND indexname NOT LIKE '%_pkey' ORDER BY 1`,
))).map((r) => r.indexname);
export const ledger = async (db) => /** @type {any[]} */ (await db.$queryRawUnsafe(
  `SELECT migration_name, finished_at IS NOT NULL AS terminou, rolled_back_at IS NOT NULL AS revertida, applied_steps_count AS passos FROM _prisma_migrations ORDER BY started_at, migration_name`,
));

/** F — falha no 2º CREATE INDEX. */
export const cenarioFalhaNoSegundo = async (admin, base) => {
  const nome = 'maike_p103_tx_f';
  const url = await bancoNovo(admin, base, nome);
  const dir = pastaDeMigrations({ '0001_base': BASE, '0002_dois_indices': SEGUNDO_FALHA });
  const db = cliente(url);
  try {
    const r = await deploy(dir, url);
    return { status: r.status, p3018: /P3018/.test(r.saida), erro_42703: /42703/.test(r.saida), indices: await indicesDe(db), ledger: await ledger(db) };
  } finally {
    await db.$disconnect();
    rmSync(dir, { recursive: true, force: true });
    await apagarBanco(admin, nome);
  }
};

/**
 * T/L — o deploy espera a trava de "T2" (transação aberta que escreveu nela).
 * `opcoes`: options do libpq na URL do DEPLOY (ex.: `-c lock_timeout=1s`).
 */
export const cenarioEspera = async (admin, base, { opcoes = null, sufixo = 't', segurarMs = 0 } = {}) => {
  const nome = `maike_p103_tx_${sufixo}`;
  const url = await bancoNovo(admin, base, nome);
  const dirBase = pastaDeMigrations({ '0001_base': BASE });
  const dir = pastaDeMigrations({ '0001_base': BASE, '0002_dois_indices': DOIS_INDICES });
  const detentor = cliente(url);
  const obs = cliente(url);
  /** @type {(v?: any) => void} */
  let soltar = () => {};
  const solto = new Promise((r) => (soltar = r));
  /** @type {any} */
  const fatos = {};
  try {
    const r0 = await deploy(dirBase, url);
    if (r0.status !== 0) throw new Error('ensaio P1-03: a base do sandbox não subiu');
    // a transação "de negócio" que escreveu em T2 e segue aberta (ROW EXCLUSIVE em T2)
    const tx = detentor.$transaction(async (t) => {
      await t.$executeRawUnsafe(`INSERT INTO "T2" ("id","b") VALUES ('x','y')`);
      fatos.detentor_pid = /** @type {any[]} */ (await t.$queryRawUnsafe('SELECT pg_backend_pid() AS pid'))[0].pid;
      await solto;
    }, { maxWait: 10000, timeout: 120000 });
    while (fatos.detentor_pid === undefined) await esperar(20);
    const pd = deploy(dir, opcoes ? comOpcoes(url, opcoes) : url);
    // espera o backend do deploy parar na trava de T2 (ou terminar, no caso do lock_timeout)
    let pidDeploy = null;
    let terminouAntes = false;
    pd.then(() => (terminouAntes = true));
    for (let i = 0; i < 1500 && pidDeploy === null && !terminouAntes; i += 1) {
      const linhas = /** @type {any[]} */ (await obs.$queryRawUnsafe(
        `SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'CREATE INDEX "T1_a_idx"%'`,
      ));
      if (linhas.length) pidDeploy = linhas[0].pid;
      else await esperar(20);
    }
    if (pidDeploy !== null) {
      fatos.travas_do_deploy = /** @type {any[]} */ (await obs.$queryRawUnsafe(
        `SELECT c.relname AS tabela, l.mode AS modo, l.granted AS concedida FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
          WHERE l.pid = ${Number(pidDeploy)} AND c.relname IN ('T1','T2') ORDER BY c.relname, l.mode`,
      ));
      const atv = /** @type {any[]} */ (await obs.$queryRawUnsafe(
        `SELECT (xact_start = query_start) AS uma_transacao_desde_o_inicio_do_script, state FROM pg_stat_activity WHERE pid = ${Number(pidDeploy)}`,
      ))[0];
      fatos.atividade_do_deploy = atv;
      fatos.indices_visiveis_durante = await indicesDe(obs);
      fatos.select_t1_durante = Number(/** @type {any[]} */ (await obs.$queryRawUnsafe('SELECT count(*)::int AS n FROM "T1"'))[0].n) >= 0;
      fatos.insert_t1_durante = await obs.$transaction(async (t) => {
        await t.$executeRawUnsafe(`SET LOCAL lock_timeout = '500ms'`);
        try {
          await t.$executeRawUnsafe(`INSERT INTO "T1" ("id","a") VALUES ('w','z')`);
          return 'passou';
        } catch (e) {
          return /55P03|lock timeout/i.test(String(/** @type {any} */ (e)?.message ?? e)) ? 'bloqueado (55P03)' : `erro: ${String(e).slice(0, 60)}`;
        }
      }).catch((e) => `erro: ${String(e).slice(0, 60)}`);
    }
    // L: segura a trava de T2 além do lock_timeout do deploy (o deploy tem de desistir sozinho)
    if (segurarMs) await Promise.race([pd, esperar(segurarMs)]);
    soltar();
    await tx;
    const r = await pd;
    fatos.deploy_status = r.status;
    fatos.deploy_55P03 = /55P03|lock timeout/i.test(r.saida);
    fatos.deploy_esperou_trava = pidDeploy !== null;
    fatos.indices_depois = await indicesDe(obs);
    fatos.ledger = await ledger(obs);
    return fatos;
  } finally {
    soltar();
    await detentor.$disconnect();
    await obs.$disconnect();
    rmSync(dirBase, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    await apagarBanco(admin, nome);
  }
};

/** Pasta com as migrations REAIS do repositório (opcionalmente sem as `excluir`). */
export const pastaReal = (excluir = []) => {
  const dir = pastaDeMigrations({});
  for (const d of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (d.isDirectory() && !excluir.includes(d.name)) cpSync(join(MIGRATIONS, d.name), join(dir, 'migrations', d.name), { recursive: true });
  }
  return dir;
};

/* c8 ignore start — CLI */
const principal = async () => {
  const i = process.argv.indexOf('--url');
  const base = exigirUrlLocal(i > 0 ? process.argv[i + 1] : process.env.DATABASE_URL);
  const admin = cliente(base);
  try {
    const f = await cenarioFalhaNoSegundo(admin, base);
    const t = await cenarioEspera(admin, base);
    const l = await cenarioEspera(admin, base, { opcoes: '-c lock_timeout=1s', sufixo: 'l', segurarMs: 4000 });
    console.log(JSON.stringify({ F_falha_no_segundo: f, T_espera_da_trava: t, L_lock_timeout_na_url: l }, null, 2));
  } finally {
    await admin.$disconnect();
  }
};
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  principal().catch((e) => {
    console.error(String(e?.message ?? e));
    process.exit(1);
  });
}
/* c8 ignore stop */
