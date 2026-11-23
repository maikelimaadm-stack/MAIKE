/**
 * D-PROD-273 (fatia 5) — EXCLUSÃO COM RECÁLCULO das ENTRADAS, contra PostgreSQL real e pelos serviços de verdade (HTTP
 * autenticado): entrada documentada (excluir), compra do financeiro (cancelar), cancelamento da transferência entre
 * depósitos e exclusão do ajuste de inventário. Com movimento depois no depósito, a entrada sai da sequência (a camada
 * dela fica 'Estornado', nunca apagada), quem consumiu dela volta a consumir das outras camadas pelo médio sem ela, e o
 * custo de tudo que veio depois é recalculado, com os dependentes. Saldo negativo em qualquer ponto → 409
 * `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO`, nada gravado. Sem estorno exato como saída. Números à mão em cada cenário; no fim de
 * cada um, o replay completo do produto bate com o gravado (`auditarReplayDoProduto`).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento, opId } from './patrimonioP1AbastecimentoCenario.mjs';
import { auditarReplayDoProduto } from '../src/modules/estoqueRecalculo/estoqueRecalculoService.js';
import { emLeituraSomente } from '../src/modules/estoqueRecalculo/estoqueRecalculoLeitor.js';
import { marcaDoPar } from '../src/modules/estoqueRecalculo/estoqueReplay.js';
import { chaveTravaProduto } from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
/** Cliente do TESTE (pool próprio) para segurar a trava do produto de fora do app. @type {PrismaClient} */
let aux;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
  aux = new PrismaClient();
});
after(async () => {
  await aux?.$disconnect();
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const hoje = () => new Date().toISOString().slice(0, 10);
const ok = (r, status = 200) => {
  assert.equal(r.statusCode, status, r.body);
  return r.json();
};
let seq = 0;

const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: false });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const sal = await p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `SAL-${suf}`, nome_produto: 'Sal mineral', unidade_principal_estoque: 'KG' } });
  const motivosEntrada = (await H.ok(H.req('GET', '/estoque/motivos-entrada', s.token))).items;
  const motivosSaida = (await H.ok(H.req('GET', '/estoque/motivos-saida', s.token))).items;
  const compra = motivosEntrada.find((m) => m.nome === 'Compra').id;
  const perda = motivosSaida.find((m) => m.nome === 'Perda').id;
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: `ADUBAÇÃO ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true } });
  ok(await H.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  return { ...s, sal, compra, perda, tipo };
};

const entrar = async (x, local, kg, custo, produto = x.sal) =>
  ok(await H.req('POST', '/estoque/entradas', x.token, {
    empresa_id: x.e1.id, operation_id: `en-${randomUUID()}`, motivo_id: x.compra, data_entrada: hoje(),
    itens: [{ produto_id: produto.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg, custo_unitario: custo }],
  }), 201);
const excluirEntrada = (x, doc) =>
  H.req('POST', `/estoque/entradas/${doc.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: doc.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` });
const sair = async (x, local, kg) =>
  ok(await H.req('POST', '/estoque/saidas', x.token, {
    empresa_id: x.e1.id, operation_id: `sa-${randomUUID()}`, motivo_id: x.perda, data_saida: hoje(),
    itens: [{ produto_id: x.sal.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg }],
  }), 201);
const transferir = async (x, origem, destino, kg) => {
  const r = ok(await H.req('POST', '/movimentacoes-estoque/comandos/transferencia-locais', x.token, {
    operation_id: `tr-${randomUUID()}`, empresa_id: x.e1.id, produto_id: x.sal.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade: kg,
  }), 201);
  return { s: r.movimentacao_saida, r: r.movimentacao_entrada };
};
const cancelarTransferencia = (x, id) =>
  H.req('POST', `/movimentacoes-estoque/${id}/cancelar-transferencia`, x.token, { empresa_id: x.e1.id, motivo: 'lançada no depósito errado', operation_id: `ct-${randomUUID()}` });
const ajustar = async (x, local, contado) =>
  ok(await H.req('POST', '/estoque/ajustes', x.token, {
    empresa_id: x.e1.id, operation_id: `aj-${randomUUID()}`, itens: [{ produto_id: x.sal.id, local_estoque_id: local.id, unidade: 'KG', quantidade_contada: contado }],
  }), 201);
const excluirAjuste = (x, a) =>
  H.req('POST', `/estoque/ajustes/${a.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: a.versao, motivo: 'contagem errada', operation_id: `xa-${randomUUID()}` });
