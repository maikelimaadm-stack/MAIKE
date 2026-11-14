/**
 * Itens do Apontamento de Atividade (D-PROD-191, Fatia D) — PostgreSQL real +
 * HTTP autenticado (`app.inject`). Escrito pelo CONTRATO
 * (`docs/engineering/MAIKE-APONTAMENTO-ITENS-CONTRATO.md` §3, §4, §6.1 e §10),
 * não pela implementação. Prova, regra a regra:
 *  - IT1/IT1b/IT2 item PRODUTO: baixa FÍSICA pelo motor único (FIFO por lote,
 *    custo = Σ fatia × custo do lote arredondado UMA vez, fatias gravadas na
 *    ordem do motor), movimento com a origem PRÓPRIA `apontamento_atividade`
 *    (documento = o apontamento), na unidade EFETIVA do Produto sem conversão
 *    (L → L; KG e SACO → KG), versão do apontamento +1, auditoria do item,
 *    replay idempotente (I-e…I-j, I-n, I-v, I-w);
 *  - IT3 SERVICO/OUTRO: total = ROUND_HALF_UP(quantidade × valor, 4) em Decimal
 *    no servidor, sem nenhum efeito de estoque (I-k, D-6, D-7);
 *  - IT4 recusas: Produto (inexistente, de outro tenant sem oráculo, de outra
 *    fazenda, inativo, unidade, COMBUSTÍVEL — D-8), local, saldo do lote e
 *    `estoque_atual`, forma do corpo (400), chave reaproveitada e o limite de
 *    200 itens (D-9) — sempre com NADA gravado (I-f, I-g, I-i, I-l, I-m);
 *  - IT5 situação, CAS e imutabilidade: apontamento CANCELADO, versão velha,
 *    PATCH do cabeçalho depois do item, sem PATCH/DELETE de item, e a data com
 *    item PRODUTO confirmado (D-1) (I-b, I-c, I-o, I-r);
 *  - IT6/IT7/IT8 cancelar item: estorno EXATO (cada fatia ao SEU lote) no "hoje"
 *    da fazenda, idempotência e os bloqueios do estorno (I-p);
 *  - IT9 cancelar o APONTAMENTO: todos os itens juntos, tudo ou nada; D-2 (I-q);
 *  - IT11 isolamento por tenant e por fazenda (I-t);
 *  - IT12 reconciliação reconhece a origem nova e as fatias FK (I-y);
 *  - IT13 X1 do lote, exclusões e proveniência da compra (I-x, R7);
 *  - IT14 código antes da migration (I-z); IT15 o banco (CHECKs, FKs, RLS);
 *  - IT16 permissões da tela (D-3).
 *
 * As corridas (T10) e o tempo do cancelamento com muitos itens (R5) estão em
 * `apontamentoAtividadeItensConcorrencia.test.mjs`. "Hoje" = 2027-06-15 em São
 * Paulo (relógio de teste do cenário do Patrimônio).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import {
  CHAVES_ITEM, CUSTO_ZERO, DIA, INSTANTE_ESTORNO, INSTANTE_SAIDA, ORIGEM, TIPO_ESTORNO, acoesItens, coerente, corpoCancelar, corpoErro, corpoProduto, corpoServico,
  erro, estoqueAtual, fatiasDe, foto, itemDe, montarItens, movimentoDe, numeracaoLimpa, opId, p4, prisma, saldoLote, versaoDe,
} from './apontamentoAtividadeItensCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoesItens>} */
let A;
before(async () => {
  app = await criarApp();
  await app.ready();
  A = acoesItens(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

/** Decimal com precisão de sobra para as contas esperadas (o padrão do Prisma, 20 dígitos, arredondaria). */
const D = Prisma.Decimal.clone({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });
const IVAL = 'APONTAMENTO_ATIVIDADE_ITEM_INVALIDO';
const BLOQ = 'APONTAMENTO_ATIVIDADE_ESTORNO_BLOQUEADO';
const SALDO = 'ESTOQUE_SALDO_INSUFICIENTE';
const VERSAO = 'APONTAMENTO_ATIVIDADE_VERSAO_CONFLITO';
const STATUS = 'APONTAMENTO_ATIVIDADE_STATUS_INVALIDO';

const adicionarOk = async (tok, id, corpo, status = 201) => {
  const r = await A.adicionar(tok, id, corpo);
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};
const cancelarItemOk = async (tok, id, itemId, corpo) => {
  const r = await A.cancelarItem(tok, id, itemId, corpo);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
const cancelarApontamentoOk = async (tok, id, corpo) => {
  const r = await A.cancelarApontamento(tok, id, corpo);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
};
/** O detalhe sem os campos só da resposta do comando (`item_id`, `replay`). */
const semExtras = (d) => {
  const resto = { ...d };
  delete resto.item_id;
  delete resto.replay;
  return resto;
};
const itemNa = (d, id) => d.itens.find((i) => i.id === id);

/**
 * Recusa com `[status, code, field, reason]` exatos e nada gravado no tenant.
 * @param {{ c: string }} s @param {() => Promise<any>} pedir @param {Array<unknown>} esperado
 */
const recusa = async (s, pedir, esperado) => {
  const antes = await foto(s.c);
  const r = await pedir();
  // `undefined` = posição que o contrato não fixa (só status, código e o que ele nomeia).
  assert.deepEqual(erro(r).map((v, i) => (esperado[i] === undefined ? undefined : v)), esperado, r.body);
  assert.equal(await foto(s.c), antes, `nada gravado (${esperado[1]} ${esperado[3] ?? ''})`);
  return r;
};
/** Recusa 400 (forma) com nada gravado; confere `field`/`reason` quando dados. */
const recusa400 = async (s, pedir, field = undefined, reason = undefined, rotulo = '') => {
  const antes = await foto(s.c);
  const r = await pedir();
  assert.deepEqual([r.statusCode, r.json().code], [400, 'REQUEST_VALIDATION_FAILED'], `${rotulo}: ${r.body}`);
  if (field !== undefined) assert.deepEqual(erro(r).slice(2), [field, reason], `${rotulo}: ${r.body}`);
  assert.equal(await foto(s.c), antes, `${rotulo}: nada gravado`);
  return r;
};

/** Duas compras P3 do herbicida em L no local 2: A (06-01, 10 L a 5,00) e B (06-03, 20 L a 7,00). */
const doisLotes = async (s, produto = s.herbicida) => {
  const a = await s.compraP3(s.e1, produto, s.local2, { quantidade: '10.0000', preco: '5.00', dia: '2027-06-01' });
  const b = await s.compraP3(s.e1, produto, s.local2, { quantidade: '20.0000', preco: '7.00', dia: '2027-06-03' });
  return { A: a.lote_id, B: b.lote_id, compraA: a, compraB: b };
};

// ═══ Item PRODUTO: baixa pelo motor único ═══════════════════════════════════

describe('D-PROD-191 — item PRODUTO: baixa física pelo motor único (I-e…I-j)', () => {
  test('IT1: FIFO em 2 lotes (5,00 e 7,00) — 12 L = 10 do mais antigo + 2 do outro; custo 64,0000 exato; movimento da origem própria; versão +1; auditoria; replay; detalhe', async () => {
    const s = await montarItens(app);
    const { A: loteA, B: loteB } = await doisLotes(s);
    assert.equal(await estoqueAtual(s.herbicida), '30.0000');
    const ap = await s.apontamento({ centro_custo_id: s.centro1.id, bem_id: s.trator.id });
    const p = prisma();
    const auditoriaDeEstoqueAntes = await p.auditLog.count({ where: { cliente_id: s.c, entidade: { in: ['EstoqueLoteNota', 'Produto'] } } });
    const financeirosAntes = await p.operacaoFinanceira.count({ where: { cliente_id: s.c } });

    const corpo = corpoProduto(ap, s.herbicida, s.local2, '12');
    const d = await adicionarOk(s.lancador.token, ap.id, corpo);
    assert.equal(d.replay, false);
    assert.deepEqual([d.id, d.status, d.versao], [ap.id, 'CONFIRMADO', 2], 'o apontamento continua CONFIRMADO, versão +1');
    assert.equal(d.itens.length, 1);
    const [item] = d.itens;
    assert.equal(d.item_id, item.id, 'item_id = o item criado');
    assert.deepEqual(Object.keys(item).sort(), [...CHAVES_ITEM]);
    assert.deepEqual(
      [item.ordem, item.tipo, item.status, item.descricao, item.quantidade, item.unidade, item.valor_unitario, item.valor_total, item.movimento_estorno, item.cancelamento],
      [1, 'PRODUTO', 'CONFIRMADO', null, '12.0000', 'L', '5.333300', '64.0000', null, null],
      'custo FIFO do motor (10 × 5 + 2 × 7 = 64), valor unitário = 64 / 12 em 4 casas (texto com 6)'
    );
    assert.deepEqual(item.produto, { id: s.herbicida.id, nome: s.herbicida.nome_produto, unidade_principal_estoque: 'L' });
    assert.deepEqual(item.local_estoque, { id: s.local2.id, nome: s.local2.nome });
    assert.deepEqual(item.consumos, [
      { ordem: 1, lote_id: loteA, quantidade: '10.0000', custo_unitario: '5.0000' },
      { ordem: 2, lote_id: loteB, quantidade: '2.0000', custo_unitario: '7.0000' },
    ], 'fatias na ordem FIFO (o mais antigo primeiro)');
    assert.deepEqual(item.criado_por, { id: s.lancador.id, nome: s.lancador.nome });
    assert.ok(Number.isFinite(Date.parse(item.criado_em)));
    assert.deepEqual(d.custo_itens, { total: '64.0000', produto: '64.0000', servico: '0.0000', outro: '0.0000', itens_confirmados: 1 });
    assert.equal(d.centro_custo_id, s.centro1.id, 'sem centro próprio: o item segue o centro (snapshot) do cabeçalho (D-4)');

    // Lotes, cache e movimento (só o motor escreveu).
    assert.deepEqual(await saldoLote(loteA), ['0.0000', 'Esgotado']);
    assert.deepEqual(await saldoLote(loteB), ['18.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.herbicida), '18.0000', 'estoque_atual = 30 − 12 (uma baixa só)');
    const mov = await movimentoDe(item.movimento.id);
    assert.deepEqual(
      [mov.tipo_movimentacao, mov.origem_sistema, mov.exclusao_somente_em, mov.tipo_detalhado, mov.lancamento_origem_id, mov.numero_documento, mov.status],
      ['Saída', ORIGEM, ORIGEM, ORIGEM, ap.id, ap.numero, 'Ativa'],
      'origem PRÓPRIA (nunca a do abastecimento nem a do financeiro); o documento é o apontamento'
    );
    assert.deepEqual(
      [mov.data_movimentacao.toISOString(), mov.data_documento.toISOString().slice(0, 10), mov.unidade_medida, p4(mov.quantidade), p4(mov.valor_total), p4(mov.valor_unitario)],
      [INSTANTE_SAIDA, DIA, 'L', '12.0000', '64.0000', '5.3333'],
      'saída na data operacional do apontamento (meio-dia UTC), na unidade do Produto, a custo FIFO'
    );
    assert.deepEqual([mov.produto_id, mov.empresa_id, mov.local_estoque_origem], [s.herbicida.id, s.e1.id, s.local2.id]);
    assert.match(mov.numero_movimentacao, /^\d+$/, 'número definitivo, nunca o provisório p-…');
    assert.equal(item.movimento.numero, mov.numero_movimentacao);
    assert.deepEqual([mov.centro_custo_id, mov.centro_custo_nome, mov.maquina_vinculada_id, mov.maquina_vinculada_nome, mov.tipo_documento], [null, null, null, null, null], 'C8: sem centro, máquina nem tipo de documento');
    assert.deepEqual((/** @type {any[]} */ (mov.lotes_consumidos)).map((f) => f.lote_id), [loteA, loteB]);

    // Linha do item e das fatias.
    const linha = await itemDe(item.id);
    assert.deepEqual(
      [linha.cliente_id, linha.empresa_id, linha.apontamento_id, linha.ordem, linha.tipo, linha.status, linha.produto_id, linha.local_estoque_id, linha.unidade],
      [s.c, s.e1.id, ap.id, 1, 'PRODUTO', 'CONFIRMADO', s.herbicida.id, s.local2.id, 'L'],
      'tenant da sessão; empresa e apontamento do caminho'
    );
    assert.deepEqual(
      [p4(linha.quantidade), linha.valor_unitario.toFixed(6), p4(linha.valor_total), linha.operation_id, linha.criado_por_usuario_id, linha.movimentacao_estoque_id, linha.movimentacao_estorno_id, linha.descricao],
      ['12.0000', '5.333300', '64.0000', corpo.operation_id, s.lancador.id, mov.id, null, null]
    );
    assert.deepEqual(await fatiasDe(item.id), [[1, loteA, '10.0000', '5.0000'], [2, loteB, '2.0000', '7.0000']]);
    assert.equal(await versaoDe(ap.id), 2);

    // Auditoria do item (mesma transação), sem AuditLog de lote/Produto (I-v); nada financeiro (I-w).
    const aud = await p.auditLog.findMany({ where: { cliente_id: s.c, entidade: 'ApontamentoAtividadeItem' } });
    assert.deepEqual(aud.map((x) => [x.acao, x.entidade_id, x.usuario_id]), [['apontamento_atividade.item_adicionar', item.id, s.lancador.id]]);
    const dados = JSON.stringify(aud[0].dados_novos);
    for (const esperado of [ap.id, mov.id, loteA, loteB, '64.0000', 'PRODUTO']) assert.ok(dados.includes(esperado), `auditoria do item cita ${esperado}: ${dados}`);
    assert.equal(await p.auditLog.count({ where: { cliente_id: s.c, entidade: { in: ['EstoqueLoteNota', 'Produto'] } } }), auditoriaDeEstoqueAntes, 'nunca AuditLog de lote ou Produto');
    assert.equal(await p.operacaoFinanceira.count({ where: { cliente_id: s.c } }), financeirosAntes, 'nenhum lançamento financeiro');

    // O detalhe (A4) é a mesma forma; a lista (A5) não traz itens.
    const det = await A.ok(A.detalhe(s.lancador.token, ap.id, s.e1.id));
    assert.deepEqual(det, semExtras(d));
    const lista = await A.ok(A.lista(s.lancador.token, s.e1.id));
    assert.equal(lista.items.length, 1);
    for (const chave of ['itens', 'custo_itens']) assert.equal(Object.prototype.hasOwnProperty.call(lista.items[0], chave), false, `a lista não traz ${chave}`);

    // Replay: mesma chave + mesmo corpo → 200 com o corpo gravado e NADA novo.
    const antes = await foto(s.c);
    const replay = await adicionarOk(s.lancador.token, ap.id, corpo, 200);
    assert.equal(replay.replay, true);
    assert.deepEqual(semExtras(replay), semExtras(d));
    assert.equal(replay.item_id, item.id);
    assert.equal(await foto(s.c), antes, 'o replay não grava nada');
    await numeracaoLimpa(s);
    await coerente(s, s.herbicida, 'IT1');
  });

  test('IT1b: o custo é arredondado UMA vez (Σ fatia × custo, depois 4 casas) — 0,5 × 5,1235 + 0,5 × 7,0001 = 6,0618 (por fatia daria 6,0619); preço digitado e custo médio nunca entram', async () => {
    const s = await montarItens(app);
    // Lotes "legados" com custo de 4 casas (a compra P3 arredonda o total a 2 casas).
    const l1 = await s.lote(s.e1, s.adubo, s.local, { quantidade: '0.5000', custo: '5.1235', dia: '2027-06-01' });
    const l2 = await s.lote(s.e1, s.adubo, s.local, { quantidade: '10.0000', custo: '7.0001', dia: '2027-06-02' });
    await prisma().produto.update({ where: { id: s.adubo.id }, data: { preco_custo: '99.0000' } });
    const ap = await s.apontamento();
    const d = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.adubo, s.local, '1'));
    const [item] = d.itens;
    assert.deepEqual([item.unidade, item.quantidade, item.valor_total, item.valor_unitario], ['KG', '1.0000', '6.0618', '6.061800']);
    assert.deepEqual(item.consumos.map((f) => [f.lote_id, f.quantidade, f.custo_unitario]), [[l1.id, '0.5000', '5.1235'], [l2.id, '0.5000', '7.0001']]);
    const mov = await movimentoDe(item.movimento.id);
    assert.deepEqual([p4(mov.valor_total), p4(mov.valor_unitario)], ['6.0618', '6.0618'], 'o item grava o MESMO custo do movimento');
    assert.equal((await prisma().produto.findUnique({ where: { id: s.adubo.id } })).preco_custo.toFixed(4), '99.0000', 'preco_custo não muda');
  });

  test('IT2: unidade EFETIVA sem conversão — Produto em SACO baixa em KG (37,5 kg, não sacos), em KG baixa KG (0,0001), em L baixa L; quantidade gravada = digitada', async () => {
    const s = await montarItens(app);
    const sal = await s.compraP3(s.e1, s.sal, s.local2, { quantidade: '100.0000', preco: '2.00', dia: '2027-06-01' });
    const adubo = await s.compraP3(s.e1, s.adubo, s.local2, { quantidade: '50.0000', preco: '3.00', dia: '2027-06-01' });
    const herb = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '20.0000', preco: '5.00', dia: '2027-06-01' });
    let ap = await s.apontamento();
    for (const [produto, quantidade, unidade, lote, saldo, total] of [
      [s.sal, '37.5', 'KG', sal.lote_id, '62.5000', '75.0000'],
      [s.adubo, '0.0001', 'KG', adubo.lote_id, '49.9999', '0.0003'],
      [s.herbicida, '2.5', 'L', herb.lote_id, '17.5000', '12.5000'],
    ]) {
      ap = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, produto, s.local2, quantidade));
      const item = ap.itens.find((/** @type {any} */ i) => i.id === ap.item_id);
      assert.deepEqual([item.unidade, item.quantidade, item.valor_total, item.produto.unidade_principal_estoque], [unidade, Number(quantidade).toFixed(4), total, produto.unidade_principal_estoque], produto.nome_produto);
      const mov = await movimentoDe(item.movimento.id);
      assert.deepEqual([mov.unidade_medida, p4(mov.quantidade)], [unidade, Number(quantidade).toFixed(4)], `${produto.nome_produto}: movimento na unidade efetiva`);
      assert.deepEqual(await saldoLote(lote), [saldo, 'Disponivel'], `${produto.nome_produto}: o lote baixa EXATAMENTE a quantidade digitada`);
      assert.equal(await estoqueAtual(produto), saldo);
    }
    assert.deepEqual(ap.itens.map((/** @type {any} */ i) => i.ordem), [1, 2, 3], 'ordem 1..n');
    assert.equal(ap.versao, 4);
  });
});

