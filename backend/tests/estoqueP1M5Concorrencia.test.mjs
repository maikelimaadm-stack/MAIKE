/**
 * MAIKE-ESTOQUE-P1-02 (D-PROD-177) — M5: CONCORRÊNCIA das reversões.
 * PostgreSQL real; o motor é chamado direto, em transações reais.
 *
 * Determinismo sem relógio: uma transação DETENTORA segura a trava (a do
 * produto, como os escritores, ou a linha do lote, como um escritor fora do
 * protocolo), dispara os concorrentes UM A UM e só segue quando o
 * `pg_stat_activity` mostra cada um esperando lock — a fila de espera do
 * PostgreSQL fixa a ordem. A observação é feita pela PRÓPRIA detentora
 * (`pg_stat_clear_snapshot()` renova a visão a cada volta), como em
 * `adminClientesGestao.test.mjs`: detentora + 2 concorrentes = 3 conexões,
 * nunca mais (o pool da CI tem `connection_limit` = núcleos × 2 + 1 = 3 num
 * runner de 1 núcleo). Rode também com `?connection_limit=3` na DATABASE_URL.
 *
 *  K1. duas reversões da MESMA compra / da MESMA venda (protocolo: trava do
 *      produto): exatamente uma vence; a outra 409 (`lote_consumido` /
 *      `original_ja_estornado`); um só movimento de estorno; cache ≥ 0;
 *  K2. as mesmas duas reversões FORA do protocolo (sem a trava do produto):
 *      o `FOR UPDATE` do lote/original as serializa; mesmo resultado;
 *  K3. baixa FIFO × reversão da compra, nas duas ordens: a FIFO primeiro →
 *      reversão 409 `lote_consumido`; a reversão primeiro → FIFO 422
 *      `saldo_lote_insuficiente`; nunca saldo negativo;
 *  K4. reversão que AGUARDA lock: um escritor segura a camada (`FOR UPDATE`)
 *      e a altera; `estornarEntrada` e `estornarEmLote` esperam NA LEITURA
 *      `FOR UPDATE` da camada (prova da trava nova em `estornarEntrada`) e,
 *      liberadas, recusam com o estado novo, sem gravar nada;
 *  K5. nenhum deadlock no banco durante o arquivo;
 *  K6. R1 corretiva — `estornarSaida` (cancelamento de abastecimento): espera
 *      NA leitura `FOR UPDATE` da camada e NA do original (nesta ordem, a do
 *      estorno em lote) e, liberada, recusa com o estado novo ANTES de
 *      escrever; dois estornos do mesmo original fora do protocolo → um só.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { montarTenant, prisma } from './gestaoP3Cenario.mjs';
import {
  OPCOES_TX, argsEstornoEmLote, argsEstornoEntrada, conferirInvariantes, ctxDe, entrar, estadoFisico, itemDaEntrada, itemDaSaida, localDe, q4,
  resumoErro, sairFifo,
} from './estoqueP1MCenario.mjs';
import * as motor from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
let deadlocksAntes = 0n;
const deadlocks = async () => /** @type {any[]} */ (await prisma().$queryRaw`SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`)[0].deadlocks;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  deadlocksAntes = await deadlocks();
});
after(async () => {
  await app.close();
  await encerrar();
});

// ─── detentora, fila e observação pela própria detentora ────────────────────
/**
 * Espera, pela transação `tx` da detentora, até `n` backends deste banco
 * aguardando lock (e, com `consulta`, todos esperando numa consulta que casa
 * o padrão ILIKE).
 */
