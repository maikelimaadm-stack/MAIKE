/**
 * D-PROD-155 — P3-01 Central Única de Lançamentos: ESTOQUE (matriz exaustiva).
 * PostgreSQL real, HTTP autenticado, prova por linhas gravadas (lotes,
 * movimentos, fatias FIFO, `estoque_atual`) — nunca só pelo status HTTP.
 *
 *  E1. entrada com 3 itens (produtos diferentes e o mesmo produto em 2 locais),
 *      SACO→KG pelo fator, kg arredondado UMA vez;
 *  E2. saída FIFO em 2+ lotes (ordem COALESCE(data_documento, createdAt), id),
 *      custo FIFO ≠ preço de venda, fatias gravadas; mesmo produto/local em 2
 *      linhas sem saldo fantasma; saldo insuficiente → 422 e ZERO efeito;
 *      `estoque_atual` legado divergente → `estoque_atual_insuficiente`;
 *  E3. concorrência: 2 vendas do último saldo; venda × suplementação ×
 *      transferência (comandos existentes) com e sem saldo suficiente;
 *  E4. cancelamentos: compra intocada (pai/filho, lote Estornado), compra já
 *      consumida (409 sem efeito), venda (fatias voltam aos lotes de origem);
 *  E5. INVARIANTES após sequência mista P3 + comandos existentes;
 *  E6. rollback forçado entre estoque e título (triggers temporários);
 *  E7. documento sem mercadoria nunca cria movimento.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, docSem, foto, fotoEstoque, loteLegado, montarTenant, motivo, opId, prisma, somaLotes } from './gestaoP3Cenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
});
after(async () => {
  await app.close();
  await encerrar();
});

const D = (v) => new Prisma.Decimal(v);
const q4 = (v) => D(v).toFixed(4);
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });
const comprar = (s, e, itens, extra = {}) => A.criarConfirmar(s.token, docCom(e, s.local, itens, extra));
const rascunhoVenda = (s, e, itens, extra = {}) => A.criar(s.token, docCom(e, s.local, itens, { direcao: 'RECEBER', ...extra }));
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const definirEstoqueAtual = (produto, kg) => prisma().produto.update({ where: { id: produto.id }, data: { estoque_atual: kg } });
const suplementar = (s, e, produto, local, quantidade) =>
  A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, { operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: local.id, quantidade });
const transferir = (s, e, produto, origem, destino, quantidade) =>
  A.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', s.token, {
    operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade,
  });
const cancelar = (s, d, e) => A.cancelarReq(s.token, d.id, e.id);

/**
 * Invariantes físicos do tenant:
 *  (a) por produto: estoque_atual − Σ disponível dos lotes da empresa do produto = diferença inicial;
 *  (b) por empresa+produto+local: Σ disponível ≥ 0;
 *  (c) por lote: 0 ≤ disponível ≤ entrada e situação coerente com o disponível.
 * @param {{c: string}} s @param {Record<string, string>} diferencas  produto_id → diferença inicial (4 casas)
 */
const conferirInvariantes = async (s, diferencas, rotulo) => {
  const p = prisma();
  const produtos = await p.produto.findMany({ where: { cliente_id: s.c }, select: { id: true, empresa_id: true, estoque_atual: true } });
  const lotes = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c } });
  for (const prod of produtos) {
    const soma = lotes.filter((l) => l.produto_id === prod.id && l.empresa_id === prod.empresa_id).reduce((t, l) => t.plus(D(l.quantidade_disponivel)), D(0));
    assert.equal(D(prod.estoque_atual).minus(soma).toFixed(4), diferencas[prod.id] ?? '0.0000', `${rotulo}: (a) produto ${prod.id}`);
  }
  const porLocal = new Map();
  for (const l of lotes) {
    const k = `${l.empresa_id}|${l.produto_id}|${l.local_estoque_id}`;
    porLocal.set(k, (porLocal.get(k) ?? D(0)).plus(D(l.quantidade_disponivel)));
    const disp = D(l.quantidade_disponivel);
    assert.ok(disp.gte(0) && disp.lte(D(l.quantidade_entrada)), `${rotulo}: (c) lote ${l.id} disp=${disp} entrada=${l.quantidade_entrada}`);
    if (disp.gt(0)) assert.equal(l.status, 'Disponivel', `${rotulo}: (c) lote ${l.id} com saldo e status ${l.status}`);
    else assert.ok(['Esgotado', 'Estornado'].includes(l.status), `${rotulo}: (c) lote ${l.id} zerado e status ${l.status}`);
  }
  for (const [k, v] of porLocal) assert.ok(v.gte(0), `${rotulo}: (b) ${k} = ${v}`);
};

