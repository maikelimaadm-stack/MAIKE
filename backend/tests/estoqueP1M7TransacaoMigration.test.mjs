/**
 * MAIKE-ESTOQUE-P1-03 (D-PROD-185) — prova REAL do escopo transacional do
 * `prisma migrate deploy` (versão do package-lock) e do preflight fail-closed.
 * PostgreSQL local/da CI, bancos descartáveis criados e apagados aqui; nada
 * remoto (as funções recusam alvo protegido). Funções do ensaio
 * `scripts/dev/ensaio-p1-03-transacao-migration.mjs`.
 *
 *  TX-F falha determinística no 2º CREATE INDEX (mesmo formato da migration da
 *       P1-03): o 1º índice NÃO persiste; ledger `failed` (sem finished_at, sem
 *       rolled_back_at, 0 passos); P3018 no deploy que falha, P3009 no seguinte.
 *  TX-T o 2º CREATE INDEX espera a trava da 2ª tabela: o backend do deploy SEGURA
 *       ShareLock na 1ª (concedido) e espera ShareLock na 2ª, numa transação só
 *       desde o início do script; o 1º índice não é visível; INSERT na 1ª tabela
 *       bloqueia (55P03 com lock_timeout curto do observador); SELECT segue;
 *       liberada a trava, os dois índices e o ledger concluído.
 *  TX-L o mesmo com `lock_timeout` nas `options` da URL do deploy: o deploy
 *       desiste (55P03) sem índice nenhum, ledger `failed`.
 *  PF   o preflight real (`estoque-p1-03-preflight-…sql`, READ ONLY) com as
 *       migrations REAIS: antes → SEGUIR; índice criado à mão (parcial) → PARAR;
 *       a migration REAL falhando no 2º índice (nome já ocupado) → nenhum índice,
 *       ledger falhado → PARAR; depois de `migrate resolve --rolled-back` (só no
 *       sandbox) e a causa removida → SEGUIR; aplicada → JA_APLICADA; nome ocupado
 *       por outra relação → PARAR; índice de mesmo nome com definição diferente → PARAR.
 *  OR   (R2) as duas ordens: banco novo (P1-03 antes da CADESTACOES, pelo nome) e produção (CADESTACOES e CADCURVAGANHO
 *       antes, P1-03 por último): todas/0, mesmo schema e sem drift, e o runner aceita a P1-03 pendente.
 *  PB   (R2) a lista `base_release` do preflight: nomes reais, sem a P1-03, com as mais antigas e as aplicadas antes dela.
 *  PH   (R2) histórico contra a base: a base → SEGUIR; CADESTACOES ausente, migration desconhecida (antes e
 *       depois), nome duplicado, falhada → PARAR; base + P1-03 por último → JA_APLICADA.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

import {
  NOME_P103, RAIZ, apagarBanco, bancoNovo, cenarioEspera, cenarioFalhaNoSegundo, deploy, exigirUrlLocal, ledger, pastaReal,
} from '../../scripts/dev/ensaio-p1-03-transacao-migration.mjs';
import { conferirHistoricoRemoto, sha256 } from '../../scripts/deploy/premergeMigrateLib.mjs';

/** Migrations com carimbo posterior ao da P1-03, aplicadas em produção ANTES dela (D-PROD-188 e D-PROD-189). */
const NOME_CAD = '20261113400000_cadestacoes_cadastro';
const NOME_CURVA = '20261113600000_cadcurvaganho_cadastro';
const MIGRATIONS = join(RAIZ, 'backend', 'prisma', 'migrations');

const PREFLIGHT = readFileSync(join(RAIZ, 'scripts', 'ops', 'sql-editor', 'estoque-p1-03-preflight-indices-somente-leitura.sql'), 'utf8');
/** A base da release como o preflight a declara (CTE base_release); vazia se ausente. */
const BASE_RELEASE = (() => {
  const bloco = PREFLIGHT.match(/base_release\(nome\) AS \(\s*VALUES([\s\S]*?)\n\),/);
  return bloco ? [...bloco[1].matchAll(/'(\d{14}_[a-z0-9_]+)'/g)].map((m) => m[1]) : [];
})();
let base;
/** @type {PrismaClient} */
let admin;
before(() => {
  base = exigirUrlLocal(process.env.DATABASE_URL);
  admin = new PrismaClient({ datasourceUrl: base, log: [] });
});
after(async () => {
  await admin.$disconnect();
});