const esperarBloqueadas = async (tx, n, consulta = null) => {
  for (let i = 0; i < 1500; i += 1) {
    await tx.$executeRaw`SELECT pg_stat_clear_snapshot()`;
    const [{ qtd, casam }] = /** @type {any[]} */ (await tx.$queryRaw`SELECT count(*)::int AS qtd,
        count(*) FILTER (WHERE query ILIKE ${consulta ?? '%'})::int AS casam
      FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`);
    if (qtd >= n && casam >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`esperava ${n} transações aguardando lock${consulta ? ` em ${consulta}` : ''}`);
};
const resultado = (p) => p.then((v) => ({ ok: true, v, x: null }), (x) => ({ ok: false, v: null, x }));
/**
 * Detentora: `prender(tx)` segura a trava; cada `disparos[i]()` começa só
 * depois de o anterior estar parado no lock (fila = ordem); `antesDeSoltar(tx)`
 * roda com todos parados (o "escritor" muda o estado). Solta no commit.
 */
const comDetentora = async (prender, disparos, { consulta = null, antesDeSoltar = null } = {}) => {
  /** @type {Promise<{ok: boolean, v: any, x: any}>[]} */
  const pedidos = [];
  await prisma().$transaction(async (tx) => {
    await prender(tx);
    for (const disparar of disparos) {
      pedidos.push(resultado(Promise.resolve().then(disparar)));
      await esperarBloqueadas(tx, pedidos.length, consulta);
    }
    if (antesDeSoltar) await antesDeSoltar(tx);
  }, OPCOES_TX);
  return Promise.all(pedidos);
};
/** A trava do produto, exatamente como os escritores (advisory + FOR UPDATE). */
const prenderProduto = (s, e, produto) => (tx) => motor.travarProdutosEstoque(tx, s.c, e.id, [produto.id]);
/** A linha da camada, como um escritor fora do protocolo. */
const prenderLote = (s, loteId) => (tx) => tx.$queryRaw`SELECT id FROM "EstoqueLoteNota" WHERE cliente_id = ${s.c} AND id = ${loteId} FOR UPDATE`;

// ─── operações concorrentes (cada uma é a sua transação) ────────────────────
const estornoEmLote = (s, e, itens, extra, { comTrava = true } = {}) => () =>
  prisma().$transaction(async (tx) => {
    if (comTrava) await motor.travarProdutosEstoque(tx, s.c, e.id, itens.map((i) => i.produto_id));
    const ids = await motor.estornarEmLote(tx, ctxDe(s), argsEstornoEmLote(s, e, itens, extra));
    await motor.numerarMovimentos(tx, s.c, ids);
    return ids;
  }, OPCOES_TX);
const estornoDeEntrada = (s, e, r) => () =>
  prisma().$transaction(async (tx) => {
    await motor.travarProdutosEstoque(tx, s.c, e.id, [r.lote.produto_id]);
    const produto = await tx.produto.findUnique({ where: { id: r.lote.produto_id } });
    const res = await motor.estornarEntrada(tx, ctxDe(s), argsEstornoEntrada(s, e, r, produto));
    await motor.numerarMovimentos(tx, s.c, [res.movimento.id]);
    return res;
  }, OPCOES_TX);
const baixaFifo = (s, e, produto, kg) => () =>
  prisma().$transaction(async (tx) => {
    await motor.travarProdutosEstoque(tx, s.c, e.id, [produto.id]);
    const lido = await tx.produto.findUnique({ where: { id: produto.id } });
    const r = await motor.aplicarSaida(tx, ctxDe(s), {
      empresaId: e.id, produto: lido, local: localDe(s.local), quantidadeKg: kg, dia: '2027-06-11', origem: { operacaoId: 'op-fifo-k' }, numeroMovimento: motor.numeroMovimentoProvisorio(),
    });
    await motor.numerarMovimentos(tx, s.c, [r.movimento.id]);
    return r;
  }, OPCOES_TX);

const estornosDe = (s, originalId) => prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, movimento_pai_id: originalId } });
const estoqueAtual = async (produto) => q4((await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual);
/** Exatamente um venceu; devolve [vencedor, perdedor]. */
const umVence = (rs) => {
  assert.equal(rs.filter((r) => r.ok).length, 1, rs.map((r) => (r.ok ? 'ok' : `${r.x?.code} ${r.x?.details?.reason} ${r.x?.message}`)).join(' | '));
  return [rs.find((r) => r.ok), rs.find((r) => !r.ok)];
};

describe('K1 — duas reversões do MESMO original (protocolo: trava do produto)', () => {
  test('compra: uma vence, a outra 409 lote_consumido; venda: uma vence, a outra 409 original_ja_estornado; um só estorno por original; cache certo e ≥ 0', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c = await entrar(s, e, e.sal);
    const rs = await comDetentora(prenderProduto(s, e, e.sal), [
      estornoEmLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' }),
      estornoEmLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' }),
    ]);
    const [venc, perd] = umVence(rs);
    assert.ok(rs[0].ok, 'a fila do lock fixa a ordem: o primeiro disparado vence');
    assert.deepEqual(resumoErro(perd.x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'lote_consumido']);
    assert.equal(await estornosDe(s, c.movimento.id), 1);
    assert.equal((await prisma().movimentacaoEstoque.findUnique({ where: { id: c.movimento.id } })).movimento_filho_id, venc.v[0]);
    assert.equal(await estoqueAtual(e.sal), '0.0000');

    const c2 = await entrar(s, e, e.sal);
    const v = await sairFifo(s, e, e.sal, '4.0000');
    const rv = await comDetentora(prenderProduto(s, e, e.sal), [
      estornoEmLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' }),
      estornoEmLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' }),
    ]);
    const [, perdV] = umVence(rv);
    assert.deepEqual(resumoErro(perdV.x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'original_ja_estornado']);
    assert.equal(await estornosDe(s, v.movimento.id), 1);
    assert.deepEqual([q4((await prisma().estoqueLoteNota.findUnique({ where: { id: c2.lote.id } })).quantidade_disponivel), await estoqueAtual(e.sal)], ['10.0000', '10.0000'], 'devolvido uma vez só');
    await conferirInvariantes(s, 'K1');
  });
});

