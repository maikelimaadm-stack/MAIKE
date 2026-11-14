/**
 * D-PROD-183 — a migration CONTRACT `20261113200000_tipo_tarefa_drop_colunas`
 * (remoção física de exige_area, pode_ter_produto, pode_ter_maquina e
 * pode_ter_implemento de TipoTarefa) de ponta a ponta, contra PostgreSQL real,
 * em bancos PRÓPRIOS criados e apagados por este teste (o banco da suíte não é
 * tocado).
 *
 * Partida: as 45 migrations da main (todas menos esta CONTRACT; inclui a CADESTACOES,
 * D-PROD-188, a CADCURVAGANHO, D-PROD-189, e a CONTRACT da D-PROD-187, aplicada
 * pelo Prisma direto e fora de ordem, com CategoriaManejo vazia) e, para 2
 * clientes, um GrupoAtividade, 5 tipos de tarefa com combinações das 4 flags
 * (um todo false, um inativo) e um LancamentoTarefa.
 *
 * RED (nada muda; a falha aberta é resolvida com `migrate resolve --rolled-back`):
 * sem impressão, impressão errada, índice, visão, política e função citando as
 * colunas, trava concorrente em TipoTarefa (lock_timeout 5 s); e o runner com a
 * conferência de alvo exigida sem MIGRATION_CONTRACT_AUTORIZADO = D-PROD-183
 * (recusa antes de qualquer DDL).
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`), com a impressão na URL:
 * 46 concluídas, TipoTarefa com as 9 colunas que ficam, linhas idênticas nessas
 * 9, mesmas tabelas, `migrate diff` vazio e 2ª execução sem pendências. Num
 * banco sem nenhum true, a migration aplica sem impressão; mas uma impressão
 * INFORMADA errada recusa mesmo assim, e a impressão do vazio informada aplica
 * (TD-06, o caminho do runbook).
 *
 * A D-PROD-191 (CONTRACT `20261114100000_cadcurvaganho_mensal`, troca a estrutura
 * de CADCURVAGANHO: 12 GMD mensais no lugar dos 3 por estação) sobe na partida
 * pelo Prisma direto e fora de ordem, sem o runner, como a da D-PROD-187: a
 * guarda dela passa porque CADCURVAGANHO está vazia. Soma +1 migration e 0
 * tabela; como já está concluída na partida, não pende no runner e a comparação
 * de tabelas antes×depois não muda.
 *
 * As funções são as do ensaio local (`scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs`).
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { encerrar } from './helpers.mjs';
import {
  ARQUIVO_CONTRACT, CENARIOS_RED, COLUNAS, COLUNAS_ANTES, COLUNAS_QUE_FICAM, DECISAO, IMPRESSAO_ERRADA, IMPRESSAO_VAZIA,
  NOME_CONTRACT, SQL_IMPRESSAO, TRECHOS_DA_GUARDA,
  aplicarMigrationsDaMain, aplicarPeloRunner, colunasTipoTarefa, comBanco, comImpressao, contagens, exigirUrlLocal,
  historico, impressao, intrusos, migrateDeploy, migrateDiff, resolverRevertida, retrato, rodarCenarioRed, semear, sistema,
} from '../../scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs';

const BANCO = 'maike_tt_drop_teste';
const BANCO_VAZIO = 'maike_tt_drop_teste_vazio';
/** Banco sem nenhum true em que o operador informa a impressão do vazio, como manda o runbook (§4.2). */
const BANCO_VAZIO_INFORMADO = 'maike_tt_drop_teste_vazio_inf';
/** O lock_timeout da guarda é 5 s; o teto cobre a partida do Prisma CLI em máquina lenta de CI. */
const TETO_TRAVA_MS = 20_000;
const ESPACOS = /\s+/g;
const normalizar = (s) => s.replace(ESPACOS, ' ');
/** Ordem de COLLATE "C" para texto ASCII: unidade a unidade, maiúscula antes de minúscula. */
const compararC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

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
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_VAZIO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_VAZIO_INFORMADO} WITH (FORCE)`);
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
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_VAZIO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_VAZIO_INFORMADO} WITH (FORCE)`);
  await encerrar();
});