// ═══ SERVICO / OUTRO ════════════════════════════════════════════════════════

describe('D-PROD-191 — itens SERVICO e OUTRO: descrição + quantidade + valor, sem estoque (I-k, D-6, D-7)', () => {
  test('IT3: total = ROUND_HALF_UP(q × v, 4) em Decimal (1 × 1,00005 = 1,0001; 0,1 × 3 = 0,3000; 3 × 0,33335 = 1,0001 e 2 × 1,000025 = 2,0001, onde Number daria 1,0000 e 2,0000; produto de 16 dígitos exato); total zero e acima do limite recusados; nenhum movimento, lote ou estoque_atual', async () => {
    const s = await montarItens(app);
    await doisLotes(s);
    let ap = await s.apontamento();
    const estoqueAntes = JSON.stringify({
      m: await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }),
      l: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }),
      p: await prisma().produto.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }),
    }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

    const exato = new D('1234567.8901').times('98765.432109').toDecimalPlaces(4, D.ROUND_HALF_UP).toFixed(4);
    const VETORES = [
      ['SERVICO', 'Mão de obra terceirizada', '1', '1.00005', '1.0001', '1.000050'],
      ['OUTRO', '  Frete do insumo  ', '0.1', '3', '0.3000', '3.000000'],
      // (3 × 0.33335).toFixed(4) e (2 × 1.000025).toFixed(4) em Number dão 1.0000 e 2.0000: só o Decimal acerta.
      ['SERVICO', 'Hora-máquina terceirizada', '3', '0.33335', '1.0001', '0.333350'],
      ['OUTRO', 'Pedágio', '2', '1.000025', '2.0001', '1.000025'],
      ['SERVICO', 'Empreitada grande', '1234567.8901', '98765.432109', exato, '98765.432109'],
    ];
    for (const [tipo, descricao, q, v, total, vu] of VETORES) {
      ap = await adicionarOk(s.lancador.token, ap.id, corpoServico(ap, /** @type {any} */ (tipo), descricao, q, v));
      const item = itemNa(ap, ap.item_id);
      assert.deepEqual(
        [item.tipo, item.status, item.descricao, item.quantidade, item.valor_unitario, item.valor_total, item.unidade, item.produto, item.local_estoque, item.movimento, item.movimento_estorno, item.consumos],
        [tipo, 'CONFIRMADO', descricao.trim(), new D(q).toFixed(4), vu, total, null, null, null, null, null, []],
        `${tipo} ${q} × ${v}`
      );
      const linha = await itemDe(item.id);
      assert.deepEqual([linha.produto_id, linha.local_estoque_id, linha.unidade, linha.movimentacao_estoque_id, p4(linha.valor_total)], [null, null, null, null, total]);
    }
    const soma = (tipo) => VETORES.filter((x) => tipo === null || x[0] === tipo).reduce((acc, x) => acc.plus(x[4]), new D(0)).toFixed(4);
    assert.deepEqual(ap.custo_itens, { total: soma(null), produto: '0.0000', servico: soma('SERVICO'), outro: soma('OUTRO'), itens_confirmados: VETORES.length });
    assert.deepEqual(ap.itens.map((/** @type {any} */ i) => i.ordem), [1, 2, 3, 4, 5]);

    // Total zero (0,0001 × 0,4 = 0,00004 → 0,0000; e valor 0) e total acima do limite das colunas: 422, nada gravado.
    for (const [q, v, reason] of [['0.0001', '0.4', 'total_zero'], ['5', '0', 'total_zero'], ['9999999999.9999', '999999999999.999999', 'valor_excede_limite']]) {
      await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoServico(ap, 'OUTRO', 'Recusado', q, v)), [422, IVAL, 'valor_unitario', reason]);
    }
    for (const corpo of [corpoServico(ap, 'SERVICO', 'Zero', '0', '10'), corpoProduto(ap, s.herbicida, s.local2, '0.0000')]) {
      await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpo), [422, IVAL, 'quantidade', 'quantidade_nao_positiva']);
    }

    const estoqueDepois = JSON.stringify({
      m: await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }),
      l: await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }),
      p: await prisma().produto.findMany({ where: { cliente_id: s.c }, orderBy: { id: 'asc' } }),
    }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    assert.equal(estoqueDepois, estoqueAntes, 'SERVICO/OUTRO não tocam movimento, lote nem estoque_atual');
    assert.equal(await prisma().apontamentoAtividadeItemConsumoLote.count({ where: { cliente_id: s.c } }), 0, 'sem fatia');
  });
});

// ═══ Recusas ════════════════════════════════════════════════════════════════

