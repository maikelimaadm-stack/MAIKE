/**
 * D-PROD-273 (fatia 5) — EXCLUSÃO COM RECÁLCULO das ENTRADAS, contra PostgreSQL real e pelos serviços de verdade (HTTP
 * autenticado): entrada documentada (excluir), compra do financeiro (cancelar), cancelamento da transferência entre
 * depósitos e exclusão do ajuste de inventário. Com movimento depois no depósito, a entrada sai da sequência (a camada
 * dela fica 'Estornado', nunca apagada), quem consumiu dela volta a consumir das outras camadas pelo médio sem ela, e o
 * custo de tudo que veio depois é recalculado, com os dependentes. Saldo negativo em qualquer ponto → 409
 * `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO`, nada gravado. Sem estorno exato como saída. Números à mão em cada cenário; no fim de
 * cada um, o replay completo do produto bate com o gravado (`auditarReplayDoProduto`).
 * D-PROD-313 (só o último): com registro depois que ainda vale, no mesmo produto e depósito (origem ou destino), a
 * exclusão é recusada antes de tudo (409 `ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR`, nada gravado) e exclui-se do mais
 * recente para o mais antigo; só os pares já excluídos depois sobram para o recálculo, que os tira da sequência.
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
const excluirSaida = (x, doc) =>
  H.req('POST', `/estoque/saidas/${doc.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: doc.versao, motivo: 'lançada errada', operation_id: `xs-${randomUUID()}` });
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
/**
 * D-PROD-313 — a resposta é a recusa do registro posterior que ainda vale (um dos `posteriores`: o mais recente no
 * depósito), com o código, o motivo e o depósito; devolve o corpo.
 */