describe('D-PROD-183 — migration CONTRACT que remove as 4 colunas dormentes de TipoTarefa (PostgreSQL real)', () => {
  test('TD-01 partida: 45 migrations da main, TipoTarefa com 13 colunas, 2 clientes com true; impressão de 12 hex igual à conta independente e à expressão da guarda', async () => {
    const h = await historico(db);
    assert.equal(h.concluidas, 45);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    assert.equal(partida.colunas, 13);
    assert.deepEqual(await colunasTipoTarefa(db), [...COLUNAS_ANTES]);
    assert.notEqual(partida.flags, null);
    assert.equal(partida.TipoTarefa.n, 10);
    assert.equal(partida.GrupoAtividade.n, 2);
    assert.equal(partida.LancamentoTarefa.n, 2);

    const imp = await impressao(db);
    assert.match(imp.impressao, /^[0-9a-f]{12}$/);
    assert.equal(imp.linhas, 8, '4 tipos com algum true por cliente');

    // A mesma conta, feita fora do banco: cliente_id|id|4 flags ('true'/'false'), ordem "C" por (cliente_id, id).
    const linhas = await db.$queryRawUnsafe(`SELECT cliente_id::text AS cliente_id, id, ${COLUNAS.join(', ')} FROM "TipoTarefa"`);
    const texto = linhas
      .filter((l) => COLUNAS.some((c) => l[c]))
      .sort((a, b) => compararC(a.cliente_id, b.cliente_id) || compararC(a.id, b.id))
      .map((l) => [l.cliente_id, l.id, ...COLUNAS.map((c) => String(l[c]))].join('|'))
      .join('\n');
    assert.equal(imp.impressao, createHash('md5').update(texto).digest('hex').slice(0, 12));
    assert.equal(IMPRESSAO_VAZIA, createHash('md5').update('').digest('hex').slice(0, 12));

    // O preflight do runbook repete a expressão da guarda letra por letra.
    const guarda = normalizar(readFileSync(ARQUIVO_CONTRACT, 'utf8'));
    for (const trecho of TRECHOS_DA_GUARDA) {
      assert.ok(guarda.includes(trecho), `a guarda tem: ${trecho}`);
      assert.ok(normalizar(SQL_IMPRESSAO).includes(trecho), `o preflight tem: ${trecho}`);
    }

    const c = await contagens(db);
    assert.deepEqual(c.map((x) => x.cliente_id), ['tt-c1', 'tt-c2']);
    for (const x of c) {
      assert.deepEqual(
        { tipos: x.tipos, tipos_com_true: x.tipos_com_true, ...Object.fromEntries(COLUNAS.map((k) => [k, x[k]])) },
        { tipos: 5, tipos_com_true: 4, exige_area: 2, pode_ter_produto: 2, pode_ter_maquina: 2, pode_ter_implemento: 2 }
      );
    }
    assert.deepEqual(await intrusos(db), []);
  });

  for (const cenario of CENARIOS_RED) {
    test(`TD-RED ${cenario.id}: recusado com a mensagem própria e NADA muda (13 colunas, linhas e flags idênticas, migration aberta → resolvida)`, async () => {
      const r = await rodarCenarioRed(cenario, { db, url: URL_T });
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, cenario.esperado);
      assert.equal(r.antes.colunas, 13);
      assert.deepEqual(r.depois, r.antes, 'nenhuma coluna, linha ou flag mudou');
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

  test('TD-02 runner com a conferência de alvo exigida (alvo "remoto" simulado) e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED antes de qualquer DDL', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    const linhasAntes = (await historico(db)).total;
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-162' }]) {
      const r = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.ok(r.saida.includes(`${NOME_CONTRACT} (${DECISAO})`), r.saida);
      assert.ok(!r.saida.includes('20261110300000_patrimonio_simplifica'), 'a D-PROD-162 já está concluída: só a D-PROD-183 pende');
      assert.ok(!r.saida.includes('20261114100000_cadcurvaganho_mensal'), 'a D-PROD-191 já está concluída na partida: só a D-PROD-183 pende');
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!vazou(r.saida, URL_T));
    }
    assert.equal((await historico(db)).total, linhasAntes, 'nenhuma linha nova no histórico');
    assert.deepEqual(await retrato(db), partida);
  });

  test('TD-03 GREEN pelo runner oficial (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO=D-PROD-183 + impressão na URL): 46/0, as 9 colunas que ficam, linhas idênticas nelas, mesmas tabelas e migrate diff vazio', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    const r = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(r.status, 0, r.saida);
    assert.ok(r.saida.includes(`CONTRACT autorizado: ${NOME_CONTRACT} (${DECISAO})`), r.saida);
    assert.ok(!vazou(r.saida, URL_T));

    const h = await historico(db);
    assert.equal(h.concluidas, 46);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);

    assert.deepEqual(await colunasTipoTarefa(db), [...COLUNAS_QUE_FICAM]);
    const depois = await retrato(db);
    assert.equal(depois.colunas, 9);
    assert.equal(depois.flags, null, 'as 4 colunas sumiram');
    assert.deepEqual(depois.TipoTarefa, partida.TipoTarefa, 'as linhas nas 9 colunas que ficam não mudaram');
    assert.equal(depois.tabelas, partida.tabelas, 'nenhuma tabela criada nem apagada');
    assert.deepEqual(depois.GrupoAtividade, partida.GrupoAtividade);
    assert.deepEqual(depois.LancamentoTarefa, partida.LancamentoTarefa);

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('TD-04 2ª execução do runner: nada pendente e nada muda', async () => {
    const antes = await retrato(db);
    const r = await aplicarPeloRunner(URL_T);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
    assert.equal((await historico(db)).concluidas, 46);
  });

  test('TD-05 banco sem nenhum true: impressão INFORMADA errada recusa mesmo assim; sem impressão, o prisma migrate deploy aplica', async () => {
    const p = getPrismaClient();
    await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO_VAZIO} WITH (FORCE)`);
    await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_VAZIO}`);
    await aplicarMigrationsDaMain(URL_V);
    dbVazio = new PrismaClient({ datasourceUrl: URL_V });
    await semear(dbVazio, { clientes: 1, apenasFalse: true });
    const partidaV = await retrato(dbVazio);
    assert.equal(partidaV.colunas, 13);
    assert.equal(partidaV.TipoTarefa.n, 1, 'um tipo, todo false');
    assert.deepEqual(await impressao(dbVazio), { linhas: 0, impressao: IMPRESSAO_VAZIA });

    // Com o parâmetro informado, ele tem de bater (aqui, com o md5 de vazio): o errado recusa e nada muda.
    const errada = await migrateDeploy(comImpressao(URL_V, IMPRESSAO_ERRADA));
    assert.notEqual(errada.status, 0, errada.saida);
    assert.match(errada.saida, new RegExp(`tipo_tarefa_drop_colunas: os valores true das colunas apagadas \\(0 tipos de tarefa\\) não são os aprovados no GO \\(maike\\.tipo_tarefa_flags_impressao = ${IMPRESSAO_ERRADA}\\)`));
    assert.ok(!vazou(errada.saida, URL_V));
    assert.deepEqual(await retrato(dbVazio), partidaV);
    assert.equal((await historico(dbVazio)).contract_aberta, 1);
    const resolvida = await resolverRevertida(URL_V);
    assert.equal(resolvida.status, 0, resolvida.saida);

    // Sem nenhum true e sem o parâmetro: não há o que perder, a guarda dispensa a impressão.
    const r = await migrateDeploy(URL_V);
    assert.equal(r.status, 0, r.saida);
    const h = await historico(dbVazio);
    assert.equal(h.concluidas, 46);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    assert.deepEqual(await colunasTipoTarefa(dbVazio), [...COLUNAS_QUE_FICAM]);
    const depois = await retrato(dbVazio);
    assert.deepEqual(depois.TipoTarefa, partidaV.TipoTarefa);
    assert.equal(depois.tabelas, partidaV.tabelas);
    const diff = await migrateDiff(URL_V);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('TD-06 banco sem nenhum true com a impressão do vazio INFORMADA (o caminho do runbook §4.2): aplica', async () => {
    const p = getPrismaClient();
    await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO_VAZIO_INFORMADO}`);
    await aplicarMigrationsDaMain(URL_VI);
    const dbVI = new PrismaClient({ datasourceUrl: URL_VI });
    try {
      await semear(dbVI, { clientes: 1, apenasFalse: true });
      const partidaVI = await retrato(dbVI);
      assert.deepEqual(await impressao(dbVI), { linhas: 0, impressao: IMPRESSAO_VAZIA });
      const r = await migrateDeploy(comImpressao(URL_VI, IMPRESSAO_VAZIA));
      assert.equal(r.status, 0, r.saida);
      assert.ok(!vazou(r.saida, URL_VI));
      const h = await historico(dbVI);
      assert.equal(h.concluidas, 46);
      assert.equal(h.contract_concluida, 1);
      assert.deepEqual(await colunasTipoTarefa(dbVI), [...COLUNAS_QUE_FICAM]);
      assert.deepEqual((await retrato(dbVI)).TipoTarefa, partidaVI.TipoTarefa);
    } finally {
      await dbVI.$disconnect();
    }
  });
});