describe('K2 — as mesmas reversões FORA do protocolo (sem a trava do produto)', () => {
  test('o FOR UPDATE da camada serializa: compra → 409 lote_consumido; venda → 409 original_ja_estornado; um só estorno; invariantes', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c = await entrar(s, e, e.sal);
    const rs = await comDetentora(prenderLote(s, c.lote.id), [
      estornoEmLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' }, { comTrava: false }),
      estornoEmLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' }, { comTrava: false }),
    ], { consulta: '%EstoqueLoteNota%FOR UPDATE%' });
    const [, perd] = umVence(rs);
    assert.deepEqual(resumoErro(perd.x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'lote_consumido']);
    assert.equal(await estornosDe(s, c.movimento.id), 1);

    const c2 = await entrar(s, e, e.sal);
    const v = await sairFifo(s, e, e.sal, '4.0000');
    const rv = await comDetentora(prenderLote(s, c2.lote.id), [
      estornoEmLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' }, { comTrava: false }),
      estornoEmLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' }, { comTrava: false }),
    ], { consulta: '%EstoqueLoteNota%FOR UPDATE%' });
    const [, perdV] = umVence(rv);
    assert.deepEqual(resumoErro(perdV.x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'original_ja_estornado']);
    assert.equal(await estornosDe(s, v.movimento.id), 1);
    assert.equal(await estoqueAtual(e.sal), '10.0000');
    await conferirInvariantes(s, 'K2');
  });
});

describe('K3 — baixa FIFO × reversão da compra', () => {
  test('FIFO primeiro → reversão 409 lote_consumido; reversão primeiro → FIFO 422 saldo_lote_insuficiente; nunca saldo negativo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const c = await entrar(s, e, e.sal);
    const r1 = await comDetentora(prenderProduto(s, e, e.sal), [baixaFifo(s, e, e.sal, '3.0000'), estornoEmLote(s, e, [itemDaEntrada(c)], { direcao: 'PAGAR' })]);
    assert.ok(r1[0].ok, r1[0].x?.message);
    assert.deepEqual(resumoErro(r1[1].x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'lote_consumido']);
    assert.deepEqual([q4((await prisma().estoqueLoteNota.findUnique({ where: { id: c.lote.id } })).quantidade_disponivel), await estoqueAtual(e.sal), await estornosDe(s, c.movimento.id)], ['7.0000', '7.0000', 0]);

    const c2 = await entrar(s, e, e.milho);
    const r2 = await comDetentora(prenderProduto(s, e, e.milho), [estornoEmLote(s, e, [itemDaEntrada(c2)], { direcao: 'PAGAR' }), baixaFifo(s, e, e.milho, '3.0000')]);
    assert.ok(r2[0].ok, r2[0].x?.message);
    assert.deepEqual([r2[1].x?.status, r2[1].x?.code, r2[1].x?.details?.reason], [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente']);
    assert.deepEqual([(await prisma().estoqueLoteNota.findUnique({ where: { id: c2.lote.id } })).status, await estoqueAtual(e.milho)], ['Estornado', '0.0000']);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, produto_id: e.milho.id, tipo_detalhado: 'venda_financeiro' } }), 0);
    await conferirInvariantes(s, 'K3');
  });
});