const cancelarLancamento = (x, id) => H.req('POST', `/operacoes-financeiras/${id}/cancelar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), motivo: 'compra lançada errada' });
const previa = (x, movimentoId) => H.req('GET', `/estoque/movimentos/${movimentoId}/exclusao/previa?empresa_id=${x.e1.id}`, x.token);

const mov = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const movDoItem = (doc) => mov(doc.itens[0].movimentacao_estoque_id);
const v4 = (d) => (d === null || d === undefined ? null : Number(d).toFixed(4));
/** [valor_unitario, valor_total, saldo_antes, saldo_depois] gravados. */
const valores = (m) => [v4(m.valor_unitario), v4(m.valor_total), v4(m.saldo_antes), v4(m.saldo_depois)];
const fatias = (m) => (m.lotes_consumidos ?? []).map((f) => [f.lote_id, f.quantidade, f.custo_unitario]);
const camada = async (id) => {
  const l = await prisma().estoqueLoteNota.findUnique({ where: { id } });
  return { disp: v4(l.quantidade_disponivel), custo: v4(l.custo_unitario), status: l.status, entrada: v4(l.quantidade_entrada) };
};
const camadasDe = async (x, local) =>
  (await prisma().estoqueLoteNota.findMany({ where: { cliente_id: x.c, produto_id: x.sal.id, local_estoque_id: local.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }))
    .map((l) => ({ id: l.id, disp: v4(l.quantidade_disponivel), custo: v4(l.custo_unitario), status: l.status, entrada: v4(l.quantidade_entrada) }));
const camadaDaEntrada = async (doc) => (await prisma().estoqueLoteNota.findFirst({ where: { movimentacao_entrada_id: doc.itens[0].movimentacao_estoque_id } })).id;
const estoqueAtual = async (x) => v4((await prisma().produto.findUnique({ where: { id: x.sal.id } })).estoque_atual);
const itemDaSaida = (doc) => prisma().saidaEstoqueItem.findFirst({ where: { movimentacao_estoque_id: doc.itens[0].movimentacao_estoque_id } });

/** Prova "replay = gravado" do produto (o que a SPEC exige depois de cada exclusão). */
const provarReplay = async (x, produto = x.sal) => {
  const r = await emLeituraSomente((tx) => auditarReplayDoProduto(tx, x.c, x.e1.id, produto.id));
  assert.equal(r.reproduzivel, true, JSON.stringify({ problemas: r.problemas, parada: r.parada }));
  assert.deepEqual(r.divergencias, [], JSON.stringify(r.divergencias.slice(0, 5)));
  return r;
};
const trilha = (x, entidade, id) => prisma().auditLog.findMany({ where: { cliente_id: x.c, acao: 'estoque.recalculo', entidade, entidade_id: id }, orderBy: { createdAt: 'asc' } });
/** Tudo que uma exclusão poderia gravar (movimentos, camadas, dependentes, documentos, cache e trilha). */
const foto = async (x) => {
  const p = prisma();
  const w = { where: { cliente_id: x.c }, orderBy: { id: /** @type {const} */ ('asc') } };
  return JSON.stringify([
    await p.movimentacaoEstoque.findMany(w), await p.estoqueLoteNota.findMany(w), await p.produto.findMany(w), await p.saidaEstoqueItem.findMany(w),
    await p.entradaEstoque.findMany(w), await p.ajusteEstoque.findMany(w), await p.ajusteEstoqueItem.findMany(w), await p.operacaoFinanceira.findMany(w),
    await p.auditLog.count({ where: { cliente_id: x.c, acao: 'estoque.recalculo' } }),
  ]);
};
/** O par (original 'Estornada' + estorno) com a marca do recálculo. */
const exigirParMarcado = async (originalId, filhoEsperado = undefined) => {
  const o = await mov(originalId);
  const estornoId = filhoEsperado ?? o.movimento_filho_id;
  const e = await mov(estornoId);
  assert.deepEqual([o.status, o.movimentacao_grupo_id, e.movimentacao_grupo_id, e.movimento_pai_id], ['Estornada', marcaDoPar(originalId), marcaDoPar(originalId), originalId]);
  assert.match(e.numero_movimentacao, /^\d+$/);
  return e;
};

// ─── entrada documentada ────────────────────────────────────────────────────
/**
 * Cenário base (conta à mão): A recebe E1 100 kg a R$ 4 (L1) e E2 100 kg a R$ 6 (L2): 200 kg, R$ 1.000, médio R$ 5.
 * S1 tira 50 kg (L1) a R$ 5 = R$ 250 → 150 kg a R$ 5. Entra E3 50 kg a R$ 9 (L3): 200 kg, R$ 1.200, médio R$ 6.
 * S2 tira 80 kg (L1 50 + L2 30) a R$ 6 = R$ 480 → 120 kg a R$ 6.
 */
const cenarioBase = async (x) => {
  const A = x.local;
  const e1 = await entrar(x, A, '100', '4');
  const e2 = await entrar(x, A, '100', '6');
  const s1 = await sair(x, A, '50');
  const e3 = await entrar(x, A, '50', '9');
  const s2 = await sair(x, A, '80');
  return { A, e1, e2, e3, s1, s2, L1: await camadaDaEntrada(e1), L2: await camadaDaEntrada(e2), L3: await camadaDaEntrada(e3) };
};

describe('D-PROD-273 fatia 5 — entrada documentada', () => {
  test('excluir a E1 (consumida por S1 e S2): passa; S1 vai a 50 × 6 = 300 (L2) e S2 a 80 × 7,5 = 600 (L2 50 + L3 30); a L1 fica Estornado; saldos, itens das saídas, trilha e prévia', async () => {
    const x = await montar();
    const c = await cenarioBase(x);
    const [m1, m2, ms1, me3, ms2] = await Promise.all([movDoItem(c.e1), movDoItem(c.e2), movDoItem(c.s1), movDoItem(c.e3), movDoItem(c.s2)]);
    assert.deepEqual(valores(ms1), ['5.0000', '250.0000', '200.0000', '150.0000']);
    assert.deepEqual(valores(ms2), ['6.0000', '480.0000', '200.0000', '120.0000']);
    assert.deepEqual(fatias(ms2), [[c.L1, '50.0000', '6.0000'], [c.L2, '30.0000', '6.0000']]);
    assert.equal(await estoqueAtual(x), '120.0000');
    await provarReplay(x);

    // a prévia (o que a janela mostra) já diz o recálculo, sem gravar
    const antes = await foto(x);
    const pv = ok(await previa(x, m1.id));
    assert.deepEqual([pv.permitido, pv.modo, pv.excluidos], [true, 'recalculo', [m1.id]]);
    const pS2 = pv.movimentos.find((m) => m.id === ms2.id);
    assert.deepEqual([pS2.antes.valor_total, pS2.depois.valor_total, pS2.fatias_mudaram], ['480.0000', '600.0000', true]);
    assert.deepEqual(pv.camadas.find((l) => l.lote_id === c.L1)?.depois?.status, 'Estornado');
    assert.equal(await foto(x), antes, 'a prévia não grava');

    // sem E1: E2 100 a 6 → S1 50 × 6 = 300 (L2); entra E3 50 a 9 → 100 kg, R$ 750, médio 7,5; S2 80 × 7,5 = 600 (L2 50 + L3 30) → 20 kg a 7,5
    const r = ok(await excluirEntrada(x, c.e1));
    assert.equal(r.status, 'EXCLUIDA');
    assert.deepEqual(r.recalculo, { produtos: 1, movimentos: 4, camadas: 3, dependentes: 2 });
    assert.deepEqual(valores(await mov(m2.id)).slice(2), ['0.0000', '100.0000'], 'o saldo da E2 desce 100');
    assert.deepEqual(valores(await mov(ms1.id)), ['6.0000', '300.0000', '100.0000', '50.0000']);
    assert.deepEqual(fatias(await mov(ms1.id)), [[c.L2, '50.0000', '6.0000']], 'a fatia de S1 passa da L1 para a L2');
    assert.deepEqual(valores(await mov(me3.id)).slice(2), ['50.0000', '100.0000']);
    assert.deepEqual(valores(await mov(ms2.id)), ['7.5000', '600.0000', '100.0000', '20.0000']);
    assert.deepEqual(fatias(await mov(ms2.id)), [[c.L2, '50.0000', '7.5000'], [c.L3, '30.0000', '7.5000']]);
    assert.deepEqual(await camada(c.L1), { disp: '0.0000', custo: '5.0000', status: 'Estornado', entrada: '100.0000' }, 'a camada da entrada excluída fica, Estornado, no custo de antes');
    assert.deepEqual(await camada(c.L2), { disp: '0.0000', custo: '6.0000', status: 'Esgotado', entrada: '100.0000' });
    assert.deepEqual(await camada(c.L3), { disp: '20.0000', custo: '7.5000', status: 'Disponivel', entrada: '50.0000' });
    assert.equal(await estoqueAtual(x), '20.0000');
    const [i1, i2] = await Promise.all([itemDaSaida(c.s1), itemDaSaida(c.s2)]);
    assert.deepEqual([v4(i1.custo_unitario), v4(i1.valor_total), v4(i2.custo_unitario), v4(i2.valor_total)], ['6.0000', '300.0000', '7.5000', '600.0000']);
    const est = await exigirParMarcado(m1.id);
    assert.deepEqual([est.tipo_detalhado, v4(est.valor_total)], ['estorno_entrada_exclusao', '400.0000'], 'o estorno leva o valor de compra (não muda)');
    const linha = await prisma().entradaEstoqueItem.findFirst({ where: { movimentacao_estoque_id: m1.id } });
    assert.deepEqual([linha.movimentacao_estorno_id, v4(linha.custo_unitario)], [est.id, '4.0000']);
    const [t2] = await trilha(x, 'MovimentacaoEstoque', ms2.id);
    assert.deepEqual([t2.dados_anteriores.valor_total, t2.dados_novos.valor_total, t2.dados_novos.movimentos_excluidos, t2.dados_novos.origem, t2.usuario_id],
      ['480.0000', '600.0000', [m1.id], 'entrada_estoque', x.adm.usuario.id]);
    assert.match(t2.dados_novos.motivo, /lançada errada/);
    const [tl] = await trilha(x, 'EstoqueLoteNota', c.L1);
    assert.deepEqual([tl.dados_anteriores.status, tl.dados_novos.status], ['Esgotado', 'Estornado']);
    await provarReplay(x);
    // o kardex esconde o par e mostra os saldos regravados sem descontar de novo
    const k = ok(await H.req('GET', `/estoque/movimentos?empresa_id=${x.e1.id}&produto_id=${x.sal.id}`, x.token));
    assert.equal(k.items.some((i) => i.id === m1.id || i.id === est.id), false);
    assert.deepEqual(['saldo_antes', 'saldo_depois', 'valor_total'].map((f) => k.items.find((i) => i.id === ms2.id)[f]), ['100.0000', '20.0000', '600.0000']);

    // a S2 agora é a última: a exclusão dela é o estorno exato de sempre (nada depois)
    const r2 = ok(await H.req('POST', `/estoque/saidas/${c.s2.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: c.s2.versao, motivo: 'lançada errada', operation_id: `ex-${randomUUID()}` }));
    assert.equal(r2.recalculo, null);
    assert.equal(v4((await mov((await mov(ms2.id)).movimento_filho_id)).valor_total), '600.0000');
    await provarReplay(x);
  });

  test('excluir a entrada deixando saldo negativo num ponto posterior → 409 ESTOQUE_EXCLUSAO_SALDO_NEGATIVO com depósito, movimento e saldo; nada gravado; a prévia diz o mesmo', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, A, '100', '4');
    const e2 = await entrar(x, A, '100', '6');
    const s = await sair(x, A, '150');
    await entrar(x, A, '200', '5');
    const ms = await movDoItem(s);
    const antes = await foto(x);
    // sem E2: só 100 kg antes da saída de 150 → −50 no movimento da saída
    const pv = ok(await previa(x, e2.itens[0].movimentacao_estoque_id));
    assert.deepEqual([pv.permitido, pv.recusa?.code, pv.recusa?.movimento_id, pv.recusa?.saldo], [false, 'ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', ms.id, '-50.0000']);
    const r = await excluirEntrada(x, e2);
    assert.equal(r.statusCode, 409, r.body);
    const b = r.json();
    assert.deepEqual([b.code, b.details?.local_estoque_id, b.details?.movimento_id, b.details?.movimento_numero, b.details?.saldo], ['ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', A.id, ms.id, ms.numero_movimentacao, '-50.0000']);
    assert.equal(await foto(x), antes, 'nada gravado');
    assert.equal((await prisma().entradaEstoque.findUnique({ where: { id: e2.id } })).status, 'CONFIRMADA');
    await provarReplay(x);
  });

  test('sem nada depois o comportamento é o de sempre: estorno exato, sem marca, recalculo nulo', async () => {
    const x = await montar();
    const e1 = await entrar(x, x.local, '100', '4');
    const r = ok(await excluirEntrada(x, e1));
    assert.equal(r.recalculo, null);
    const o = await movDoItem(e1);
    assert.deepEqual([o.status, o.movimentacao_grupo_id], ['Estornada', null]);
    assert.deepEqual(await camada(await camadaDaEntrada(e1)), { disp: '0.0000', custo: '4.0000', status: 'Estornado', entrada: '100.0000' });
    await provarReplay(x);
  });
});