describe('D-PROD-191 — recusas do item: nada gravado (I-e, I-f, I-i, I-l, I-m, D-8, D-9)', () => {
  test('IT4a: Produto inexistente / de outro tenant (mesmo corpo) / de outra fazenda / inativo / unidade fora de L-KG-SACO / COMBUSTÍVEL; local inexistente / de outro tenant / inativo → 422', async () => {
    const s = await montarItens(app);
    const B = await montarItens(app);
    await doisLotes(s);
    // Com saldo: sem a conferência do serviço, o motor baixaria (inativo) ou recusaria com outro código (outra fazenda).
    await s.lote(s.e1, s.inativo, s.local2, { quantidade: '10.0000', custo: '1.0000', dia: '2027-06-01' });
    await s.lote(s.e2, s.herbicida2, s.local2, { quantidade: '10.0000', custo: '1.0000', dia: '2027-06-01' });
    await s.lote(s.e1, s.diesel, s.local2, { quantidade: '100.0000', custo: '5.0000', dia: '2027-06-01' });
    await s.lote(s.e1, s.emUnidade, s.local2, { quantidade: '10.0000', custo: '1.0000', dia: '2027-06-01' });
    const ap = await s.apontamento();
    const tentar = (produtoId, localId) => () => A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, { id: produtoId }, { id: localId }, '1'));

    const inexistente = await recusa(s, tentar('produto-que-nao-existe', s.local2.id), [422, IVAL, 'produto_id', 'inexistente']);
    const deOutroTenant = await recusa(s, tentar(B.herbicida.id, s.local2.id), [422, IVAL, 'produto_id', 'inexistente']);
    assert.deepEqual(corpoErro(deOutroTenant), corpoErro(inexistente), 'Produto de outro tenant: o mesmo corpo do inexistente (sem oráculo)');
    await recusa(s, tentar(s.herbicida2.id, s.local2.id), [422, IVAL, 'produto_id', 'outra_empresa']);
    await recusa(s, tentar(s.inativo.id, s.local2.id), [422, IVAL, 'produto_id', 'inativo']);
    await recusa(s, tentar(s.emUnidade.id, s.local2.id), [422, IVAL, 'produto_id', 'unidade_nao_aceita']);
    // D-8: o diesel é aceito pelos tanques do trator e do gerador → combustível se lança no abastecimento.
    assert.ok((await prisma().tanqueBemProduto.count({ where: { cliente_id: s.c, produto_id: s.diesel.id } })) > 0, 'o diesel é aceito por tanque');
    await recusa(s, tentar(s.diesel.id, s.local2.id), [422, IVAL, 'produto_id', 'combustivel_no_abastecimento']);

    const localInexistente = await recusa(s, tentar(s.herbicida.id, 'local-que-nao-existe'), [422, IVAL, 'local_estoque_id', 'inexistente']);
    const localDeB = await recusa(s, tentar(s.herbicida.id, B.local2.id), [422, IVAL, 'local_estoque_id', 'inexistente']);
    assert.deepEqual(corpoErro(localDeB), corpoErro(localInexistente), 'local de outro tenant: o mesmo corpo');
    await recusa(s, tentar(s.herbicida.id, s.localInativo.id), [422, IVAL, 'local_estoque_id', 'inativo']);

    // Controle positivo: o mesmo pedido com o insumo ativo da fazenda passa.
    assert.equal((await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '1'))).versao, 2);
  });

  test('IT4b: saldo — acima do lote (10,0001 > 10), local sem lote da fazenda e estoque_atual menor que os lotes → 422 ESTOQUE_SALDO_INSUFICIENTE; nada gravado (item, fatia, movimento, recibo, versão)', async () => {
    const s = await montarItens(app);
    const c = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '10.0000', preco: '5.00', dia: '2027-06-01' });
    const ap = await s.apontamento();
    const r1 = await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '10.0001')), [422, SALDO, 'quantidade', 'saldo_lote_insuficiente']);
    assert.deepEqual([r1.json().details.disponivel, r1.json().details.solicitado], ['10.0000', '10.0001']);
    // O local é do tenant, mas a fazenda não tem lote do produto nele (I-f).
    const r2 = await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local, '1')), [422, SALDO, 'quantidade', 'saldo_lote_insuficiente']);
    assert.equal(r2.json().details.disponivel, '0.0000');
    // Lote do produto gravado com a OUTRA fazenda no mesmo local (dado incoerente, direto no banco): não conta.
    const estoqueAntes = await estoqueAtual(s.herbicida);
    await s.lote(s.e2, s.herbicida, s.local, { quantidade: '50.0000', custo: '1.0000', dia: '2027-06-01' });
    await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local, '1')), [422, SALDO, 'quantidade', 'saldo_lote_insuficiente']);
    // estoque_atual (cache) menor que os lotes: o motor recusa antes de escrever.
    await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = 5 WHERE id = ${s.herbicida.id}`;
    const r3 = await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '6')), [422, SALDO, 'quantidade', 'estoque_atual_insuficiente']);
    assert.equal(r3.json().details.estoque_atual, '5.0000');
    await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = ${estoqueAntes}::numeric WHERE id = ${s.herbicida.id}`;
    assert.deepEqual(await saldoLote(c.lote_id), ['10.0000', 'Disponivel']);
    assert.equal(await versaoDe(ap.id), 1);
    assert.equal(await prisma().operacaoIdempotente.count({ where: { cliente_id: s.c, tipo_operacao: 'adicionar_item_apontamento_atividade_v1' } }), 0, 'nenhum recibo');
  });

  test('IT4c: forma do corpo (I-l) → 400 ANTES da transação — produto sem produto/local, com descrição/valor; serviço sem descrição/valor, com produto/local; decimal como número; cliente_id; tipo, null, casas e caracteres inválidos', async () => {
    const s = await montarItens(app);
    await doisLotes(s);
    const ap = await s.apontamento();
    const tentar = (corpo) => () => A.adicionar(s.lancador.token, ap.id, corpo);
    const prod = (extra = {}) => corpoProduto(ap, s.herbicida, s.local2, '1', extra);
    const serv = (extra = {}) => corpoServico(ap, 'SERVICO', 'Mão de obra', '1', '10', extra);
    const sem = (corpo, chave) => {
      const c = { ...corpo };
      delete c[chave];
      return c;
    };
    await recusa400(s, tentar(sem(prod(), 'produto_id')), 'produto_id', 'campo_obrigatorio', 'PRODUTO sem produto');
    await recusa400(s, tentar(sem(prod(), 'local_estoque_id')), 'local_estoque_id', 'campo_obrigatorio', 'PRODUTO sem local');
    await recusa400(s, tentar(prod({ descricao: 'texto' })), 'descricao', 'campo_nao_permitido', 'PRODUTO com descrição');
    await recusa400(s, tentar(prod({ valor_unitario: '9.99' })), 'valor_unitario', 'campo_nao_permitido', 'PRODUTO com valor (o custo é do motor)');
    await recusa400(s, tentar(sem(serv(), 'descricao')), 'descricao', 'campo_obrigatorio', 'SERVICO sem descrição');
    await recusa400(s, tentar(sem(serv(), 'valor_unitario')), 'valor_unitario', 'campo_obrigatorio', 'SERVICO sem valor');
    await recusa400(s, tentar(serv({ produto_id: s.herbicida.id })), 'produto_id', 'campo_nao_permitido', 'SERVICO com produto');
    await recusa400(s, tentar(corpoServico(ap, 'OUTRO', 'Frete', '1', '10', { local_estoque_id: s.local2.id })), 'local_estoque_id', 'campo_nao_permitido', 'OUTRO com local');
    await recusa400(s, tentar(prod({ quantidade: 12 })), 'quantidade', 'valor_deve_ser_texto', 'quantidade como número');
    await recusa400(s, tentar(serv({ valor_unitario: 10.5 })), 'valor_unitario', 'valor_deve_ser_texto', 'valor como número');
    for (const [rotulo, corpo] of [
      ['cliente_id no corpo', prod({ cliente_id: s.c })],
      ['campo desconhecido', prod({ centro_custo_id: s.centro1.id })],
      ['tipo fora do domínio', serv({ tipo: 'MAO_DE_OBRA' })],
      ['produto null', prod({ produto_id: null })],
      ['descrição null', serv({ descricao: null })],
      ['descrição vazia', serv({ descricao: '' })],
      ['quantidade com 5 casas', prod({ quantidade: '1.23456' })],
      ['quantidade negativa', prod({ quantidade: '-1' })],
      ['valor com 7 casas', serv({ valor_unitario: '1.1234567' })],
      ['sem operation_id', sem(prod(), 'operation_id')],
      ['operation_id curto', prod({ operation_id: 'abc' })],
      ['sem versão', sem(prod(), 'versao')],
      ['sem quantidade', sem(prod(), 'quantidade')],
      ['descrição com caractere de controle', serv({ descricao: 'Frete\u0007' })],
      ['descrição só com espaços', serv({ descricao: '   ' })],
    ]) await recusa400(s, tentar(corpo), undefined, undefined, rotulo);
    assert.equal(await versaoDe(ap.id), 1);
  });

  test('IT4d: limite de 200 itens por apontamento contando os CANCELADOS (D-9); a chave de item gravada fora do recibo é recusada pelo unique da tabela (409 IDEMPOTENCY_CONFLICT)', async () => {
    const s = await montarItens(app);
    const ap = await s.apontamento();
    const agora = new Date();
    // 199 itens SERVICO direto no banco (40 deles CANCELADOS): o limite conta tudo.
    await prisma().apontamentoAtividadeItem.createMany({
      data: Array.from({ length: 199 }, (_, i) => ({
        cliente_id: s.c, empresa_id: s.e1.id, apontamento_id: ap.id, ordem: i + 1, tipo: 'SERVICO', descricao: `Semente ${i + 1}`, quantidade: '1', valor_unitario: '1',
        valor_total: '1', operation_id: `semente-item-${i + 1}-${randomUUID().slice(0, 8)}`,
        ...(i < 40 ? { status: 'CANCELADO', cancelado_em: agora, motivo_cancelamento: 'semente cancelada', cancelamento_origem: 'ITEM' } : { status: 'CONFIRMADO' }),
      })),
    });
    const operacaoDaSemente = (await prisma().apontamentoAtividadeItem.findFirst({ where: { apontamento_id: ap.id, ordem: 199 } })).operation_id;
    // A mesma chave de um item já gravado (sem recibo): o unique (cliente_id, operation_id) da tabela é a rede (§3.3).
    const semAuditoria = async () => JSON.stringify({ ...JSON.parse(await foto(s.c)), auditLog: null });
    const antesDaChave = await semAuditoria();
    const repetida = await A.adicionar(s.lancador.token, ap.id, corpoServico(ap, 'SERVICO', 'Repetido', '1', '1', { operation_id: operacaoDaSemente }));
    assert.deepEqual([repetida.statusCode, repetida.json().code], [409, 'IDEMPOTENCY_CONFLICT'], repetida.body);
    assert.equal(await semAuditoria(), antesDaChave, 'nada gravado (só a auditoria best-effort do reenvio)');

    const d = await adicionarOk(s.lancador.token, ap.id, corpoServico(ap, 'SERVICO', 'Ducentésimo', '1', '1'));
    assert.equal(itemNa(d, d.item_id).ordem, 200, 'o 200º entra (ordem nunca reaproveitada)');
    assert.equal(d.itens.length, 200);
    const r = await recusa(s, () => A.adicionar(s.lancador.token, d.id, corpoServico(d, 'OUTRO', 'Excedente', '1', '1')), [422, 'APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS', undefined, undefined]);
    assert.equal(r.json().details.limite, 200);
    await recusa(s, () => A.adicionar(s.lancador.token, d.id, corpoProduto(d, s.herbicida, s.local2, '1')), [422, 'APONTAMENTO_ATIVIDADE_ITENS_EXCEDIDOS', undefined, undefined]);
  });
});

// ═══ Situação, CAS e imutabilidade ══════════════════════════════════════════

