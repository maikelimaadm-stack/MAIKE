/**
 * D-PROD-162 (MAIKE-PATRIMONIO-SIMPLIFICA-01) — a migration CONTRACT
 * `20261110300000_patrimonio_simplifica` de ponta a ponta, contra PostgreSQL
 * real, num banco PRÓPRIO criado e apagado por este teste (o banco da suíte não
 * é tocado).
 *
 * Partida: as 43 migrations da main (todas menos esta CONTRACT; inclui a TipoAtividade, D-PROD-182, a CADESTACOES,
 * D-PROD-188, e as CONTRACT `20261113200000_tipo_tarefa_drop_colunas`, D-PROD-183, e
 * `20261113500000_categoria_manejo_cadcategoria`, D-PROD-187, aplicadas pelo Prisma direto, sem o runner e portanto
 * sem a barreira de MIGRATION_CONTRACT_AUTORIZADO; as guardas delas passam porque TipoTarefa e CategoriaManejo estão
 * vazias nessa hora e `semear` não cria nenhuma das duas) e sementes nas 13 tabelas do Patrimônio antigo para 2
 * clientes, com um abastecimento CANCELADO (saída + estorno + fatia) e uma compra P3 em KG com lote. A D-PROD-183 e a
 * D-PROD-187 não criam nem apagam tabela (a D-PROD-187 só renomeia CategoriaManejo para CADCATEGORIA): as contagens de
 * tabelas (87/88/81) não mudam com elas.
 * A D-PROD-188 (CADESTACOES) cria 1 tabela nova e soma +1 migration e +1 tabela em todas as contagens.
 *
 * RED (nada muda; a falha aberta é resolvida com `migrate resolve --rolled-back`):
 * CONFIRMADO, FK e visão de fora, trava concorrente em Produto, sem impressão,
 * impressão errada, papel que não é o dono, gatilho, política e publicação
 * criados à mão; e o runner com a conferência de alvo exigida sem
 * MIGRATION_CONTRACT_AUTORIZADO (recusa antes de qualquer DDL).
 *
 * GREEN pelo runner oficial (`npm run deploy:migrate`), com a impressão na URL:
 * 44 concluídas, 81 tabelas, as 7 novas vazias com o mesmo dono/ACL das antigas,
 * RLS e políticas no padrão, 7/31/32/55 constraints e índices, impressão digital
 * das 74 que ficam idêntica, os 2 CHECKs de OperacaoFinanceiraItem com 'L',
 * estoque intacto, `migrate diff` vazio e 2ª execução sem pendências.
 *
 * As funções são as do ensaio local (`scripts/dev/ensaio-patrimonio-simplifica.mjs`).
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../src/database/prismaClient.js';
import { encerrar } from './helpers.mjs';
import {
  CENARIOS_RED, DECISAO, NOME_CONTRACT, PAPEL_OUTRO, TABELAS_APAGADAS, TABELAS_ESTOQUE, TABELAS_NOVAS,
  aplicarMigrationsDaMain, aplicarPeloRunner, checksOperacaoItem, comBanco, comImpressao, contarTabelas, donoEAcl,
  estoqueCoerente, estruturaNovas, exigirUrlLocal, fingerprintV2, historico, impressao, itemEmLitros, migrateDiff,
  retrato, rodarCenarioRed, segurancaDe, semear, sistema,
} from '../../scripts/dev/ensaio-patrimonio-simplifica.mjs';

const BANCO = 'maike_simplifica_teste';
/** O lock_timeout da guarda é 5 s; o teto cobre a partida do Prisma CLI em máquina lenta de CI. */
const TETO_TRAVA_MS = 20_000;

let URL_T;
let db;
let superusuario;
let partida;
let fpAntes;
let donosAntes;
let segurancaAntes;