describe('K4 — reversão que aguarda o lock da camada', () => {
  test('um escritor segura a camada FOR UPDATE e baixa 1 kg dela; estornarEntrada e estornarEmLote ficam parados NA leitura FOR UPDATE da camada; liberados, recusam lote_consumido com o estado novo e nada gravam', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    for (const [rotulo, operacao] of [['estornarEntrada', estornoDeEntrada], ['estornarEmLote', (s2, e2, r) => estornoEmLote(s2, e2, [itemDaEntrada(r)], { direcao: 'PAGAR' })]]) {
      const c = await entrar(s, e, e.sal);
      const antes = await estadoFisico(prisma(), s.c);
      /** @type {string} */
      let escritor = '';
      const [r] = await comDetentora(prenderLote(s, c.lote.id), [operacao(s, e, c)], {
        consulta: '%EstoqueLoteNota%FOR UPDATE%',
        antesDeSoltar: async (tx) => {
          // o escritor (fora do protocolo) baixa 1 kg da camada enquanto a reversão espera. Só a
          // camada: a reversão já segura a linha do Produto (trava canônica), e tocá-la aqui
          // seria um ciclo de espera de verdade.
          await tx.estoqueLoteNota.update({ where: { id: c.lote.id }, data: { quantidade_disponivel: '9.0000' } });
          escritor = 'baixou';
        },
      });
      assert.equal(escritor, 'baixou');
      assert.equal(r.ok, false, `${rotulo}: devia recusar`);
      assert.deepEqual(resumoErro(r.x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'lote_consumido'], `${rotulo}: ${r.x?.message}`);
      assert.deepEqual([r.x.details.entrada, r.x.details.disponivel], ['10.0000', '9.0000'], `${rotulo}: leu o estado NOVO (depois do commit do escritor)`);
      const depois = JSON.parse(await estadoFisico(prisma(), s.c));
      const loteAgora = depois.lotes.find((l) => l.id === c.lote.id);
      assert.deepEqual([loteAgora.status, q4(loteAgora.quantidade_disponivel)], ['Disponivel', '9.0000']);
      assert.equal(depois.movimentos.length, JSON.parse(antes).movimentos.length, `${rotulo}: nenhum movimento de estorno`);
      assert.equal(await estornosDe(s, c.movimento.id), 0);
      // devolve a camada ao estado coerente para o próximo caso
      await prisma().estoqueLoteNota.update({ where: { id: c.lote.id }, data: { quantidade_disponivel: '10.0000' } });
    }
    await conferirInvariantes(s, 'K4');
  });
});

// ─── K6: estornarSaida (R1 corretiva) ───────────────────────────────────────
const argsSaida = (s, e, v, produto) => ({
  empresaId: e.id,
  item: { ordem: 1, quantidade_estoque: v.movimento.quantidade, movimentacao_estoque_id: v.movimento.id },
  consumos: v.fatias.map((f) => ({ estoque_lote_nota_id: f.lote_id, quantidade: f.quantidade })),
  produto, local: localDe(s.local), dia: '2027-06-12', origem: { operacaoId: 'op-saida-k6' }, numeroMovimento: motor.numeroMovimentoProvisorio(),
});
const estornoDeSaida = (s, e, v, { comTrava = true } = {}) => () =>
  prisma().$transaction(async (tx) => {
    if (comTrava) await motor.travarProdutosEstoque(tx, s.c, e.id, [e.sal.id]);
    const produto = await tx.produto.findUnique({ where: { id: e.sal.id } });
    const res = await motor.estornarSaida(tx, ctxDe(s), argsSaida(s, e, v, produto));
    await motor.numerarMovimentos(tx, s.c, [res.movimento.id]);
    return res;
  }, OPCOES_TX);