// ─── compra do financeiro ───────────────────────────────────────────────────
describe('D-PROD-273 fatia 5 — compra do financeiro', () => {
  test('cancelar a compra com saída depois: a saída passa de 50 × 5 = 250 (camada da compra) para 50 × 6 = 300 (L2); camada da compra Estornado; valor de compra igual; documento CANCELADO', async () => {
    const x = await montar();
    const A = x.local;
    // C: compra de 100 kg a R$ 4 (LC); E2 100 kg a R$ 6 (L2): 200 kg, médio 5; S 50 kg a 5 = 250 (LC)
    const { operacao: c, lote_id: LC } = await x.compraP3(x.e1, x.sal, A, { quantidade: '100', preco: '4', dia: hoje() });
    const e2 = await entrar(x, A, '100', '6');
    const s = await sair(x, A, '50');
    const L2 = await camadaDaEntrada(e2);
    const ms = await movDoItem(s);
    assert.deepEqual([valores(ms), fatias(ms)], [['5.0000', '250.0000', '200.0000', '150.0000'], [[LC, '50.0000', '5.0000']]]);
    await provarReplay(x);
    const r = ok(await cancelarLancamento(x, c.id));
    assert.equal(r.status, 'CANCELADO');
    // sem a compra: 100 kg a 6; S 50 × 6 = 300 (L2) → 50 kg a 6
    assert.deepEqual(valores(await mov(ms.id)), ['6.0000', '300.0000', '100.0000', '50.0000']);
    assert.deepEqual(fatias(await mov(ms.id)), [[L2, '50.0000', '6.0000']]);
    assert.deepEqual(await camada(LC), { disp: '0.0000', custo: '5.0000', status: 'Estornado', entrada: '100.0000' });
    assert.deepEqual(await camada(L2), { disp: '50.0000', custo: '6.0000', status: 'Disponivel', entrada: '100.0000' });
    const item = await prisma().operacaoFinanceiraItem.findFirst({ where: { operacao_id: c.id } });
    assert.deepEqual([v4(item.valor_unitario), v4(item.valor_total)], ['4.0000', '400.0000'], 'o valor de compra não muda');
    const est = await exigirParMarcado(item.movimentacao_estoque_id);
    assert.deepEqual([est.tipo_detalhado, v4(est.valor_total), item.movimentacao_estorno_id], ['estorno_compra', '400.0000', est.id]);
    const si = await itemDaSaida(s);
    assert.deepEqual([v4(si.custo_unitario), v4(si.valor_total)], ['6.0000', '300.0000']);
    assert.equal(await estoqueAtual(x), '50.0000');
    await provarReplay(x);
  });

  test('cancelar a compra cujo estoque foi todo usado (só ela no depósito) → 409 ESTOQUE_EXCLUSAO_SALDO_NEGATIVO; nada gravado; o lançamento continua CONFIRMADO', async () => {
    const x = await montar();
    const { operacao: c } = await x.compraP3(x.e1, x.sal, x.local, { quantidade: '100', preco: '4', dia: hoje() });
    const s = await sair(x, x.local, '30');
    const antes = await foto(x);
    const r = await cancelarLancamento(x, c.id);
    assert.equal(r.statusCode, 409, r.body);
    assert.deepEqual([r.json().code, r.json().details?.movimento_id, r.json().details?.saldo], ['ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', s.itens[0].movimentacao_estoque_id, '-30.0000']);
    assert.equal(await foto(x), antes);
    await provarReplay(x);
  });
});

