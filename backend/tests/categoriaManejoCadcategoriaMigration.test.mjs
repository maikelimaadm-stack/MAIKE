/**
 * D-PROD-187 — a migration CONTRACT `20261113500000_categoria_manejo_cadcategoria`
 * (remoção física das 15 colunas dormentes de CategoriaManejo e do vínculo com
 * o ícone oficial, com a FK e o índice, e o nome físico novo da tabela,
 * CADCATEGORIA) de ponta a ponta, contra PostgreSQL real, em bancos PRÓPRIOS
 * criados e apagados por este teste (o banco da suíte não é tocado).
 *
 * Partida: as 43 migrations da main (todas menos esta CONTRACT; inclui a EXPAND da CADESTACOES, D-PROD-188) e, para 2
 * clientes, 4 categorias de manejo: uma no formato das 4 de produção (raça,
 * categoria oficial, 12 GMDs 0.0000), uma com ganho e GMDs variados (e um
 * apóstrofo na raça), uma só com o vínculo do ícone e uma sem nada nas 16
 * colunas; e uma categoria visual GLOBAL do tipo `lote`.
 *
 * RED (nada muda; a falha aberta é resolvida com `migrate resolve --rolled-back`):
 * sem impressão, impressão errada, índice numa coluna apagada, índice a mais,
 * visão numa coluna apagada e na do ícone, política, função citando coluna,
 * função com o nome físico da tabela, gatilho em caixa mista, RETURNS TABLE,
 * CADCATEGORIA já existente, nome novo de índice ocupado, trava concorrente
 * (lock_timeout 5 s); e o runner com a conferência de alvo exigida sem
 * MIGRATION_CONTRACT_AUTORIZADO = D-PROD-187 (recusa antes de qualquer DDL).
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`), com a impressão na URL:
 * 44 concluídas, CategoriaManejo some, CADCATEGORIA com o mesmo OID, ACL, RLS e
 * políticas, as 12 colunas que ficam, linhas idênticas nelas, os 4 nomes novos,
 * FK válida, demais tabelas iguais, `migrate diff` vazio, o Prisma Client lê
 * `categoriaManejo.findMany()` e 2ª execução sem pendências. Num banco sem
 * legado, a migration aplica sem impressão; uma impressão INFORMADA errada
 * recusa mesmo assim, e a impressão do vazio informada aplica (o caminho do
 * runbook).
 *
 * As funções são as do ensaio local (`scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs`).
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { encerrar } from './helpers.mjs';
import {
  ARQUIVO_CONTRACT, CENARIOS_RED, COLUNAS, COLUNAS_ANTES, COLUNAS_QUE_FICAM, CONSTRAINTS_ANTES, CONSTRAINTS_DEPOIS, DECISAO,
  IMPRESSAO_ERRADA, IMPRESSAO_VAZIA, INDICES_ANTES, INDICES_DEPOIS, NOME_CONTRACT, REGEX_ROTINAS, SQL_IMPRESSAO, TABELA_ANTIGA,
  TABELA_NOVA, TRECHOS_DA_GUARDA,
  aplicarMigrationsDaMain, aplicarPeloRunner, colunasDaTabela, comBanco, comImpressao, contagens, divergenciasGreen, exigirUrlLocal,
  historico, impressao, intrusos, migrateDeploy, migrateDiff, resolverRevertida, retrato, rodarCenarioRed, semear, sistema, tabelaAtual,
} from '../../scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs';

const BANCO = 'maike_cadcat_teste';
const BANCO_VAZIO = 'maike_cadcat_teste_vazio';
/** Banco sem legado em que o operador informa a impressão do vazio, como manda o runbook (§4.2). */
const BANCO_VAZIO_INFORMADO = 'maike_cadcat_teste_vazio_inf';
/** O lock_timeout da guarda é 5 s; o teto cobre a partida do Prisma CLI em máquina lenta de CI. */
const TETO_TRAVA_MS = 20_000;
const normalizar = (s) => s.replace(/\s+/g, ' ');
/** Ordem de COLLATE "C" para texto ASCII: unidade a unidade, maiúscula antes de minúscula. */
const compararC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** quote_nullable do Postgres para texto sem barra invertida: NULL → NULL; senão entre aspas, com '' no lugar de '. */
const quoteNullable = (v) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

let URL_T;
let URL_V;
let URL_VI;
/** Nem a URL inteira nem o par usuário:senha podem aparecer na saída. */
const vazou = (saida, url) => {
  const u = new URL(url);
  return saida.includes(url) || (u.password !== '' && saida.includes(`${u.username}:${u.password}@`));
};
let db;
let dbVazio;
let partida;