/** Diferença inicial estoque_atual − Σ lotes, por produto. */
const diferencasAtuais = async (s) => {
  const p = prisma();
  const produtos = await p.produto.findMany({ where: { cliente_id: s.c }, select: { id: true, empresa_id: true, estoque_atual: true } });
  const out = {};
  for (const prod of produtos) out[prod.id] = D(prod.estoque_atual).minus(D(await somaLotes({ cliente_id: s.c, produto_id: prod.id, empresa_id: prod.empresa_id }))).toFixed(4);
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
describe('E1 — entrada (compra confirmada)', () => {
  test('3 itens: produtos diferentes e o mesmo produto em 2 locais → 1 lote + 1 movimento por item, saldos por local e estoque_atual exatos; SACO→KG pelo fator', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const doc = docCom(e, s.local, [
      item(e.sal, '100', '2.5'),
      item(e.racao, '10', '80', { unidade: 'SACO' }),
      item(e.sal, '40', '3', { local: s.local2 }),
    ], { documento_referencia: 'NF-777' });
    const d = await A.criar(s.token, doc);
    assert.deepEqual(d.itens.map((i) => [i.ordem, i.unidade, i.fator_kg, i.quantidade_estoque, i.valor_total]), [
      [1, 'KG', '1.0000', '100.0000', '250.00'], [2, 'SACO', '30.0000', '300.0000', '800.00'], [3, 'KG', '1.0000', '40.0000', '120.00'],
    ]);
    assert.equal(d.valor_total, '1170.00');
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual(prev.plano.efeitos_estoque.entradas.map((x) => [x.item_ordem, x.local_estoque_id, x.kg, x.custo_kg]), [
      [1, s.local.id, '100.0000', '2.5000'], [2, s.local.id, '300.0000', '2.6667'], [3, s.local2.id, '40.0000', '3.0000'],
    ]);
    assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c } }), 0, 'rascunho e prévia não movimentam');
    const conf = await A.confirmar(s.token, d, e.id);
    const ids = conf.itens.map((i) => [i.movimentacao_estoque_id, i.estoque_lote_nota_id]);
    assert.equal(new Set(ids.flat()).size, 6, 'um movimento e um lote distintos por item');
    const lotes = await Promise.all(conf.itens.map((i) => p.estoqueLoteNota.findUnique({ where: { id: i.estoque_lote_nota_id } })));
    assert.deepEqual(lotes.map((l) => [l.produto_id, l.local_estoque_id, l.empresa_id, q4(l.quantidade_entrada), q4(l.quantidade_disponivel), q4(l.custo_unitario), l.status, l.fornecedor_id, l.numero_documento]), [
      [e.sal.id, s.local.id, e.id, '100.0000', '100.0000', '2.5000', 'Disponivel', e.forn.id, 'NF-777'],
      [e.racao.id, s.local.id, e.id, '300.0000', '300.0000', '2.6667', 'Disponivel', e.forn.id, 'NF-777'],
      [e.sal.id, s.local2.id, e.id, '40.0000', '40.0000', '3.0000', 'Disponivel', e.forn.id, 'NF-777'],
    ]);
    const movs = await Promise.all(conf.itens.map((i) => p.movimentacaoEstoque.findUnique({ where: { id: i.movimentacao_estoque_id } })));
    assert.deepEqual(movs.map((m) => [m.tipo_movimentacao, m.tipo_detalhado, q4(m.quantidade), q4(m.valor_total), q4(m.valor_unitario), m.local_estoque_destino, q4(m.saldo_antes), q4(m.saldo_depois), m.lancamento_origem_id, m.bloqueado_exclusao_estoque, m.status]), [
      ['Entrada', 'compra_financeiro', '100.0000', '250.0000', '2.5000', s.local.id, '0.0000', '100.0000', d.id, true, 'Ativa'],
      ['Entrada', 'compra_financeiro', '300.0000', '800.0000', '2.6667', s.local.id, '0.0000', '300.0000', d.id, true, 'Ativa'],
      ['Entrada', 'compra_financeiro', '40.0000', '120.0000', '3.0000', s.local2.id, '0.0000', '40.0000', d.id, true, 'Ativa'],
    ]);
    assert.ok(movs.every((m) => m.data_movimentacao.toISOString() === '2027-06-10T12:00:00.000Z' && m.unidade_medida === 'KG' && m.fornecedor_id === e.forn.id));
    assert.equal(new Set(movs.map((m) => m.numero_movimentacao)).size, 3, 'números de movimento distintos');
    for (const [l, m] of lotes.map((l, k) => [l, movs[k]])) assert.equal(l.movimentacao_entrada_id, m.id);
    assert.deepEqual([await estoqueAtual(e.sal), await estoqueAtual(e.racao)], ['140.0000', '300.0000']);
    // o movimento gerado pelo lançamento não é excluível pela rota legada (código próprio, nunca 403/500)
    const del = await A.req('DELETE', `/movimentacoes-estoque/${movs[0].id}`, s.token);
    assert.deepEqual([del.statusCode, codigo(del)], [409, 'MOVIMENTO_CANCELAMENTO_OBRIGATORIO'], del.body);
    assert.equal(await p.movimentacaoEstoque.count({ where: { id: movs[0].id } }), 1);
    // segunda compra no mesmo produto/local: o saldo do movimento é o do local (e só da empresa)
    const conf2 = await comprar(s, e, [item(e.sal, '50', '2')]);
    const m2 = await p.movimentacaoEstoque.findUnique({ where: { id: conf2.itens[0].movimentacao_estoque_id } });
    assert.deepEqual([q4(m2.saldo_antes), q4(m2.saldo_depois)], ['100.0000', '150.0000']);
    assert.equal(await estoqueAtual(e.sal), '190.0000');
    assert.equal(await p.operacaoFinanceiraConsumoLote.count({ where: { cliente_id: s.c } }), 0, 'compra não grava fatias');
  });

  test('SACO fracionário e peso por saco com 4 casas: kg = ROUND_HALF_UP(q × fator, 4) uma vez (item, lote, movimento, estoque_atual); SACO em produto KG → 422', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const farelo = await p.produto.create({
      data: { cliente_id: s.c, empresa_id: e.id, numero_produto: '99', nome_produto: 'FARELO', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '33.3333' },
    });
    const conf = await comprar(s, e, [item(farelo, '2.5', '100', { unidade: 'SACO' }), item(farelo, '3', '100', { unidade: 'SACO' })]);
    assert.deepEqual(conf.itens.map((i) => [i.quantidade, i.fator_kg, i.quantidade_estoque]), [['2.5000', '33.3333', '83.3333'], ['3.0000', '33.3333', '99.9999']]);
    const lotes = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: farelo.id }, orderBy: { quantidade_entrada: 'asc' } });
    assert.deepEqual(lotes.map((l) => [q4(l.quantidade_entrada), q4(l.custo_unitario)]), [['83.3333', '3.0000'], ['99.9999', '3.0000']]);
    assert.equal(await estoqueAtual(farelo), '183.3332');
    const errado = await A.req('POST', '/operacoes-financeiras', s.token, { ...docCom(e, s.local, [item(e.sal, '1', '1', { unidade: 'SACO' })]), operation_id: opId() });
    assert.deepEqual([errado.statusCode, codigo(errado), errado.json().field, motivo(errado), errado.json().details.indice], [422, 'OPERACAO_REFERENCIA_INVALIDA', 'unidade', 'unidade_invalida', 0]);
    const zero = await A.req('POST', '/operacoes-financeiras', s.token, { ...docCom(e, s.local, [item(e.sal, '0.0001', '10000', { unidade: 'KG' })], { total: '1.00' }), operation_id: opId() });
    assert.equal(zero.statusCode, 201, 'kg 0,0001 é positivo');
    const kgZero = await A.req('POST', '/operacoes-financeiras', s.token, {
      ...docCom(e, s.local, [item(await p.produto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_produto: '98', nome_produto: 'MICRO', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '0.0001' } }), '0.0001', '100000', { unidade: 'SACO' })], { total: '10.00' }),
      operation_id: opId(),
    });
    assert.deepEqual([kgZero.statusCode, codigo(kgZero), motivo(kgZero)], [422, 'OPERACAO_VALORES_INVALIDOS', 'quantidade_estoque_zero']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E2 — saída FIFO (venda confirmada)', () => {
  test('FIFO em 3 lotes na ordem COALESCE(data_documento, createdAt), id; custo FIFO ≠ preço de venda; fatias gravadas e exibidas', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    // criado ANTES, mas com documento mais recente: vem depois na fila
    const tardio = await loteLegado(s, e, e.sal, s.local, { kg: '50', custo: '3.0000', dia: '2027-05-10' });
    const cedo = await loteLegado(s, e, e.sal, s.local, { kg: '30', custo: '2.0000', dia: '2027-05-01' });
    const semData = await p.estoqueLoteNota.create({
      data: {
        cliente_id: s.c, empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: s.local.id, custo_unitario: '1.0000', quantidade_entrada: '5', quantidade_disponivel: '5', status: 'Disponivel',
        createdAt: new Date('2027-04-01T10:00:00.000Z'),
      },
    });
    await definirEstoqueAtual(e.sal, '85');
    const d = await rascunhoVenda(s, e, [item(e.sal, '45', '10')]);
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual(prev.bloqueios, []);
    const saida = prev.plano.efeitos_estoque.saidas[0];
    assert.deepEqual([saida.kg, saida.disponivel, saida.custo_total, saida.fatias.map((f) => [f.lote_id, f.quantidade, f.custo_unitario])], [
      '45.0000', '85.0000', '95.0000', [[semData.id, '5.0000', '1.0000'], [cedo.id, '30.0000', '2.0000'], [tardio.id, '10.0000', '3.0000']],
    ]);
    const conf = await A.confirmar(s.token, d, e.id);
    const porQtd = (lista) => [...lista].sort((a, b) => Number(a.quantidade) - Number(b.quantidade));
    assert.deepEqual(porQtd(conf.itens[0].consumos).map((c) => [c.estoque_lote_nota_id, c.quantidade, c.custo_unitario]), [
      [semData.id, '5.0000', '1.0000'], [tardio.id, '10.0000', '3.0000'], [cedo.id, '30.0000', '2.0000'],
    ]);
    const consumos = await p.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.c }, orderBy: { quantidade: 'asc' } });
    assert.deepEqual(consumos.map((c) => [c.item_id, c.estoque_lote_nota_id, q4(c.quantidade), q4(c.custo_unitario), c.empresa_id]), [
      [conf.itens[0].id, semData.id, '5.0000', '1.0000', e.id], [conf.itens[0].id, tardio.id, '10.0000', '3.0000', e.id], [conf.itens[0].id, cedo.id, '30.0000', '2.0000', e.id],
    ]);
    const lotes = await p.estoqueLoteNota.findMany({ where: { id: { in: [semData.id, cedo.id, tardio.id] } } });
    const porId = new Map(lotes.map((l) => [l.id, [q4(l.quantidade_disponivel), l.status]]));
    assert.deepEqual([porId.get(semData.id), porId.get(cedo.id), porId.get(tardio.id)], [['0.0000', 'Esgotado'], ['0.0000', 'Esgotado'], ['40.0000', 'Disponivel']]);
    const mov = await p.movimentacaoEstoque.findUnique({ where: { id: conf.itens[0].movimentacao_estoque_id } });
    assert.deepEqual(
      [mov.tipo_movimentacao, mov.tipo_detalhado, q4(mov.quantidade), q4(mov.valor_total), q4(mov.valor_unitario), mov.local_estoque_origem, q4(mov.saldo_antes), q4(mov.saldo_depois), mov.cliente_nome, mov.modo_saida_fifo],
      ['Saída', 'venda_financeiro', '45.0000', '95.0000', '2.1111', s.local.id, '85.0000', '40.0000', e.cli.nome, 'FIFO'],
      'custo FIFO (95), nunca o preço de venda (450)'
    );
    assert.equal(conf.valor_total, '450.00');
    assert.equal(await estoqueAtual(e.sal), '40.0000');
    assert.equal(conf.itens[0].estoque_lote_nota_id, null, 'venda não cria lote');
  });

  test('mesmo produto/local em 2 linhas: cada linha relê o estado (sem saldo fantasma); falta só na 2ª linha → prévia aponta a linha e a confirmação recusa com ZERO efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const l1 = await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '2.0000', dia: '2027-05-01' });
    const l2 = await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '4.0000', dia: '2027-05-02' });
    await definirEstoqueAtual(e.sal, '20');
    const d = await rascunhoVenda(s, e, [item(e.sal, '8', '10'), item(e.sal, '8', '10')]);
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual(prev.plano.efeitos_estoque.saidas.map((x) => x.fatias.map((f) => [f.lote_id, f.quantidade])), [[[l1.id, '8.0000']], [[l1.id, '2.0000'], [l2.id, '6.0000']]]);
    const conf = await A.confirmar(s.token, d, e.id);
    assert.deepEqual(conf.itens.map((i) => i.consumos.map((c) => [c.estoque_lote_nota_id, c.quantidade, c.custo_unitario])), [
      [[l1.id, '8.0000', '2.0000']], [[l1.id, '2.0000', '2.0000'], [l2.id, '6.0000', '4.0000']],
    ]);
    const movs = await Promise.all(conf.itens.map((i) => p.movimentacaoEstoque.findUnique({ where: { id: i.movimentacao_estoque_id } })));
    assert.deepEqual(movs.map((m) => [q4(m.saldo_antes), q4(m.saldo_depois), q4(m.valor_total)]), [['20.0000', '12.0000', '16.0000'], ['12.0000', '4.0000', '28.0000']]);
    assert.deepEqual((await p.estoqueLoteNota.findMany({ where: { id: { in: [l1.id, l2.id] } }, orderBy: { custo_unitario: 'asc' } })).map((l) => [q4(l.quantidade_disponivel), l.status]), [['0.0000', 'Esgotado'], ['4.0000', 'Disponivel']]);
    assert.equal(await estoqueAtual(e.sal), '4.0000');
    // cancelar e confirmar de novo (outro rascunho igual): cada linha devolve as SUAS fatias, o mesmo lote recebe duas devoluções
    const cancelada = await A.ok(cancelar(s, conf, e));
    assert.equal(cancelada.status, 'CANCELADO');
    assert.deepEqual((await p.estoqueLoteNota.findMany({ where: { id: { in: [l1.id, l2.id] } }, orderBy: { custo_unitario: 'asc' } })).map((l) => [q4(l.quantidade_disponivel), l.status]), [['10.0000', 'Disponivel'], ['10.0000', 'Disponivel']]);
    assert.equal(await estoqueAtual(e.sal), '20.0000');
    const de_novo = await rascunhoVenda(s, e, [item(e.sal, '8', '10'), item(e.sal, '8', '10')]);
    await A.confirmar(s.token, de_novo, e.id);
    assert.equal(await estoqueAtual(e.sal), '4.0000');

    // agora faltam 2 kg só na 2ª linha (3 + 3 com 4 disponíveis)
    const falta = await rascunhoVenda(s, e, [item(e.sal, '3', '10'), item(e.sal, '3', '10')]);
    const prev2 = await A.previa(s.token, falta.id, e.id);
    assert.deepEqual(prev2.bloqueios.map((b) => [b.code, b.reason, b.details.indice, b.details.disponivel ?? b.details.estoque_atual, b.details.solicitado]), [
      ['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente', 1, '1.0000', '3.0000'],
      ['ESTOQUE_SALDO_INSUFICIENTE', 'estoque_atual_insuficiente', 1, '1.0000', '3.0000'],
    ], 'simulação EM SEQUÊNCIA: a 1ª linha consome antes da 2ª');
    const antes = await foto(s.c);
    const chave = opId();
    const r = await A.req('POST', `/operacoes-financeiras/${falta.id}/confirmar`, s.token, { empresa_id: e.id, operation_id: chave, versao: falta.versao });
    assert.deepEqual([r.statusCode, codigo(r), motivo(r), r.json().details.indice, r.json().details.disponivel, r.json().details.solicitado], [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente', 1, '1.0000', '3.0000']);
    assert.equal(await foto(s.c), antes, 'a 1ª linha (que cabia) também foi desfeita: estoque, fatias, títulos, cabeçalho e idempotência');
    const ainda = await p.operacaoFinanceira.findUnique({ where: { id: falta.id }, include: { titulos: true } });
    assert.deepEqual([ainda.status, ainda.titulos.map((t) => t.status)], ['RASCUNHO', ['PREVISTO']]);
  });

  test('estoque_atual legado menor que os lotes → 422 estoque_atual_insuficiente {estoque_atual, solicitado} na prévia e na confirmação, sem efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '10' });
    await definirEstoqueAtual(e.sal, '6');
    const d = await rascunhoVenda(s, e, [item(e.sal, '8', '5')]);
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual(prev.bloqueios.map((b) => [b.code, b.reason, b.details.estoque_atual, b.details.solicitado]), [['ESTOQUE_SALDO_INSUFICIENTE', 'estoque_atual_insuficiente', '6.0000', '8.0000']]);
    const antes = await foto(s.c);
    const r = await A.confirmarReq(s.token, d, e.id);
    assert.deepEqual([r.statusCode, codigo(r), motivo(r), r.json().details.estoque_atual, r.json().details.solicitado], [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'estoque_atual_insuficiente', '6.0000', '8.0000']);
    assert.equal(await foto(s.c), antes);
    // até o limite do agregado passa
    const ok6 = await rascunhoVenda(s, e, [item(e.sal, '6', '5')]);
    await A.confirmar(s.token, ok6, e.id);
    assert.deepEqual([await estoqueAtual(e.sal), await somaLotes({ cliente_id: s.c, produto_id: e.sal.id })], ['0.0000', '4.0000']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E3 — concorrência', () => {
  test('2 vendas simultâneas do último saldo (3 rodadas): uma passa, a outra 422; saldo nunca negativo; perdedora intocada', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    for (let rodada = 0; rodada < 3; rodada += 1) {
      await comprar(s, e, [item(e.sal, '10', '2')]);
      const v1 = await rascunhoVenda(s, e, [item(e.sal, '10', '9')]);
      const v2 = await rascunhoVenda(s, e, [item(e.sal, '10', '9')]);
      const rs = await Promise.all([A.confirmarReq(s.token, v1, e.id), A.confirmarReq(s.token, v2, e.id)]);
      const status = rs.map((r) => r.statusCode).sort();
      assert.deepEqual(status, [200, 422], rs.map((r) => r.body).join('\n'));
      const perdedora = rs[0].statusCode === 422 ? v1 : v2;
      assert.equal(codigo(rs.find((r) => r.statusCode === 422)), 'ESTOQUE_SALDO_INSUFICIENTE');
      const op = await p.operacaoFinanceira.findUnique({ where: { id: perdedora.id }, include: { itens: { include: { consumos: true } }, titulos: true } });
      assert.deepEqual([op.status, op.itens[0].movimentacao_estoque_id, op.itens[0].consumos.length, op.titulos[0].status], ['RASCUNHO', null, 0, 'PREVISTO']);
      assert.equal(await estoqueAtual(e.sal), '0.0000');
      assert.equal(await somaLotes({ cliente_id: s.c, produto_id: e.sal.id }), '0.0000');
    }
    assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: 'venda_financeiro' } }), 3);
  });

  test('venda P3 × suplementação × transferência (comandos existentes) em paralelo: tudo serializado pela trava do produto; com saldo curto ninguém fica negativo e o estado = soma dos sucessos', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await comprar(s, e, [item(e.sal, '100', '2')]);
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const venda = await rascunhoVenda(s, e, [item(e.sal, '10', '9')]);
      const rs = await Promise.all([A.confirmarReq(s.token, venda, e.id), suplementar(s, e, e.sal, s.local, 5), transferir(s, e, e.sal, s.local, s.local2, 5)]);
      assert.deepEqual(rs.map((r) => r.statusCode), [200, 201, 201], rs.map((r) => r.body).join('\n'));
    }
    assert.deepEqual(
      [await estoqueAtual(e.sal), await somaLotes({ cliente_id: s.c, produto_id: e.sal.id, local_estoque_id: s.local.id }), await somaLotes({ cliente_id: s.c, produto_id: e.sal.id, local_estoque_id: s.local2.id })],
      ['55.0000', '40.0000', '15.0000'],
      '100 − 3×(10+5) no agregado; local 1: 100 − 3×20; local 2: 3×5'
    );
    await conferirInvariantes(s, {}, 'após 3 rodadas');
    // rodada com demanda (30 + 15 + 15) maior que o saldo do local (40)
    const venda = await rascunhoVenda(s, e, [item(e.sal, '30', '9')]);
    const [rv, rsup, rtr] = await Promise.all([A.confirmarReq(s.token, venda, e.id), suplementar(s, e, e.sal, s.local, 15), transferir(s, e, e.sal, s.local, s.local2, 15)]);
    for (const r of [rv, rsup, rtr]) assert.ok([200, 201, 422].includes(r.statusCode), `nunca 500/409: ${r.statusCode} ${r.body}`);
    const okV = rv.statusCode === 200;
    const okS = rsup.statusCode === 201;
    const okT = rtr.statusCode === 201;
    assert.ok(okV || okS || okT, 'alguém passa');
    const consumidoLocal = (okV ? 30 : 0) + (okS ? 15 : 0) + (okT ? 15 : 0);
    assert.ok(consumidoLocal <= 40);
    assert.deepEqual(
      [await estoqueAtual(e.sal), await somaLotes({ cliente_id: s.c, produto_id: e.sal.id, local_estoque_id: s.local.id }), await somaLotes({ cliente_id: s.c, produto_id: e.sal.id, local_estoque_id: s.local2.id })],
      [q4(55 - (okV ? 30 : 0) - (okS ? 15 : 0)), q4(40 - consumidoLocal), q4(15 + (okT ? 15 : 0))]
    );
    assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: venda.id } })).status, okV ? 'CONFIRMADO' : 'RASCUNHO');
    await conferirInvariantes(s, {}, 'após a rodada curta');
  });
});