// ─── transferência ──────────────────────────────────────────────────────────
describe('D-PROD-273 fatia 5 — cancelamento da transferência', () => {
  test('com consumo depois na origem e no destino: A volta a 240 kg (saída de A 525 → 450), B perde a camada recebida (saída de B 180 → 240, DB1); os dois pares marcados; elegibilidade ensaia sem gravar', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    // A: E1 100 a 4 (L1), E2 100 a 6 (L2) → 200 kg a 5. B: EB 40 a 8 (DB1).
    const e1 = await entrar(x, A, '100', '4');
    await entrar(x, A, '100', '6');
    const eb = await entrar(x, B, '40', '8');
    const L1 = await camadaDaEntrada(e1);
    const DB1 = await camadaDaEntrada(eb);
    // T: 80 kg A→B a 5 = 400 (L1 80); B: 120 kg, R$ 720, médio 6. A: 120 kg a 5; E3 40 a 20 em A → 160 kg, R$ 1.400, médio 8,75
    const t = await transferir(x, A, B, '80');
    await entrar(x, A, '40', '20');
    // SA: 60 kg de A a 8,75 = 525; SB: 30 kg de B a 6 = 180 (DB1, a mais antiga)
    const sa = await sair(x, A, '60');
    const sb = await sair(x, B, '30');
    const [msa, msb] = await Promise.all([movDoItem(sa), movDoItem(sb)]);
    assert.deepEqual([valores(msa), valores(msb)], [['8.7500', '525.0000', '160.0000', '100.0000'], ['6.0000', '180.0000', '120.0000', '90.0000']]);
    const D1 = (await mov(t.s.id)).lotes_consumidos[0].lote_destino_id;
    await provarReplay(x);
    const total = await estoqueAtual(x);

    const antes = await foto(x);
    const el = ok(await H.req('GET', `/movimentacoes-estoque/${t.s.id}/elegibilidade-cancelamento-transferencia?empresa_id=${x.e1.id}`, x.token));
    assert.equal(el.elegivel, true, JSON.stringify(el));
    assert.equal(el.efeitos.recalculo.produtos, 1);
    assert.equal(await foto(x), antes, 'a elegibilidade ensaia e desfaz');

    const r = ok(await cancelarTransferencia(x, t.r.id));
    assert.equal(r.recalculo.produtos, 1);
    // sem T: A 200 a 5 + E3 40 a 20 = 240 kg, R$ 1.800, médio 7,5 → SA 60 × 7,5 = 450 (L1 60); B: 40 a 8 → SB 30 × 8 = 240 (DB1) → 10 kg
    assert.deepEqual(valores(await mov(msa.id)), ['7.5000', '450.0000', '240.0000', '180.0000']);
    assert.deepEqual(fatias(await mov(msa.id)), [[L1, '60.0000', '7.5000']]);
    assert.deepEqual(valores(await mov(msb.id)), ['8.0000', '240.0000', '40.0000', '10.0000']);
    assert.deepEqual(fatias(await mov(msb.id)), [[DB1, '30.0000', '8.0000']]);
    assert.deepEqual(await camada(D1), { disp: '0.0000', custo: '6.0000', status: 'Estornado', entrada: '80.0000' }, 'a camada recebida fica, Estornado');
    assert.deepEqual(await camada(DB1), { disp: '10.0000', custo: '8.0000', status: 'Disponivel', entrada: '40.0000' });
    const camadasA = await camadasDe(x, A);
    assert.deepEqual(camadasA.map((l) => [l.disp, l.custo, l.status]), [['40.0000', '7.5000', 'Disponivel'], ['100.0000', '7.5000', 'Disponivel'], ['40.0000', '7.5000', 'Disponivel']]);
    assert.equal(await estoqueAtual(x), total, 'a transferência não mexe no total da empresa');
    // os dois pares (S + E_o, R + E_d) marcados; S continua com o filho R
    const s = await mov(t.s.id);
    const rr = await mov(t.r.id);
    const eo = await prisma().movimentacaoEstoque.findFirst({ where: { movimento_pai_id: s.id, tipo_detalhado: 'estorno_transferencia_enviada' } });
    assert.deepEqual([s.status, s.movimento_filho_id, s.movimentacao_grupo_id, eo.movimentacao_grupo_id], ['Estornada', rr.id, marcaDoPar(s.id), marcaDoPar(s.id)]);
    await exigirParMarcado(rr.id);
    assert.deepEqual([v4(eo.valor_total), r.estorno_origem.id], ['400.0000', eo.id]);
    const [ia, ib] = await Promise.all([itemDaSaida(sa), itemDaSaida(sb)]);
    assert.deepEqual([v4(ia.valor_total), v4(ib.valor_total)], ['450.0000', '240.0000']);
    await provarReplay(x);
  });

  test('cancelar deixando o destino negativo (o recebido já saiu) → 409 ESTOQUE_EXCLUSAO_SALDO_NEGATIVO no depósito de destino; nada gravado', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    await entrar(x, A, '100', '4');
    const t = await transferir(x, A, B, '50');
    const sb = await sair(x, B, '20');
    const antes = await foto(x);
    const r = await cancelarTransferencia(x, t.s.id);
    assert.equal(r.statusCode, 409, r.body);
    assert.deepEqual([r.json().code, r.json().details?.local_estoque_id, r.json().details?.movimento_id, r.json().details?.saldo], ['ESTOQUE_EXCLUSAO_SALDO_NEGATIVO', B.id, sb.itens[0].movimentacao_estoque_id, '-20.0000']);
    assert.equal(await foto(x), antes);
    const el = ok(await H.req('GET', `/movimentacoes-estoque/${t.s.id}/elegibilidade-cancelamento-transferencia?empresa_id=${x.e1.id}`, x.token));
    assert.deepEqual([el.elegivel, el.codigo], [false, 'ESTOQUE_EXCLUSAO_SALDO_NEGATIVO']);
  });
});