describe('Escopo transacional do prisma migrate deploy (PG real)', () => {
  test('TX-F falha no 2º CREATE INDEX: o 1º não persiste; ledger failed; P3018', async () => {
    const r = await cenarioFalhaNoSegundo(admin, base);
    assert.notEqual(r.status, 0);
    assert.equal(r.p3018, true, 'erro de migration falhada do Prisma');
    assert.equal(r.erro_42703, true, 'a causa é o 2º índice');
    assert.deepEqual(r.indices, [], 'o 1º CREATE INDEX foi desfeito junto: uma transação só');
    assert.deepEqual(r.ledger.find((l) => l.migration_name === '0002_dois_indices'), { migration_name: '0002_dois_indices', terminou: false, revertida: false, passos: 0 });
    assert.notEqual(r.retry_status, 0, 'o deploy seguinte recusa');
    assert.equal(r.retry_p3009, true, 'retry com migration falhada pendente: P3009 (não P3018)');
  });

  test('TX-T espera da 2ª trava: ShareLock da 1ª tabela retido, 1º índice invisível, escrita na 1ª bloqueada, leitura livre', async () => {
    const r = await cenarioEspera(admin, base);
    assert.equal(r.deploy_esperou_trava, true);
    assert.deepEqual(r.travas_do_deploy, [
      { tabela: 'T1', modo: 'ShareLock', concedida: true },
      { tabela: 'T2', modo: 'ShareLock', concedida: false },
    ]);
    assert.equal(r.atividade_do_deploy.uma_transacao_desde_o_inicio_do_script, true);
    assert.deepEqual(r.indices_visiveis_durante, [], 'o 1º índice só aparece no COMMIT');
    assert.equal(r.select_t1_durante, true);
    assert.equal(r.insert_t1_durante, 'bloqueado (55P03)');
    assert.equal(r.deploy_status, 0);
    assert.deepEqual(r.indices_depois, ['T1_a_idx', 'T2_b_idx']);
    assert.equal(r.ledger.find((l) => l.migration_name === '0002_dois_indices').terminou, true);
  });

  test('TX-L lock_timeout nas options da URL do deploy: desiste com 55P03, nenhum índice, ledger failed', async () => {
    const r = await cenarioEspera(admin, base, { opcoes: '-c lock_timeout=1s', sufixo: 'l', segurarMs: 4000 });
    assert.equal(r.deploy_esperou_trava, true);
    assert.notEqual(r.deploy_status, 0);
    assert.equal(r.deploy_55P03, true);
    assert.deepEqual(r.indices_depois, []);
    assert.deepEqual(r.ledger.find((l) => l.migration_name === '0002_dois_indices'), { migration_name: '0002_dois_indices', terminou: false, revertida: false, passos: 0 });
  });
});

/** Preflight numa transação READ ONLY que nunca commita → { 'secao.item': valor }. */
const preflight = async (db) => {
  /** @type {any[]} */
  let linhas = [];
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    linhas = await tx.$queryRawUnsafe(PREFLIGHT);
    throw new Error('desfaz');
  }).catch((x) => {
    if (x?.message !== 'desfaz') throw x;
  });
  return Object.fromEntries(linhas.map((l) => [`${l.secao}.${l.item}`, l.valor]));
};
const resolveRevertida = (dir, url) =>
  new Promise((resolve) => {
    const env = { ...process.env, DATABASE_URL: url };
    const f = spawn(process.execPath, [join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'resolve', '--rolled-back', NOME_P103, '--schema', join(dir, 'schema.prisma')], { cwd: RAIZ, env });
    f.on('close', (s) => resolve(s ?? 1));
  });

