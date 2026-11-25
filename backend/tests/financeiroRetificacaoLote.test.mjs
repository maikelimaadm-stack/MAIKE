/**
 * D-PROD-304 — o lote na retificação por SUBSTITUIÇÃO do lançamento financeiro. PostgreSQL real, pela API.
 *
 * A retificação que muda o estoque estorna a versão anterior e grava a nova pelo MESMO núcleo da confirmação
 * (`aplicarEfeitosDoPlano`). Até aqui ela não recebia `lotes_por_item`: a correção de uma compra confirmada de produto
 * com lote era recusada (422 lote_obrigatorio) e a venda caía no FEFO sem escolha.
 *
 *  R1 compra com lote, quantidade corrigida: sem `lotes_por_item` → 422 lote_obrigatorio e nada muda (prova do RED);
 *     com ele → SUBSTITUIÇÃO e a camada nova nasce com o lote e a validade informados; o mesmo `operation_id` devolve
 *     o mesmo resultado (replay), sem gravar de novo.
 *  R2 venda: a escolha manual sai dos lotes escolhidos; sem escolha, o FEFO (com o aviso do vencido).
 *  R3 NO_LUGAR (sem mudança física) com `lotes_por_item`: o campo é ignorado; o lote continua o mesmo.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const hoje = () => new Date().toISOString().slice(0, 10);
const opId = () => `op-${randomUUID()}`;
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};
const erro = (r, status, code, reason) => {
  assert.equal(r.statusCode, status, r.body);
  const b = r.json();
  if (code) assert.equal(b.code, code, r.body);
  if (reason) assert.equal(b.reason ?? b.details?.reason, reason, r.body);
  return b;
};
const v4 = (d) => (d === null || d === undefined ? null : Number(d).toFixed(4));
const semId = (avisos) => (avisos ?? []).map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'lote_id')));

const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const sal = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `SAL-${suf}`, nome_produto: `Vermífugo ${suf}`, unidade_principal_estoque: 'KG' } });
  const motivosEntrada = (await H.ok(H.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const compra = motivosEntrada.find((m) => m.nome === 'Compra').id;
  ok(await H.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  ok(await H.req('PATCH', `/produtos/${sal.id}`, s.token, { controla_lote: true, controla_validade: true }));
  return { ...s, sal, compra };
};

const entrar = async (x, produto, kg, custo, lote, validade) =>
  ok(await H.req('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e1.id, operation_id: `en-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: x.local.id, unidade: 'KG', quantidade: kg, custo_unitario: custo, lote_fabricante: lote, data_validade: validade }],
  }), 201);
const idDoLote = async (produto, lote) => (await prisma().estoqueLoteNota.findFirst({ where: { produto_id: produto.id, lote_fabricante: lote } })).id;
/** Camadas vigentes do produto por lote do fabricante: { LOTE: [disponível, custo, validade] }. */
const porLote = async (produto) => {
  const ls = await prisma().estoqueLoteNota.findMany({ where: { produto_id: produto.id, status: 'Disponivel' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  return Object.fromEntries(ls.map((l) => [l.lote_fabricante ?? l.id, [v4(l.quantidade_disponivel), v4(l.custo_unitario), l.data_validade?.toISOString().slice(0, 10) ?? null]]));
};
/** Três lotes do vermífugo: VELHO (vencido) 10 a 3; B 50 a 6; A 100 a 4. */
const tresLotes = async (x) => {
  await entrar(x, x.sal, '10', '3', 'VELHO', '2027-01-10');
  await entrar(x, x.sal, '50', '6', 'B', '2027-08-01');
  await entrar(x, x.sal, '100', '4', 'A', '2027-12-31');
  return { V: await idDoLote(x.sal, 'VELHO'), B: await idDoLote(x.sal, 'B'), A: await idDoLote(x.sal, 'A') };
};

/** Parceiro e natureza do lado do lançamento. */
const referencias = async (x, direcao) => {
  const p = prisma();
  const base = { cliente_id: x.c, empresa_id: x.e1.id };
  const marca = randomUUID().slice(0, 6);
  const compra = direcao === 'PAGAR';
  const parceiro = await p.fornecedor.create({ data: { ...base, numero_cadastro: `PA-${marca}`, tipo_pessoa: 'Jurídica', nome: `Parceiro ${marca}`, tipos: [compra ? 'fornecedor' : 'cliente'] } });
  const natureza = await p.naturezaFinanceira.create({ data: { ...base, numero: `NA-${marca}`, tipo: compra ? 'DESPESA' : 'RECEITA', nome: `${compra ? 'INSUMOS' : 'VENDAS'} ${marca}` } });
  return { parceiro, natureza };
};
/** Documento COM_PRODUTOS de uma linha do vermífugo (kg a `preco`), o corpo do POST e da retificação. */
const documento = (x, direcao, ref, kg, preco, extra = {}) => {
  const centavos = Math.round(Number(kg) * Number(preco) * 100);
  const total = `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;
  return {
    empresa_id: x.e1.id, direcao, conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: ref.parceiro.id, data_emissao: '2027-06-10', data_operacional: '2027-06-10',
    efeito_fisico_confirmado: true,
    itens: [{ tipo_item: 'MERCADORIA', produto_id: x.sal.id, local_estoque_id: x.local.id, unidade: 'KG', quantidade: kg, valor_unitario: preco }],
    rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: ref.natureza.id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
    ...extra,
  };
};
/** Rascunho criado e confirmado (com `lotes_por_item`, quando vem). */
const confirmado = async (x, direcao, kg, preco, lotesPorItem) => {
  const ref = await referencias(x, direcao);
  const r = ok(await H.req('POST', '/operacoes-financeiras', x.token, { ...documento(x, direcao, ref, kg, preco), operation_id: opId() }), 201);
  const c = ok(await H.req('POST', `/operacoes-financeiras/${r.id}/confirmar`, x.token, {
    empresa_id: x.e1.id, operation_id: opId(), versao: r.versao, ...(lotesPorItem ? { lotes_por_item: lotesPorItem } : {}),
  }));
  return { ...c, ref };
};
const retificarCorpo = (x, atual, direcao, kg, preco, { lotesPorItem = null, operationId = opId(), extra = {} } = {}) => ({
  ...documento(x, direcao, atual.ref, kg, preco, extra), versao: atual.versao, operation_id: operationId, motivo: 'quantidade corrigida',
  ...(lotesPorItem ? { lotes_por_item: lotesPorItem } : {}),
});
const retificar = (x, atual, corpo) => H.req('POST', `/operacoes-financeiras/${atual.id}/retificar`, x.token, corpo);

describe('R1 — compra com lote corrigida por substituição', () => {
  test('sem lotes_por_item → 422 lote_obrigatorio (nada muda); com ele → lote e validade novos; replay = mesmo resultado', async () => {
    const x = await montar();
    const c = await confirmado(x, 'PAGAR', '40', '5', [{ item_ordem: 1, lote_fabricante: 'NF-77', data_validade: '2027-12-31' }]);
    assert.deepEqual(await porLote(x.sal), { 'NF-77': ['40.0000', '5.0000', '2027-12-31'] });

    // RED: a correção da quantidade (40 → 50 kg) muda o estoque e, sem o lote, o motor recusa a entrada nova.
    erro(await retificar(x, c, retificarCorpo(x, c, 'PAGAR', '50', '5')), 422, 'ESTOQUE_LOTE_OBRIGATORIO', 'lote_obrigatorio');
    assert.deepEqual(await porLote(x.sal), { 'NF-77': ['40.0000', '5.0000', '2027-12-31'] }, 'nada mudou');
    const antes = ok(await H.req('GET', `/operacoes-financeiras/${c.id}?empresa_id=${x.e1.id}`, x.token));
    assert.equal(antes.status, 'CONFIRMADO');
    assert.equal(antes.versao, c.versao);

    // A validade é obrigatória para o produto que controla validade (a mesma regra da confirmação).
    erro(await retificar(x, c, retificarCorpo(x, c, 'PAGAR', '50', '5', { lotesPorItem: [{ item_ordem: 1, lote_fabricante: 'NF-78' }] })),
      422, 'ESTOQUE_LOTE_OBRIGATORIO', 'validade_obrigatoria');

    const operationId = opId();
    const corpo = retificarCorpo(x, c, 'PAGAR', '50', '5', { operationId, lotesPorItem: [{ item_ordem: 1, lote_fabricante: ' NF-78 ', data_validade: '2028-01-31' }] });
    const r = ok(await retificar(x, c, corpo));
    assert.equal(r.retificacao.modo, 'SUBSTITUICAO');
    assert.equal(r.replay, false);
    assert.notEqual(r.id, c.id);
    // A camada anterior foi estornada; a nova nasce com o lote (aparado) e a validade informados.
    assert.deepEqual(await porLote(x.sal), { 'NF-78': ['50.0000', '5.0000', '2028-01-31'] });
    const item = r.itens.find((i) => i.ordem === 1);
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { cliente_id_id: { cliente_id: x.c, id: item.estoque_lote_nota_id } } });
    assert.equal(lote.lote_fabricante, 'NF-78');
    assert.equal(lote.data_validade.toISOString().slice(0, 10), '2028-01-31');

    // Replay: o mesmo operation_id e o mesmo corpo devolvem o mesmo documento, sem gravar nada de novo.
    const camadas = await prisma().estoqueLoteNota.count({ where: { cliente_id: x.c } });
    const movimentos = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } });
    const rr = ok(await retificar(x, c, corpo));
    assert.equal(rr.replay, true);
    assert.equal(rr.id, r.id);
    assert.equal(rr.versao, r.versao);
    assert.equal(await prisma().estoqueLoteNota.count({ where: { cliente_id: x.c } }), camadas);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c } }), movimentos);
    // O lote faz parte do envio: o mesmo operation_id com outro lote é outro pedido (conflito de idempotência).
    const outro = { ...corpo, lotes_por_item: [{ item_ordem: 1, lote_fabricante: 'NF-79', data_validade: '2028-01-31' }] };
    assert.equal((await retificar(x, c, outro)).statusCode, 409);
  });
});

describe('R2 — venda corrigida por substituição', () => {
  test('a escolha manual sai dos lotes escolhidos; sem escolha, o FEFO (com o aviso do vencido)', async () => {
    const x = await montar();
    const L = await tresLotes(x);
    // Venda de 20 kg confirmada pelo FEFO: VELHO 10 + B 10.
    const c = await confirmado(x, 'RECEBER', '20', '9');
    assert.deepEqual(c.itens[0].consumos.map((k) => [k.estoque_lote_nota_id, v4(k.quantidade)]), [[L.V, '10.0000'], [L.B, '10.0000']]);

    // Corrigida para 25 kg, todos do A: a saída anterior volta aos lotes e a nova sai do A.
    const r = ok(await retificar(x, c, retificarCorpo(x, c, 'RECEBER', '25', '9', { lotesPorItem: [{ item_ordem: 1, lotes: [{ estoque_lote_nota_id: L.A, quantidade: '25' }] }] })));
    assert.equal(r.retificacao.modo, 'SUBSTITUICAO');
    assert.equal(r.avisos, undefined);
    assert.deepEqual(r.itens[0].consumos.map((k) => [k.estoque_lote_nota_id, v4(k.quantidade)]), [[L.A, '25.0000']]);
    const lotes = await porLote(x.sal);
    assert.deepEqual([lotes.VELHO[0], lotes.B[0], lotes.A[0]], ['10.0000', '50.0000', '75.0000']);

    // Corrigida de novo para 15 kg, sem escolha: o FEFO (VELHO 10 + B 5) e o aviso do vencido.
    const atual = { ...r, ref: c.ref };
    const f = ok(await retificar(x, atual, retificarCorpo(x, atual, 'RECEBER', '15', '9')));
    assert.equal(f.retificacao.modo, 'SUBSTITUICAO');
    assert.deepEqual(f.itens[0].consumos.map((k) => [k.estoque_lote_nota_id, v4(k.quantidade)]), [[L.V, '10.0000'], [L.B, '5.0000']]);
    assert.deepEqual(semId(f.avisos), [{ tipo: 'lote_vencido', lote: 'VELHO', validade: '2027-01-10', item_ordem: 1 }]);
    const depois = await porLote(x.sal);
    assert.deepEqual([depois.B[0], depois.A[0]], ['45.0000', '100.0000']);
  });
});

describe('R3 — NO_LUGAR não mexe em lote', () => {
  test('correção sem mudança física com lotes_por_item: modo NO_LUGAR, o lote e a validade continuam os mesmos', async () => {
    const x = await montar();
    const c = await confirmado(x, 'PAGAR', '40', '5', [{ item_ordem: 1, lote_fabricante: 'NF-77', data_validade: '2027-12-31' }]);
    const loteAntes = c.itens[0].estoque_lote_nota_id;
    const r = ok(await retificar(x, c, retificarCorpo(x, c, 'PAGAR', '40', '5', {
      extra: { descricao: 'Compra de vermífugo' },
      lotesPorItem: [{ item_ordem: 1, lote_fabricante: 'OUTRO', data_validade: '2029-01-01' }],
    })));
    assert.equal(r.retificacao.modo, 'NO_LUGAR');
    assert.equal(r.id, c.id);
    assert.equal(r.itens[0].estoque_lote_nota_id, loteAntes);
    assert.deepEqual(await porLote(x.sal), { 'NF-77': ['40.0000', '5.0000', '2027-12-31'] });
  });
});