describe('D-PROD-191 — situação, CAS e imutabilidade (I-b, I-c, I-o, I-r, D-1)', () => {
  test('IT5: versão velha → 409; PATCH do cabeçalho com a versão de antes do item → 409; sem PATCH/DELETE de item (404 de rota); data com item PRODUTO confirmado → 409 DATA_COM_ITENS; apontamento CANCELADO não recebe nem cancela item', async () => {
    const s = await montarItens(app);
    await doisLotes(s);
    const ap = await s.apontamento();
    await recusa(s, () => A.adicionar(s.lancador.token, 'apontamento-inexistente', corpoServico(ap, 'SERVICO', 'x', '1', '1')), [404, 'APONTAMENTO_ATIVIDADE_NOT_FOUND', undefined, undefined]);
    const v2 = await adicionarOk(s.lancador.token, ap.id, corpoServico(ap, 'SERVICO', 'Diária de tratorista', '1', '150'));
    const servicoId = v2.item_id;

    // CAS = a versão do APONTAMENTO (um token para o agregado).
    const velha = await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoServico(ap, 'SERVICO', 'Velha', '1', '1')), [409, VERSAO, undefined, undefined]);
    assert.deepEqual(velha.json().details, { versao_atual: 2, versao_informada: 1 });
    await recusa(s, () => A.editar(s.token, ap.id, { empresa_id: s.e1.id, versao: 1, observacao: 'tela velha' }), [409, VERSAO, undefined, undefined]);
    const v3 = await A.ok(A.editar(s.token, ap.id, { empresa_id: s.e1.id, versao: 2, observacao: 'relida' }));
    assert.equal(v3.versao, 3);

    // Imutável: não há PATCH nem DELETE de item.
    for (const metodo of ['PATCH', 'DELETE', 'PUT']) {
      const r = await A.req(metodo, `/apontamentos-atividade/${ap.id}/itens/${servicoId}?empresa_id=${s.e1.id}`, s.token, metodo === 'DELETE' ? undefined : { empresa_id: s.e1.id, versao: 3, quantidade: '2' });
      assert.equal(r.statusCode, 404, `${metodo}: ${r.body}`);
    }
    assert.equal((await A.req('DELETE', `/apontamentos-atividade/${ap.id}/itens?empresa_id=${s.e1.id}`, s.token)).statusCode, 404);
    assert.equal(p4((await itemDe(servicoId)).quantidade), '1.0000');

    // D-1: com item SERVICO só, a data muda; com item PRODUTO CONFIRMADO, não.
    const v4 = await A.ok(A.editar(s.token, ap.id, { empresa_id: s.e1.id, versao: 3, data_operacional: '2027-06-09' }));
    assert.equal(v4.data_operacional, '2027-06-09', 'SERVICO não prende a data');
    const v5 = await adicionarOk(s.lancador.token, ap.id, corpoProduto(v4, s.herbicida, s.local2, '3'));
    const produtoId = v5.item_id;
    const mov = await movimentoDe(itemNa(v5, produtoId).movimento.id);
    assert.equal(mov.data_movimentacao.toISOString(), '2027-06-09T12:00:00.000Z', 'a saída está na data do apontamento');
    await recusa(s, () => A.editar(s.token, ap.id, { empresa_id: s.e1.id, versao: 5, data_operacional: '2027-06-08' }), [409, 'APONTAMENTO_ATIVIDADE_DATA_COM_ITENS', undefined, undefined]);
    // A mesma data (sem mudar) e outro campo seguem livres.
    const v6 = await A.ok(A.editar(s.token, ap.id, { empresa_id: s.e1.id, versao: 5, data_operacional: '2027-06-09', observacao: 'mesma data' }));
    assert.equal(v6.versao, 6);
    // Cancelado o item PRODUTO, a data volta a mudar.
    const v7 = await cancelarItemOk(s.cancelador.token, ap.id, produtoId, corpoCancelar(v6, 'lançado errado'));
    assert.equal(v7.versao, 7);
    assert.equal((await A.ok(A.editar(s.token, ap.id, { empresa_id: s.e1.id, versao: 7, data_operacional: '2027-06-08' }))).data_operacional, '2027-06-08');

    // Apontamento CANCELADO: nada entra nem sai (status antes da versão).
    const c = await cancelarApontamentoOk(s.cancelador.token, ap.id, corpoCancelar({ empresa_id: s.e1.id, versao: 8 }, 'atividade não aconteceu'));
    assert.deepEqual([c.status, c.versao], ['CANCELADO', 9]);
    for (const versao of [9, 1]) {
      const r = await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoServico({ empresa_id: s.e1.id, versao }, 'SERVICO', 'Depois', '1', '1')), [409, STATUS, 'status', 'status_invalido']);
      assert.equal(r.json().details.status, 'CANCELADO');
      await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoProduto({ empresa_id: s.e1.id, versao }, s.herbicida, s.local2, '1')), [409, STATUS, 'status', 'status_invalido']);
      await recusa(s, () => A.cancelarItem(s.cancelador.token, ap.id, servicoId, corpoCancelar({ empresa_id: s.e1.id, versao }, 'depois')), [409, STATUS, 'status', 'status_invalido']);
    }
  });
});

// ═══ Cancelar item ══════════════════════════════════════════════════════════