// ─── ajuste de inventário ───────────────────────────────────────────────────
describe('D-PROD-273 fatia 5 — exclusão do ajuste de inventário', () => {
  test('SOBRA com movimentos depois: E1 100 a 4, sobra 20 a 4, E2 60 a 10 (180 kg, médio 6), S 90 × 6 = 540; excluir o ajuste: S 90 × 6,25 = 562,5; a camada da sobra fica Estornado', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, A, '100', '4');
    const a = await ajustar(x, A, '120');
    assert.equal(a.itens[0].tipo, 'SOBRA');
    const LS = (await prisma().ajusteEstoqueItem.findFirst({ where: { ajuste_id: a.id } })).estoque_lote_nota_id;
    await entrar(x, A, '60', '10');
    const s = await sair(x, A, '90');
    const ms = await movDoItem(s);
    assert.deepEqual(valores(ms), ['6.0000', '540.0000', '180.0000', '90.0000']);
    await provarReplay(x);
    const pv = ok(await previa(x, a.itens[0].movimentacao_estoque_id));
    assert.deepEqual([pv.permitido, pv.modo], [true, 'recalculo']);
    const r = ok(await excluirAjuste(x, a));
    assert.equal(r.status, 'EXCLUIDA');
    assert.equal(r.recalculo.produtos, 1);
    // sem a sobra: 100 a 4 + 60 a 10 = 160 kg, R$ 1.000, médio 6,25; S 90 × 6,25 = 562,5 → 70 kg
    assert.deepEqual(valores(await mov(ms.id)), ['6.2500', '562.5000', '160.0000', '70.0000']);
    assert.deepEqual(await camada(LS), { disp: '0.0000', custo: '6.0000', status: 'Estornado', entrada: '20.0000' }, 'a camada fica no custo da última reavaliação');
    await exigirParMarcado(a.itens[0].movimentacao_estoque_id);
    const linha = await prisma().ajusteEstoqueItem.findFirst({ where: { ajuste_id: a.id } });
    assert.deepEqual([v4(linha.custo_unitario), v4(linha.valor_total)], ['4.0000', '80.0000'], 'a linha do ajuste excluído guarda o que foi contado');
    assert.equal(await estoqueAtual(x), '70.0000');
    await provarReplay(x);
  });

  test('FALTA com movimentos depois: E1 100 a 4, E2 100 a 6, falta 50 a 5, E3 50 a 9, S 80 × 6 = 480; excluir o ajuste: S 80 × 5,8 = 464 (L1 80)', async () => {
    const x = await montar();
    const A = x.local;
    const e1 = await entrar(x, A, '100', '4');
    await entrar(x, A, '100', '6');
    const a = await ajustar(x, A, '150');
    assert.equal(a.itens[0].tipo, 'FALTA');
    await entrar(x, A, '50', '9');
    const s = await sair(x, A, '80');
    const ms = await movDoItem(s);
    assert.deepEqual(valores(ms), ['6.0000', '480.0000', '200.0000', '120.0000']);
    const r = ok(await excluirAjuste(x, a));
    assert.equal(r.recalculo.produtos, 1);
    assert.deepEqual(valores(await mov(ms.id)), ['5.8000', '464.0000', '250.0000', '170.0000']);
    assert.deepEqual(fatias(await mov(ms.id)), [[await camadaDaEntrada(e1), '80.0000', '5.8000']]);
    await exigirParMarcado(a.itens[0].movimentacao_estoque_id);
    assert.equal(await estoqueAtual(x), '170.0000');
    await provarReplay(x);
  });

  test('com OUTRO ajuste vigente depois no mesmo depósito → 409 ajuste_de_inventario_posterior (escolha do dono); nada gravado', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, A, '100', '4');
    const a1 = await ajustar(x, A, '90'); // falta 10
    await sair(x, A, '20');
    const a2 = await ajustar(x, A, '75'); // sobra 5
    const antes = await foto(x);
    const r = await excluirAjuste(x, a1);
    assert.equal(r.statusCode, 409, r.body);
    assert.deepEqual([r.json().code, r.json().reason ?? r.json().details?.reason, r.json().details?.ajuste_numero], ['ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL', 'ajuste_de_inventario_posterior', a2.numero]);
    assert.equal(await foto(x), antes);
    // o ajuste mais novo é o último: a exclusão dele é o estorno exato de sempre
    const r2 = ok(await excluirAjuste(x, a2));
    assert.equal(r2.recalculo, null);
    await provarReplay(x);
  });
});