describe('Preflight fail-closed com as migrations reais', () => {
  test('PF antes → SEGUIR; parcial à mão → PARAR; migration real falhada → PARAR; revertida e corrigida → SEGUIR; aplicada → JA_APLICADA', async () => {
    const nome = 'maike_p103_preflight';
    const url = await bancoNovo(admin, base, nome);
    const semP103 = pastaReal([NOME_P103]);
    const todas = pastaReal([]);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    try {
      assert.equal((await deploy(semP103, url)).status, 0, 'a main antes da P1-03 sobe');
      let v = await preflight(db);
      assert.equal(v['veredito.estado'], 'SEGUIR', JSON.stringify(v));
      assert.deepEqual([v['indice.novos_ja_existem'], v['migration.falhadas_pendentes'], v['migration.contract_d_prod_183_aplicada']], ['0', '0', 'SIM']);

      // nome de um dos índices ocupado por OUTRA relação (tabela): o CREATE INDEX falharia → PARAR antes do GO-2
      await db.$executeRawUnsafe('CREATE TABLE "MovimentacaoEstoque_keyset_empresa_idx" (x int)');
      v = await preflight(db);
      assert.deepEqual([v['indice.nomes_ocupados_qualquer_tipo'], v['veredito.estado']], ['1', 'PARAR'], 'nome ocupado por tabela');
      await db.$executeRawUnsafe('DROP TABLE "MovimentacaoEstoque_keyset_empresa_idx"');

      // parcial à mão: só o 1º índice existe, sem a migration
      await db.$executeRawUnsafe('CREATE INDEX "OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx" ON "OperacaoIdempotente"("cliente_id", "tipo_operacao", "createdAt")');
      v = await preflight(db);
      assert.equal(v['veredito.estado'], 'PARAR', 'índice parcial fora da migration');
      await db.$executeRawUnsafe('DROP INDEX "OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx"');

      // a migration REAL falha no 2º índice (o nome já está ocupado por outra relação)
      await db.$executeRawUnsafe('CREATE TABLE "MovimentacaoEstoque_keyset_empresa_idx" (x int)');
      const r = await deploy(todas, url);
      assert.notEqual(r.status, 0, 'a migration real falha');
      assert.match(r.saida, /P3018/);
      v = await preflight(db);
      assert.equal(v['indice.novos_ja_existem'], '0', 'o 1º índice (LC-2) NÃO ficou: a migration é uma transação só');
      assert.equal(v['migration.falhadas_pendentes'], '1');
      assert.equal(v['veredito.estado'], 'PARAR');
      const p103 = (await ledger(db)).find((l) => l.migration_name === NOME_P103);
      assert.deepEqual([p103.terminou, p103.revertida, p103.passos], [false, false, 0]);

      // recuperação LOCAL (no runbook ela exige GO próprio): resolve --rolled-back e causa removida → SEGUIR
      assert.equal(await resolveRevertida(todas, url), 0);
      await db.$executeRawUnsafe('DROP TABLE "MovimentacaoEstoque_keyset_empresa_idx"');
      v = await preflight(db);
      assert.deepEqual([v['migration.falhadas_pendentes'], v['migration.revertidas_historico'], v['veredito.estado']], ['0', '1', 'SEGUIR']);

      assert.equal((await deploy(todas, url)).status, 0, 'reaplicada pelo deploy real');
      v = await preflight(db);
      assert.deepEqual([v['indice.novos_ja_existem'], v['indice.definicoes_exatas_validas'], v['veredito.estado']], ['2', '2', 'JA_APLICADA']);

      // migration registrada, mas um índice com o MESMO nome e definição diferente (em outra tabela) → PARAR
      await db.$executeRawUnsafe('DROP INDEX "MovimentacaoEstoque_keyset_empresa_idx"');
      await db.$executeRawUnsafe('CREATE INDEX "MovimentacaoEstoque_keyset_empresa_idx" ON "OperacaoIdempotente"("cliente_id")');
      v = await preflight(db);
      assert.deepEqual([v['indice.novos_ja_existem'], v['indice.definicoes_exatas_validas'], v['veredito.estado']], ['2', '1', 'PARAR'], 'nome certo, definição errada');
    } finally {
      await db.$disconnect();
      rmSync(semP103, { recursive: true, force: true });
      rmSync(todas, { recursive: true, force: true });
      await apagarBanco(admin, nome);
    }
  });
});