describe('D-PROD-191 — cancelar item: estorno exato (I-p)', () => {
  test('IT6: cada fatia volta ao SEU lote (mesmo com o resto do lote mais novo consumido por outro apontamento); Entrada de estorno com o mesmo valor e o par pai/filho; no HOJE da fazenda; item CANCELADO origem ITEM; apontamento CONFIRMADO versão +1', async () => {
    const s = await montarItens(app);
    const { A: loteA, B: loteB } = await doisLotes(s);
    const ap1 = await s.apontamento();
    const ap2 = await s.apontamento({ data_operacional: '2027-06-12' });
    const d1 = await adicionarOk(s.lancador.token, ap1.id, corpoProduto(ap1, s.herbicida, s.local2, '12'));
    const item1 = itemNa(d1, d1.item_id);
    const d2 = await adicionarOk(s.lancador.token, ap2.id, corpoProduto(ap2, s.herbicida, s.local2, '18'));
    assert.deepEqual(itemNa(d2, d2.item_id).consumos.map((f) => [f.lote_id, f.quantidade]), [[loteB, '18.0000']]);
    assert.deepEqual(await saldoLote(loteA), ['0.0000', 'Esgotado']);
    assert.deepEqual(await saldoLote(loteB), ['0.0000', 'Esgotado']);
    assert.equal(await estoqueAtual(s.herbicida), '0.0000');

    const auditoriaDeEstoque = () => prisma().auditLog.count({ where: { cliente_id: s.c, entidade: { in: ['EstoqueLoteNota', 'Produto'] } } });
    const auditoriaDeEstoqueAntes = await auditoriaDeEstoque();
    const corpo = corpoCancelar(d1, '  aplicado no talhão errado  ');
    const c = await cancelarItemOk(s.cancelador.token, ap1.id, item1.id, corpo);
    assert.equal(c.replay, false);
    assert.deepEqual([c.id, c.status, c.versao], [ap1.id, 'CONFIRMADO', 3], 'o apontamento continua CONFIRMADO, versão +1');
    assert.deepEqual(c.custo_itens, CUSTO_ZERO, 'item cancelado não soma custo');
    const it = itemNa(c, item1.id);
    assert.equal(it.status, 'CANCELADO');
    assert.deepEqual(it.cancelamento.cancelado_por, { id: s.cancelador.id, nome: s.cancelador.nome });
    assert.deepEqual([it.cancelamento.motivo, it.cancelamento.origem], ['aplicado no talhão errado', 'ITEM']);
    assert.ok(Number.isFinite(Date.parse(it.cancelamento.cancelado_em)));
    assert.deepEqual(it.consumos, item1.consumos, 'o histórico das fatias fica');
    assert.deepEqual([it.valor_total, it.quantidade], ['64.0000', '12.0000']);

    // Devolução EXATA: 10 ao A e 2 ao B (nunca FIFO refeito).
    assert.deepEqual(await saldoLote(loteA), ['10.0000', 'Disponivel']);
    assert.deepEqual(await saldoLote(loteB), ['2.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(s.herbicida), '12.0000');
    const original = await movimentoDe(item1.movimento.id);
    const estorno = await movimentoDe(it.movimento_estorno.id);
    assert.deepEqual([original.status, original.movimento_filho_id], ['Estornada', estorno.id]);
    assert.deepEqual(
      [estorno.tipo_movimentacao, estorno.tipo_detalhado, estorno.origem_sistema, estorno.exclusao_somente_em, estorno.movimento_pai_id, estorno.lancamento_origem_id, estorno.numero_documento],
      ['Entrada', TIPO_ESTORNO, ORIGEM, ORIGEM, original.id, ap1.id, ap1.numero]
    );
    assert.deepEqual([p4(estorno.quantidade), p4(estorno.valor_total), estorno.unidade_medida], ['12.0000', '64.0000', 'L'], 'o MESMO valor do original');
    assert.equal(estorno.data_movimentacao.toISOString(), INSTANTE_ESTORNO, 'estorno no HOJE da fazenda, não na data operacional');
    assert.match(estorno.numero_movimentacao, /^\d+$/);
    assert.equal(it.movimento_estorno.numero, estorno.numero_movimentacao);

    const linha = await itemDe(item1.id);
    assert.deepEqual(
      [linha.status, linha.movimentacao_estorno_id, linha.cancelado_por_usuario_id, linha.motivo_cancelamento, linha.cancelamento_origem, linha.movimentacao_estoque_id],
      ['CANCELADO', estorno.id, s.cancelador.id, 'aplicado no talhão errado', 'ITEM', original.id]
    );
    assert.equal((await fatiasDe(item1.id)).length, 2, 'as fatias ficam (histórico)');
    assert.deepEqual([(await prisma().apontamentoAtividade.findUnique({ where: { id: ap1.id } })).status, await versaoDe(ap1.id)], ['CONFIRMADO', 3]);
    const aud = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'ApontamentoAtividadeItem', entidade_id: item1.id }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(aud.map((x) => [x.acao, x.usuario_id]), [['apontamento_atividade.item_adicionar', s.lancador.id], ['apontamento_atividade.item_cancelar', s.cancelador.id]]);
    assert.ok(JSON.stringify(aud[1].dados_novos).includes(estorno.id), 'a auditoria do cancelamento cita o estorno');
    assert.deepEqual(await A.ok(A.detalhe(s.token, ap1.id, s.e1.id)), semExtras(c));
    await numeracaoLimpa(s);
    await coerente(s, s.herbicida, 'IT6');

    // SERVICO: só a situação muda (nenhum movimento).
    const movimentos = await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c } });
    const d3 = await adicionarOk(s.lancador.token, ap1.id, corpoServico(c, 'SERVICO', 'Diária', '1', '100'));
    const c3 = await cancelarItemOk(s.cancelador.token, ap1.id, d3.item_id, corpoCancelar(d3, 'não houve diária'));
    const sv = itemNa(c3, d3.item_id);
    assert.equal(sv.ordem, 2, 'a ordem segue depois do cancelado (I-n: nunca reaproveitada)');
    assert.deepEqual([sv.status, sv.cancelamento.origem, sv.movimento_estorno], ['CANCELADO', 'ITEM', null]);
    assert.equal(await auditoriaDeEstoque(), auditoriaDeEstoqueAntes, 'o estorno nunca grava AuditLog de lote ou Produto (I-v)');
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c } }), movimentos);
    assert.equal(c3.versao, 5);
  });

  test('IT7: estorno idempotente — mesma chave e corpo → 200 replay (UMA Entrada); mesma chave com outro motivo → 409 IDEMPOTENCY_CONFLICT auditado; chave nova no item já cancelado → 409 ITEM_STATUS_INVALIDO (versão atual) ou VERSAO_CONFLITO (velha); A1 com a mesma chave e outro conteúdo → 409', async () => {
    const s = await montarItens(app);
    await doisLotes(s);
    const ap = await s.apontamento();
    const corpoItem = corpoProduto(ap, s.herbicida, s.local2, '12');
    const d = await adicionarOk(s.lancador.token, ap.id, corpoItem);
    // A1: a mesma chave com outro conteúdo (quantidade, ou outro apontamento) → 409, nada gravado além da auditoria do reenvio.
    const outroAp = await s.apontamento();
    for (const corpo of [{ ...corpoItem, quantidade: '11' }, { ...corpoItem, versao: 2 }]) {
      const antes = await prisma().apontamentoAtividadeItem.count({ where: { cliente_id: s.c } });
      const r = await A.adicionar(s.lancador.token, ap.id, corpo);
      assert.deepEqual([r.statusCode, r.json().code], [409, 'IDEMPOTENCY_CONFLICT'], r.body);
      assert.equal(await prisma().apontamentoAtividadeItem.count({ where: { cliente_id: s.c } }), antes);
    }
    const noOutro = await A.adicionar(s.lancador.token, outroAp.id, { ...corpoItem, versao: 1 });
    assert.deepEqual([noOutro.statusCode, noOutro.json().code], [409, 'IDEMPOTENCY_CONFLICT'], 'a chave é do tenant, não do apontamento');

    const corpo = corpoCancelar(d, 'lançado em dobro');
    const c = await cancelarItemOk(s.cancelador.token, ap.id, d.item_id, corpo);
    const estornos = () => prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: TIPO_ESTORNO } });
    assert.equal(await estornos(), 1);
    const antes = await foto(s.c);
    const replay = await cancelarItemOk(s.cancelador.token, ap.id, d.item_id, corpo);
    assert.equal(replay.replay, true);
    assert.deepEqual(semExtras(replay), semExtras(c));
    assert.equal(await foto(s.c), antes, 'replay sem efeito novo');
    assert.equal(await estornos(), 1, 'UMA Entrada só');

    // Mesma chave, outro motivo → 409; só a auditoria do reenvio é gravada.
    const auditAntes = await prisma().auditLog.findMany({ where: { cliente_id: s.c }, select: { id: true } });
    const conflito = await A.cancelarItem(s.cancelador.token, ap.id, d.item_id, { ...corpo, motivo: 'outro motivo qualquer' });
    assert.deepEqual([conflito.statusCode, conflito.json().code], [409, 'IDEMPOTENCY_CONFLICT'], conflito.body);
    const novos = await prisma().auditLog.findMany({ where: { cliente_id: s.c, id: { notIn: auditAntes.map((x) => x.id) } } });
    assert.equal(novos.length, 1, 'o reenvio conflitante é auditado (uma linha)');
    assert.ok(JSON.stringify(novos[0].dados_novos).includes(corpo.operation_id), 'a auditoria cita a chave');
    assert.equal(await estornos(), 1);

    // Chave NOVA no item já cancelado.
    const st = await recusa(s, () => A.cancelarItem(s.cancelador.token, ap.id, d.item_id, corpoCancelar(c, 'de novo')), [409, 'APONTAMENTO_ATIVIDADE_ITEM_STATUS_INVALIDO', undefined, undefined]);
    assert.equal(st.json().details.status, 'CANCELADO');
    await recusa(s, () => A.cancelarItem(s.cancelador.token, ap.id, d.item_id, corpoCancelar(d, 'de novo')), [409, VERSAO, undefined, undefined]);
    // Motivo curto e sem operation_id: 400 antes da transação.
    await recusa400(s, () => A.cancelarItem(s.cancelador.token, ap.id, d.item_id, corpoCancelar(c, 'ab')), 'motivo', 'motivo_curto', 'motivo curto');
    const semChave = corpoCancelar(c, 'sem chave');
    delete semChave.operation_id;
    await recusa400(s, () => A.cancelarItem(s.cancelador.token, ap.id, d.item_id, semChave), undefined, undefined, 'sem operation_id');
    await recusa400(s, () => A.cancelarItem(s.cancelador.token, ap.id, d.item_id, { ...corpoCancelar(c, 'com tenant'), cliente_id: s.c }), undefined, undefined, 'cliente_id');
    assert.equal(await estornos(), 1);
  });

  test('IT8: estorno bloqueado (fail-closed, nada alterado) — lote de origem Estornado (compra cancelada antes), unidade efetiva mudou (L↔KG; KG↔SACO não bloqueia), produto mudou de fazenda, movimento já estornado, fatias inconsistentes', async () => {
    const s = await montarItens(app);
    const compra = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '100.0000', preco: '5.00', dia: '2027-06-01' });
    const L = compra.lote_id;
    const ap = await s.apontamento();
    const d = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '12'));
    const item = itemNa(d, d.item_id);
    /** Mexe no banco por fora, confere a recusa EXATA (item e apontamento) e que nada mudou, e desfaz. */
    const bloqueadoPor = async (sujar, reason, limpar) => {
      await sujar();
      for (const [rotulo, pedir] of [
        ['item', () => A.cancelarItem(s.cancelador.token, ap.id, item.id, corpoCancelar(d, 'cancelar o item'))],
        ['apontamento', () => A.cancelarApontamento(s.cancelador.token, ap.id, corpoCancelar(d, 'cancelar tudo'))],
      ]) {
        const r = await recusa(s, pedir, [409, BLOQ, undefined, reason]);
        assert.deepEqual([r.json().details.item_id, r.json().details.item_ordem], [item.id, 1], `${reason} (${rotulo}): o item da recusa`);
      }
      await limpar();
    };
    const restaurarProduto = () => prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'L', empresa_id = ${s.e1.id} WHERE id = ${s.herbicida.id}`;
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'KG' WHERE id = ${s.herbicida.id}`, 'unidade_mudou', restaurarProduto);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "Produto" SET empresa_id = ${s.e2.id} WHERE id = ${s.herbicida.id}`, 'produto_mudou_de_fazenda', restaurarProduto);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET status = 'Estornada' WHERE id = ${item.movimento.id}`, 'movimento_estornado',
      () => prisma().$executeRaw`UPDATE "MovimentacaoEstoque" SET status = 'Ativa' WHERE id = ${item.movimento.id}`);
    await bloqueadoPor(() => prisma().$executeRaw`UPDATE "ApontamentoAtividadeItemConsumoLote" SET quantidade = 11 WHERE item_id = ${item.id}`, 'fatias_inconsistentes',
      () => prisma().$executeRaw`UPDATE "ApontamentoAtividadeItemConsumoLote" SET quantidade = 12 WHERE item_id = ${item.id}`);

    // Lote de origem 'Estornado': reposição por fora (o lote volta a 100) e a compra P3 é cancelada.
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_entrada WHERE id = ${L}`;
    await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = estoque_atual + 12 WHERE id = ${s.herbicida.id}`;
    const cancelCompra = await A.req('POST', `/operacoes-financeiras/${compra.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida ao fornecedor' });
    assert.equal(cancelCompra.statusCode, 200, cancelCompra.body);
    assert.deepEqual(await saldoLote(L), ['0.0000', 'Estornado']);
    for (const pedir of [
      () => A.cancelarItem(s.cancelador.token, ap.id, item.id, corpoCancelar(d, 'cancelar o item')),
      () => A.cancelarApontamento(s.cancelador.token, ap.id, corpoCancelar(d, 'cancelar tudo')),
    ]) {
      const r = await recusa(s, pedir, [409, BLOQ, undefined, 'lote_indisponivel_para_devolucao']);
      assert.deepEqual([r.json().details.lote_id, r.json().details.item_id, r.json().details.item_ordem], [L, item.id, 1]);
    }
    assert.equal((await itemDe(item.id)).status, 'CONFIRMADO');

    // KG ↔ SACO: a unidade EFETIVA é a mesma (kg) → o estorno segue.
    const adubo = await s.compraP3(s.e1, s.adubo, s.local2, { quantidade: '10.0000', preco: '3.00', dia: '2027-06-01' });
    const ap2 = await s.apontamento();
    const d2 = await adicionarOk(s.lancador.token, ap2.id, corpoProduto(ap2, s.adubo, s.local2, '4'));
    await prisma().$executeRaw`UPDATE "Produto" SET unidade_principal_estoque = 'SACO' WHERE id = ${s.adubo.id}`;
    const c2 = await cancelarItemOk(s.cancelador.token, ap2.id, d2.item_id, corpoCancelar(d2, 'unidade de cadastro trocada'));
    assert.equal(itemNa(c2, d2.item_id).status, 'CANCELADO');
    assert.deepEqual(await saldoLote(adubo.lote_id), ['10.0000', 'Disponivel']);
  });
});

// ═══ Cancelar o APONTAMENTO ═════════════════════════════════════════════════

describe('D-PROD-191 — cancelar o apontamento cancela e estorna todos os itens, tudo ou nada (I-q, D-2)', () => {
  test('IT9: 2 PRODUTO (produtos diferentes) + 1 SERVICO + 1 já cancelado → tudo CANCELADO (origem APONTAMENTO, o motivo do apontamento), 2 Entradas, estoque restaurado, auditoria 1 + 3; replay; sem operation_id → 400', async () => {
    const s = await montarItens(app);
    const herb = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '50.0000', preco: '5.00', dia: '2027-06-01' });
    const adub = await s.compraP3(s.e1, s.adubo, s.local2, { quantidade: '40.0000', preco: '3.00', dia: '2027-06-01' });
    let ap = await s.apontamento();
    ap = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '10'));
    const i1 = ap.item_id;
    ap = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.adubo, s.local2, '4'));
    const i2 = ap.item_id;
    ap = await adicionarOk(s.lancador.token, ap.id, corpoServico(ap, 'SERVICO', 'Diária de tratorista', '2', '150'));
    const i3 = ap.item_id;
    ap = await adicionarOk(s.lancador.token, ap.id, corpoServico(ap, 'OUTRO', 'Frete', '1', '80'));
    const i4 = ap.item_id;
    ap = await cancelarItemOk(s.cancelador.token, ap.id, i4, corpoCancelar(ap, 'frete pago por fora'));
    const canceladoAntes = await itemDe(i4);
    assert.deepEqual([await estoqueAtual(s.herbicida), await estoqueAtual(s.adubo)], ['40.0000', '36.0000']);
    assert.deepEqual(ap.custo_itens, { total: '362.0000', produto: '62.0000', servico: '300.0000', outro: '0.0000', itens_confirmados: 3 });

    // D-2: sem operation_id → 400, nada gravado.
    const semChave = corpoCancelar(ap, 'sem chave');
    delete semChave.operation_id;
    await recusa400(s, () => A.cancelarApontamento(s.cancelador.token, ap.id, semChave), undefined, undefined, 'cancelar sem operation_id (D-2)');

    const corpo = corpoCancelar(ap, '  atividade lançada no dia errado  ');
    const c = await cancelarApontamentoOk(s.cancelador.token, ap.id, corpo);
    assert.equal(c.replay, false);
    assert.deepEqual([c.status, c.versao, c.cancelamento.motivo], ['CANCELADO', ap.versao + 1, 'atividade lançada no dia errado']);
    assert.deepEqual(c.custo_itens, CUSTO_ZERO);
    for (const id of [i1, i2, i3]) {
      const it = itemNa(c, id);
      assert.deepEqual([it.status, it.cancelamento.origem, it.cancelamento.motivo], ['CANCELADO', 'APONTAMENTO', 'atividade lançada no dia errado'], `item ${it.ordem}`);
      assert.deepEqual(it.cancelamento.cancelado_por, { id: s.cancelador.id, nome: s.cancelador.nome });
    }
    const quarto = itemNa(c, i4);
    assert.deepEqual([quarto.cancelamento.origem, quarto.cancelamento.motivo], ['ITEM', 'frete pago por fora'], 'o item já cancelado não é cancelado de novo');
    assert.deepEqual(await itemDe(i4), canceladoAntes, 'a linha do item já cancelado não muda');
    assert.ok(itemNa(c, i1).movimento_estorno && itemNa(c, i2).movimento_estorno, 'os 2 PRODUTO têm estorno');
    assert.equal(itemNa(c, i3).movimento_estorno, null);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: TIPO_ESTORNO } }), 2, '2 Entradas de estorno');
    assert.deepEqual([await saldoLote(herb.lote_id), await saldoLote(adub.lote_id)], [['50.0000', 'Disponivel'], ['40.0000', 'Disponivel']]);
    assert.deepEqual([await estoqueAtual(s.herbicida), await estoqueAtual(s.adubo)], ['50.0000', '40.0000']);
    for (const id of [i1, i2]) {
      const e = await movimentoDe(itemNa(c, id).movimento_estorno.id);
      assert.deepEqual([e.data_movimentacao.toISOString(), e.origem_sistema, e.tipo_detalhado], [INSTANTE_ESTORNO, ORIGEM, TIPO_ESTORNO]);
    }
    const doApontamento = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'apontamento_atividade.cancelar', entidade_id: ap.id } });
    assert.equal(doApontamento.length, 1);
    const dosItens = await prisma().auditLog.findMany({ where: { cliente_id: s.c, acao: 'apontamento_atividade.item_cancelar', entidade_id: { in: [i1, i2, i3] } } });
    assert.deepEqual(dosItens.map((x) => x.entidade).sort(), ['ApontamentoAtividadeItem', 'ApontamentoAtividadeItem', 'ApontamentoAtividadeItem'], 'um evento por item cancelado junto');
    assert.deepEqual(await A.ok(A.detalhe(s.token, ap.id, s.e1.id)), semExtras(c));

    // Replay: o corpo gravado, sem efeito novo; a mesma chave com outro motivo → 409.
    const antes = await foto(s.c);
    const replay = await cancelarApontamentoOk(s.cancelador.token, ap.id, corpo);
    assert.equal(replay.replay, true);
    assert.deepEqual(semExtras(replay), semExtras(c));
    assert.equal(await foto(s.c), antes);
    const conflito = await A.cancelarApontamento(s.cancelador.token, ap.id, { ...corpo, motivo: 'outro motivo' });
    assert.deepEqual([conflito.statusCode, conflito.json().code], [409, 'IDEMPOTENCY_CONFLICT']);
    await numeracaoLimpa(s);
    await coerente(s, s.herbicida, 'IT9 herbicida');
    await coerente(s, s.adubo, 'IT9 adubo');
  });

  test('IT9b: UM item com o estorno bloqueado (o 2º PRODUTO, lote de origem Estornado) → 409 ESTORNO_BLOQUEADO com o item e NADA muda — o outro PRODUTO e o SERVICO seguem CONFIRMADO, o apontamento também, estoque igual', async () => {
    const s = await montarItens(app);
    const herb = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '50.0000', preco: '5.00', dia: '2027-06-01' });
    const adub = await s.compraP3(s.e1, s.adubo, s.local2, { quantidade: '40.0000', preco: '3.00', dia: '2027-06-01' });
    let ap = await s.apontamento();
    ap = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '10'));
    const i1 = ap.item_id;
    ap = await adicionarOk(s.lancador.token, ap.id, corpoServico(ap, 'SERVICO', 'Diária', '1', '100'));
    ap = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.adubo, s.local2, '4'));
    const i3 = ap.item_id;
    // O lote do adubo volta a 40 por fora e a compra é cancelada: a devolução do 3º item não tem para onde ir.
    await prisma().$executeRaw`UPDATE "EstoqueLoteNota" SET quantidade_disponivel = quantidade_entrada WHERE id = ${adub.lote_id}`;
    await prisma().$executeRaw`UPDATE "Produto" SET estoque_atual = estoque_atual + 4 WHERE id = ${s.adubo.id}`;
    assert.equal((await A.req('POST', `/operacoes-financeiras/${adub.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida' })).statusCode, 200);

    const r = await recusa(s, () => A.cancelarApontamento(s.cancelador.token, ap.id, corpoCancelar(ap, 'cancelar tudo')), [409, BLOQ, undefined, 'lote_indisponivel_para_devolucao']);
    assert.deepEqual([r.json().details.item_id, r.json().details.item_ordem, r.json().details.lote_id], [i3, 3, adub.lote_id]);
    const det = await A.ok(A.detalhe(s.token, ap.id, s.e1.id));
    assert.deepEqual([det.status, det.versao], ['CONFIRMADO', ap.versao]);
    assert.deepEqual(det.itens.map((i) => i.status), ['CONFIRMADO', 'CONFIRMADO', 'CONFIRMADO'], 'nenhum item cancelado em parte');
    assert.deepEqual(await saldoLote(herb.lote_id), ['40.0000', 'Disponivel'], 'o 1º PRODUTO não foi estornado');
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: TIPO_ESTORNO } }), 0);
    assert.equal(await prisma().auditLog.count({ where: { cliente_id: s.c, acao: { in: ['apontamento_atividade.cancelar', 'apontamento_atividade.item_cancelar'] } } }), 0);
    assert.equal((await itemDe(i1)).status, 'CONFIRMADO');
  });
});

