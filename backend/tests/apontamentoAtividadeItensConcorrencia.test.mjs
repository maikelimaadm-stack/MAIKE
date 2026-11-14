/**
 * Itens do Apontamento de Atividade (D-PROD-191, Fatia D) × concorrência
 * (contrato §6.1 T10, C1–C5) e o tempo do cancelamento com muitos itens
 * PRODUTO (risco R5). PostgreSQL real, HTTP autenticado, prova por linhas
 * gravadas; nenhum 500 em nenhum caso.
 *
 * Corridas DETERMINÍSTICAS, no padrão de `patrimonioP1AbastecimentosConcorrencia.test.mjs`:
 *  - "portão": gatilho temporário (BEFORE INSERT no movimento, só do tenant do
 *    teste) que espera o advisory lock (191, 4) segurado por uma transação do
 *    TESTE. O primeiro comando para EXATAMENTE no INSERT do movimento, com as
 *    travas dele já tomadas (apontamento → local → produto → lotes lidos), até
 *    o teste abrir o portão;
 *  - quem espera quem é lido em `pg_locks`/`pg_blocking_pids`, nunca inferido
 *    por relógio: o segundo comando TEM de ficar bloqueado pelo pid do
 *    primeiro (trava do produto, I-d; trava do apontamento, I-c).
 *
 *  C1  duas baixas no MESMO lote por apontamentos diferentes, soma > saldo →
 *      um 201 e um 422 ESTOQUE_SALDO_INSUFICIENTE (serializadas no Produto)
 *  C2  dois itens no MESMO apontamento com a mesma versão → um 201, um 409
 *  C3  item × cancelamento do apontamento, nas duas ordens → nunca item
 *      CONFIRMADO em apontamento CANCELADO
 *  C4  dois cancelamentos do mesmo item com chaves diferentes → um 200, um 409;
 *      UMA Entrada
 *  C5  cancelar item × abastecimento do MESMO Produto/lote (o Produto virou
 *      combustível DEPOIS do item: a D-8 barra item NOVO de combustível, não o
 *      cancelamento) → serializados pela trava do Produto; o abastecimento vê a
 *      devolução; totais exatos
 *  R5  cancelar o apontamento com 50 itens PRODUTO cabe com folga na
 *      transação curta (9 s)
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoesAbastecimento, corpoAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';
import {
  acoesItens, coerente, corpoCancelar, corpoProduto, corpoServico, estoqueAtual, itensConfirmadosEmCancelado, montarItens, numeracaoLimpa, prisma, saldoLote,
  TIPO_ESTORNO, versaoDe,
} from './apontamentoAtividadeItensCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesItens>} */
let A;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let AB;
/** Pool PRÓPRIO do teste (portão e observação de `pg_locks`); os comandos usam o pool do app. @type {PrismaClient} */
let aux;
let deadlocksAntes = 0n;
const deadlocks = async () => /** @type {any[]} */ (await aux.$queryRaw`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`)[0].deadlocks;

before(async () => {
  app = await criarApp();
  await app.ready();
  A = acoesItens(app);
  AB = acoesAbastecimento(app);
  aux = new PrismaClient();
  deadlocksAntes = await deadlocks();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

// ─── portão e observação de travas ──────────────────────────────────────────
const PORTAO = 'd191_itens_portao';
/** Gatilho BEFORE INSERT no movimento (só do tenant do teste) que segura até o teste abrir o portão. */
const instalarPortao = async (s, condicao) => {
  const p = prisma();
  await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${PORTAO}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN PERFORM pg_advisory_xact_lock_shared(191, 4); RETURN NEW; END $f$`);
  await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "MovimentacaoEstoque"`);
  await p.$executeRawUnsafe(`CREATE TRIGGER ${PORTAO} BEFORE INSERT ON "MovimentacaoEstoque" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND ${condicao}) EXECUTE FUNCTION ${PORTAO}()`);
};
const removerPortao = () => prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${PORTAO} ON "MovimentacaoEstoque"`);
const comPortaoFechado = (fn) =>
  aux.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(191, 4)`;
    return fn();
  }, { maxWait: 10000, timeout: 60000 });