// ─── cascata, dependentes e concorrência ────────────────────────────────────
/** Atividade aberta + apontamento do dia; devolve o lançamento da linha de produto. */
const atividade = async (x) => {
  const a = ok(await H.req('POST', '/atividades', x.token, {
    empresa_id: x.e1.id, nome: `Adubação ${++seq}`, tipo_atividade_id: x.tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30',
  }), 201);
  const base = `/atividades/${a.id}/apontamentos`;
  const ap = ok(await H.req('POST', base, x.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', area_executada_dia: '10' }), 201).apontamento;
  return async (local, kg) => ok(await H.req('POST', `${base}/${ap.id}/produtos`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), produto_id: x.sal.id, local_estoque_id: local.id, quantidade: kg }), 201).linha;
};
/** Lançamento de cocho como o formulário (baixa + comando com a MESMA chave), período aberto. */
const lancarCocho = async (x, local, { ponto, kg, data }) => {
  const chave = `lanc-${randomUUID()}`;
  const movimentacao = ok(await H.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', x.token, {
    operation_id: chave, empresa_id: x.e1.id, produto_id: x.sal.id, local_origem_id: local.id, quantidade: kg, ponto_suplementacao_id: ponto, data_movimentacao: data,
  }), 201).movimentacao;
  const evento = ok(await H.req('POST', '/suplementacao-eventos/comandos/lancamento-com-lotes', x.token, {
    operation_id: chave,
    evento: {
      empresa_id: x.e1.id, ponto_suplementacao_id: ponto, ponto_nome: `Cocho ${ponto}`, area_id: `area-${ponto}`, area_ids: [`area-${ponto}`], data_lancamento: data,
      produto: 'Sal mineral', produto_id: x.sal.id, quantidade_total_kg: kg, sobra_kg: 0, dias_periodo: null, consumo_diario_grupo_kg: null,
      total_cabecas_afetadas: 10, movimentacao_estoque_id: movimentacao.id, custo_unitario_kg: Number(movimentacao.valor_unitario),
    },
    lotes: [{ empresa_id: x.e1.id, lote_id: `lote-${ponto}`, lote_nome: 'A', data_lancamento: data, percentual_consumo_lote: 1, dias_periodo: null, dias_ativos_periodo: null, animal_dias_periodo: null, consumo_unitario_dia: null, consumo_por_cabeca_dia_kg: null, consumo_total_lote_periodo_kg: null }],
  }), 201).evento;
  return { evento, mov: movimentacao };
};