// ═══ Isolamento ═════════════════════════════════════════════════════════════

describe('D-PROD-191 — isolamento por tenant e por fazenda (I-t)', () => {
  test('IT11: outro tenant não lê, não adiciona e não cancela item de A (404 com o corpo do id inexistente); opções de B só com B; a fazenda 2 não alcança o apontamento da 1; item de OUTRO apontamento = inexistente', async () => {
    const s = await montarItens(app);
    const B = await montarItens(app);
    await doisLotes(s);
    await B.compraP3(B.e1, B.herbicida, B.local2, { quantidade: '10.0000', preco: '5.00', dia: '2027-06-01' });
    const ap = await s.apontamento();
    const d = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '3'));
    const apB = await B.apontamento();
    const fotoA = await foto(s.c);

    // B, com a SUA fazenda no corpo: o apontamento de A não existe (o mesmo corpo de um id inventado).
    const nf = 'APONTAMENTO_ATIVIDADE_NOT_FOUND';
    const inventado = await A.detalhe(B.token, 'apontamento-inventado', B.e1.id);
    for (const r of [
      await A.detalhe(B.token, ap.id, B.e1.id),
      await A.adicionar(B.token, ap.id, corpoServico({ empresa_id: B.e1.id, versao: 2 }, 'SERVICO', 'invasão', '1', '1')),
      await A.adicionar(B.token, ap.id, corpoProduto({ empresa_id: B.e1.id, versao: 2 }, B.herbicida, B.local2, '1')),
      await A.cancelarItem(B.token, ap.id, d.item_id, corpoCancelar({ empresa_id: B.e1.id, versao: 2 }, 'invasão')),
    ]) {
      assert.deepEqual([r.statusCode, r.json().code], [404, nf], r.body);
      if (r.json().code === nf) assert.deepEqual(corpoErro(r), corpoErro(inventado), 'sem oráculo');
    }
    // A fazenda de A no corpo de B: a empresa não existe no tenant de B.
    for (const r of [
      await A.detalhe(B.token, ap.id, s.e1.id),
      await A.adicionar(B.token, ap.id, corpoServico({ empresa_id: s.e1.id, versao: 2 }, 'SERVICO', 'invasão', '1', '1')),
      await A.cancelarItem(B.token, ap.id, d.item_id, corpoCancelar({ empresa_id: s.e1.id, versao: 2 }, 'invasão')),
    ]) assert.deepEqual([r.statusCode, r.json().code], [404, 'EMPRESA_NOT_FOUND'], r.body);
    // Item de A no apontamento de B: item inexistente (mesmo corpo do inventado).
    const itemInventado = await A.cancelarItem(B.token, apB.id, 'item-inventado', corpoCancelar(apB, 'invasão'));
    const itemDeA = await A.cancelarItem(B.token, apB.id, d.item_id, corpoCancelar(apB, 'invasão'));
    assert.deepEqual([itemDeA.statusCode, itemDeA.json().code], [404, 'APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND'], itemDeA.body);
    assert.deepEqual(corpoErro(itemDeA), corpoErro(itemInventado));
    assert.equal(await foto(s.c), fotoA, 'nada de A mudou');

    // Opções: B vê só os seus produtos; o local com saldo do produto de A → 404 PRODUTO_NOT_FOUND.
    const prodB = await A.ok(A.opcoes(B.token, 'produtos', `empresa_id=${B.e1.id}&limit=100`));
    const idsA = new Set([s.herbicida.id, s.adubo.id, s.sal.id, s.diesel.id]);
    assert.ok(prodB.itens.length > 0 && prodB.itens.every((x) => !idsA.has(x.id)), 'nenhum produto de A');
    const locB = await A.opcoes(B.token, 'locais', `empresa_id=${B.e1.id}&produto_id=${s.herbicida.id}`);
    assert.deepEqual([locB.statusCode, locB.json().code], [404, 'PRODUTO_NOT_FOUND'], locB.body);
    assert.deepEqual((await A.ok(A.opcoes(B.token, 'locais', `empresa_id=${B.e1.id}&produto_id=${B.herbicida.id}`))).itens.map((x) => [x.local_estoque_id, x.disponivel]), [[B.local2.id, '10.0000']]);

    // Mesmo tenant: com a fazenda 2 o apontamento da 1 não existe; item de OUTRO apontamento também não.
    await recusa(s, () => A.adicionar(s.lancador.token, ap.id, corpoServico({ empresa_id: s.e2.id, versao: 2 }, 'SERVICO', 'fazenda errada', '1', '1')), [404, nf, undefined, undefined]);
    await recusa(s, () => A.cancelarItem(s.cancelador.token, ap.id, d.item_id, corpoCancelar({ empresa_id: s.e2.id, versao: 2 }, 'fazenda errada')), [404, nf, undefined, undefined]);
    const outro = await s.apontamento();
    const inventadoA = await recusa(s, () => A.cancelarItem(s.cancelador.token, outro.id, 'item-inventado', corpoCancelar(outro, 'errado')), [404, 'APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND', undefined, undefined]);
    const deOutroAp = await recusa(s, () => A.cancelarItem(s.cancelador.token, outro.id, d.item_id, corpoCancelar(outro, 'errado')), [404, 'APONTAMENTO_ATIVIDADE_ITEM_NOT_FOUND', undefined, undefined]);
    assert.deepEqual(corpoErro(deOutroAp), corpoErro(inventadoA));
    // Produto da fazenda 2 no local: opções da fazenda 1 não o mostram.
    const prodA = await A.ok(A.opcoes(s.lancador.token, 'produtos', `empresa_id=${s.e1.id}&limit=100`));
    const ids = prodA.itens.map((x) => x.id);
    assert.ok(ids.includes(s.herbicida.id) && !ids.includes(s.herbicida2.id) && !ids.includes(s.inativo.id), 'produtos ATIVOS da fazenda');
    const p = prodA.itens.find((x) => x.id === s.herbicida.id);
    assert.deepEqual(Object.keys(p).sort(), ['estoque_atual', 'id', 'nome', 'numero', 'peso_por_saco_kg', 'unidade_principal_estoque']);
    const loc = await A.ok(A.opcoes(s.lancador.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${s.herbicida.id}`));
    assert.deepEqual(loc.itens, [{ local_estoque_id: s.local2.id, local_nome: s.local2.nome, disponivel: '27.0000', unidade: 'L', unidade_principal_estoque: 'L' }]);
    const loc2 = await A.opcoes(s.lancador.token, 'locais', `empresa_id=${s.e1.id}&produto_id=${s.herbicida2.id}`);
    assert.deepEqual([loc2.statusCode, loc2.json().code], [404, 'PRODUTO_NOT_FOUND'], 'produto de outra fazenda');
  });
});

// ═══ Reconciliação ══════════════════════════════════════════════════════════

/** Relatório da reconciliação (administrador do tenant) filtrado pelo produto. */
const reconciliar = async (s, produto) => A.ok(A.reconciliacao(s.token, `empresa_id=${s.e1.id}&produto_id=${produto.id}`));
const regras = (rel) => rel.achados.map((a) => [a.nivel, a.classe, a.regra]);

describe('D-PROD-191 — reconciliação reconhece a origem nova e as fatias FK (I-y)', () => {
  test('IT12: depois da baixa e do estorno a reconciliação fecha (sem DIVERGENCIA_REAL, sem origem fora do protocolo; Σ fatias FK = movimento); fatia adulterada é DIVERGÊNCIA no movimento e no lote; item cancelado não conta consumo', async () => {
    const s = await montarItens(app);
    const { B: loteB } = await doisLotes(s);
    const ap = await s.apontamento();
    const d = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '12'));
    const item = itemNa(d, d.item_id);

    const r1 = await reconciliar(s, s.herbicida);
    assert.deepEqual(regras(r1), [], `depois da baixa, nenhum achado: ${JSON.stringify(r1.achados)}`);
    assert.equal(r1.resumo.situacao, 'CONSISTENTE');

    // Adulteração das fatias FK (por fora, desfeita): o reconciliador LÊ a tabela nova no lote e no movimento.
    await prisma().$executeRaw`UPDATE "ApontamentoAtividadeItemConsumoLote" SET quantidade = 3 WHERE item_id = ${item.id} AND ordem = 2`;
    try {
      const sujo = await reconciliar(s, s.herbicida);
      const achados = regras(sujo);
      assert.ok(achados.some(([nivel, classe, regra]) => nivel === 'movimento' && classe === 'DIVERGENCIA_REAL' && regra === 'fatias_divergem_da_quantidade'), JSON.stringify(sujo.achados));
      assert.ok(sujo.achados.some((a) => a.nivel === 'lote' && a.classe === 'DIVERGENCIA_REAL' && a.regra === 'consumo_nao_explicado' && a.chave.lote_id === loteB), JSON.stringify(sujo.achados));
    } finally {
      await prisma().$executeRaw`UPDATE "ApontamentoAtividadeItemConsumoLote" SET quantidade = 2 WHERE item_id = ${item.id} AND ordem = 2`;
    }

    await cancelarItemOk(s.cancelador.token, ap.id, item.id, corpoCancelar(d, 'lançado errado'));
    const r2 = await reconciliar(s, s.herbicida);
    assert.deepEqual(regras(r2), [], `depois do estorno, nenhum achado (o item cancelado não conta consumo): ${JSON.stringify(r2.achados)}`);
    assert.equal(r2.resumo.situacao, 'CONSISTENTE');
    for (const a of [...r1.achados, ...r2.achados]) assert.notEqual(a.regra, 'origem_fora_do_protocolo');
  });
});

// ═══ X1, exclusões e proveniência ═══════════════════════════════════════════

describe('D-PROD-191 — lote imutável (X1), exclusões e proveniência da compra (I-x, R7)', () => {
  test('IT13: PATCH/DELETE do lote consumido pelo item → 409 REGISTRO_OPERACIONAL_IMUTAVEL (vinculo apontamento_atividade), também depois do estorno; DELETE do Produto e do Local → 409 (nunca 403); a compra cujo lote o item consumiu não retifica nem exclui, mesmo depois do estorno', async () => {
    const s = await montarItens(app);
    // Lote sem vínculo financeiro (legado), para o vínculo do item ser o único.
    const consumido = await s.lote(s.e1, s.adubo, s.local, { quantidade: '10.0000', custo: '3.0000', dia: '2027-06-01' });
    const livre = await s.lote(s.e1, s.sal, s.local, { quantidade: '10.0000', custo: '3.0000', dia: '2027-06-01' });
    const ap = await s.apontamento();
    const d = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.adubo, s.local, '4'));
    const x1 = async (rotulo) => {
      const antes = await foto(s.c);
      const patch = await A.req('PATCH', `/estoque-lotes-nota/${consumido.id}`, s.token, { quantidade_disponivel: 1000 });
      assert.deepEqual([patch.statusCode, patch.json().code, patch.json().details?.vinculo], [409, 'REGISTRO_OPERACIONAL_IMUTAVEL', 'apontamento_atividade'], `${rotulo} PATCH: ${patch.body}`);
      const del = await A.req('DELETE', `/estoque-lotes-nota/${consumido.id}`, s.token);
      assert.deepEqual([del.statusCode, del.json().code, del.json().details?.vinculo], [409, 'REGISTRO_OPERACIONAL_IMUTAVEL', 'apontamento_atividade'], `${rotulo} DELETE: ${del.body}`);
      assert.equal(await foto(s.c), antes, `${rotulo}: nada alterado`);
    };
    await x1('confirmado');
    // Controle: o lote livre recusa pela regra geral (outro código), não pelo vínculo do item.
    const livrePatch = await A.req('PATCH', `/estoque-lotes-nota/${livre.id}`, s.token, { quantidade_disponivel: 1000 });
    assert.deepEqual([livrePatch.statusCode, livrePatch.json().code], [409, 'ESTOQUE_ESCRITA_DIRETA_RECUSADA'], livrePatch.body);

    for (const [url, entidade] of [[`/produtos/${s.adubo.id}`, 'produto'], [`/locais-estoque/${s.local.id}`, 'local']]) {
      const r = await A.req('DELETE', url, s.token);
      assert.equal(r.statusCode, 409, `${entidade}: ${r.body}`);
    }
    assert.equal(await prisma().produto.count({ where: { id: s.adubo.id } }), 1);
    assert.equal(await prisma().localEstoque.count({ where: { id: s.local.id } }), 1);

    await cancelarItemOk(s.cancelador.token, ap.id, d.item_id, corpoCancelar(d, 'estorno para o X1'));
    assert.deepEqual(await saldoLote(consumido.id), ['10.0000', 'Disponivel']);
    await x1('cancelado (o histórico da fatia fica)');

    // Gestão P3 (R7): a compra cujo lote o item consumiu.
    const compra = await s.compraP3(s.e1, s.herbicida, s.local2, { quantidade: '100.0000', preco: '5.00', dia: '2027-06-01' });
    const ap2 = await s.apontamento();
    const d2 = await adicionarOk(s.lancador.token, ap2.id, corpoProduto(ap2, s.herbicida, s.local2, '12'));
    const mov = itemNa(d2, d2.item_id).movimento;
    const detalheCompra = () => A.ok(A.req('GET', `/operacoes-financeiras/${compra.operacao.id}?empresa_id=${s.e1.id}`, s.token));
    const bloqueiosP3 = async (rotulo) => {
      const atual = await detalheCompra();
      const doc = await s.docCompraP3(s.e1, s.herbicida, s.local2, { quantidade: '90.0000', preco: '5.00', dia: '2027-06-01' });
      const ret = await A.req('POST', `/operacoes-financeiras/${atual.id}/retificar`, s.token, { ...doc, versao: atual.versao, operation_id: opId(), motivo: 'quantidade corrigida' });
      assert.deepEqual([ret.statusCode, ret.json().code, ret.json().details?.reason ?? ret.json().reason], [409, 'OPERACAO_RETIFICACAO_BLOQUEADA', 'lote_consumido'], `${rotulo}: ${ret.body}`);
      assert.ok((ret.json().details?.motivos ?? []).some((m) => m.codigo === 'lote_consumido' && m.entidade === 'MovimentacaoEstoque' && m.numero === mov.numero), `${rotulo}: a recusa cita o movimento do item: ${ret.body}`);
      const exc = await A.req('POST', `/operacoes-financeiras/${atual.id}/excluir`, s.token, { empresa_id: s.e1.id, versao: atual.versao, operation_id: opId(), motivo: 'lançamento indevido' });
      assert.deepEqual([exc.statusCode, exc.json().code, exc.json().details?.reason ?? exc.json().reason], [409, 'OPERACAO_EXCLUSAO_BLOQUEADA', 'lote_consumido'], `${rotulo}: ${exc.body}`);
    };
    const antesP3 = await foto(s.c);
    await bloqueiosP3('confirmado');
    const cancel1 = await A.req('POST', `/operacoes-financeiras/${compra.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida' });
    assert.deepEqual(erro(cancel1).slice(0, 2), [409, 'ESTOQUE_JA_CONSUMIDO'], cancel1.body);
    assert.equal(await foto(s.c), antesP3, 'nenhuma recusa da P3 mexeu no estoque nem no item');
    await cancelarItemOk(s.cancelador.token, ap2.id, d2.item_id, corpoCancelar(d2, 'devolvido ao estoque'));
    await bloqueiosP3('estornado (a proveniência lê lotes_consumidos)');
    const cancel2 = await A.req('POST', `/operacoes-financeiras/${compra.operacao.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'compra devolvida' });
    assert.equal(cancel2.statusCode, 200, cancel2.body);
    assert.deepEqual(await saldoLote(compra.lote_id), ['0.0000', 'Estornado']);
  });
});

// ═══ Código antes da migration (I-z) ════════════════════════════════════════

const TABELAS_NOVAS = Object.freeze(['ApontamentoAtividadeItem', 'ApontamentoAtividadeItemConsumoLote']);
/** Troca o nome das 2 tabelas novas durante `fn` (código no ar antes da migration) e o devolve no fim. */
const semTabelasDosItens = async (fn) => {
  for (const t of TABELAS_NOVAS) await prisma().$executeRawUnsafe(`ALTER TABLE "${t}" RENAME TO "${t}_iz_tmp"`);
  try {
    await fn();
  } finally {
    for (const t of TABELAS_NOVAS) await prisma().$executeRawUnsafe(`ALTER TABLE "${t}_iz_tmp" RENAME TO "${t}"`);
  }
};

describe('D-PROD-191 — runtime novo com schema antigo (I-z, lição do hotfix #259)', () => {
  test('IT14: sem as 2 tabelas novas, a guarda do lote (PATCH/DELETE) e a reconciliação respondem sem 500; fora do módulo, só elas citam as tabelas novas, e com to_regclass', async () => {
    const s = await montarItens(app);
    const consumido = await s.lote(s.e1, s.adubo, s.local, { quantidade: '10.0000', custo: '3.0000', dia: '2027-06-01' });
    await doisLotes(s);
    const ap = await s.apontamento();
    await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.adubo, s.local, '4'));
    await semTabelasDosItens(async () => {
      const [r] = /** @type {any[]} */ (await prisma().$queryRaw`SELECT to_regclass('public."ApontamentoAtividadeItemConsumoLote"') IS NULL AS sumiu`);
      assert.equal(r.sumiu, true, 'a tabela "não existe" para o catálogo');
      const patch = await A.req('PATCH', `/estoque-lotes-nota/${consumido.id}`, s.token, { quantidade_disponivel: 1000 });
      assert.deepEqual([patch.statusCode, patch.json().code], [409, 'ESTOQUE_ESCRITA_DIRETA_RECUSADA'], `sem a tabela, a contagem é 0 e vale a regra geral: ${patch.body}`);
      const del = await A.req('DELETE', `/estoque-lotes-nota/${consumido.id}`, s.token);
      assert.ok(del.statusCode < 500, `DELETE do lote sem 500: ${del.body}`);
      for (const produto of [s.herbicida, s.adubo]) {
        const rec = await A.reconciliacao(s.token, `empresa_id=${s.e1.id}&produto_id=${produto.id}`);
        assert.equal(rec.statusCode, 200, `reconciliação sem 500: ${rec.body}`);
      }
      const geral = await A.reconciliacao(s.token, `empresa_id=${s.e1.id}`);
      assert.equal(geral.statusCode, 200, geral.body);
    });
    // A tabela voltou: o vínculo volta a valer.
    const depois = await A.req('PATCH', `/estoque-lotes-nota/${consumido.id}`, s.token, { quantidade_disponivel: 1000 });
    assert.deepEqual([depois.json().code, depois.json().details?.vinculo], ['REGISTRO_OPERACIONAL_IMUTAVEL', 'apontamento_atividade']);

    // Estático: fora do módulo do apontamento, só a reconciliação e a guarda do lote citam as tabelas novas — com to_regclass.
    const raiz = new URL('../src/', import.meta.url);
    const arquivos = /** @type {string[]} */ (readdirSync(raiz, { recursive: true })).filter((f) => /\.(m?js)$/.test(f));
    const cita = /apontamentoAtividadeItem(ConsumoLote)?\s*\.|"ApontamentoAtividadeItem(ConsumoLote)?"/;
    const fora = arquivos.map((f) => f.replaceAll('\\', '/')).filter((f) => !f.startsWith('modules/apontamentosAtividade/') && cita.test(readFileSync(new URL(f, raiz), 'utf8'))).sort();
    assert.deepEqual(fora, ['modules/estoqueFisico/reconciliacaoEstoque.js', 'modules/estoqueLotesNota/estoqueLoteNotaService.js']);
    for (const f of fora) {
      assert.ok(readFileSync(new URL(f, raiz), 'utf8').includes(`to_regclass('public."ApontamentoAtividadeItemConsumoLote"')`), `${f}: confere a tabela no catálogo antes`);
    }
  });
});

// ═══ O banco é a última rede ════════════════════════════════════════════════

describe('D-PROD-191 — o banco: CHECKs, FKs RESTRICT, RLS sem FORCE (T15)', () => {
  test('IT15a: 7 CHECKs e 11 FKs RESTRICT nas 2 tabelas; inserção direta inválida recusada (PRODUTO sem movimento, SERVICO com produto, CANCELADO sem motivo, origem fora do domínio, tipo fora, estorno = movimento, fatia zero)', async () => {
    const s = await montarItens(app);
    await doisLotes(s);
    const ap = await s.apontamento();
    const d = await adicionarOk(s.lancador.token, ap.id, corpoProduto(ap, s.herbicida, s.local2, '1'));
    const movId = itemNa(d, d.item_id).movimento.id;
    const p = prisma();
    const checks = /** @type {any[]} */ (await p.$queryRaw`SELECT conrelid::regclass::text AS tabela, conname FROM pg_constraint
      WHERE contype = 'c' AND conrelid IN ('public."ApontamentoAtividadeItem"'::regclass, 'public."ApontamentoAtividadeItemConsumoLote"'::regclass) ORDER BY 2`);
    assert.deepEqual(checks.map((c) => c.conname), [
      'ApontamentoAtividadeItemConsumoLote_valores_check', 'ApontamentoAtividadeItem_forma_check', 'ApontamentoAtividadeItem_movimentos_check',
      'ApontamentoAtividadeItem_status_check', 'ApontamentoAtividadeItem_textos_check', 'ApontamentoAtividadeItem_tipo_check', 'ApontamentoAtividadeItem_valores_check',
    ]);
    const fks = /** @type {any[]} */ (await p.$queryRaw`SELECT conname, confdeltype::text AS del FROM pg_constraint
      WHERE contype = 'f' AND conrelid IN ('public."ApontamentoAtividadeItem"'::regclass, 'public."ApontamentoAtividadeItemConsumoLote"'::regclass) ORDER BY 1`);
    assert.equal(fks.length, 11);
    assert.deepEqual([...new Set(fks.map((f) => f.del))], ['r'], 'todas RESTRICT');
    for (const nome of ['ApontamentoAtividadeItem_apontamento_fkey', 'ApontamentoAtividadeItem_movimentacao_fkey', 'ApontamentoAtividadeItem_estorno_fkey', 'ApontamentoAtividadeItemConsumoLote_item_fkey', 'ApontamentoAtividadeItemConsumoLote_lote_fkey']) {
      assert.ok(fks.some((f) => f.conname === nome), nome);
    }

    let n = 0;
    const base = () => ({
      id: `it-dir-${(n += 1)}-${randomUUID().slice(0, 6)}`, cliente_id: s.c, empresa_id: s.e1.id, apontamento_id: ap.id, ordem: 100 + n, quantidade: '1', valor_unitario: '1',
      valor_total: '1', operation_id: `direto-${randomUUID()}`, status: 'CONFIRMADO',
    });
    /** O PostgreSQL confere os CHECKs em ordem de nome: com mais de um violado, vale o primeiro da lista dada. */
    const recusada = async (dados, ...constraints) => {
      await assert.rejects(p.apontamentoAtividadeItem.create({ data: dados }), (e) => constraints.some((c) => `${e?.message} ${JSON.stringify(e?.meta ?? {})}`.includes(c)), constraints.join(' | '));
    };
    const antes = await foto(s.c);
    await recusada({ ...base(), tipo: 'PRODUTO', produto_id: s.herbicida.id, local_estoque_id: s.local2.id, unidade: 'L' }, 'ApontamentoAtividadeItem_forma_check');
    await recusada({ ...base(), tipo: 'SERVICO', descricao: 'x', produto_id: s.herbicida.id }, 'ApontamentoAtividadeItem_forma_check');
    await recusada({ ...base(), tipo: 'OUTRO', descricao: '   ' }, 'ApontamentoAtividadeItem_forma_check');
    await recusada({ ...base(), tipo: 'MANUAL', descricao: 'x' }, 'ApontamentoAtividadeItem_forma_check', 'ApontamentoAtividadeItem_tipo_check');
    await recusada({ ...base(), tipo: 'SERVICO', descricao: 'x', status: 'CANCELADO', cancelado_em: new Date(), cancelamento_origem: 'ITEM' }, 'ApontamentoAtividadeItem_status_check');
    await recusada({ ...base(), tipo: 'SERVICO', descricao: 'x', status: 'CANCELADO', cancelado_em: new Date(), motivo_cancelamento: 'motivo', cancelamento_origem: 'XYZ' }, 'ApontamentoAtividadeItem_status_check');
    await recusada({ ...base(), tipo: 'SERVICO', descricao: 'x', valor_total: '0' }, 'ApontamentoAtividadeItem_valores_check');
    await recusada({ ...base(), tipo: 'SERVICO', descricao: 'x', operation_id: 'curto' }, 'ApontamentoAtividadeItem_textos_check');
    await recusada({ ...base(), tipo: 'PRODUTO', produto_id: s.herbicida.id, local_estoque_id: s.local2.id, unidade: 'L', movimentacao_estoque_id: movId, movimentacao_estorno_id: movId, status: 'CANCELADO', cancelado_em: new Date(), motivo_cancelamento: 'motivo', cancelamento_origem: 'ITEM' }, 'ApontamentoAtividadeItem_movimentos_check');
    await assert.rejects(
      p.apontamentoAtividadeItemConsumoLote.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, item_id: d.item_id, estoque_lote_nota_id: (await fatiasDe(d.item_id))[0][1], ordem: 9, quantidade: '0', custo_unitario: '1' } }),
      (e) => String(e?.message).includes('ApontamentoAtividadeItemConsumoLote_valores_check')
    );
    // FK composta: apontamento de OUTRA fazenda (empresa do item ≠ empresa do apontamento) é recusado.
    await assert.rejects(p.apontamentoAtividadeItem.create({ data: { ...base(), empresa_id: s.e2.id, tipo: 'SERVICO', descricao: 'x' } }), (e) => e?.code === 'P2003');
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // Controle positivo: a mesma linha, coerente, entra.
    const ok = await p.apontamentoAtividadeItem.create({ data: { ...base(), tipo: 'SERVICO', descricao: 'direto' } });
    assert.equal(ok.status, 'CONFIRMADO');
  });

  test('IT15b: RLS ligado sem FORCE e zero grants para PUBLIC/anon/authenticated nas 2 tabelas; o DO EXATO da migration revoga o GRANT hostil e cria maike_backend_all só para maike_vercel (transação desfeita)', async () => {
    const p = prisma();
    for (const T of TABELAS_NOVAS) {
      const [rls] = /** @type {any[]} */ (await p.$queryRaw`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname = ${T}`);
      assert.deepEqual([rls.relrowsecurity, rls.relforcerowsecurity], [true, false], T);
      const grants = /** @type {any[]} */ (await p.$queryRaw`
        SELECT a.grantee::regrole::text AS grantee, a.privilege_type
          FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
         WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ${T}
           AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated')))`);
      assert.deepEqual(grants, [], `${T}: nenhum privilégio para PUBLIC, anon ou authenticated`);
    }
    const sql = readFileSync(new URL('../prisma/migrations/20261113800000_apontamento_atividade_item/migration.sql', import.meta.url), 'utf8');
    const blocos = (sql.match(/^DO \$\$[\s\S]*?^END \$\$;/gm) ?? []).filter((b) => b.includes("pol_name constant text := 'maike_backend_all'"));
    assert.equal(blocos.length, 1, 'a migration tem exatamente um bloco DO de REVOKE/RLS');
    assert.ok(blocos[0].includes("ARRAY['ApontamentoAtividadeItem','ApontamentoAtividadeItemConsumoLote']"), 'o DO cobre exatamente as 2 tabelas novas');
    const PRIVS = 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER';
    const papeisAntes = /** @type {any[]} */ (await p.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'maike_vercel') ORDER BY 1`);
    const DESFAZER = new Error('rollback proposital do IT15b');
    /** @type {any} */
    let visto = null;
    const pode = async (tx) => {
      const linhas = [];
      for (const T of TABELAS_NOVAS) {
        for (const papel of ['anon', 'authenticated']) {
          const [r] = /** @type {any[]} */ (await tx.$queryRawUnsafe(`SELECT has_table_privilege('${papel}', 'public."${T}"', '${PRIVS}') AS pode`));
          linhas.push([T, papel, r.pode]);
        }
      }
      return linhas;
    };
    await p
      .$transaction(async (tx) => {
        for (const papel of ['anon', 'authenticated', 'maike_vercel']) {
          await tx.$executeRawUnsafe(`DO $papel$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${papel}') THEN CREATE ROLE ${papel} NOLOGIN; END IF; END $papel$`);
        }
        for (const T of TABELAS_NOVAS) await tx.$executeRawUnsafe(`GRANT ALL ON TABLE public."${T}" TO anon, authenticated`);
        const controle = await pode(tx);
        await tx.$executeRawUnsafe(blocos[0]);
        const depois = await pode(tx);
        const politicas = /** @type {any[]} */ (await tx.$queryRaw`SELECT tablename, cmd, array_to_string(roles, ',') AS roles, qual, with_check FROM pg_policies
          WHERE schemaname = 'public' AND policyname = 'maike_backend_all' AND tablename IN ('ApontamentoAtividadeItem', 'ApontamentoAtividadeItemConsumoLote') ORDER BY 1`);
        visto = { controle, depois, politicas };
        throw DESFAZER;
      }, { timeout: 20000 })
      .catch((e) => {
        if (e !== DESFAZER) throw e;
      });
    assert.ok(visto, 'a transação chegou ao fim');
    assert.ok(visto.controle.every((x) => x[2] === true), 'controle negativo: o GRANT simulado vale antes do DO');
    assert.ok(visto.depois.every((x) => x[2] === false), 'o DO revoga anon/authenticated nas 2 tabelas');
    assert.deepEqual(visto.politicas.map((x) => [x.tablename, x.cmd, x.roles, x.qual, x.with_check]), TABELAS_NOVAS.map((t) => [t, 'ALL', 'maike_vercel', 'true', 'true']));
    const papeisDepois = /** @type {any[]} */ (await p.$queryRaw`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'maike_vercel') ORDER BY 1`);
    assert.deepEqual(papeisDepois, papeisAntes, 'nenhum papel criado sobrevive ao ROLLBACK');
  });
});