/* ------------------------------------------------------------------------------------------------
 * R2 — base da release e ordem das migrations.
 * A produção aplicou a CADESTACOES (20261113400000) antes da P1-03 (20261113300000): o carimbo da
 * P1-03 é anterior, mas a ordem real de aplicação é a inversa. O preflight passa a conferir o
 * histórico (nomes, não checksums: isso é do `premerge-migrate --verificar-alvo`) contra a lista
 * fixa da base da release, e os dois caminhos de aplicação têm de chegar ao mesmo schema.
 * ---------------------------------------------------------------------------------------------- */
const prismaCli = (args, url) =>
  new Promise((resolve) => {
    const f = spawn(process.execPath, [join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js'), ...args], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url } });
    let saida = '';
    f.stdout.on('data', (d) => { saida += d; });
    f.stderr.on('data', (d) => { saida += d; });
    f.on('close', (s) => resolve({ status: s ?? 1, saida }));
  });
/** `migrate diff --exit-code`: 0 = sem diferença, 2 = há diferença. */
const semDiferenca = async (de, para) => (await prismaCli(['migrate', 'diff', ...de, ...para, '--exit-code'], de[1])).status;
const SCHEMA = join(RAIZ, 'backend', 'prisma', 'schema.prisma');
const concluidasPorOrdem = async (db) => (/** @type {any[]} */ (await db.$queryRawUnsafe(
  `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at, migration_name`,
))).map((r) => r.migration_name);
const locaisDaPasta = () => readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory())
  .map((d) => ({ nome: d.name, checksum: sha256(readFileSync(join(MIGRATIONS, d.name, 'migration.sql'), 'utf8')) }));
const linhasDoHistorico = (db) => db.$queryRawUnsafe('SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations');
const indicesNovos = async (db) => (/** @type {any[]} */ (await db.$queryRawUnsafe(
  `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('OperacaoIdempotente_cliente_id_tipo_operacao_createdAt_idx', 'MovimentacaoEstoque_keyset_empresa_idx') ORDER BY 1`,
)));

describe('Ordem das migrations: banco novo (P1-03 antes da CADESTACOES) e produção (CADESTACOES antes da P1-03)', () => {
  test('OR as duas ordens: todas/0, mesmo schema entre si e igual ao schema.prisma, índices e CADESTACOES iguais; o runner aceita a P1-03 pendente depois da CADESTACOES', async () => {
    const [nomeNovo, nomeProd] = ['maike_p103_ordem_novo', 'maike_p103_ordem_prod'];
    const urlNovo = await bancoNovo(admin, base, nomeNovo);
    const urlProd = await bancoNovo(admin, base, nomeProd);
    const semP103 = pastaReal([NOME_P103]);
    const todas = pastaReal([]);
    const dbNovo = new PrismaClient({ datasourceUrl: urlNovo, log: [] });
    const dbProd = new PrismaClient({ datasourceUrl: urlProd, log: [] });
    try {
      // 1. banco novo: o Prisma aplica pela ordem do nome → … → P1-03 → CADESTACOES
      assert.equal((await deploy(todas, urlNovo)).status, 0);
      const ordemNovo = await concluidasPorOrdem(dbNovo);
      const total = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).length;
      assert.equal(ordemNovo.length, total);
      assert.ok(ordemNovo.indexOf(NOME_P103) < ordemNovo.indexOf(NOME_CAD), 'banco novo: P1-03 antes da CADESTACOES');

      // 2. produção: a base inteira (com a CADESTACOES e a CADCURVAGANHO) e só depois a P1-03, pelo mesmo `migrate deploy`
      assert.equal((await deploy(semP103, urlProd)).status, 0);
      const antes = conferirHistoricoRemoto({ locais: locaisDaPasta(), linhas: await linhasDoHistorico(dbProd) });
      assert.deepEqual([antes.ok, antes.pendentes, antes.falhas], [true, [NOME_P103], []], 'o runner reconhece o histórico de produção e só a P1-03 pendente');
      const r = await deploy(todas, urlProd);
      assert.equal(r.status, 0, r.saida);
      const ordemProd = await concluidasPorOrdem(dbProd);
      assert.equal(ordemProd.length, total);
      assert.ok(ordemProd.indexOf(NOME_CURVA) < ordemProd.indexOf(NOME_P103) && ordemProd.indexOf(NOME_CAD) < ordemProd.indexOf(NOME_P103));
      assert.equal(ordemProd.at(-1), NOME_P103, 'produção: a P1-03 é a última por finished_at, apesar do carimbo anterior');
      const depois = conferirHistoricoRemoto({ locais: locaisDaPasta(), linhas: await linhasDoHistorico(dbProd) });
      assert.deepEqual([depois.ok, depois.pendentes, depois.falhas], [true, [], []]);

      // 3. nas duas: nenhuma falhada, mesmo schema (entre si e com o schema.prisma), mesmos índices
      for (const db of [dbNovo, dbProd]) {
        const l = await ledger(db);
        assert.equal(l.filter((x) => !x.terminou || x.revertida).length, 0, 'nenhuma migration falhada ou revertida');
      }
      assert.equal(await semDiferenca(['--from-url', urlNovo], ['--to-url', urlProd]), 0, 'banco novo e produção: mesmo schema');
      for (const url of [urlNovo, urlProd]) assert.equal(await semDiferenca(['--from-url', url], ['--to-schema-datamodel', SCHEMA]), 0, 'sem drift contra o schema.prisma');
      assert.deepEqual(await indicesNovos(dbNovo), await indicesNovos(dbProd));
      assert.equal((await indicesNovos(dbProd)).length, 2);
      // CADESTACOES intacta: mesmas colunas e constraints nas duas ordens
      const cad = (db) => db.$queryRawUnsafe(
        `SELECT (SELECT string_agg(column_name || ':' || data_type, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADESTACOES') AS colunas,
                (SELECT string_agg(conname || ':' || pg_get_constraintdef(oid), ',' ORDER BY conname) FROM pg_constraint WHERE conrelid = '"CADESTACOES"'::regclass) AS constraints,
                (SELECT relrowsecurity FROM pg_class WHERE oid = '"CADESTACOES"'::regclass) AS rls`);
      const [cNovo] = await cad(dbNovo);
      const [cProd] = await cad(dbProd);
      assert.ok(cNovo.colunas && cNovo.constraints);
      assert.deepEqual(cProd, cNovo);
    } finally {
      await dbNovo.$disconnect();
      await dbProd.$disconnect();
      rmSync(semP103, { recursive: true, force: true });
      rmSync(todas, { recursive: true, force: true });
      await apagarBanco(admin, nomeNovo);
      await apagarBanco(admin, nomeProd);
    }
  });
});