describe('E3b — ordem global de travas (§8.4)', () => {
  test('produtos em ordem cruzada (compra [B,A] × venda [A,B] × suplementação × transferência) em paralelo: nenhum deadlock/409/500; efeitos somados exatos', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const [pa, pb] = [e.sal, e.milho].sort((x, y) => (x.id < y.id ? -1 : 1));
    await comprar(s, e, [item(pa, '100', '1'), item(pb, '100', '1')]);
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const compra = await A.criar(s.token, docCom(e, s.local, [item(pb, '10', '1'), item(pa, '10', '1')]));
      const venda = await rascunhoVenda(s, e, [item(pa, '5', '3'), item(pb, '5', '3')]);
      const venda2 = await rascunhoVenda(s, e, [item(pb, '2', '3'), item(pa, '2', '3')]);
      const rs = await Promise.all([
        A.confirmarReq(s.token, compra, e.id), A.confirmarReq(s.token, venda, e.id), A.confirmarReq(s.token, venda2, e.id),
        suplementar(s, e, pa, s.local, 1), suplementar(s, e, pb, s.local, 1), transferir(s, e, pb, s.local, s.local2, 1),
      ]);
      assert.deepEqual(rs.map((r) => r.statusCode), [200, 200, 200, 201, 201, 201], rs.map((r) => r.body).join('\n'));
    }
    // por rodada: +10 −5 −2 −1 em cada produto (a transferência não muda o agregado)
    assert.deepEqual([await estoqueAtual(pa), await estoqueAtual(pb)], ['106.0000', '106.0000']);
    assert.equal(await somaLotes({ cliente_id: s.c, produto_id: pb.id, local_estoque_id: s.local2.id }), '3.0000');
    await conferirInvariantes(s, {}, 'ordem cruzada');
  });

  test('cancelar a compra × vender o mesmo lote, em paralelo (3 rodadas): ou a venda vence (cancelamento 409 ESTOQUE_JA_CONSUMIDO) ou o cancelamento vence (venda 422); nunca os dois, nunca 500', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const compra = await comprar(s, e, [item(e.sal, '10', '2')]);
      const venda = await rascunhoVenda(s, e, [item(e.sal, '4', '9')]);
      const [rc, rv] = await Promise.all([cancelar(s, compra, e), A.confirmarReq(s.token, venda, e.id)]);
      const lote = await p.estoqueLoteNota.findUnique({ where: { id: compra.itens[0].estoque_lote_nota_id } });
      if (rv.statusCode === 200) {
        assert.deepEqual([rc.statusCode, codigo(rc), lote.status, q4(lote.quantidade_disponivel)], [409, 'ESTOQUE_JA_CONSUMIDO', 'Disponivel', '6.0000'], rc.body);
        await A.ok(cancelar(s, { id: venda.id }, e));
        await A.ok(cancelar(s, compra, e));
      } else {
        assert.deepEqual([rc.statusCode, rv.statusCode, codigo(rv), lote.status], [200, 422, 'ESTOQUE_SALDO_INSUFICIENTE', 'Estornado'], `${rc.body}\n${rv.body}`);
      }
      assert.equal(await estoqueAtual(e.sal), '0.0000');
      await conferirInvariantes(s, {}, `rodada ${rodada}`);
    }
  });

  test('rascunho com itens em ordem DECRESCENTE de produto enquanto uma confirmação já travou o menor e vai travar o maior: sem ciclo (o rascunho espera, ninguém morre por deadlock)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const [pa, pb] = [e.sal, e.milho].sort((x, y) => (x.id < y.id ? -1 : 1));
    const doc = docCom(e, s.local, [item(pb, '1', '1'), item(pa, '1', '1')], { total: '2.00' });
    /** @type {any} */
    let erroConfirmacao = null;
    /** @type {any} */
    let resposta = null;
    // A sessão X reproduz, passo a passo, a ordem da confirmação/comandos: FOR UPDATE no menor id, depois no maior.
    await p.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${s.c} AND id = ${pa.id} FOR UPDATE`;
      const pedido = A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: opId() });
      const limite = Date.now() + 8000;
      for (;;) {
        const [w] = /** @type {any[]} */ (await p.$queryRaw`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
        if (w.n > 0 || Date.now() > limite) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      try {
        await tx.$queryRaw`SELECT id FROM "Produto" WHERE cliente_id = ${s.c} AND id = ${pb.id} FOR UPDATE`;
      } catch (erro) {
        erroConfirmacao = erro;
      }
      resposta = pedido;
    }, { maxWait: 10000, timeout: 20000 }).catch((erro) => { erroConfirmacao ??= erro; });
    const r = await resposta;
    assert.equal(erroConfirmacao, null, `a "confirmação" morreu por deadlock: ${erroConfirmacao?.message}`);
    assert.equal(r.statusCode, 201, `o rascunho não pode morrer por deadlock: ${r.body}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E4 — cancelamento com efeito de estoque', () => {
  test('compra intocada: estorno vinculado (pai/filho), lote Estornado, estoque_atual volta, títulos e chave documental liberados; prévia de saldo some', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.sal, s.local, { kg: '7' });
    await definirEstoqueAtual(e.sal, '7');
    const conf = await comprar(s, e, [item(e.sal, '100', '2'), item(e.racao, '10', '80', { unidade: 'SACO', local: s.local2 })], { documento_referencia: 'NF-CANC' });
    assert.deepEqual([await estoqueAtual(e.sal), await estoqueAtual(e.racao)], ['107.0000', '300.0000']);
    const canc = await A.ok(cancelar(s, conf, e));
    assert.deepEqual([canc.status, canc.titulos.map((t) => t.status), canc.motivo_cancelamento], ['CANCELADO', ['CANCELADO'], 'teste de cancelamento']);
    assert.ok(canc.cancelado_em && canc.cancelado_por);
    for (const it of canc.itens) {
      assert.ok(it.movimentacao_estorno_id, 'item aponta o estorno');
      const lote = await p.estoqueLoteNota.findUnique({ where: { id: it.estoque_lote_nota_id } });
      assert.deepEqual([q4(lote.quantidade_disponivel), lote.status, q4(lote.quantidade_entrada)], ['0.0000', 'Estornado', it.quantidade_estoque]);
      const original = await p.movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estoque_id } });
      const estorno = await p.movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estorno_id } });
      assert.deepEqual([original.status, original.movimento_filho_id], ['Estornada', estorno.id]);
      assert.deepEqual(
        [estorno.tipo_movimentacao, estorno.tipo_detalhado, estorno.movimento_pai_id, q4(estorno.quantidade), q4(estorno.valor_total), estorno.local_estoque_origem, estorno.lancamento_origem_id, estorno.status],
        ['Saída', 'estorno_compra', original.id, it.quantidade_estoque, q4(original.valor_total), it.local_estoque_id, conf.id, 'Ativa']
      );
      assert.equal(estorno.data_movimentacao.toISOString(), '2027-06-15T12:00:00.000Z', 'data do estorno = hoje da fazenda');
    }
    assert.deepEqual([await estoqueAtual(e.sal), await estoqueAtual(e.racao)], ['7.0000', '0.0000']);
    const saldos = await A.ok(A.req('GET', `/operacoes-financeiras-opcoes/saldos?empresa_id=${e.id}&produto_id=${e.racao.id}`, s.token));
    assert.deepEqual(saldos.itens, [], 'lote Estornado não aparece como saldo');
    assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: conf.id } })).documento_chave_ativa, null);
    // cancelar de novo → 409 (status), sem novo estorno
    const de_novo = await cancelar(s, conf, e);
    assert.deepEqual([de_novo.statusCode, codigo(de_novo)], [409, 'OPERACAO_STATUS_INVALIDO']);
    assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: 'estorno_compra' } }), 2);
    await conferirInvariantes(s, {}, 'após cancelar a compra');
  });

  test('cadastros desativados depois da confirmação (parceiro, produto, local, natureza, centro) não impedem o cancelamento nem a liquidação', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const compra = await comprar(s, e, [item(e.sal, '10', '2')], { rateio_modo: 'VALOR', rateios: [{ natureza_id: e.desp.id, centro_custo_id: e.cc.id, centro_resultado_id: e.cr.id, valor: '20.00' }] });
    await p.fornecedor.update({ where: { id: e.forn.id }, data: { ativo: false } });
    await p.produto.update({ where: { id: e.sal.id }, data: { ativo: false } });
    await p.localEstoque.update({ where: { id: s.local.id }, data: { ativo: false } });
    await p.naturezaFinanceira.update({ where: { id: e.desp.id }, data: { ativo: false } });
    await p.centroCusto.update({ where: { id: e.cc.id }, data: { ativo: false } });
    await p.centroResultado.update({ where: { id: e.cr.id }, data: { ativo: false } });
    const l = await A.ok(A.liquidarReq(s.token, compra.titulos[0].id, e.id, { valor: '5.00' }), 201);
    await A.ok(A.estornarReq(s.token, l.titulos[0].liquidacoes[0].id, e.id), 201);
    const canc = await A.ok(cancelar(s, compra, e));
    assert.equal(canc.status, 'CANCELADO');
    assert.equal(await estoqueAtual(e.sal), '0.0000');
  });

  test('compra já consumida (suplementação, venda P3 ou estoque_atual legado) → 409 ESTOQUE_JA_CONSUMIDO com reason/detalhes, ZERO efeito; cancelando a venda antes, a compra volta a ser cancelável', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await comprar(s, e, [item(e.milho, '5', '1'), item(e.sal, '100', '2')]);
    const lote = compra.itens[1].estoque_lote_nota_id;
    // (a) suplementação consumiu 1 kg do lote do 2º item
    assert.equal((await suplementar(s, e, e.sal, s.local, 1)).statusCode, 201);
    let antes = await foto(s.c);
    let r = await cancelar(s, compra, e);
    assert.deepEqual([r.statusCode, codigo(r), motivo(r), r.json().details.lote_id, r.json().details.entrada, r.json().details.disponivel, r.json().details.item_ordem, r.json().details.indice],
      [409, 'ESTOQUE_JA_CONSUMIDO', 'lote_consumido', lote, '100.0000', '99.0000', 2, 1]);
    assert.equal(await foto(s.c), antes, 'o 1º item (intocado) também não foi estornado');

    // (b) venda P3 consumindo a compra; cancelar a venda devolve e libera o cancelamento da compra
    const s2 = await montarTenant(app);
    const e2 = s2.e1;
    const compra2 = await comprar(s2, e2, [item(e2.sal, '100', '2')]);
    const venda = await rascunhoVenda(s2, e2, [item(e2.sal, '30', '9')]);
    await A.confirmar(s2.token, venda, e2.id);
    antes = await foto(s2.c);
    r = await cancelar(s2, compra2, e2);
    assert.deepEqual([r.statusCode, codigo(r), motivo(r), r.json().details.disponivel], [409, 'ESTOQUE_JA_CONSUMIDO', 'lote_consumido', '70.0000']);
    assert.equal(await foto(s2.c), antes);
    await A.ok(cancelar(s2, venda, e2));
    await A.ok(cancelar(s2, compra2, e2));
    assert.equal(await estoqueAtual(e2.sal), '0.0000');
    await conferirInvariantes(s2, {}, 'venda e compra canceladas');

    // (c) lote intocado mas estoque_atual legado rebaixado → recusa pelo agregado
    const s3 = await montarTenant(app);
    const e3 = s3.e1;
    const compra3 = await comprar(s3, e3, [item(e3.sal, '100', '2')]);
    await definirEstoqueAtual(e3.sal, '50');
    antes = await foto(s3.c);
    r = await cancelar(s3, compra3, e3);
    assert.deepEqual([r.statusCode, codigo(r), motivo(r), r.json().details.estoque_atual, r.json().details.solicitado], [409, 'ESTOQUE_JA_CONSUMIDO', 'estoque_atual_insuficiente', '50.0000', '100.0000']);
    assert.equal(await foto(s3.c), antes);
  });

  test('venda cancelada devolve cada fatia ao SEU lote (Esgotado volta a Disponivel), estorno pai/filho, fatias preservadas; lote Estornado recusa a devolução (409 sem efeito)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const l1 = await loteLegado(s, e, e.sal, s.local, { kg: '30', custo: '2.0000', dia: '2027-05-01' });
    const l2 = await loteLegado(s, e, e.sal, s.local, { kg: '50', custo: '3.0000', dia: '2027-05-02' });
    await definirEstoqueAtual(e.sal, '80');
    const venda = await rascunhoVenda(s, e, [item(e.sal, '45', '10')]);
    const conf = await A.confirmar(s.token, venda, e.id);
    const canc = await A.ok(cancelar(s, conf, e));
    const lotes = await p.estoqueLoteNota.findMany({ where: { id: { in: [l1.id, l2.id] } }, orderBy: { custo_unitario: 'asc' } });
    assert.deepEqual(lotes.map((l) => [q4(l.quantidade_disponivel), l.status]), [['30.0000', 'Disponivel'], ['50.0000', 'Disponivel']]);
    const original = await p.movimentacaoEstoque.findUnique({ where: { id: canc.itens[0].movimentacao_estoque_id } });
    const estorno = await p.movimentacaoEstoque.findUnique({ where: { id: canc.itens[0].movimentacao_estorno_id } });
    assert.deepEqual([original.status, original.movimento_filho_id, estorno.movimento_pai_id], ['Estornada', estorno.id, original.id]);
    assert.deepEqual([estorno.tipo_movimentacao, estorno.tipo_detalhado, q4(estorno.quantidade), q4(estorno.valor_total), estorno.local_estoque_destino, q4(estorno.saldo_antes), q4(estorno.saldo_depois)],
      ['Entrada', 'estorno_venda', '45.0000', '105.0000', s.local.id, '35.0000', '80.0000']);
    assert.equal(await estoqueAtual(e.sal), '80.0000');
    assert.equal(await p.operacaoFinanceiraConsumoLote.count({ where: { cliente_id: s.c } }), 2, 'fatias são fatos: continuam gravadas');
    assert.deepEqual(canc.itens[0].consumos.map((c) => c.estoque_lote_nota_id).sort(), [l1.id, l2.id].sort());

    // lote de origem que virou Estornado (escrita administrativa direta) → a devolução é recusada sem efeito
    const v2 = await rascunhoVenda(s, e, [item(e.sal, '10', '10')]);
    const c2 = await A.confirmar(s.token, v2, e.id);
    await p.estoqueLoteNota.update({ where: { id: l1.id }, data: { status: 'Estornado', quantidade_disponivel: '0' } });
    await definirEstoqueAtual(e.sal, '50');
    const antes = await foto(s.c);
    const r = await cancelar(s, c2, e);
    assert.deepEqual([r.statusCode, codigo(r), motivo(r), r.json().details.lote_id, r.json().details.status], [409, 'ESTOQUE_JA_CONSUMIDO', 'lote_indisponivel_para_devolucao', l1.id, 'Estornado']);
    assert.equal(await foto(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E5 — invariantes físicos', () => {
  test('sequência mista (entrada P3 → suplementação → transferência → venda P3 → cancelamentos, 2 empresas no mesmo local): diferença estoque_atual − Σ lotes preservada; Σ por local ≥ 0; nenhum lote acima da entrada', async () => {
    const s = await montarTenant(app);
    const { e1, e2 } = s;
    // estado inicial legado, com divergências propositais (preservadas)
    await loteLegado(s, e1, e1.sal, s.local, { kg: '40', custo: '2.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e1.sal, '100');
    await loteLegado(s, e1, e1.milho, s.local2, { kg: '10', custo: '1.5000', dia: '2027-05-01' });
    await definirEstoqueAtual(e1.milho, '12');
    await loteLegado(s, e2, e2.sal, s.local, { kg: '20', custo: '2.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e2.sal, '20');
    const inicial = await diferencasAtuais(s);
    assert.deepEqual([inicial[e1.sal.id], inicial[e1.milho.id], inicial[e2.sal.id], inicial[e1.racao.id]], ['60.0000', '2.0000', '0.0000', '0.0000']);
    const passo = async (rotulo, acao) => {
      const r = await acao();
      await conferirInvariantes(s, inicial, rotulo);
      return r;
    };
    const compra = await passo('1 compra', () => comprar(s, e1, [item(e1.sal, '100', '2.5'), item(e1.racao, '10', '80', { unidade: 'SACO', local: s.local2 })]));
    await passo('2 suplementação', async () => assert.equal((await suplementar(s, e1, e1.sal, s.local, 20)).statusCode, 201));
    await passo('3 transferência', async () => assert.equal((await transferir(s, e1, e1.sal, s.local, s.local2, 30)).statusCode, 201));
    const venda = await passo('4 venda', async () => {
      const d = await A.criar(s.token, docCom(e1, s.local2, [item(e1.sal, '25', '9'), item(e1.racao, '120', '4'), item(e1.milho, '5', '3')], { direcao: 'RECEBER' }));
      return A.confirmar(s.token, d, e1.id);
    });
    assert.deepEqual([await estoqueAtual(e1.sal), await estoqueAtual(e1.racao), await estoqueAtual(e1.milho)], ['155.0000', '180.0000', '7.0000']);
    await passo('5 cancelar compra consumida', async () => assert.deepEqual([(await cancelar(s, compra, e1)).statusCode], [409]));
    await passo('6 cancelar venda', () => A.ok(cancelar(s, venda, e1)));
    assert.deepEqual([await estoqueAtual(e1.sal), await estoqueAtual(e1.racao), await estoqueAtual(e1.milho)], ['180.0000', '300.0000', '12.0000']);
    const vendaE2 = await passo('7 venda E2 no mesmo local', async () => {
      const d = await A.criar(s.token, docCom(e2, s.local, [item(e2.sal, '20', '5')], { direcao: 'RECEBER' }));
      return A.confirmar(s.token, d, e2.id);
    });
    assert.equal(await somaLotes({ cliente_id: s.c, empresa_id: e1.id, produto_id: e1.sal.id, local_estoque_id: s.local.id }), '90.0000', 'a venda da E2 não tocou lote da E1');
    await passo('8 suplementação esgota a compra', async () => assert.equal((await suplementar(s, e1, e1.sal, s.local, 90)).statusCode, 201));
    await passo('9 cancelar venda E2', () => A.ok(cancelar(s, vendaE2, e2)));
    await passo('10 nova venda e cancelamento da racao', async () => {
      const d = await A.criar(s.token, docCom(e1, s.local2, [item(e1.racao, '300', '4')], { direcao: 'RECEBER' }));
      const c = await A.confirmar(s.token, d, e1.id);
      assert.equal(await estoqueAtual(e1.racao), '0.0000');
      await A.ok(cancelar(s, c, e1));
    });
    assert.deepEqual([await estoqueAtual(e1.sal), await estoqueAtual(e1.racao), await estoqueAtual(e1.milho), await estoqueAtual(e2.sal)], ['90.0000', '300.0000', '12.0000', '20.0000']);
    const movs = await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: s.c, origem_sistema: 'operacao_financeira' } });
    for (const m of movs.filter((x) => x.tipo_detalhado.startsWith('estorno_'))) {
      const pai = movs.find((x) => x.id === m.movimento_pai_id);
      assert.ok(pai && pai.status === 'Estornada' && pai.movimento_filho_id === m.id, `estorno ${m.id} vinculado`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E6 — rollback forçado entre estoque e título', () => {
  test('venda: falha depois das fatias/lotes/movimento (na promoção dos títulos e na gravação das fatias) → nada muda; cancelamento: falha depois do estorno físico → nada muda; retentativa idempotente aplica UMA vez', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.sal, s.local, { kg: '30', custo: '2.0000', dia: '2027-05-01' });
    await loteLegado(s, e, e.sal, s.local, { kg: '30', custo: '3.0000', dia: '2027-05-02' });
    await definirEstoqueAtual(e.sal, '60');
    const compra = await comprar(s, e, [item(e.milho, '10', '2')]);
    const venda = await rascunhoVenda(s, e, [item(e.sal, '40', '9')]);
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION p3e_falha() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'falha forçada P3-01 estoque'; END $f$`);
    const gatilhos = [
      ['p3e_titulo_upd', 'BEFORE UPDATE ON "TituloFinanceiro"'],
      ['p3e_consumo_ins', 'BEFORE INSERT ON "OperacaoFinanceiraConsumoLote"'],
      ['p3e_item_upd', 'BEFORE UPDATE ON "OperacaoFinanceiraItem"'],
    ];
    try {
      const corpo = { empresa_id: e.id, operation_id: opId(), versao: venda.versao };
      for (const [nome, quando] of gatilhos) {
        await p.$executeRawUnsafe(`CREATE TRIGGER ${nome} ${quando} FOR EACH ROW EXECUTE FUNCTION p3e_falha()`);
        const antes = await foto(s.c);
        const r = await A.req('POST', `/operacoes-financeiras/${venda.id}/confirmar`, s.token, corpo);
        assert.equal(r.statusCode, 500, `${nome}: ${r.body}`);
        assert.equal(await foto(s.c), antes, `${nome}: lotes, fatias, movimento, estoque_atual, títulos, cabeçalho e idempotência desfeitos`);
        await p.$executeRawUnsafe(`DROP TRIGGER ${nome} ON ${quando.split(' ON ')[1]}`);
      }
      const ok1 = await A.ok(A.req('POST', `/operacoes-financeiras/${venda.id}/confirmar`, s.token, corpo));
      const ok2 = await A.ok(A.req('POST', `/operacoes-financeiras/${venda.id}/confirmar`, s.token, corpo));
      assert.deepEqual([ok1.replay, ok2.replay, ok2.itens[0].movimentacao_estoque_id], [false, true, ok1.itens[0].movimentacao_estoque_id]);
      assert.deepEqual([await estoqueAtual(e.sal), await p.operacaoFinanceiraConsumoLote.count({ where: { cliente_id: s.c } })], ['20.0000', 2]);

      // cancelamento da compra: falha nos títulos (depois do estorno físico) e no item
      const chaveC = opId();
      for (const [nome, quando] of [gatilhos[0], gatilhos[2]]) {
        await p.$executeRawUnsafe(`CREATE TRIGGER ${nome} ${quando} FOR EACH ROW EXECUTE FUNCTION p3e_falha()`);
        const antes = await foto(s.c);
        const r = await A.req('POST', `/operacoes-financeiras/${compra.id}/cancelar`, s.token, { empresa_id: e.id, operation_id: chaveC, motivo: 'falha forçada' });
        assert.equal(r.statusCode, 500, `${nome}: ${r.body}`);
        assert.equal(await foto(s.c), antes, `cancelamento ${nome}: lote, movimentos e estoque_atual intactos`);
        await p.$executeRawUnsafe(`DROP TRIGGER ${nome} ON ${quando.split(' ON ')[1]}`);
      }
      const canc = await A.ok(A.req('POST', `/operacoes-financeiras/${compra.id}/cancelar`, s.token, { empresa_id: e.id, operation_id: chaveC, motivo: 'falha forçada' }));
      const replay = await A.ok(A.req('POST', `/operacoes-financeiras/${compra.id}/cancelar`, s.token, { empresa_id: e.id, operation_id: chaveC, motivo: 'falha forçada' }));
      assert.deepEqual([canc.status, canc.replay, replay.replay], ['CANCELADO', false, true]);
      assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: 'estorno_compra' } }), 1);
      assert.equal(await estoqueAtual(e.milho), '0.0000');
    } finally {
      for (const [nome, quando] of gatilhos) await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${nome} ON ${quando.split(' ON ')[1]}`);
      await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS p3e_falha()');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('E7 — documento sem mercadoria nunca movimenta estoque', () => {
  test('sem produtos e com produtos só de SERVIÇO (pagar e receber): criar, prévia, confirmar e cancelar sem nenhum lote/movimento/estoque_atual; nem exige fuso', async () => {
    const s = await montarTenant(app, { fuso: null });
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '10' });
    await definirEstoqueAtual(e.sal, '10');
    const estoque = await fotoEstoque(s.c);
    const servico = (direcao) => ({
      empresa_id: e.id, direcao, conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: (direcao === 'PAGAR' ? e.prest : e.cli).id, data_emissao: '2027-06-10',
      itens: [{ tipo_item: 'SERVICO', descricao: 'FRETE DO GADO', unidade: 'UN', quantidade: '2', valor_unitario: '150' }],
      rateio_modo: 'VALOR', rateios: [{ natureza_id: (direcao === 'PAGAR' ? e.desp2 : e.rec2).id, valor: '300.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '300.00' }],
    });
    for (const doc of [docSem(e), docSem(e, { direcao: 'RECEBER' }), servico('PAGAR'), servico('RECEBER')]) {
      const d = await A.criar(s.token, doc);
      const prev = await A.previa(s.token, d.id, e.id);
      assert.deepEqual([prev.bloqueios, prev.plano.efeitos_estoque.entradas, prev.plano.efeitos_estoque.saidas, prev.plano.resumo.itens_estoque_n], [[], [], [], 0]);
      const conf = await A.confirmar(s.token, d, e.id);
      assert.ok(conf.itens.every((i) => i.movimentacao_estoque_id === null && i.estoque_lote_nota_id === null && i.quantidade_estoque === null));
      const canc = await A.ok(cancelar(s, conf, e));
      assert.ok(canc.itens.every((i) => i.movimentacao_estorno_id === null));
      assert.equal(await fotoEstoque(s.c), estoque, `${doc.direcao}/${doc.conteudo}: estoque intocado`);
    }
    const comData = await A.req('POST', '/operacoes-financeiras', s.token, { ...servico('PAGAR'), data_operacional: '2027-06-10', operation_id: opId() });
    assert.deepEqual([comData.statusCode, comData.json().field, motivo(comData)], [400, 'data_operacional', 'nao_permitido_sem_mercadoria']);
    // com mercadoria, sem fuso → 409 na confirmação, sem efeito
    const merc = await A.criar(s.token, docCom(e, s.local, [item(e.sal, '1', '1')], { total: '1.00' }));
    const antes = await foto(s.c);
    const r = await A.confirmarReq(s.token, merc, e.id);
    assert.deepEqual([r.statusCode, codigo(r)], [409, 'EMPRESA_FUSO_NAO_CONFIGURADO']);
    assert.equal(await foto(s.c), antes);
  });
});