before(async () => {
  const p = getPrismaClient();
  const base = exigirUrlLocal(process.env.DATABASE_URL);
  URL_T = comBanco(base, BANCO);
  URL_V = comBanco(base, BANCO_VAZIO);
  URL_VI = comBanco(base, BANCO_VAZIO_INFORMADO);
  for (const b of [BANCO, BANCO_VAZIO, BANCO_VAZIO_INFORMADO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO}`);
  await aplicarMigrationsDaMain(URL_T);
  db = new PrismaClient({ datasourceUrl: URL_T });
  await semear(db, { clientes: 2 });
  partida = await retrato(db);
});

after(async () => {
  await db?.$disconnect();
  await dbVazio?.$disconnect();
  const p = getPrismaClient();
  for (const b of [BANCO, BANCO_VAZIO, BANCO_VAZIO_INFORMADO]) await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${b} WITH (FORCE)`);
  await encerrar();
});

describe('D-PROD-187 — migration CONTRACT CategoriaManejo → CADCATEGORIA sem as 16 colunas (PostgreSQL real)', () => {
  test('CD-01 partida: 43 migrations da main, CategoriaManejo com 28 colunas, 4 índices e 3 constraints; impressão de 12 hex igual à conta independente e à expressão da guarda', async () => {
    const h = await historico(db);
    assert.equal(h.concluidas, 43);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    assert.equal(partida.tabela, TABELA_ANTIGA);
    assert.equal(partida.colunas, 28);
    assert.deepEqual(await colunasDaTabela(db), [...COLUNAS_ANTES]);
    assert.deepEqual(partida.estrutura.indices, [...INDICES_ANTES]);
    assert.deepEqual(partida.estrutura.constraints, [...CONSTRAINTS_ANTES]);
    assert.notEqual(partida.legado, null);
    assert.equal(partida.linhas.n, 8);
    assert.equal(partida.Cliente.n, 2);
    assert.equal(partida.CatalogoCategoriaVisual.n, 1);

    const imp = await impressao(db);
    assert.match(imp.impressao, /^[0-9a-f]{12}$/);
    assert.equal(imp.linhas, 6, '3 categorias com algum valor por cliente');

    // A mesma conta, feita fora do banco: cliente_id|id|16 valores com quote_nullable, ordem "C" por (cliente_id, id).
    const linhas = await db.$queryRawUnsafe(`SELECT cliente_id::text AS cliente_id, id, ${COLUNAS.map((c) => `${c}::text AS ${c}`).join(', ')} FROM "${TABELA_ANTIGA}"`);
    const texto = linhas
      .filter((l) => COLUNAS.some((c) => l[c] !== null))
      .sort((a, b) => compararC(a.cliente_id, b.cliente_id) || compararC(a.id, b.id))
      .map((l) => [l.cliente_id, l.id, ...COLUNAS.map((c) => quoteNullable(l[c]))].join('|'))
      .join('\n');
    assert.ok(texto.includes("'D''ANGUS'"), 'o apóstrofo entra dobrado, como no quote_nullable');
    assert.equal(imp.impressao, createHash('md5').update(texto).digest('hex').slice(0, 12));
    assert.equal(IMPRESSAO_VAZIA, createHash('md5').update('').digest('hex').slice(0, 12));

    // O preflight do runbook repete a expressão da guarda letra por letra (impressão e busca de rotinas).
    const guarda = normalizar(readFileSync(ARQUIVO_CONTRACT, 'utf8'));
    for (const trecho of TRECHOS_DA_GUARDA) {
      assert.ok(guarda.includes(trecho), `a guarda tem: ${trecho}`);
      assert.ok(normalizar(SQL_IMPRESSAO).includes(trecho), `o preflight tem: ${trecho}`);
    }
    assert.ok(guarda.includes(`~* '${REGEX_ROTINAS}'`), 'a busca de rotinas do preflight é a da guarda');

    const c = await contagens(db);
    assert.deepEqual(c.map((x) => x.cliente_id), ['cad-c1', 'cad-c2']);
    for (const x of c) {
      assert.deepEqual(
        { categorias: x.categorias, com_valor: x.categorias_com_valor, raca: x.raca, oficial: x.categoria_oficial, ganho: x.ganho_peso_anual_kg, marco: x.gmd_marco, janeiro: x.gmd_janeiro, icone: x.catalogo_categoria_visual_id },
        { categorias: 4, com_valor: 3, raca: 2, oficial: 1, ganho: 1, marco: 2, janeiro: 1, icone: 1 }
      );
    }
    assert.deepEqual(await intrusos(db), []);
  });

  for (const cenario of CENARIOS_RED) {
    test(`CD-RED ${cenario.id}: recusado com a mensagem própria e NADA muda (28 colunas, nome, linhas e valores idênticos, migration aberta → resolvida)`, async () => {
      const r = await rodarCenarioRed(cenario, { db, url: URL_T });
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, cenario.esperado);
      assert.equal(r.antes.colunas, 28);
      assert.equal(r.antes.tabela, TABELA_ANTIGA);
      assert.deepEqual(r.depois, r.antes, 'nenhuma coluna, nome, linha ou valor mudou');
      assert.equal(r.historico.contract_concluida, 0);
      assert.equal(r.historico.contract_aberta, 1, 'a linha da migration fica com finished_at NULL');
      assert.equal(r.resolvida?.status, 0, r.resolvida?.saida);
      if (cenario.trava) assert.ok(r.ms < TETO_TRAVA_MS, `o runner saiu em ${r.ms} ms (lock_timeout de 5 s; não espera a trava)`);
      assert.equal((await historico(db)).contract_aberta, 0);
      assert.deepEqual(await intrusos(db), [], 'o objeto do cenário foi removido');
      assert.deepEqual(await retrato(db), partida, 'o cenário foi desfeito por inteiro');
      assert.ok(!vazou(r.saida, URL_T), 'a URL nunca aparece na saída');
    });
  }

  test('CD-02 runner com a conferência de alvo exigida (alvo "remoto" simulado) e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED antes de qualquer DDL', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    const linhasAntes = (await historico(db)).total;
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-183' }, { MIGRATION_CONTRACT_AUTORIZADO: 'd-prod-187' }]) {
      const r = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.saida.includes(`${NOME_CONTRACT} (${DECISAO})`), r.saida);
      for (const outra of ['20261110300000_patrimonio_simplifica', '20261113200000_tipo_tarefa_drop_colunas']) {
        assert.ok(!r.saida.includes(outra), `${outra} já está concluída: só a D-PROD-187 pende`);
      }
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(r.saida, URL_T));
    }
    assert.equal((await historico(db)).total, linhasAntes, 'nenhuma linha nova no histórico');
    assert.deepEqual(await retrato(db), partida);
  });

  test('CD-03 GREEN pelo runner oficial (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-187 + impressão na URL): 44/0, CADCATEGORIA com o mesmo OID/ACL/RLS/políticas, 12 colunas, linhas idênticas, nomes novos, migrate diff vazio e o Prisma Client lê', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    const r = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(r.status, 0, r.saida);
    assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME_CONTRACT} (${DECISAO})`), r.saida);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.equal(h.concluidas, 44);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);

    assert.equal(await tabelaAtual(db), TABELA_NOVA);
    const [{ antiga }] = await db.$queryRawUnsafe(`SELECT to_regclass('public."${TABELA_ANTIGA}"') IS NULL AS antiga`);
    assert.equal(antiga, true, 'o nome antigo sumiu');
    assert.deepEqual(await colunasDaTabela(db), [...COLUNAS_QUE_FICAM]);
    const depois = await retrato(db);
    assert.deepEqual(divergenciasGreen(partida, depois), []);
    assert.equal(depois.estrutura.oid, partida.estrutura.oid, 'a mesma tabela (RENAME, não cópia)');
    assert.deepEqual(depois.estrutura.indices, [...INDICES_DEPOIS]);
    assert.deepEqual(depois.estrutura.constraints, [...CONSTRAINTS_DEPOIS]);
    assert.equal(depois.legado, null, 'as 16 colunas sumiram');
    assert.deepEqual(depois.linhas, partida.linhas, 'as linhas nas 12 colunas que ficam não mudaram');
    assert.equal(depois.tabelas, partida.tabelas, 'nenhuma tabela criada nem apagada');
    assert.deepEqual(depois.CatalogoCategoriaVisual, partida.CatalogoCategoriaVisual, 'o catálogo global só perdeu a FK que apontava para ele');
    // Nenhuma FK de outra tabela aponta para CADCATEGORIA nem sobrou FK para o catálogo.
    const [{ fks_entrando, fks_catalogo }] = await db.$queryRawUnsafe(`SELECT
        (SELECT count(*)::int FROM pg_constraint WHERE confrelid = 'public."${TABELA_NOVA}"'::regclass) AS fks_entrando,
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public."${TABELA_NOVA}"'::regclass AND confrelid = 'public."CatalogoCategoriaVisual"'::regclass) AS fks_catalogo`);
    assert.deepEqual({ fks_entrando, fks_catalogo }, { fks_entrando: 0, fks_catalogo: 0 });

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);

    // O delegate continua `categoriaManejo` (o @@map só muda o nome físico) e devolve exatamente as 12 colunas.
    const lidas = await db.categoriaManejo.findMany({ orderBy: { id: 'asc' } });
    assert.equal(lidas.length, partida.linhas.n);
    assert.deepEqual(Object.keys(lidas[0]).sort(), [...COLUNAS_QUE_FICAM].sort());
    assert.equal(lidas.find((x) => x.id === 'cad-c1-cat-A').nome, 'BEZERRO MACHO');
  });

  test('CD-04 2ª execução do runner: nada pendente e nada muda', async () => {
    const antes = await retrato(db);
    const r = await aplicarPeloRunner(URL_T);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
    assert.equal((await historico(db)).concluidas, 44);
  });

  test('CD-05 banco sem legado: impressão INFORMADA errada recusa mesmo assim; sem impressão, o prisma migrate deploy aplica', async () => {
    const p = getPrismaClient();
    await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_VAZIO}`);
    await aplicarMigrationsDaMain(URL_V);
    dbVazio = new PrismaClient({ datasourceUrl: URL_V });
    await semear(dbVazio, { clientes: 1, apenasVazias: true });
    const partidaV = await retrato(dbVazio);
    assert.equal(partidaV.colunas, 28);
    assert.equal(partidaV.linhas.n, 1, 'uma categoria, sem nada nas 16 colunas');
    assert.deepEqual(await impressao(dbVazio), { linhas: 0, impressao: IMPRESSAO_VAZIA });

    // Com o parâmetro informado, ele tem de bater (aqui, com o md5 de vazio): o errado recusa e nada muda.
    const errada = await migrateDeploy(comImpressao(URL_V, IMPRESSAO_ERRADA));
    assert.notEqual(errada.status, 0, errada.saida);
    assert.match(errada.saida, new RegExp(`categoria_manejo_cadcategoria: os valores das colunas apagadas \\(0 categorias de manejo\\) não são os aprovados no GO \\(maike\\.categoria_manejo_legado_impressao = ${IMPRESSAO_ERRADA}\\)`));
    assert.ok(!vazou(errada.saida, URL_V));
    assert.deepEqual(await retrato(dbVazio), partidaV);
    assert.equal((await historico(dbVazio)).contract_aberta, 1);
    const resolvida = await resolverRevertida(URL_V);
    assert.equal(resolvida.status, 0, resolvida.saida);

    // Sem legado e sem o parâmetro: não há o que perder, a guarda dispensa a impressão.
    const r = await migrateDeploy(URL_V);
    assert.equal(r.status, 0, r.saida);
    const h = await historico(dbVazio);
    assert.equal(h.concluidas, 44);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    assert.deepEqual(await colunasDaTabela(dbVazio), [...COLUNAS_QUE_FICAM]);
    assert.deepEqual(divergenciasGreen(partidaV, await retrato(dbVazio)), []);
    const diff = await migrateDiff(URL_V);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('CD-06 banco sem legado com a impressão do vazio INFORMADA (o caminho do runbook §4.2): aplica', async () => {
    const p = getPrismaClient();
    await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_VAZIO_INFORMADO}`);
    await aplicarMigrationsDaMain(URL_VI);
    const dbVI = new PrismaClient({ datasourceUrl: URL_VI });
    try {
      await semear(dbVI, { clientes: 1, apenasVazias: true });
      const partidaVI = await retrato(dbVI);
      assert.deepEqual(await impressao(dbVI), { linhas: 0, impressao: IMPRESSAO_VAZIA });
      const r = await migrateDeploy(comImpressao(URL_VI, IMPRESSAO_VAZIA));
      assert.equal(r.status, 0, r.saida);
      assert.ok(!vazou(r.saida, URL_VI));
      const h = await historico(dbVI);
      assert.equal(h.concluidas, 44);
      assert.equal(h.contract_concluida, 1);
      assert.deepEqual(await colunasDaTabela(dbVI), [...COLUNAS_QUE_FICAM]);
      assert.deepEqual(divergenciasGreen(partidaVI, await retrato(dbVI)), []);
    } finally {
      await dbVI.$disconnect();
    }
  });
});