describe('Preflight: histórico conferido contra a base da release (R2)', () => {
  test('PB a lista base_release do preflight é a base desta release: nomes reais da pasta, sem a P1-03, com tudo o que é mais antigo que ela e com as aplicadas antes dela', () => {
    assert.ok(BASE_RELEASE.length > 0, 'o preflight declara a CTE base_release(nome)');
    const pasta = new Set(readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
    for (const n of BASE_RELEASE) assert.ok(pasta.has(n), `nome da lista sem pasta: ${n}`);
    assert.equal(new Set(BASE_RELEASE).size, BASE_RELEASE.length, 'sem nome repetido');
    assert.ok(!BASE_RELEASE.includes(NOME_P103), 'a P1-03 não é base');
    for (const n of pasta) if (n < NOME_P103) assert.ok(BASE_RELEASE.includes(n), `migration anterior à P1-03 fora da base: ${n}`);
    for (const n of ['20261113200000_tipo_tarefa_drop_colunas', NOME_CAD, NOME_CURVA]) assert.ok(BASE_RELEASE.includes(n), n);
    // Base da main cf07309c: 44. Migration mais nova (de outra release) não entra; em produção, ela dá PARAR (PH).
    assert.equal(BASE_RELEASE.length, 44);
  });

  test('PH antes → SEGUIR (a base); CADESTACOES ausente, migration extra, nome duplicado, falhada → PARAR; depois → JA_APLICADA (base + 1, P1-03 última); extra depois → PARAR', async () => {
    const N = BASE_RELEASE.length;
    const ultimaDaBase = [...BASE_RELEASE].sort().at(-1);
    const nome = 'maike_p103_preflight_hist';
    const nomeSemCad = 'maike_p103_preflight_semcad';
    const url = await bancoNovo(admin, base, nome);
    const urlSemCad = await bancoNovo(admin, base, nomeSemCad);
    const semP103 = pastaReal([NOME_P103]);
    const semP103SemCad = pastaReal([NOME_P103, NOME_CAD]);
    const todas = pastaReal([]);
    const db = new PrismaClient({ datasourceUrl: url, log: [] });
    const dbSemCad = new PrismaClient({ datasourceUrl: urlSemCad, log: [] });
    const extra = (db) => db.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ('teste-extra', 'x', now(), '20261113450000_desconhecida', now(), 1)`);
    try {
      // estado de produção antes do GO-2: a base inteira concluída (a CADCURVAGANHO por último)
      assert.equal((await deploy(semP103, url)).status, 0);
      let v = await preflight(db);
      assert.deepEqual(
        [v['migration.concluidas'], v['migration.cadestacoes_aplicada'], v['migration.base_ausentes'], v['migration.desconhecidas'], v['migration.ultima'], v['veredito.estado']],
        [`${N}`, 'SIM', '0', '0', ultimaDaBase, 'SEGUIR'], JSON.stringify(v));

      // base sem a CADESTACOES: N-1 concluídas → PARAR (contagem sozinha não basta: falta um nome da base)
      assert.equal((await deploy(semP103SemCad, urlSemCad)).status, 0);
      v = await preflight(dbSemCad);
      assert.deepEqual([v['migration.concluidas'], v['migration.cadestacoes_aplicada'], v['migration.base_ausentes'], v['veredito.estado']], [`${N - 1}`, 'NAO', '1', 'PARAR'], 'CADESTACOES ausente');

      // migration concluída que não é da base nem a P1-03 → PARAR (o defeito do GO-1: 43 com uma desconhecida dava SEGUIR)
      await extra(db);
      v = await preflight(db);
      assert.deepEqual([v['migration.desconhecidas'], v['veredito.estado']], ['1', 'PARAR'], 'migration extra');
      await db.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'teste-extra'`);

      // a mesma migration da base registrada duas vezes como concluída → PARAR
      await db.$executeRawUnsafe(
        `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) SELECT 'teste-dup', checksum, now(), migration_name, now(), 1 FROM _prisma_migrations WHERE migration_name = '${NOME_CAD}'`);
      v = await preflight(db);
      assert.deepEqual([v['migration.duplicadas'], v['veredito.estado']], ['1', 'PARAR'], 'nome duplicado');
      await db.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'teste-dup'`);

      // migration falhada pendente (sem finished_at, sem rolled_back_at) → PARAR
      await db.$executeRawUnsafe(
        `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count) VALUES ('teste-falha', 'x', '20261113460000_falhou', now(), 0)`);
      v = await preflight(db);
      assert.deepEqual([v['migration.falhadas_pendentes'], v['veredito.estado']], ['1', 'PARAR'], 'falhada');
      await db.$executeRawUnsafe(`DELETE FROM _prisma_migrations WHERE id = 'teste-falha'`);
      assert.equal((await preflight(db))['veredito.estado'], 'SEGUIR', 'limpo de novo');

      // GO-2 simulado: a P1-03 entra por último (ordem da produção) → JA_APLICADA com N + 1
      assert.equal((await deploy(todas, url)).status, 0);
      v = await preflight(db);
      assert.deepEqual(
        [v['migration.concluidas'], v['migration.p1_03_registrada'], v['indice.definicoes_exatas_validas'], v['migration.ultima'], v['veredito.estado']],
        [`${N + 1}`, '1', '2', NOME_P103, 'JA_APLICADA'], JSON.stringify(v));

      // depois da aplicação, uma migration desconhecida também derruba o JA_APLICADA
      await extra(db);
      v = await preflight(db);
      assert.deepEqual([v['migration.desconhecidas'], v['veredito.estado']], ['1', 'PARAR'], 'extra depois da aplicação');
    } finally {
      await db.$disconnect();
      await dbSemCad.$disconnect();
      for (const d of [semP103, semP103SemCad, todas]) rmSync(d, { recursive: true, force: true });
      await apagarBanco(admin, nome);
      await apagarBanco(admin, nomeSemCad);
    }
  });
});