// ═══ Permissões ═════════════════════════════════════════════════════════════

describe('D-PROD-191 — permissões da tela op-apontamentos-atividade, sem ação nova (D-3)', () => {
  test('IT16: visualizar lê o detalhe e os produtos; "editar" e "salvar" lançam item e veem os locais com saldo; "excluir" cancela item; "novo" não lança item; sem a linha, 403 em tudo; nada gravado no 403', async () => {
    const s = await montarItens(app);
    await doisLotes(s);
    const ap = await s.apontamento();
    const leitor = await s.contaApontamento({});
    const novo = await s.contaApontamento({ novo: true });
    const salvar = await s.contaApontamento({ salvar: true });
    const semLinha = await s.conta(null);
    const nego = async (pedir, rotulo) => {
      const antes = await foto(s.c);
      const r = await pedir();
      assert.deepEqual([r.statusCode, r.json().code], [403, 'ACAO_NAO_PERMITIDA'], `${rotulo}: ${r.body}`);
      assert.equal(await foto(s.c), antes, `${rotulo}: nada gravado`);
    };
    const locais = (tok) => A.opcoes(tok, 'locais', `empresa_id=${s.e1.id}&produto_id=${s.herbicida.id}`);
    const produtos = (tok) => A.opcoes(tok, 'produtos', `empresa_id=${s.e1.id}`);
    let atual = ap;

    // Leitor: lê; não lança, não cancela, não vê saldo por local.
    assert.equal((await A.detalhe(leitor.token, ap.id, s.e1.id)).statusCode, 200);
    assert.equal((await produtos(leitor.token)).statusCode, 200);
    await nego(() => locais(leitor.token), 'visualizar não vê saldo por local');
    await nego(() => A.adicionar(leitor.token, ap.id, corpoServico(atual, 'SERVICO', 'x', '1', '1')), 'visualizar não lança');
    // "novo" não lança item (só cria apontamento).
    await nego(() => A.adicionar(novo.token, ap.id, corpoServico(atual, 'SERVICO', 'x', '1', '1')), 'novo não lança item');
    await nego(() => locais(novo.token), 'novo não vê saldo por local');
    // editar e salvar lançam e veem os locais.
    for (const conta of [s.lancador, salvar]) {
      assert.equal((await locais(conta.token)).statusCode, 200);
      atual = await adicionarOk(conta.token, ap.id, corpoProduto(atual, s.herbicida, s.local2, '1'));
      assert.equal(itemNa(atual, atual.item_id).criado_por.id, conta.id);
      await nego(() => A.cancelarItem(conta.token, ap.id, atual.item_id, corpoCancelar(atual, 'sem permissão')), 'editar/salvar não cancelam item');
    }
    // excluir cancela item; não lança.
    await nego(() => A.adicionar(s.cancelador.token, ap.id, corpoServico(atual, 'SERVICO', 'x', '1', '1')), 'excluir não lança');
    await nego(() => locais(s.cancelador.token), 'excluir não vê saldo por local');
    atual = await cancelarItemOk(s.cancelador.token, ap.id, atual.item_id, corpoCancelar(atual, 'cancelado por quem pode'));
    // Sem linha: 403 em tudo.
    for (const [rotulo, pedir] of [
      ['detalhe', () => A.detalhe(semLinha.token, ap.id, s.e1.id)],
      ['produtos', () => produtos(semLinha.token)],
      ['locais', () => locais(semLinha.token)],
      ['adicionar', () => A.adicionar(semLinha.token, ap.id, corpoServico(atual, 'SERVICO', 'x', '1', '1'))],
      ['cancelar item', () => A.cancelarItem(semLinha.token, ap.id, atual.itens[0].id, corpoCancelar(atual, 'sem linha'))],
    ]) await nego(pedir, `sem linha / ${rotulo}`);
    assert.equal((await A.adicionar(null, ap.id, corpoServico(atual, 'SERVICO', 'x', '1', '1'))).statusCode, 401, 'sem token');
  });
});