const paradosNoPortao = async () => {
  const l = /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND classid = 191 AND objid = 4 AND objsubid = 2 AND NOT granted`);
  return l.length ? l.map((r) => r.pid) : null;
};
const bloqueadosPor = async (pid) =>
  /** @type {any[]} */ (await aux.$queryRaw`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${pid}::int = ANY(pg_blocking_pids(pid))`).map((r) => r.pid);
/** Espera uma CONDIÇÃO observável (nunca um tempo fixo); estoura com rótulo. */
const esperar = async (cond, rotulo, ms = 15000) => {
  const limite = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > limite) throw new Error(`tempo esgotado esperando: ${rotulo}`);
    await new Promise((r) => setTimeout(r, 15));
  }
};
const acompanhar = (pedido) => {
  /** @type {{ feito: boolean, r: any, p: Promise<any> }} */
  const a = { feito: false, r: null, p: Promise.resolve() };
  a.p = Promise.resolve(pedido).then((r) => {
    Object.assign(a, { feito: true, r });
    return r;
  });
  return a;
};
const codigo = (r) => {
  try {
    return r.json().code;
  } catch {
    return null;
  }
};

/**
 * Corrida determinística: `primeiro()` para no portão com as travas dele
 * tomadas; `segundo()` chega e TEM de ficar bloqueado pelo pid do primeiro
 * (lido em `pg_blocking_pids`). O portão abre e as duas respostas voltam.
 */
const corrida = async (s, condicao, primeiro, segundo) => {
  await instalarPortao(s, condicao);
  /** @type {any[]} */
  const pend = [];
  /** @type {any} */ let a;
  /** @type {any} */ let b;
  try {
    await comPortaoFechado(async () => {
      a = acompanhar(primeiro());
      pend.push(a);
      const [pid] = await esperar(async () => (a.feito ? [null] : paradosNoPortao()), 'primeiro parado no portão');
      assert.equal(a.feito, false, `o primeiro tinha de parar no portão: ${a.r?.statusCode} ${a.r?.body}`);
      b = acompanhar(segundo());
      pend.push(b);
      await esperar(async () => b.feito || (await bloqueadosPor(pid)).length > 0, 'segundo bloqueado pelas travas do primeiro');
      assert.equal(b.feito, false, `o segundo não pode passar pelo primeiro: ${b.r?.statusCode} ${b.r?.body}`);
    });
  } finally {
    await Promise.allSettled(pend.map((x) => x.p));
    await removerPortao();
  }
  for (const r of [a.r, b.r]) assert.ok(r.statusCode < 500, `nenhum 500: ${r.statusCode} ${r.body}`);
  return { r1: a.r, r2: b.r };
};

const NA_SAIDA_DO_ITEM = `NEW.origem_sistema = 'apontamento_atividade' AND NEW.tipo_movimentacao = 'Saída'`;
const NO_ESTORNO_DO_ITEM = `NEW.origem_sistema = 'apontamento_atividade' AND NEW.tipo_detalhado = 'estorno_apontamento_atividade'`;

/** Reconciliação do produto sem nenhum achado. */
const reconciliacaoLimpa = async (s, produto, rotulo) => {
  const rel = await A.ok(A.reconciliacao(s.token, `empresa_id=${s.e1.id}&produto_id=${produto.id}`));
  assert.deepEqual(rel.achados, [], `${rotulo}: reconciliação sem achados`);
  assert.equal(rel.resumo.situacao, 'CONSISTENTE', rotulo);
};

describe('D-PROD-191 — itens × concorrência (T10)', () => {
  test('C1: duas baixas no MESMO lote por apontamentos diferentes (8 + 5 > 10) → a 2ª espera a trava do Produto e recebe 422 ESTOQUE_SALDO_INSUFICIENTE (nunca 409/lost update); lote, estoque_atual e reconciliação coerentes', async () => {
    const s = await montarItens(app);
    const c = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '10.0000', preco: '5.00', dia: '2027-06-01' });
    const ap1 = await s.apontamento();
    const ap2 = await s.apontamento();
    const { r1, r2 } = await corrida(s, NA_SAIDA_DO_ITEM,
      () => A.adicionar(s.lancador.token, ap1.id, corpoProduto(ap1, s.herbicida, s.local2, '8')),
      () => A.adicionar(s.lancador.token, ap2.id, corpoProduto(ap2, s.herbicida, s.local2, '5')));
    assert.equal(r1.statusCode, 201, r1.body);
    assert.deepEqual([r2.statusCode, r2.json().code, r2.json().reason ?? r2.json().details?.reason], [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente'], r2.body);
    assert.equal(r2.json().details.disponivel, '2.0000', 'o 2º leu o lote DEPOIS do 1º');
    assert.deepEqual(await saldoLote(c.lote_id), ['2.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.herbicida), '2.0000');
    assert.deepEqual([await versaoDe(ap1.id), await versaoDe(ap2.id)], [2, 1], 'a recusa não muda a versão');
    assert.equal(await prisma().apontamentoAtividadeItem.count({ where: { cliente_id: s.c } }), 1);
    await coerente(s, s.herbicida, 'C1');
    await numeracaoLimpa(s);
    await reconciliacaoLimpa(s, s.herbicida, 'C1');
  });

  test('C2: dois itens no MESMO apontamento com a mesma versão (Promise.all) → um 201 e um 409 VERSAO_CONFLITO; um item só, versão 2', async () => {
    const s = await montarItens(app);
    await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '10.0000', preco: '5.00', dia: '2027-06-01' });
    const ap = await s.apontamento();
    const rs = await Promise.all([
      A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '3')),
      A.adicionar(s.lancador.token, ap.id, corpoServico(ap, 'SERVICO', 'Diária', '1', '100')),
    ]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 409], rs.map((r) => r.body).join(' | '));
    assert.equal(codigo(rs.find((r) => r.statusCode === 409)), 'APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO');
    assert.equal(await prisma().apontamentoAtividadeItem.count({ where: { apontamento_id: ap.id } }), 1);
    assert.equal(await versaoDe(ap.id), 2);
    await coerente(s, s.herbicida, 'C2');
  });

  test('C3: item × cancelamento do apontamento, nas duas ordens — o 2º espera a trava do apontamento; nunca item CONFIRMADO em apontamento CANCELADO', async () => {
    const s = await montarItens(app);
    await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '20.0000', preco: '5.00', dia: '2027-06-01' });
    // (a) o item chega primeiro: o cancelamento espera e perde o CAS (a versão mudou).
    const ap = await s.apontamento();
    const a = await corrida(s, NA_SAIDA_DO_ITEM,
      () => A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '4')),
      () => A.cancelarApontamento(s.cancelador.token, ap.id, corpoCancelar(ap, 'cancelar na corrida')));
    assert.equal(a.r1.statusCode, 201, a.r1.body);
    assert.deepEqual([a.r2.statusCode, codigo(a.r2)], [409, 'APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO'], a.r2.body);
    assert.equal(await itensConfirmadosEmCancelado(), 0);
    assert.equal((await prisma().apontamentoAtividade.findUnique({ where: { id: ap.id } })).status, 'CONFIRMADO');

    // (b) o cancelamento chega primeiro (parado no estorno do item que já existe): o item novo espera e vê CANCELADO.
    const v2 = a.r1.json();
    const b = await corrida(s, NO_ESTORNO_DO_ITEM,
      () => A.cancelarApontamento(s.cancelador.token, ap.id, corpoCancelar(v2, 'cancelar primeiro')),
      () => A.adicionar(s.lancador.token, ap.id, corpoProduto(v2, s.herbicida, s.local2, '2')));
    assert.equal(b.r1.statusCode, 200, b.r1.body);
    assert.deepEqual([b.r2.statusCode, codigo(b.r2)], [409, 'APONTAMENTO_ATIVIDADE_STATUS_INVALIDO'], b.r2.body);
    assert.equal(await itensConfirmadosEmCancelado(), 0, 'nunca item CONFIRMADO em apontamento CANCELADO');
    assert.deepEqual((await prisma().apontamentoAtividadeItem.findMany({ where: { apontamento_id: ap.id } })).map((i) => [i.status, i.cancelamento_origem]), [['CANCELADO', 'APONTAMENTO']]);
    assert.equal(await estoqueAtual(s.herbicida), '20.0000');
    await coerente(s, s.herbicida, 'C3');
    await numeracaoLimpa(s);
  });

  test('C4: dois cancelamentos do mesmo item com chaves diferentes (Promise.all) → um 200 e um 409; UMA Entrada de estorno; estoque exato', async () => {
    const s = await montarItens(app);
    const c = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '10.0000', preco: '5.00', dia: '2027-06-01' });
    const ap = await s.apontamento();
    const d = await A.ok(A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '6')), 201);
    const rs = await Promise.all([1, 2].map((i) => A.cancelarItem(s.cancelador.token, ap.id, d.item_id, corpoCancelar(d, `corrida ${i}`))));
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409], rs.map((r) => r.body).join(' | '));
    const perdedor = codigo(rs.find((r) => r.statusCode === 409));
    assert.ok(['APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO', 'APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO'].includes(perdedor), perdedor);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: TIPO_ESTORNO } }), 1, 'UMA Entrada');
    assert.deepEqual(await saldoLote(c.lote_id), ['10.0000', 'Disponivel']);
    assert.equal(await versaoDe(ap.id), 3);
    await coerente(s, s.herbicida, 'C4');
    await reconciliacaoLimpa(s, s.herbicida, 'C4');
  });

  test('C5: cancelar item × abastecimento do MESMO Produto e lote (aceito pelo tanque DEPOIS do item) → serializados na trava do Produto; o abastecimento só passa com a devolução; totais exatos', async () => {
    const s = await montarItens(app);
    const c = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '10.0000', preco: '5.00', dia: '2027-06-01' });
    const ap = await s.apontamento();
    const d = await A.ok(A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '10')), 201);
    assert.deepEqual(await saldoLote(c.lote_id), ['0.0000', 'Esgotado']);
    // O tanque do trator passa a aceitar o Produto: a partir daqui ele é combustível (D-8 barra item NOVO).
    await AB.ok(s.patchAceites(s.trator, [[s.diesel.id, s.dieselKg.id, s.herbicida.id]]));
    const novo = await A.adicionar(s.lancador.token, ap.id, corpoProduto(d, s.herbicida, s.local2, '1'));
    assert.deepEqual([novo.statusCode, novo.json().code, novo.json().reason], [422, 'APONTAMENTO_ATIVIDADE_ITEM_INVALIDO', 'combustivel_no_abastecimento'], novo.body);

    const { r1, r2 } = await corrida(s, NO_ESTORNO_DO_ITEM,
      () => A.cancelarItem(s.cancelador.token, ap.id, d.item_id, corpoCancelar(d, 'devolver ao estoque')),
      () => AB.confirmar(s.operador.token, corpoAbastecimento(s, { produto_id: s.herbicida.id, local_estoque_id: s.local2.id, quantidade: '6' })));
    assert.equal(r1.statusCode, 200, r1.body);
    assert.equal(r2.statusCode, 201, `o abastecimento viu a devolução: ${r2.body}`);
    assert.deepEqual(await saldoLote(c.lote_id), ['4.0000', 'Disponivel'], '10 devolvidos − 6 abastecidos');
    assert.equal(await estoqueAtual(s.herbicida), '4.0000');
    await coerente(s, s.herbicida, 'C5');
    await numeracaoLimpa(s);
    await reconciliacaoLimpa(s, s.herbicida, 'C5');
  });

  test('sem deadlock (40P01) em nenhuma corrida deste arquivo', async () => {
    assert.equal(await deadlocks(), deadlocksAntes, 'nenhum deadlock registrado no banco durante as corridas');
  });
});

describe('D-PROD-191 — tempo do cancelamento com muitos itens (R5)', () => {
  test('R5: apontamento com 50 itens PRODUTO (2 produtos) cancela em uma transação curta, bem abaixo de 9 s; 50 Entradas; estoque restaurado', async () => {
    const s = await montarItens(app);
    await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '1000.0000', preco: '5.00', dia: '2027-06-01' });
    await s.compraP3(s.e1, s.adubo, s.local2, { quantidade: '1000.0000', preco: '3.00', dia: '2027-06-01' });
    let ap = await s.apontamento();
    for (let i = 0; i < 50; i += 1) {
      ap = await A.ok(A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, i % 2 ? s.adubo : s.herbicida, s.local2, '1.5')), 201);
    }
    assert.equal(ap.custo_itens.itens_confirmados, 50);
    const t0 = Date.now();
    const r = await A.cancelarApontamento(s.cancelador.token, ap.id, corpoCancelar(ap, 'cancelamento em massa'));
    const ms = Date.now() - t0;
    assert.equal(r.statusCode, 200, r.body);
    assert.ok(ms < 9000, `cancelamento de 50 itens em ${ms} ms (TRANSACAO_CURTA = 9 s)`);
    console.log(`# R5: cancelar o apontamento com 50 itens PRODUTO levou ${ms} ms`);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: TIPO_ESTORNO } }), 50);
    assert.deepEqual([await estoqueAtual(s.herbicida), await estoqueAtual(s.adubo)], ['1000.0000', '1000.0000']);
    assert.equal(await itensConfirmadosEmCancelado(), 0);
    await numeracaoLimpa(s);
  });
});