before(async () => {
  const p = getPrismaClient();
  URL_T = comBanco(exigirUrlLocal(process.env.DATABASE_URL), BANCO);
  superusuario = (await p.$queryRawUnsafe(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`))[0].rolsuper;
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  await p.$executeRawUnsafe(`CREATE DATABASE ${BANCO}`);
  await aplicarMigrationsDaMain(URL_T);
  db = new PrismaClient({ datasourceUrl: URL_T });
  await semear(db, { clientes: 2, bens: 1, cancelados: 1 });
  partida = await retrato(db);
  fpAntes = await fingerprintV2(db);
  donosAntes = await donoEAcl(db, TABELAS_APAGADAS);
  segurancaAntes = await segurancaDe(db, TABELAS_APAGADAS);
});

after(async () => {
  await db?.$disconnect();
  const p = getPrismaClient();
  await p.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
  if (superusuario) await p.$executeRawUnsafe(`DROP ROLE IF EXISTS ${PAPEL_OUTRO}`);
  await encerrar();
});

describe('D-PROD-162 — migration CONTRACT do Patrimônio simplificado (PostgreSQL real)', () => {
  test('SM-01 partida: 43 migrations da main, 87 tabelas, as 13 com linhas de 2 clientes; um item P3 em L é RECUSADO pelo CHECK antigo (achado B1)', async () => {
    const h = await historico(db);
    assert.equal(h.concluidas, 43);
    assert.equal(h.contract_concluida + h.contract_aberta, 0);
    assert.equal(partida.tabelas, 87);
    for (const t of TABELAS_APAGADAS) assert.ok(partida[t].n > 0, `${t} sem linhas`);
    const imp = await impressao(db);
    assert.equal(imp.linhas, TABELAS_APAGADAS.reduce((s, t) => s + partida[t].n, 0));
    assert.match(imp.impressao, /^[0-9a-f]{12}$/);
    const clientes = await db.$queryRawUnsafe(`SELECT count(DISTINCT cliente_id)::int AS n FROM "BemPatrimonial"`);
    assert.equal(clientes[0].n, 2);
    const l = await itemEmLitros(db);
    assert.equal(l.aceito, false);
    assert.match(l.erro, /OperacaoFinanceiraItem_forma_check/);
    assert.equal(await estoqueCoerente(db), true);
  });

  for (const cenario of CENARIOS_RED) {
    test(`SM-RED ${cenario.id}: recusado com a mensagem própria e NADA muda (87 tabelas, linhas idênticas, migration aberta → resolvida)`, async (t) => {
      if (cenario.papel && !superusuario) return t.skip('o papel do banco de teste não cria superusuário');
      const r = await rodarCenarioRed(cenario, { db, url: URL_T });
      assert.notEqual(r.status, 0, r.saida);
      assert.match(r.saida, cenario.esperado);
      assert.deepEqual(r.depois, r.antes, 'nenhuma linha nem tabela mudou');
      assert.equal(r.antes.tabelas, cenario.id === 'fk_de_fora' ? 88 : 87);
      assert.equal(r.historico.contract_concluida, 0);
      assert.equal(r.historico.contract_aberta, 1, 'a linha da migration fica com finished_at NULL');
      assert.equal(r.resolvida?.status, 0, r.resolvida?.saida);
      if (cenario.trava) assert.ok(r.ms < TETO_TRAVA_MS, `o runner saiu em ${r.ms} ms (lock_timeout de 5 s; não espera a trava)`);
      assert.equal(await contarTabelas(db), 87);
      assert.equal((await historico(db)).contract_aberta, 0);
      assert.deepEqual(await retrato(db), partida, 'o cenário foi desfeito por inteiro');
      assert.ok(!r.saida.includes(URL_T), 'a URL nunca aparece na saída');
    });
  }

  test('SM-02 runner com a conferência de alvo exigida (alvo "remoto" simulado) e SEM a decisão exata → DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED antes de qualquer DDL', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    const linhasAntes = (await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations"`))[0].n;
    for (const extra of [{}, { MIGRATION_CONTRACT_AUTORIZADO: 'D-PROD-999' }]) {
      const r = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, ...extra } });
      assert.equal(r.status, 1, r.saida);
      assert.match(r.saida, /alvo conferido nas duas conexões/);
      assert.match(r.saida, /FALHOU \[DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED\]/);
      assert.match(r.saida, new RegExp(`${NOME_CONTRACT} \\(${DECISAO}\\)`));
      assert.match(r.saida, /Nenhuma migration foi executada/);
      assert.ok(!r.saida.includes(URL_T));
    }
    assert.equal((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations"`))[0].n, linhasAntes, 'nenhuma linha nova no histórico');
    assert.deepEqual(await retrato(db), partida);
  });

  test('SM-03 GREEN pelo runner oficial (alvo conferido + MIGRATION_CONTRACT_AUTORIZADO + impressão na URL): 44/0, 81 tabelas, 7 novas vazias com o mesmo dono/ACL, RLS, estrutura, impressão digital das 74 idêntica, CHECKs com L, estoque intacto e migrate diff vazio', async () => {
    const sid = await sistema(db);
    const imp = (await impressao(db)).impressao;
    const r = await aplicarPeloRunner(comImpressao(URL_T, imp), { runtime: URL_T, extras: { MIGRATION_EXIGIR_CONFERENCIA: 'sim', MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: sid, MIGRATION_CONTRACT_AUTORIZADO: DECISAO } });
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, new RegExp(`CONTRACT autorizado: ${NOME_CONTRACT} \\(${DECISAO}\\)`));

    const h = await historico(db);
    assert.equal(h.concluidas, 44);
    assert.equal(h.abertas, 0);
    assert.equal(h.contract_concluida, 1);
    assert.equal(await contarTabelas(db), 81);

    const depois = await retrato(db);
    for (const t of TABELAS_NOVAS) assert.equal(depois[t]?.n, 0, `${t} nasce vazia`);
    for (const t of TABELAS_APAGADAS.filter((x) => !TABELAS_NOVAS.includes(x))) assert.equal(depois[t], null, `${t} foi removida`);
    for (const t of TABELAS_ESTOQUE) assert.deepEqual(depois[t], partida[t], `linhas de ${t} intactas`);
    assert.equal(await estoqueCoerente(db), true, 'estoque_atual = Σ lotes por Produto');

    // Mesmo dono e mesma ACL das 13 (os privilégios padrão do dono valem para as 7).
    const assinaturas = new Set(donosAntes.map((d) => `${d.dono}|${d.acl}`));
    assert.equal(assinaturas.size, 1, 'as 13 tinham um único dono/ACL');
    const novas = await donoEAcl(db, TABELAS_NOVAS);
    assert.deepEqual(novas.map((d) => d.tabela), [...TABELAS_NOVAS]);
    for (const d of novas) {
      assert.equal(`${d.dono}|${d.acl}`, [...assinaturas][0], d.tabela);
      assert.equal(d.rls, true, `${d.tabela} com RLS`);
      assert.equal(d.force, false, `${d.tabela} sem FORCE`);
    }
    const seg = await segurancaDe(db, TABELAS_NOVAS);
    assert.equal(seg.grants, 0, 'nenhum grant para anon/authenticated/PUBLIC');
    assert.equal(segurancaAntes.grants, 0);
    const esperadas = seg.vercel ? TABELAS_NOVAS.map((t) => ({ tabela: t, nome: 'maike_backend_all', cmd: 'ALL', papeis: 'maike_vercel' })) : [];
    assert.deepEqual(seg.politicas, esperadas);
    // O mesmo padrão das 13 antigas: com maike_vercel no cluster, uma maike_backend_all por tabela; sem ele, nenhuma.
    assert.deepEqual(segurancaAntes.politicas.map((x) => x.nome), seg.vercel ? TABELAS_APAGADAS.map(() => 'maike_backend_all') : []);

    const e = await estruturaNovas(db);
    assert.deepEqual({ pk: e.pk, fk: e.fk, check: e.check, indices: e.indices }, { pk: 7, fk: 31, check: 32, indices: 55 });
    assert.deepEqual(e.colunas, { AbastecimentoBem: 31, AbastecimentoBemConsumoLote: 10, BemPatrimonial: 54, FamiliaPatrimonial: 12, TanqueBem: 9, TanqueBemProduto: 7, TipoPatrimonial: 11 });

    assert.deepEqual(await fingerprintV2(db), fpAntes, 'as 74 tabelas que ficam não mudaram (fora os 2 CHECKs alargados)');
    const k = await checksOperacaoItem(db);
    assert.match(k.OperacaoFinanceiraItem_unidade_check, /'KG'.*'SACO'.*'UN'.*'L'/);
    assert.match(k.OperacaoFinanceiraItem_forma_check, /'MERCADORIA'.*'KG'.*'SACO'.*'L'.*'SERVICO'.*'UN'/);
    assert.deepEqual(await itemEmLitros(db), { aceito: true }, 'o item P3 em L agora entra (D1)');

    const diff = await migrateDiff(URL_T);
    assert.equal(diff.status, 0, diff.saida);
  });

  test('SM-04 2ª execução do runner: nada pendente e nada muda', async () => {
    const antes = await retrato(db);
    const r = await aplicarPeloRunner(URL_T);
    assert.equal(r.status, 0, r.saida);
    assert.match(r.saida, /No pending migrations to apply/);
    assert.deepEqual(await retrato(db), antes);
    assert.equal((await historico(db)).concluidas, 44);
  });
});