describe('D-PROD-273 fatia 5 — cascata, dependentes e concorrência', () => {
  test('cascata: excluir a entrada da origem que a transferência levou ao destino: T 80 × 4 = 320 → 80 × 5 = 400 (L2), camada nova no destino (as antigas Estornado) e a saída no destino 120 → 150', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    // A: E1 50 a 2 (L1), E2 100 a 5 (L2) → 150 kg, R$ 600, médio 4; T 80 A→B a 4 = 320 (L1 50 + L2 30); SB 30 em B a 4 = 120
    const e1 = await entrar(x, A, '50', '2');
    const e2 = await entrar(x, A, '100', '5');
    const L1 = await camadaDaEntrada(e1);
    const L2 = await camadaDaEntrada(e2);
    const t = await transferir(x, A, B, '80');
    const sb = await sair(x, B, '30');
    const antigas = (await mov(t.s.id)).lotes_consumidos.map((f) => f.lote_destino_id);
    assert.deepEqual(fatias(await mov(t.s.id)), [[L1, '50.0000', '4.0000'], [L2, '30.0000', '4.0000']]);
    assert.deepEqual(valores(await movDoItem(sb)), ['4.0000', '120.0000', '80.0000', '50.0000']);
    await provarReplay(x);
    ok(await excluirEntrada(x, e1));
    // sem E1: A 100 a 5 → T 80 × 5 = 400 (L2) → B 80 a 5 → SB 30 × 5 = 150 (camada nova); A fica 20 a 5
    const ts = await mov(t.s.id);
    assert.deepEqual(valores(ts), ['5.0000', '400.0000', '100.0000', '20.0000']);
    assert.deepEqual(valores(await mov(t.r.id)), ['5.0000', '400.0000', '0.0000', '80.0000']);
    assert.deepEqual(fatias(ts), [[L2, '80.0000', '5.0000']], 'T sai só da L2');
    const [nova] = ts.lotes_consumidos.map((f) => f.lote_destino_id);
    assert.equal(antigas.includes(nova), false, 'a camada de origem mudou: camada de destino nova');
    for (const id of antigas) assert.deepEqual((await camada(id)).status, 'Estornado');
    assert.deepEqual(await camada(nova), { disp: '50.0000', custo: '5.0000', status: 'Disponivel', entrada: '80.0000' });
    const msb = await movDoItem(sb);
    assert.deepEqual([valores(msb), fatias(msb)], [['5.0000', '150.0000', '80.0000', '50.0000'], [[nova, '30.0000', '5.0000']]]);
    assert.deepEqual(await camada(L1), { disp: '0.0000', custo: '2.0000', status: 'Estornado', entrada: '50.0000' });
    assert.deepEqual(await camada(L2), { disp: '20.0000', custo: '5.0000', status: 'Disponivel', entrada: '100.0000' });
    await provarReplay(x);
  });

  test('cocho e atividade dependentes de saídas posteriores cuja fatia sai da camada excluída: cocho 30 × 5 = 150 → 30 × 6 = 180 (L2); linha 60 × 5 = 300 (L1 20 + L2 40) → 60 × 6 = 360 (L2 60): a fatia da L1 sai, a da L2 é atualizada', async () => {
    const x = await montar();
    const A = x.local;
    // E1 50 a 2 (L1), E2 150 a 6 (L2): 200 kg, R$ 1.000, médio 5. Cocho 30 × 5 = 150 (L1 30); linha 60 × 5 = 300 (L1 20 + L2 40)
    const e1 = await entrar(x, A, '50', '2');
    const e2 = await entrar(x, A, '150', '6');
    const L1 = await camadaDaEntrada(e1);
    const L2 = await camadaDaEntrada(e2);
    const c = await lancarCocho(x, A, { ponto: 'cocho-1', kg: 30, data: '2027-06-01' });
    const lancar = await atividade(x);
    const linha = await lancar(A, '60');
    assert.deepEqual(fatias(await mov(c.mov.id)), [[L1, '30.0000', '5.0000']]);
    const antes = await prisma().atividadeApontamentoProduto.findUnique({ where: { id: linha.id }, include: { consumos: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual([v4(antes.custo_total), antes.consumos.map((f) => [f.estoque_lote_nota_id, f.ordem, v4(f.quantidade)])], ['300.0000', [[L1, 1, '20.0000'], [L2, 2, '40.0000']]]);
    assert.equal((await prisma().suplementacaoEvento.findUnique({ where: { id: c.evento.id } })).dados.custo_unitario_kg, 5);
    await provarReplay(x);
    const r = ok(await excluirEntrada(x, e1));
    assert.equal(r.recalculo.produtos, 1);
    // sem E1: 150 kg a 6 → cocho 30 × 6 = 180 (L2); linha 60 × 6 = 360 (L2) → 60 kg a 6
    const mc = await mov(c.mov.id);
    assert.deepEqual([valores(mc), fatias(mc)], [['6.0000', '180.0000', '150.0000', '120.0000'], [[L2, '30.0000', '6.0000']]]);
    assert.match(mc.observacoes ?? '', /\[RATEIO_FIFO\] .*30\.000 kg/, 'o rateio do cocho segue a fatia nova');
    assert.equal((await prisma().suplementacaoEvento.findUnique({ where: { id: c.evento.id } })).dados.custo_unitario_kg, 6, 'o custo/kg do lançamento do cocho');
    const depois = await prisma().atividadeApontamentoProduto.findUnique({ where: { id: linha.id }, include: { consumos: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual([v4(depois.custo_unitario), v4(depois.custo_total)], ['6.0000', '360.0000']);
    assert.deepEqual(depois.consumos.map((f) => [f.estoque_lote_nota_id, f.ordem, v4(f.quantidade), v4(f.custo_unitario)]), [[L2, 1, '60.0000', '6.0000']]);
    assert.equal(depois.consumos[0].id, antes.consumos[1].id, 'a fatia da L2 é atualizada (mesmo id); a da L1 sai');
    assert.deepEqual(await camada(L1), { disp: '0.0000', custo: '5.0000', status: 'Estornado', entrada: '50.0000' }, 'a camada fica (as FKs das fatias são Restrict)');
    const [t] = await trilha(x, 'AtividadeApontamentoProduto', linha.id);
    assert.deepEqual([t.dados_anteriores.custo_total, t.dados_novos.custo_total, t.dados_anteriores.fatias.length, t.dados_novos.fatias.length], ['300.0000', '360.0000', 2, 1]);
    assert.equal(await estoqueAtual(x), '60.0000');
    await provarReplay(x);
  });

  test('concorrência: duas exclusões de entrada no mesmo produto (a trava do produto as enfileira) passam uma depois da outra; a saída depois fica 50 × 8 = 400 (L3)', async () => {
    const x = await montar();
    const A = x.local;
    // E1 100 a 4, E2 100 a 6, E3 100 a 8 → 300 kg, médio 6; S 50 × 6 = 300 (L1). Sem E1 e E2: S 50 × 8 = 400 (L3)
    const e1 = await entrar(x, A, '100', '4');
    const e2 = await entrar(x, A, '100', '6');
    const e3 = await entrar(x, A, '100', '8');
    const s = await sair(x, A, '50');
    const ms = await movDoItem(s);
    assert.deepEqual(valores(ms), ['6.0000', '300.0000', '300.0000', '250.0000']);
    let liberar = () => {};
    const liberado = new Promise((res) => { liberar = () => res(undefined); });
    let pronto = () => {};
    const comTrava = new Promise((res) => { pronto = res; });
    const fim = aux.$transaction(async (t) => {
      await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${chaveTravaProduto(x.c, x.e1.id, x.sal.id)}, 0))`;
      pronto();
      await liberado;
    }, { timeout: 60000, maxWait: 10000 });
    await comTrava;
    const x1 = excluirEntrada(x, e1);
    const x2 = excluirEntrada(x, e2);
    for (let i = 0; i < 400; i++) {
      const [{ c }] = /** @type {any[]} */ (await prisma().$queryRaw`SELECT count(*)::int AS c FROM pg_locks WHERE NOT granted`);
      if (c >= 2) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    liberar();
    await fim;
    const [r1, r2] = await Promise.all([x1, x2]);
    assert.deepEqual([r1.statusCode, r2.statusCode], [200, 200], `${r1.body} ${r2.body}`);
    assert.deepEqual(valores(await mov(ms.id)), ['8.0000', '400.0000', '100.0000', '50.0000']);
    assert.deepEqual(fatias(await mov(ms.id)), [[await camadaDaEntrada(e3), '50.0000', '8.0000']]);
    const marcados = await prisma().movimentacaoEstoque.count({ where: { cliente_id: x.c, movimentacao_grupo_id: { startsWith: 'exclusao_recalculo:' } } });
    assert.equal(marcados, 4, 'os dois pares marcados');
    assert.equal(await estoqueAtual(x), '50.0000');
    await provarReplay(x);
  });
});