const prenderMovimento = (s, id) => (tx) => tx.$queryRaw`SELECT id FROM "MovimentacaoEstoque" WHERE cliente_id = ${s.c} AND id = ${id} FOR UPDATE`;

describe('K6 — estornarSaida espera as travas da camada e do original', () => {
  test('camada presa e reposta por fora → espera no FOR UPDATE da camada e recusa devolucao_excede_entrada com o estado novo; original preso e estornado por fora → espera no FOR UPDATE do original e recusa original_ja_estornado; nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await entrar(s, e, e.sal);
    // (a) camada
    const v = await sairFifo(s, e, e.sal, '4.0000');
    const loteId = v.fatias[0].lote_id;
    const antesA = await estadoFisico(prisma(), s.c);
    const [ra] = await comDetentora(prenderLote(s, loteId), [estornoDeSaida(s, e, v, { comTrava: false })], {
      consulta: '%EstoqueLoteNota%FOR UPDATE%',
      antesDeSoltar: (tx) => tx.estoqueLoteNota.update({ where: { id: loteId }, data: { quantidade_disponivel: '10.0000' } }),
    });
    assert.deepEqual(resumoErro(ra.x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'devolucao_excede_entrada'], ra.x?.message);
    assert.equal(ra.x.details.disponivel, '10.0000', 'leu a camada DEPOIS do commit do escritor');
    const depoisA = JSON.parse(await estadoFisico(prisma(), s.c));
    assert.equal(depoisA.movimentos.length, JSON.parse(antesA).movimentos.length, 'nenhum movimento de estorno');
    assert.equal(await estornosDe(s, v.movimento.id), 0);
    await prisma().estoqueLoteNota.update({ where: { id: loteId }, data: { quantidade_disponivel: '6.0000' } });

    // (b) original — o escritor fora do protocolo o marca 'Estornada' enquanto o estorno espera
    const antesB = await estadoFisico(prisma(), s.c);
    const [rb] = await comDetentora(prenderMovimento(s, v.movimento.id), [estornoDeSaida(s, e, v)], {
      consulta: '%MovimentacaoEstoque%FOR UPDATE%',
      antesDeSoltar: (tx) => tx.movimentacaoEstoque.update({ where: { id: v.movimento.id }, data: { status: 'Estornada' } }),
    });
    assert.deepEqual(resumoErro(rb.x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'original_ja_estornado'], rb.x?.message);
    const depoisB = JSON.parse(await estadoFisico(prisma(), s.c));
    const loteB = depoisB.lotes.find((l) => l.id === loteId);
    assert.equal(q4(loteB.quantidade_disponivel), '6.0000', 'a camada NÃO recebeu devolução (recusa antes de escrever)');
    assert.equal(depoisB.movimentos.length, JSON.parse(antesB).movimentos.length);
    await prisma().movimentacaoEstoque.update({ where: { id: v.movimento.id }, data: { status: 'Ativa' } });
    await conferirInvariantes(s, 'K6a/b');
  });

  test('dois estornos do MESMO original fora do protocolo (sem a trava do produto): um vence, o outro 409 original_ja_estornado; uma devolução só', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await entrar(s, e, e.sal);
    const v = await sairFifo(s, e, e.sal, '3.0000');
    const rs = await Promise.all([resultado(estornoDeSaida(s, e, v, { comTrava: false })()), resultado(estornoDeSaida(s, e, v, { comTrava: false })())]);
    const [, perdedor] = umVence(rs);
    assert.deepEqual(resumoErro(perdedor.x), [409, 'ESTOQUE_JA_CONSUMIDO', 'itens', 'original_ja_estornado'], perdedor.x?.message);
    assert.equal(await estornosDe(s, v.movimento.id), 1);
    assert.equal(q4((await prisma().estoqueLoteNota.findUnique({ where: { id: v.fatias[0].lote_id } })).quantidade_disponivel), '10.0000');
    assert.equal(await estoqueAtual(e.sal), '10.0000');
    await conferirInvariantes(s, 'K6c');
  });
});

describe('K5 — sem deadlock', () => {
  test('nenhum deadlock neste banco durante o arquivo', async () => {
    assert.equal(await deadlocks(), deadlocksAntes);
  });
});