const exigirRegistroPosterior = (r, posteriores, local) => {
  assert.equal(r.statusCode, 409, r.body);
  const b = r.json();
  assert.deepEqual([b.code, b.reason ?? b.details?.reason], ['ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior'], r.body);
  assert.ok(posteriores.includes(b.details?.posterior_id), `posterior ${b.details?.posterior_id} fora de ${posteriores}`);
  if (local) assert.equal(b.details?.local_estoque_id, local.id, r.body);
  return b;
};
/** A prévia diz a mesma recusa, sem gravar. */
const exigirPreviaRegistroPosterior = async (x, movimentoId, posteriores) => {
  const pv = ok(await previa(x, movimentoId));
  assert.deepEqual([pv.permitido, pv.modo, pv.recusa?.code, pv.recusa?.reason], [false, null, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior'], JSON.stringify(pv.recusa));
  assert.ok(posteriores.includes(pv.recusa?.posterior_id), JSON.stringify(pv.recusa));
  return pv;
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
  test('D-PROD-313: excluir a E1 com S1, E3 e S2 depois → 409 registro posterior (S2); nada gravado, nem pela prévia; do mais recente ao mais antigo (S2 pelo estorno exato, E3, S1, E2) a E1 sai; a L1 fica Estornado; o estorno leva o valor de compra; o kardex esconde os pares', async () => {
    const x = await montar();
    const c = await cenarioBase(x);
    const [m1, ms1, me3, ms2] = await Promise.all([movDoItem(c.e1), movDoItem(c.s1), movDoItem(c.e3), movDoItem(c.s2)]);
    assert.deepEqual(valores(ms1), ['5.0000', '250.0000', '200.0000', '150.0000']);
    assert.deepEqual(valores(ms2), ['6.0000', '480.0000', '200.0000', '120.0000']);
    assert.deepEqual(fatias(ms2), [[c.L1, '50.0000', '6.0000'], [c.L2, '30.0000', '6.0000']]);
    assert.equal(await estoqueAtual(x), '120.0000');
    await provarReplay(x);

    // a prévia (o que a janela mostra) e a exclusão recusam pelo registro mais recente que ainda vale (S2); nada gravado
    const antes = await foto(x);
    await exigirPreviaRegistroPosterior(x, m1.id, [ms2.id]);
    exigirRegistroPosterior(await excluirEntrada(x, c.e1), [ms2.id], c.A);
    assert.equal(await foto(x), antes, 'nada gravado');
    assert.equal((await prisma().entradaEstoque.findUnique({ where: { id: c.e1.id } })).status, 'CONFIRMADA');

    // a S2 é a última: a exclusão dela é o estorno exato de sempre (nada depois), pelo valor gravado
    const r2 = ok(await excluirSaida(x, c.s2));
    assert.equal(r2.recalculo, null);
    assert.equal(v4((await mov((await mov(ms2.id)).movimento_filho_id)).valor_total), '480.0000');
    // com S2 fora, a E3 é a mais recente que vale: a E1 continua presa
    exigirRegistroPosterior(await excluirEntrada(x, c.e1), [me3.id], c.A);
    ok(await excluirEntrada(x, c.e3));
    ok(await excluirSaida(x, c.s1));
    ok(await excluirEntrada(x, c.e2));
    const r = ok(await excluirEntrada(x, c.e1));
    assert.equal(r.status, 'EXCLUIDA');
    for (const L of [c.L1, c.L2, c.L3]) assert.deepEqual([(await camada(L)).disp, (await camada(L)).status], ['0.0000', 'Estornado'], 'a camada da entrada excluída fica, Estornado');
    assert.equal(await estoqueAtual(x), '0.0000');
    const est = await mov((await mov(m1.id)).movimento_filho_id);
    assert.deepEqual([est.tipo_detalhado, v4(est.valor_total), est.movimento_pai_id], ['estorno_entrada_exclusao', '400.0000', m1.id], 'o estorno leva o valor de compra (não muda)');
    const linha = await prisma().entradaEstoqueItem.findFirst({ where: { movimentacao_estoque_id: m1.id } });
    assert.deepEqual([linha.movimentacao_estorno_id, v4(linha.custo_unitario)], [est.id, '4.0000']);
    await provarReplay(x);
    // o kardex esconde os cinco pares
    const k = ok(await H.req('GET', `/estoque/movimentos?empresa_id=${x.e1.id}&produto_id=${x.sal.id}`, x.token));
    assert.deepEqual([k.total, k.items.length], [0, 0]);
  });

  test('excluir a entrada com saída e entrada depois → D-PROD-313: 409 registro posterior (a entrada mais nova); nada gravado; a prévia diz o mesmo', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, A, '100', '4');
    const e2 = await entrar(x, A, '100', '6');
    await sair(x, A, '150');
    const e4 = await entrar(x, A, '200', '5');
    const me4 = await movDoItem(e4);
    const antes = await foto(x);
    // D-PROD-313: a recusa por saldo negativo (sem E2, só 100 kg antes da saída de 150 → −50) agora é precedida pela do
    // registro posterior; com só pares já excluídos depois, a entrada de camada inteira sai pelo estorno exato (achado (3))
    await exigirPreviaRegistroPosterior(x, e2.itens[0].movimentacao_estoque_id, [me4.id]);
    const b = exigirRegistroPosterior(await excluirEntrada(x, e2), [me4.id], A);
    assert.deepEqual([b.details?.movimento_id, b.details?.posterior_numero], [e2.itens[0].movimentacao_estoque_id, me4.numero_movimentacao]);
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
  test('D-PROD-313: cancelar a compra com entrada e saída depois → 409 registro posterior (a saída); nada gravado, o lançamento continua CONFIRMADO; excluídas a saída e a entrada, a compra cancela: camada Estornado, valor de compra igual', async () => {
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
    const antes = await foto(x);
    exigirRegistroPosterior(await cancelarLancamento(x, c.id), [ms.id], A);
    assert.equal(await foto(x), antes, 'nada gravado');
    assert.equal((await prisma().operacaoFinanceira.findUnique({ where: { id: c.id } })).status, 'CONFIRMADO');
    // do mais recente ao mais antigo: a saída, a entrada E2 e então a compra
    ok(await excluirSaida(x, s));
    exigirRegistroPosterior(await cancelarLancamento(x, c.id), [e2.itens[0].movimentacao_estoque_id], A);
    ok(await excluirEntrada(x, e2));
    const r = ok(await cancelarLancamento(x, c.id));
    assert.equal(r.status, 'CANCELADO');
    assert.deepEqual([(await camada(LC)).disp, (await camada(LC)).status, (await camada(LC)).entrada], ['0.0000', 'Estornado', '100.0000']);
    assert.deepEqual([(await camada(L2)).disp, (await camada(L2)).status], ['0.0000', 'Estornado']);
    const item = await prisma().operacaoFinanceiraItem.findFirst({ where: { operacao_id: c.id } });
    assert.deepEqual([v4(item.valor_unitario), v4(item.valor_total)], ['4.0000', '400.0000'], 'o valor de compra não muda');
    const est = await mov((await mov(item.movimentacao_estoque_id)).movimento_filho_id);
    assert.deepEqual([est.tipo_detalhado, v4(est.valor_total), item.movimentacao_estorno_id], ['estorno_compra', '400.0000', est.id]);
    assert.equal(await estoqueAtual(x), '0.0000');
    await provarReplay(x);
  });

  test('cancelar a compra cujo estoque foi todo usado (só ela no depósito) → D-PROD-313: 409 registro posterior (a saída); nada gravado; o lançamento continua CONFIRMADO; excluída a saída, a compra cancela', async () => {
    const x = await montar();
    const { operacao: c } = await x.compraP3(x.e1, x.sal, x.local, { quantidade: '100', preco: '4', dia: hoje() });
    const s = await sair(x, x.local, '30');
    const antes = await foto(x);
    // D-PROD-313: a recusa por saldo negativo (sem a compra, a saída de 30 deixaria −30) agora é precedida pela do registro posterior
    exigirRegistroPosterior(await cancelarLancamento(x, c.id), [s.itens[0].movimentacao_estoque_id], x.local);
    assert.equal(await foto(x), antes);
    assert.equal((await prisma().operacaoFinanceira.findUnique({ where: { id: c.id } })).status, 'CONFIRMADO');
    await provarReplay(x);
    ok(await excluirSaida(x, s));
    assert.equal(ok(await cancelarLancamento(x, c.id)).status, 'CANCELADO');
    assert.equal(await estoqueAtual(x), '0.0000');
    await provarReplay(x);
  });
});

// ─── transferência ──────────────────────────────────────────────────────────
describe('D-PROD-273 fatia 5 — cancelamento da transferência', () => {
  test('D-PROD-313: com consumo depois na origem e no destino → 409 registro posterior; a elegibilidade diz o mesmo sem gravar; excluídas SB, SA e E3, a transferência cancela: A volta a 200 kg a 5, B a 40 a 8; a camada recebida fica Estornado', async () => {
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
    const e3 = await entrar(x, A, '40', '20');
    // SA: 60 kg de A a 8,75 = 525; SB: 30 kg de B a 6 = 180 (DB1, a mais antiga)
    const sa = await sair(x, A, '60');
    const sb = await sair(x, B, '30');
    const [msa, msb] = await Promise.all([movDoItem(sa), movDoItem(sb)]);
    assert.deepEqual([valores(msa), valores(msb)], [['8.7500', '525.0000', '160.0000', '100.0000'], ['6.0000', '180.0000', '120.0000', '90.0000']]);
    const D1 = (await mov(t.s.id)).lotes_consumidos[0].lote_destino_id;
    await provarReplay(x);

    // a mais recente que vale no depósito de cada perna (SA na origem, SB no destino) prende a transferência
    const antes = await foto(x);
    const el = ok(await H.req('GET', `/movimentacoes-estoque/${t.s.id}/elegibilidade-cancelamento-transferencia?empresa_id=${x.e1.id}`, x.token));
    assert.deepEqual([el.elegivel, el.codigo], [false, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR'], JSON.stringify(el));
    assert.equal(await foto(x), antes, 'a elegibilidade ensaia e desfaz');
    exigirRegistroPosterior(await cancelarTransferencia(x, t.r.id), [msa.id, msb.id]);
    assert.equal(await foto(x), antes, 'nada gravado');

    // do mais recente ao mais antigo: SB (destino), SA e E3 (origem); então a transferência sai
    ok(await excluirSaida(x, sb));
    exigirRegistroPosterior(await cancelarTransferencia(x, t.r.id), [msa.id], A);
    ok(await excluirSaida(x, sa));
    ok(await excluirEntrada(x, e3));
    const r = ok(await cancelarTransferencia(x, t.r.id));
    assert.deepEqual(await camada(D1), { disp: '0.0000', custo: '6.0000', status: 'Estornado', entrada: '80.0000' }, 'a camada recebida fica, Estornado');
    assert.deepEqual([(await camada(DB1)).disp, (await camada(DB1)).custo, (await camada(DB1)).status, (await camada(DB1)).entrada], ['40.0000', '8.0000', 'Disponivel', '40.0000']);
    const camadasA = await camadasDe(x, A);
    assert.deepEqual(camadasA.filter((l) => l.status === 'Disponivel').reduce((t2, l) => t2 + Number(l.disp), 0), 200);
    assert.equal(await estoqueAtual(x), '240.0000', 'E1 + E2 + EB: a transferência não mexe no total da empresa');
    assert.equal((await camada(L1)).status, 'Disponivel');
    const s = await mov(t.s.id);
    const rr = await mov(t.r.id);
    const eo = await prisma().movimentacaoEstoque.findFirst({ where: { movimento_pai_id: s.id, tipo_detalhado: 'estorno_transferencia_enviada' } });
    // só pares já excluídos depois: o recálculo de sempre tira os dois pares (S + E_o, R + E_d) da sequência, marcados
    assert.deepEqual([s.status, s.movimento_filho_id, s.movimentacao_grupo_id, eo.movimentacao_grupo_id], ['Estornada', rr.id, marcaDoPar(s.id), marcaDoPar(s.id)]);
    await exigirParMarcado(rr.id);
    assert.deepEqual([v4(eo.valor_total), r.estorno_origem.id], ['400.0000', eo.id]);
    await provarReplay(x);
  });

  test('cancelar com o recebido já saído do destino → D-PROD-313: 409 registro posterior (a saída em B); nada gravado; a elegibilidade diz o mesmo; excluída a saída, a transferência cancela', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    await entrar(x, A, '100', '4');
    const t = await transferir(x, A, B, '50');
    const sb = await sair(x, B, '20');
    const antes = await foto(x);
    // D-PROD-313: a recusa por saldo negativo no destino (sem a transferência, a saída de 20 deixaria B em −20) agora é
    // precedida pela do registro posterior: a saída em B ainda vale
    exigirRegistroPosterior(await cancelarTransferencia(x, t.s.id), [sb.itens[0].movimentacao_estoque_id], B);
    assert.equal(await foto(x), antes);
    const el = ok(await H.req('GET', `/movimentacoes-estoque/${t.s.id}/elegibilidade-cancelamento-transferencia?empresa_id=${x.e1.id}`, x.token));
    assert.deepEqual([el.elegivel, el.codigo], [false, 'ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR']);
    await provarReplay(x);
    // excluída a saída em B (a mais recente), a transferência é a última que vale e sai; o par da saída sai da
    // sequência com ela (marcado): A volta a 100 kg a 4 e B fica vazio
    ok(await excluirSaida(x, sb));
    const r = ok(await cancelarTransferencia(x, t.s.id));
    assert.deepEqual((await camadasDe(x, A)).map((l) => [l.disp, l.custo, l.status, l.entrada]), [['100.0000', '4.0000', 'Disponivel', '100.0000']]);
    assert.deepEqual((await camadasDe(x, B)).map((l) => [l.disp, l.status, l.entrada]), [['0.0000', 'Estornado', '50.0000']]);
    assert.equal(await estoqueAtual(x), '100.0000');
    const s = await mov(t.s.id);
    assert.deepEqual([s.status, s.movimentacao_grupo_id, v4(r.estorno_origem.valor_total)], ['Estornada', marcaDoPar(s.id), '200.0000']);
    await exigirParMarcado(t.r.id);
    await exigirParMarcado(sb.itens[0].movimentacao_estoque_id);
    await provarReplay(x);
  });
});

// ─── ajuste de inventário ───────────────────────────────────────────────────
describe('D-PROD-273 fatia 5 — exclusão do ajuste de inventário', () => {
  test('D-PROD-313: SOBRA com movimentos depois (E1 100 a 4, sobra 20 a 4, E2 60 a 10, S 90 × 6 = 540) → 409 registro posterior (S); nada gravado, nem pela prévia; excluídas S e E2, o ajuste sai: a camada da sobra fica Estornado', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, A, '100', '4');
    const a = await ajustar(x, A, '120');
    assert.equal(a.itens[0].tipo, 'SOBRA');
    const LS = (await prisma().ajusteEstoqueItem.findFirst({ where: { ajuste_id: a.id } })).estoque_lote_nota_id;
    const e2 = await entrar(x, A, '60', '10');
    const s = await sair(x, A, '90');
    const ms = await movDoItem(s);
    assert.deepEqual(valores(ms), ['6.0000', '540.0000', '180.0000', '90.0000']);
    await provarReplay(x);
    const antes = await foto(x);
    await exigirPreviaRegistroPosterior(x, a.itens[0].movimentacao_estoque_id, [ms.id]);
    exigirRegistroPosterior(await excluirAjuste(x, a), [ms.id], A);
    assert.equal(await foto(x), antes, 'nada gravado');
    // do mais recente ao mais antigo: S, E2 e então o ajuste
    ok(await excluirSaida(x, s));
    ok(await excluirEntrada(x, e2));
    const r = ok(await excluirAjuste(x, a));
    assert.equal(r.status, 'EXCLUIDA');
    assert.deepEqual([(await camada(LS)).disp, (await camada(LS)).status, (await camada(LS)).entrada], ['0.0000', 'Estornado', '20.0000']);
    const linha = await prisma().ajusteEstoqueItem.findFirst({ where: { ajuste_id: a.id } });
    assert.deepEqual([v4(linha.custo_unitario), v4(linha.valor_total)], ['4.0000', '80.0000'], 'a linha do ajuste excluído guarda o que foi contado');
    assert.equal(await estoqueAtual(x), '100.0000');
    await provarReplay(x);
  });

  test('D-PROD-313: FALTA com movimentos depois (E1 100 a 4, E2 100 a 6, falta 50 a 5, E3 50 a 9, S 80 × 6 = 480) → 409 registro posterior (S); nada gravado; excluídas S e E3, o ajuste sai e o estoque volta a 200 kg', async () => {
    const x = await montar();
    const A = x.local;
    await entrar(x, A, '100', '4');
    await entrar(x, A, '100', '6');
    const a = await ajustar(x, A, '150');
    assert.equal(a.itens[0].tipo, 'FALTA');
    const e3 = await entrar(x, A, '50', '9');
    const s = await sair(x, A, '80');
    const ms = await movDoItem(s);
    assert.deepEqual(valores(ms), ['6.0000', '480.0000', '200.0000', '120.0000']);
    const antes = await foto(x);
    exigirRegistroPosterior(await excluirAjuste(x, a), [ms.id], A);
    assert.equal(await foto(x), antes, 'nada gravado');
    ok(await excluirSaida(x, s));
    exigirRegistroPosterior(await excluirAjuste(x, a), [e3.itens[0].movimentacao_estoque_id], A);
    ok(await excluirEntrada(x, e3));
    const r = ok(await excluirAjuste(x, a));
    assert.equal(r.status, 'EXCLUIDA');
    assert.equal(await estoqueAtual(x), '200.0000');
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
/** Atividade aberta + apontamento do dia; devolve quem lança e quem cancela a linha de produto. */
const atividade = async (x) => {
  const a = ok(await H.req('POST', '/atividades', x.token, {
    empresa_id: x.e1.id, nome: `Adubação ${++seq}`, tipo_atividade_id: x.tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30',
  }), 201);
  const base = `/atividades/${a.id}/apontamentos`;
  let ap = ok(await H.req('POST', base, x.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', area_executada_dia: '10' }), 201).apontamento;
  return {
    lancar: async (local, kg) => {
      const r = ok(await H.req('POST', `${base}/${ap.id}/produtos`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), produto_id: x.sal.id, local_estoque_id: local.id, quantidade: kg }), 201);
      ap = r.apontamento;
      return r.linha;
    },
    cancelar: async (linha) => {
      const r = ok(await H.req('POST', `${base}/${ap.id}/produtos/${linha.id}/cancelar`, x.token, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), motivo: 'lançado errado' }));
      ap = r.apontamento;
      return r.linha;
    },
  };
};
const cancelarCocho = (x, id) =>
  H.req('POST', `/suplementacao-eventos/${id}/cancelamento`, x.token, { empresa_id: x.e1.id, operation_id: `canc-${randomUUID()}`, motivo: 'lançado em dobro' });
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
  test('cascata — D-PROD-313: a transferência depois prende a E1 (409 registro posterior) e a saída em B prende a transferência; nada gravado; do mais recente ao mais antigo (SB, a transferência, E2) a E1 sai; as camadas de destino ficam Estornado; sem nada depois da transferência, ela e a E1 saem', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    // A: E1 50 a 2 (L1), E2 100 a 5 (L2) → 150 kg, R$ 600, médio 4; B: EB 40 a 8. T 80 A→B a 4 = 320 (L1 50 + L2 30) → B 120 kg; SB 30 em B
    const e1 = await entrar(x, A, '50', '2');
    const e2 = await entrar(x, A, '100', '5');
    const eb = await entrar(x, B, '40', '8');
    const L1 = await camadaDaEntrada(e1);
    const L2 = await camadaDaEntrada(e2);
    const t = await transferir(x, A, B, '80');
    const sb = await sair(x, B, '30');
    const msb = await movDoItem(sb);
    const antigas = (await mov(t.s.id)).lotes_consumidos.map((f) => f.lote_destino_id);
    assert.deepEqual(fatias(await mov(t.s.id)), [[L1, '50.0000', '4.0000'], [L2, '30.0000', '4.0000']]);
    assert.deepEqual(valores(msb).slice(2), ['120.0000', '90.0000']);
    await provarReplay(x);
    const antes = await foto(x);
    // a mais recente que vale no depósito A é a transferência (as duas pernas tocam A); no destino, a SB prende a transferência
    await exigirPreviaRegistroPosterior(x, e1.itens[0].movimentacao_estoque_id, [t.s.id, t.r.id]);
    exigirRegistroPosterior(await excluirEntrada(x, e1), [t.s.id, t.r.id], A);
    exigirRegistroPosterior(await cancelarTransferencia(x, t.s.id), [msb.id], B);
    assert.equal(await foto(x), antes, 'nada gravado');
    // do mais recente ao mais antigo: SB e então a transferência; a E2 continua prendendo a E1
    ok(await excluirSaida(x, sb));
    ok(await cancelarTransferencia(x, t.s.id));
    for (const id of antigas) assert.deepEqual((await camada(id)).status, 'Estornado');
    assert.deepEqual([(await camada(await camadaDaEntrada(eb))).disp, (await camada(await camadaDaEntrada(eb))).status], ['40.0000', 'Disponivel'], 'B fica com a EB');
    assert.deepEqual([(await camada(L1)).disp, (await camada(L2)).disp], ['50.0000', '100.0000'], 'A volta a 150 kg');
    exigirRegistroPosterior(await excluirEntrada(x, e1), [e2.itens[0].movimentacao_estoque_id], A);
    assert.equal(await estoqueAtual(x), '190.0000');
    await provarReplay(x);
    // a E2 (a camada dela citada na transferência já cancelada, par marcado) e então a E1 saem; B fica com a EB
    ok(await excluirEntrada(x, e2));
    ok(await excluirEntrada(x, e1));
    assert.deepEqual([(await camada(L1)).disp, (await camada(L1)).status], ['0.0000', 'Estornado']);
    assert.deepEqual([(await camada(L2)).disp, (await camada(L2)).status], ['0.0000', 'Estornado']);
    assert.deepEqual([(await camada(await camadaDaEntrada(eb))).disp, (await camada(await camadaDaEntrada(eb))).custo, (await camada(await camadaDaEntrada(eb))).status], ['40.0000', '8.0000', 'Disponivel']);
    assert.equal(await estoqueAtual(x), '40.0000');
    await provarReplay(x);

    // sem nada depois da transferência: ela sai pelo estorno exato e, então, a E1 (a camada volta inteira)
    const y = await montar();
    const f1 = await entrar(y, y.local, '100', '4');
    const ty = await transferir(y, y.local, y.local2, '80');
    exigirRegistroPosterior(await excluirEntrada(y, f1), [ty.s.id, ty.r.id], y.local);
    assert.equal(ok(await cancelarTransferencia(y, ty.s.id)).recalculo ?? null, null);
    assert.equal(ok(await excluirEntrada(y, f1)).status, 'EXCLUIDA');
    assert.deepEqual([(await camada(await camadaDaEntrada(f1))).disp, (await camada(await camadaDaEntrada(f1))).status], ['0.0000', 'Estornado']);
    assert.equal(await estoqueAtual(y), '0.0000');
    await provarReplay(y);
  });

  test('cocho e atividade depois da entrada — D-PROD-313: excluir a E1 → 409 registro posterior (a linha da atividade); nada gravado (o cocho e a linha ficam com o custo de antes); cancelados a linha e o cocho, a E2 (camada reavaliada) sai e então a E1', async () => {
    const x = await montar();
    const A = x.local;
    // E1 50 a 2 (L1), E2 150 a 6 (L2): 200 kg, R$ 1.000, médio 5. Cocho 30 × 5 = 150 (L1 30); linha 60 × 5 = 300 (L1 20 + L2 40)
    const e1 = await entrar(x, A, '50', '2');
    const e2 = await entrar(x, A, '150', '6');
    const L1 = await camadaDaEntrada(e1);
    const L2 = await camadaDaEntrada(e2);
    const c = await lancarCocho(x, A, { ponto: 'cocho-1', kg: 30, data: '2027-06-01' });
    const at = await atividade(x);
    const linha = await at.lancar(A, '60');
    assert.deepEqual(fatias(await mov(c.mov.id)), [[L1, '30.0000', '5.0000']]);
    const antesLinha = await prisma().atividadeApontamentoProduto.findUnique({ where: { id: linha.id }, include: { consumos: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual([v4(antesLinha.custo_total), antesLinha.consumos.map((f) => [f.estoque_lote_nota_id, f.ordem, v4(f.quantidade)])], ['300.0000', [[L1, 1, '20.0000'], [L2, 2, '40.0000']]]);
    assert.equal((await prisma().suplementacaoEvento.findUnique({ where: { id: c.evento.id } })).dados.custo_unitario_kg, 5);
    await provarReplay(x);
    const antes = await foto(x);
    await exigirPreviaRegistroPosterior(x, e1.itens[0].movimentacao_estoque_id, [linha.movimentacao_estoque_id]);
    exigirRegistroPosterior(await excluirEntrada(x, e1), [linha.movimentacao_estoque_id], A);
    assert.equal(await foto(x), antes, 'nada gravado');
    assert.equal((await prisma().suplementacaoEvento.findUnique({ where: { id: c.evento.id } })).dados.custo_unitario_kg, 5, 'o custo/kg do cocho não muda');
    const depoisLinha = await prisma().atividadeApontamentoProduto.findUnique({ where: { id: linha.id }, include: { consumos: { orderBy: { ordem: 'asc' } } } });
    assert.deepEqual(depoisLinha, antesLinha, 'a linha e as fatias dela não mudam');
    // do mais recente ao mais antigo: a linha da atividade, o cocho, a E2 e então a E1
    await at.cancelar(linha);
    exigirRegistroPosterior(await excluirEntrada(x, e1), [c.mov.id], A);
    ok(await cancelarCocho(x, c.evento.id));
    // a camada da E2 foi reavaliada (médio 5) e sem ela o par da linha passaria por −40: o par sai da sequência com ela
    ok(await excluirEntrada(x, e2));
    assert.deepEqual(await camada(L1), { disp: '50.0000', custo: '2.0000', status: 'Disponivel', entrada: '50.0000' }, 'A fica com a E1, no custo dela');
    assert.deepEqual([(await camada(L2)).disp, (await camada(L2)).status], ['0.0000', 'Estornado'], 'a camada fica (as FKs das fatias são Restrict)');
    await exigirParMarcado(linha.movimentacao_estoque_id);
    await exigirParMarcado(c.mov.id);
    assert.equal(await estoqueAtual(x), '50.0000');
    // a E1 por último: as fatias dela na linha e no cocho são de pares marcados e não a prendem
    ok(await excluirEntrada(x, e1));
    assert.deepEqual([(await camada(L1)).disp, (await camada(L1)).status], ['0.0000', 'Estornado']);
    assert.equal(await estoqueAtual(x), '0.0000');
    await provarReplay(x);
  });

  test('concorrência: duas exclusões de entrada no mesmo produto (a trava do produto as enfileira) passam uma depois da outra — D-PROD-313: cada uma é a última no seu depósito, pelo estorno exato; a que tem algo depois no depósito recusa', async () => {
    const x = await montar();
    const A = x.local;
    const B = x.local2;
    // A: E0 100 a 8 e E1 100 a 4; B: E2 100 a 6. E1 é a última em A e E2 a última em B: as duas podem sair, em qualquer ordem;
    // E0 tem a E1 depois em A e recusa enquanto a E1 vale.
    const e0 = await entrar(x, A, '100', '8');
    const e1 = await entrar(x, A, '100', '4');
    const e2 = await entrar(x, B, '100', '6');
    exigirRegistroPosterior(await excluirEntrada(x, e0), [e1.itens[0].movimentacao_estoque_id], A);
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
    let naFila = 0;
    for (let i = 0; i < 400; i++) {
      const [{ c }] = /** @type {any[]} */ (await prisma().$queryRaw`SELECT count(*)::int AS c FROM pg_locks WHERE NOT granted`);
      naFila = c;
      if (c >= 2) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    assert.ok(naFila >= 2, 'as duas exclusões esperam a trava do produto');
    liberar();
    await fim;
    const [r1, r2] = await Promise.all([x1, x2]);
    assert.deepEqual([r1.statusCode, r2.statusCode], [200, 200], `${r1.body} ${r2.body}`);
    assert.deepEqual([r1.json().recalculo, r2.json().recalculo], [null, null], 'nada depois: o estorno exato de sempre');
    assert.deepEqual([(await camada(await camadaDaEntrada(e1))).status, (await camada(await camadaDaEntrada(e2))).status], ['Estornado', 'Estornado']);
    assert.deepEqual(await camada(await camadaDaEntrada(e0)), { disp: '100.0000', custo: '8.0000', status: 'Disponivel', entrada: '100.0000' });
    assert.equal(await estoqueAtual(x), '100.0000');
    await provarReplay(x);
  });
});

// ─── achados da revisão independente (rev5) ─────────────────────────────────
const vender = async (x, local, kg, preco) => {
  const p = prisma();
  const base = { cliente_id: x.c, empresa_id: x.e1.id };
  const marca = randomUUID().slice(0, 6);
  const cli = await p.fornecedor.create({ data: { ...base, numero_cadastro: `CL-${marca}`, tipo_pessoa: 'Jurídica', nome: `Cliente ${marca}`, tipos: ['cliente'] } });
  const rec = await p.naturezaFinanceira.create({ data: { ...base, numero: `RC-${marca}`, tipo: 'RECEITA', nome: `VENDAS ${marca}` } });
  const total = (Number(kg) * Number(preco)).toFixed(2);
  const doc = {
    empresa_id: x.e1.id, direcao: 'RECEBER', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: cli.id, data_emissao: '2027-06-10', data_operacional: '2027-06-10',
    efeito_fisico_confirmado: true, itens: [{ tipo_item: 'MERCADORIA', produto_id: x.sal.id, local_estoque_id: local.id, unidade: 'KG', quantidade: kg, valor_unitario: preco }],
    rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: rec.id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
  };
  const criada = ok(await H.req('POST', '/operacoes-financeiras', x.token, { ...doc, operation_id: opId() }), 201);
  return ok(await H.req('POST', `/operacoes-financeiras/${criada.id}/confirmar`, x.token, { empresa_id: x.e1.id, operation_id: opId(), versao: criada.versao }));
};
/** Segura a trava do produto de fora; devolve quem libera. */
const segurarTrava = async (x) => {
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
  return async () => { liberar(); await fim; };
};
const esperarNaFila = async (n) => {
  for (let i = 0; i < 400; i++) {
    const [{ c }] = /** @type {any[]} */ (await prisma().$queryRaw`SELECT count(*)::int AS c FROM pg_locks WHERE NOT granted`);
    if (c >= n) return;
    await new Promise((res) => setTimeout(res, 25));
  }
};

describe('D-PROD-273 fatia 5 — achados da revisão', () => {
  test('(1) corrida: cancelar a venda enquanto a exclusão da E1 espera a trava — D-PROD-313: a exclusão recusa (registro posterior: a venda ou a saída) sem gravar e a venda cancela; depois, do mais recente ao mais antigo, a E1 sai; replay = gravado', async () => {
    const x = await montar();
    const A = x.local;
    // E1 100 a 4, E2 100 a 6, E3 100 a 8; S 100 a 6 = 600 (L1); venda 50 a 7 = 350 (L2)
    const e1 = await entrar(x, A, '100', '4');
    const e2 = await entrar(x, A, '100', '6');
    const e3 = await entrar(x, A, '100', '8');
    const s = await sair(x, A, '100');
    const venda = await vender(x, A, '50', '20');
    const ms = await movDoItem(s);
    const mv = (await prisma().movimentacaoEstoque.findFirst({ where: { cliente_id: x.c, tipo_detalhado: 'venda_financeiro' } })).id;
    const [L1, L2, L3] = await Promise.all([camadaDaEntrada(e1), camadaDaEntrada(e2), camadaDaEntrada(e3)]);
    const antesL3 = await camada(L3);
    const soltar = await segurarTrava(x);
    const pE = excluirEntrada(x, e1);
    await esperarNaFila(1);
    const pV = cancelarLancamento(x, venda.id);
    await esperarNaFila(2);
    await soltar();
    const [rE, rV] = await Promise.all([pE, pV]);
    // em qualquer ordem a E1 tem algo depois que vale (a venda, se vier antes do cancelamento; senão, a saída S)
    exigirRegistroPosterior(rE, [mv, ms.id], A);
    assert.equal(rV.statusCode, 200, rV.body);
    // a venda devolve a fatia ao seu lote; a E1 continua como estava
    assert.deepEqual([(await movDoItem(e1)).status, (await camada(L1)).status], ['Ativa', 'Esgotado']);
    assert.equal(await estoqueAtual(x), '200.0000');
    assert.deepEqual(await camada(L3), antesL3);
    await provarReplay(x);
    // do mais recente ao mais antigo: S, E3, E2 e então a E1
    exigirRegistroPosterior(await excluirEntrada(x, e1), [ms.id], A);
    ok(await excluirSaida(x, s));
    ok(await excluirEntrada(x, e3));
    ok(await excluirEntrada(x, e2));
    assert.equal(ok(await excluirEntrada(x, e1)).status, 'EXCLUIDA');
    for (const L of [L1, L2, L3]) assert.equal((await camada(L)).status, 'Estornado');
    assert.equal(await estoqueAtual(x), '0.0000');
    await provarReplay(x);
  });

  test('(2) "camada intocada" (custo voltou ao do movimento) mas a entrada entrou no médio de S1 e S2: a exclusão RECUSA (nunca o estorno exato); a prévia diz o mesmo — D-PROD-313: pelo registro posterior (S2), antes do recálculo', async () => {
    const x = await montar();
    const A = x.local;
    // L0 100 a 5, E 100 a 5, X 100 a 11 → 300 kg, médio 7; S1 50 × 7 = 350 (L0); Y 250 a 3 → 500 kg, médio 5; S2 10 × 5 = 50; E volta a custo 5
    await entrar(x, A, '100', '5');
    const e = await entrar(x, A, '100', '5');
    await entrar(x, A, '100', '11');
    const s1 = await sair(x, A, '50');
    await entrar(x, A, '250', '3');
    const s2 = await sair(x, A, '10');
    const mE = await movDoItem(e);
    const mS2 = s2.itens[0].movimentacao_estoque_id;
    assert.deepEqual(await camada(await camadaDaEntrada(e)), { disp: '100.0000', custo: '5.0000', status: 'Disponivel', entrada: '100.0000' });
    // D-PROD-313: a prévia já não oferece o recálculo; recusa pela S2, a mais recente que vale
    await exigirPreviaRegistroPosterior(x, mE.id, [mS2]);
    // com o grupo legado no movimento da entrada (antes, uma recusa contornável do recálculo): D-PROD-313 — a recusa
    // grupo_legado_preenchido agora é precedida pela do registro posterior; nunca o estorno exato
    await prisma().movimentacaoEstoque.update({ where: { id: mE.id }, data: { movimentacao_grupo_id: 'legado-x' } });
    const antes = await foto(x);
    await exigirPreviaRegistroPosterior(x, mE.id, [mS2]);
    exigirRegistroPosterior(await excluirEntrada(x, e), [mS2], A);
    assert.equal(await foto(x), antes, 'nada gravado: S1 e S2 continuam 350 e 50, coerentes com a entrada que continua');
    assert.deepEqual([v4((await movDoItem(s1)).valor_total), v4((await movDoItem(s2)).valor_total)], ['350.0000', '50.0000']);
  });

  test('(2) regressão citada: compra cujo abastecimento já foi cancelado (par excluído não conta) continua cancelável pelo estorno exato', async () => {
    const x = await montar();
    const { acoesAbastecimento, corpoAbastecimento } = await import('./patrimonioP1AbastecimentoCenario.mjs');
    const AB = acoesAbastecimento(app);
    const { operacao: c, lote_id: LC } = await x.compraP3(x.e1, x.diesel, x.local, { quantidade: '100', preco: '5' });
    const ab = await AB.confirmarOk(x.token, corpoAbastecimento(x, { quantidade: '80', medidor_leitura: '1550.5' }));
    ok(await AB.cancelar(x.token, ab.id, { empresa_id: x.e1.id, versao: ab.versao, motivo: 'lançado em dobro', operation_id: opId() }));
    const r = await cancelarLancamento(x, c.id);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(await camada(LC), { disp: '0.0000', custo: '5.0000', status: 'Estornado', entrada: '100.0000' });
    await provarReplay(x, x.diesel);
  });

  test('(3) a prévia e a exclusão concordam: entrada E (único estoque) e a saída S de 30 kg excluída depois → as duas permitem; o par da saída sai da sequência com a entrada, marcado, sem regravar nada', async () => {
    const x = await montar();
    const A = x.local;
    const e = await entrar(x, A, '100', '4');
    const s = await sair(x, A, '30');
    ok(await H.req('POST', `/estoque/saidas/${s.id}/excluir`, x.token, { empresa_id: x.e1.id, versao: s.versao, motivo: 'lançada errada', operation_id: `xs-${randomUUID()}` }));
    const pv = ok(await previa(x, e.itens[0].movimentacao_estoque_id));
    const mE = e.itens[0].movimentacao_estoque_id;
    assert.deepEqual([pv.permitido, pv.modo, pv.aviso, pv.recusa, pv.movimentos.length], [true, 'recalculo', null, null, 0]);
    const r = await excluirEntrada(x, e);
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().recalculo, { produtos: 1, movimentos: 0, camadas: 0, dependentes: 0 });
    assert.equal(await estoqueAtual(x), '0.0000');
    const [t] = await trilha(x, 'Produto', x.sal.id);
    assert.deepEqual([t?.dados_novos?.recalculo_dispensado, t?.dados_novos?.movimentos_excluidos, t?.dados_novos?.movimentos_reescritos], [undefined, [mE], 0]);
    await exigirParMarcado(mE);
    await exigirParMarcado(s.itens[0].movimentacao_estoque_id);
    await provarReplay(x);
  });
});
