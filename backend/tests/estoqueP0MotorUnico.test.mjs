/**
 * D-PROD-161 — Estoque P0 (fatia F1): MOTOR FÍSICO ÚNICO. A suplementação e a
 * transferência entre locais deixam o FIFO próprio em Number (`fifoEstoque.js`)
 * e passam pelas primitivas do motor (`aplicarSaida`,
 * `aplicarTransferenciaEstoque`): Decimal ponta a ponta, CAS no lote, decremento
 * conferido do cache, local validado e travado, número no fim.
 * PostgreSQL real, HTTP autenticado, prova pelas linhas gravadas.
 *
 *  EX1. exemplo da missão: compra 100 sacos → suplementação 20 → transferência 30
 *       → venda a custo médio no destino → cancelar a compra falha por dependência;
 *  S.   suplementação: 2 camadas de custo diferente, rateio Decimal exato,
 *       recusas antes de qualquer escrita, limite, observações longas;
 *  T.   transferência: parcial em várias camadas, origem −, destino +, total
 *       conservado, custo e data da camada preservados (bug 2001), procedência
 *       copiada, replay, local inválido;
 *  M.   guardas do motor, tenancy sem oráculo, recibo antigo, empate de data,
 *       rollback, data inválida;
 *  AB-X. abastecimento sobre a camada transferida (FIFO pela data verdadeira);
 *  F9a. confirmar duas vezes / duplicar nunca cria segunda entrada.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, corpoErro, docCom, foto, loteLegado, montarTenant, motivo, opId, prisma, somaLotes } from './gestaoP3Cenario.mjs';
import { acoesAbastecimento, corpoAbastecimento, montarAbastecimento, opId as opIdAb } from './patrimonioP1AbastecimentoCenario.mjs';
import * as motor from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof acoes>} */
let A;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let AB;
before(async () => {
  app = await criarApp();
  await app.ready();
  await limparBanco();
  A = acoes(app);
  AB = acoesAbastecimento(app);
});
after(async () => {
  await app.close();
  await encerrar();
});

// ─── apoio ──────────────────────────────────────────────────────────────────
const D = (v) => new Prisma.Decimal(v);
const q4 = (v) => D(v).toFixed(4);
const item = (produto, quantidade, valor_unitario, extra = {}) => ({ produto, quantidade, valor_unitario, ...extra });
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const definirEstoqueAtual = (produto, kg) => prisma().produto.update({ where: { id: produto.id }, data: { estoque_atual: kg } });
const lote = (id) => prisma().estoqueLoteNota.findUnique({ where: { id } });
const movimento = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const dia = (d) => (d ? d.toISOString().slice(0, 10) : null);
const URL_SUP = '/movimentacoes-estoque/comandos/saida-suplementacao';
const URL_TRANSF = '/movimentacoes-estoque/comandos/transferencia-locais';
const suplementar = (s, e, produto, local, quantidade, extra = {}) =>
  A.req('POST', URL_SUP, s.token, { operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: local.id, quantidade, ...extra });
const transferir = (s, e, produto, origem, destino, quantidade, extra = {}) =>
  A.req('POST', URL_TRANSF, s.token, {
    operation_id: opId(), empresa_id: e.id, produto_id: produto.id, local_origem_id: origem.id, local_destino_id: destino.id, quantidade, ...extra,
  });
/** `[status, code, field, reason]` (o tradutor HTTP põe field/reason no topo do corpo). */
const recusa = (r) => [r.statusCode, codigo(r), r.json().field ?? null, motivo(r) ?? null];
const fatiasDoMovimento = (m) => (m.lotes_consumidos ?? []).map((f) => [f.lote_id, f.quantidade, f.custo_unitario]);

/** Lote direto no banco com id/createdAt escolhidos (empate de data, data nula). */
const loteCom = (s, e, produto, local, { id, kg, custo = '2.0000', dia: d = null, createdAt }) =>
  prisma().estoqueLoteNota.create({
    data: {
      id, cliente_id: s.c, empresa_id: e.id, produto_id: produto.id, produto_nome: produto.nome_produto, local_estoque_id: local.id, local_estoque_nome: local.nome,
      data_documento: d ? new Date(`${d}T00:00:00.000Z`) : null, custo_unitario: custo, quantidade_entrada: kg, quantidade_disponivel: kg, status: 'Disponivel',
      ...(createdAt ? { createdAt } : {}),
    },
  });

/**
 * Invariantes físicos (copiados de `gestaoP3Estoque.test.mjs`):
 *  (a) por produto: estoque_atual − Σ disponível dos lotes da empresa do produto = diferença inicial;
 *  (b) por empresa+produto+local: Σ disponível ≥ 0;
 *  (c) por lote: 0 ≤ disponível ≤ entrada e situação coerente com o disponível.
 */
const conferirInvariantes = async (s, diferencas, rotulo) => {
  const p = prisma();
  const produtos = await p.produto.findMany({ where: { cliente_id: s.c }, select: { id: true, empresa_id: true, estoque_atual: true } });
  const lotes = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c } });
  for (const prod of produtos) {
    const soma = lotes.filter((l) => l.produto_id === prod.id && l.empresa_id === prod.empresa_id && l.status === 'Disponivel').reduce((t, l) => t.plus(D(l.quantidade_disponivel)), D(0));
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
  const provisorios = await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, numero_movimentacao: { startsWith: 'p-' } } });
  assert.equal(provisorios, 0, `${rotulo}: nenhum movimento commitado com número provisório`);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('EX1 — exemplo da missão (compra 100 sacos → suplementação 20 → transferência 30 → venda a custo médio no destino → cancelar a compra)', () => {
  test('números exatos em cada passo; a camada transferida mantém custo, data e procedência; a venda no destino respeita a data verdadeira; o cancelamento da compra falha por dependência sem desfazer nada', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    // 0. o cadastro do produto nunca credita saldo
    assert.equal(await estoqueAtual(e.racao), '0.0000');
    assert.equal(await p.estoqueLoteNota.count({ where: { cliente_id: s.c, produto_id: e.racao.id } }), 0);

    // 1. compra de 100 sacos (30 kg) a 80,00 o saco
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.racao, '100', '80', { unidade: 'SACO' })]));
    const L1 = await lote(compra.itens[0].estoque_lote_nota_id);
    assert.deepEqual([q4(L1.quantidade_entrada), q4(L1.quantidade_disponivel), q4(L1.custo_unitario), L1.status, L1.local_estoque_id], ['3000.0000', '3000.0000', '2.6667', 'Disponivel', s.local.id]);
    const mCompra = await movimento(compra.itens[0].movimentacao_estoque_id);
    assert.deepEqual([mCompra.tipo_movimentacao, mCompra.tipo_detalhado, q4(mCompra.quantidade), q4(mCompra.valor_total)], ['Entrada', 'compra_financeiro', '3000.0000', '8000.0000']);
    assert.equal(await estoqueAtual(e.racao), '3000.0000');

    // 2. suplementação de 20 sacos = 600 kg no mesmo local
    const rs = await suplementar(s, e, e.racao, s.local, 600);
    assert.equal(rs.statusCode, 201, rs.body);
    const sup = rs.json();
    const mSup = await movimento(sup.movimentacao.id);
    assert.deepEqual(
      [mSup.tipo_movimentacao, mSup.tipo_detalhado, mSup.origem_sistema, q4(mSup.quantidade), q4(mSup.valor_total), q4(mSup.valor_unitario), mSup.unidade_medida, mSup.modo_saida_fifo],
      ['Saída', 'suplementacao', 'suplementacao', '600.0000', '1600.0200', '2.6667', 'KG', 'CUSTO_MEDIO'],
    );
    assert.deepEqual(fatiasDoMovimento(mSup), [[L1.id, '600.0000', '2.6667']]);
    assert.match(mSup.numero_movimentacao, /^\d+$/);
    assert.equal(sup.movimentacao.numero_movimentacao, mSup.numero_movimentacao, 'a resposta traz o número final, nunca o provisório');
    assert.equal(q4((await lote(L1.id)).quantidade_disponivel), '2400.0000');
    assert.equal(await estoqueAtual(e.racao), '2400.0000');

    // 3. transferência de 30 sacos = 900 kg para o local 2
    const fin = async () => [await p.operacaoFinanceira.count({ where: { cliente_id: s.c } }), await p.tituloFinanceiro.count({ where: { cliente_id: s.c } })];
    const finAntes = await fin();
    const rt = await transferir(s, e, e.racao, s.local, s.local2, 900);
    assert.equal(rt.statusCode, 201, rt.body);
    const tr = rt.json();
    const saida = await movimento(tr.movimentacao_saida.id);
    const entrada = await movimento(tr.movimentacao_entrada.id);
    assert.deepEqual(
      [saida.tipo_movimentacao, saida.tipo_detalhado, saida.origem_sistema, q4(saida.quantidade), q4(saida.valor_total), saida.movimento_filho_id, saida.local_estoque_origem, saida.local_estoque_destino],
      ['Saída', 'transferencia_enviada', 'deposito', '900.0000', '2400.0300', entrada.id, s.local.id, s.local2.id],
    );
    assert.deepEqual([entrada.tipo_movimentacao, entrada.tipo_detalhado, q4(entrada.quantidade), entrada.movimento_pai_id], ['Entrada', 'transferencia_recebida', '900.0000', saida.id]);
    assert.equal(tr.movimentacao_saida.movimento_filho_id, entrada.id, 'a resposta traz o filho preenchido');
    assert.equal(BigInt(entrada.numero_movimentacao), BigInt(saida.numero_movimentacao) + 1n, 'saída = n, entrada = n + 1');
    assert.equal(q4((await lote(L1.id)).quantidade_disponivel), '1500.0000');
    const destino = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: e.racao.id, local_estoque_id: s.local2.id } });
    assert.equal(destino.length, 1);
    const T1 = destino[0];
    assert.deepEqual(
      [q4(T1.quantidade_entrada), q4(T1.quantidade_disponivel), q4(T1.custo_unitario), T1.status, T1.movimentacao_entrada_id, T1.empresa_id, T1.local_estoque_nome],
      ['900.0000', '900.0000', '2.6667', 'Disponivel', entrada.id, e.id, s.local2.nome],
    );
    assert.equal(dia(T1.data_documento), dia(L1.data_documento), 'a camada transferida mantém a data da camada de origem (nunca 2001)');
    assert.deepEqual(
      [T1.numero_documento, T1.serie_documento, T1.fornecedor_id, T1.fornecedor_nome],
      [L1.numero_documento, L1.serie_documento, L1.fornecedor_id, L1.fornecedor_nome],
      'procedência copiada exatamente',
    );
    assert.deepEqual(saida.lotes_consumidos.map((f) => [f.lote_id, f.quantidade, f.custo_unitario, f.lote_destino_id]), [[L1.id, '900.0000', '2.6667', T1.id]]);
    assert.equal(await estoqueAtual(e.racao), '2400.0000', 'a transferência não muda o cache');
    assert.deepEqual(await fin(), finAntes, 'nenhum lançamento nem título novo');

    // 4. camada legada mais antiga no destino + venda de 10 sacos (300 kg) no destino
    const leg = await loteLegado(s, e, e.racao, s.local2, { kg: '100', custo: '5.0000', dia: '2027-01-01' });
    await definirEstoqueAtual(e.racao, '2500');
    const venda = await A.criarConfirmar(s.token, docCom(e, s.local2, [item(e.racao, '10', '120', { unidade: 'SACO' })], { direcao: 'RECEBER' }));
    const itemVenda = await p.operacaoFinanceiraItem.findFirst({ where: { cliente_id: s.c, operacao_id: venda.id } });
    const fatias = await p.operacaoFinanceiraConsumoLote.findMany({ where: { cliente_id: s.c, item_id: itemVenda.id } });
    assert.deepEqual(
      Object.fromEntries(fatias.map((f) => [f.estoque_lote_nota_id, [q4(f.quantidade), q4(f.custo_unitario)]])),
      // D-PROD-256: poço do destino = 100×5,0000 + 900×2,6667 = 2900,03 em 1000 kg → médio 2,9000 em TODAS as fatias
      { [leg.id]: ['100.0000', '2.9000'], [T1.id]: ['200.0000', '2.9000'] },
      'lotes baixados pela data verdadeira (o legado, 2027-01-01, antes da camada transferida), mas valorizados pelo médio do poço',
    );
    const mVenda = await movimento(itemVenda.movimentacao_estoque_id);
    assert.deepEqual([q4(mVenda.valor_total), q4(mVenda.valor_unitario)], ['870.0000', '2.9000']);
    assert.deepEqual(mVenda.lotes_consumidos.map((f) => f.lote_id), [leg.id, T1.id]);
    assert.deepEqual([q4((await lote(T1.id)).quantidade_disponivel), (await lote(leg.id)).status], ['700.0000', 'Esgotado']);
    assert.equal(q4((await lote(T1.id)).custo_unitario), '2.9000', 'o restante foi reavaliado: (2900,03 − 870) ÷ 700');
    assert.equal(await estoqueAtual(e.racao), '2200.0000');

    // 5. cancelar a compra: 409 por dependência, nada muda
    const antes = await foto([s.c]);
    const rc = await A.cancelarReq(s.token, compra.id, e.id);
    assert.deepEqual([rc.statusCode, codigo(rc), motivo(rc)], [409, 'ESTOQUE_JA_CONSUMIDO', 'lote_consumido'], rc.body);
    const det = rc.json().details;
    assert.deepEqual([det.lote_id, det.entrada, det.disponivel], [L1.id, '3000.0000', '1500.0000']);
    assert.equal(await foto([s.c]), antes, 'o cancelamento recusado não desfez nada');
    const el = await A.ok(A.req('GET', `/operacoes-financeiras/${compra.id}/elegibilidade?empresa_id=${e.id}`, s.token));
    assert.equal(el.excluir.permitido, false);
    const m = el.excluir.motivos.find((x) => x.codigo === 'lote_consumido');
    assert.ok(m, JSON.stringify(el.excluir.motivos));
    assert.deepEqual([m.entidade, m.numero], ['MovimentacaoEstoque', mSup.numero_movimentacao], 'a dependência é a suplementação (o primeiro consumo do lote)');
    const atual = await A.detalhe(s.token, compra.id, e.id);
    const rr = await A.req('POST', `/operacoes-financeiras/${compra.id}/retificar`, s.token, {
      ...docCom(e, s.local, [item(e.racao, '90', '80', { unidade: 'SACO' })]), versao: atual.versao, operation_id: opId(), motivo: 'correção de teste',
    });
    assert.deepEqual([rr.statusCode, codigo(rr)], [409, 'OPERACAO_RETIFICACAO_BLOQUEADA'], rr.body);
    const rx = await A.req('POST', `/operacoes-financeiras/${compra.id}/excluir`, s.token, { empresa_id: e.id, versao: atual.versao, operation_id: opId(), motivo: 'exclusão de teste' });
    assert.deepEqual([rx.statusCode, codigo(rx)], [409, 'OPERACAO_EXCLUSAO_BLOQUEADA'], rx.body);
    assert.equal(await foto([s.c]), antes, 'retificação e exclusão recusadas não desfizeram nada');

    // 6. invariantes
    await conferirInvariantes(s, {}, 'EX1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('S — suplementação no motor (Decimal, CAS, cache conferido)', () => {
  test('S1: duas camadas de custo diferente, pedido 12,34567 → kg 12,3457 (HALF_UP uma vez); médio (20 + 166,665) ÷ 60 = 3,1111, valor 38,4087; fatias gravadas; A esgotado, B 47,6543; cache 47,6543; rateio legado na resposta', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const la = await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '2.0000', dia: '2027-05-01' });
    const lb = await loteLegado(s, e, e.sal, s.local, { kg: '50', custo: '3.3333', dia: '2027-05-02' });
    await definirEstoqueAtual(e.sal, '60');
    const r = await suplementar(s, e, e.sal, s.local, 12.34567);
    assert.equal(r.statusCode, 201, r.body);
    const corpo = r.json();
    const m = await movimento(corpo.movimentacao.id);
    assert.deepEqual(
      [q4(m.quantidade), q4(m.valor_total), q4(m.valor_unitario), q4(m.custo_medio_depois), q4(m.saldo_antes), q4(m.saldo_depois), m.unidade_medida, m.modo_saida_fifo],
      ['12.3457', '38.4087', '3.1111', '3.1111', '60.0000', '47.6543', 'KG', 'CUSTO_MEDIO'],
    );
    assert.deepEqual(fatiasDoMovimento(m), [[la.id, '10.0000', '3.1111'], [lb.id, '2.3457', '3.1111']]);
    assert.equal(m.observacoes, '[RATEIO_FIFO] S/N: 10.000 kg | S/N: 2.346 kg');
    assert.deepEqual([(await lote(la.id)).status, q4((await lote(la.id)).quantidade_disponivel)], ['Esgotado', '0.0000']);
    assert.deepEqual([(await lote(lb.id)).status, q4((await lote(lb.id)).quantidade_disponivel)], ['Disponivel', '47.6543']);
    assert.equal(q4((await lote(lb.id)).custo_unitario), '3.1111', 'o restante foi reavaliado ao médio de (186,665 − 38,4087) ÷ 47,6543');
    assert.equal(await estoqueAtual(e.sal), '47.6543');
    // contrato externo: rateio com os mesmos campos e números (number)
    assert.deepEqual(corpo.rateio.map((x) => [x.lote_id, x.quantidade_consumida, x.custo_unitario, x.valor_total, x.numero_documento, x.serie_documento]), [
      [la.id, 10, 3.1111, 31.111, 'S/N', ''],
      [lb.id, 2.3457, 3.1111, 7.29770727, 'S/N', ''],
    ]);
    assert.equal(dia(new Date(corpo.rateio[0].data_documento)), '2027-05-01');
    assert.deepEqual([corpo.committed, corpo.replay, corpo.operation_id.length > 0], [true, false, true]);
    await conferirInvariantes(s, {}, 'S1');
  });

  test('S2: pedido 1,23455 → movimento 1,2346 = Δlote = Δcache (lote 8,7654)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const l = await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '10');
    const r = await suplementar(s, e, e.sal, s.local, 1.23455);
    assert.equal(r.statusCode, 201, r.body);
    const m = await movimento(r.json().movimentacao.id);
    assert.deepEqual([q4(m.quantidade), q4((await lote(l.id)).quantidade_disponivel), await estoqueAtual(e.sal)], ['1.2346', '8.7654', '8.7654']);
    await conferirInvariantes(s, {}, 'S2');
  });

  test('S3: [0,1; 0,1; 0,7] pedindo 0,9 → 201 (3 fatias); todos esgotados; cache 0', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const ls = [];
    for (const [k, kg] of ['0.1', '0.1', '0.7'].entries()) ls.push(await loteLegado(s, e, e.sal, s.local, { kg, custo: '1.0000', dia: `2027-05-0${k + 1}` }));
    await definirEstoqueAtual(e.sal, '0.9');
    const r = await suplementar(s, e, e.sal, s.local, 0.9);
    assert.equal(r.statusCode, 201, r.body);
    const m = await movimento(r.json().movimentacao.id);
    assert.deepEqual(fatiasDoMovimento(m), [[ls[0].id, '0.1000', '1.0000'], [ls[1].id, '0.1000', '1.0000'], [ls[2].id, '0.7000', '1.0000']]);
    for (const l of ls) assert.equal((await lote(l.id)).status, 'Esgotado');
    assert.equal(await estoqueAtual(e.sal), '0.0000');
    await conferirInvariantes(s, {}, 'S3');
  });

  test('S4: [0,1 a 2; 0,2 a 3] pedindo 0,3 → os 2 lotes esgotados (nunca "Disponivel" com 0,0000); valor 0,8', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const la = await loteLegado(s, e, e.sal, s.local, { kg: '0.1', custo: '2.0000', dia: '2027-05-01' });
    const lb = await loteLegado(s, e, e.sal, s.local, { kg: '0.2', custo: '3.0000', dia: '2027-05-02' });
    await definirEstoqueAtual(e.sal, '0.3');
    const r = await suplementar(s, e, e.sal, s.local, 0.3);
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([(await lote(la.id)).status, (await lote(lb.id)).status], ['Esgotado', 'Esgotado']);
    assert.equal(q4((await movimento(r.json().movimentacao.id)).valor_total), '0.8000');
    await conferirInvariantes(s, {}, 'S4');
  });

  test('S5: pedido 0,00004 → kg 0,0000 → 422 OPERACAO_VALORES_INVALIDOS quantidade_estoque_zero; nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '10');
    const antes = await foto([s.c]);
    const r = await suplementar(s, e, e.sal, s.local, 0.00004);
    assert.deepEqual(recusa(r), [422, 'OPERACAO_VALORES_INVALIDOS', 'quantidade', 'quantidade_estoque_zero'], r.body);
    assert.equal(await foto([s.c]), antes);
  });

  test('S6: lote 9.999.999 kg a 2.000 → valor acima do limite → 422 valor_excede_limite_estoque (nunca 500); nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '9999999', custo: '2000.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '9999999');
    const antes = await foto([s.c]);
    const r = await suplementar(s, e, e.sal, s.local, 9999999);
    assert.deepEqual(recusa(r).slice(0, 2).concat(motivo(r)), [422, 'OPERACAO_VALORES_INVALIDOS', 'valor_excede_limite_estoque'], r.body);
    assert.equal(await foto([s.c]), antes);
  });

  test('S7: sem negativo — lotes insuficientes → 422 saldo_lote_insuficiente {disponivel, solicitado}; estoque_atual menor que o pedido → 422 estoque_atual_insuficiente ANTES de qualquer escrita', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '10');
    const antes = await foto([s.c]);
    const r = await suplementar(s, e, e.sal, s.local, 11);
    assert.deepEqual(recusa(r), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'saldo_lote_insuficiente'], r.body);
    assert.deepEqual([r.json().details.disponivel, r.json().details.solicitado], ['10.0000', '11.0000']);
    assert.equal(await foto([s.c]), antes);
    await definirEstoqueAtual(e.sal, '5');
    const antes2 = await foto([s.c]);
    const r2 = await suplementar(s, e, e.sal, s.local, 8);
    assert.deepEqual(recusa(r2), [422, 'ESTOQUE_SALDO_INSUFICIENTE', 'quantidade', 'estoque_atual_insuficiente'], r2.body);
    assert.equal(await foto([s.c]), antes2);
  });

  test('S8: observações do usuário perto de 2000 caracteres + rateio de várias camadas → 201; o texto do usuário fica inteiro e só o bloco [RATEIO_FIFO] é cortado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    for (let k = 1; k <= 9; k += 1) await loteLegado(s, e, e.sal, s.local, { kg: '1', custo: '1.0000', dia: `2027-05-0${k}` });
    await definirEstoqueAtual(e.sal, '9');
    const texto = `${'Á'.repeat(1897)}fim`; // 1900 caracteres (o bloco gerado de 9 camadas tem 155)
    const r = await suplementar(s, e, e.sal, s.local, 9, { observacoes: texto });
    assert.equal(r.statusCode, 201, r.body);
    const m = await movimento(r.json().movimentacao.id);
    assert.ok(m.observacoes.startsWith(`${texto}\n[RATEIO_FIFO] S/N: 1.000 kg`), m.observacoes.slice(1890));
    assert.ok([...m.observacoes].length <= 2000, `${[...m.observacoes].length} caracteres`);
    // texto do usuário no limite do schema (2000): o bloco gerado sai inteiro, o texto fica
    await loteLegado(s, e, e.sal, s.local, { kg: '1', custo: '1.0000', dia: '2027-05-09' });
    await definirEstoqueAtual(e.sal, '1');
    const cheio = 'x'.repeat(2000);
    const rc = await suplementar(s, e, e.sal, s.local, 1, { observacoes: cheio });
    assert.equal(rc.statusCode, 201, rc.body);
    assert.equal((await movimento(rc.json().movimentacao.id)).observacoes, cheio);
    // sem observações do usuário: só o bloco gerado (como hoje)
    await loteLegado(s, e, e.sal, s.local, { kg: '1', custo: '1.0000', dia: '2027-05-10' });
    await definirEstoqueAtual(e.sal, '1');
    const r2 = await suplementar(s, e, e.sal, s.local, 1);
    assert.equal((await movimento(r2.json().movimentacao.id)).observacoes, '[RATEIO_FIFO] S/N: 1.000 kg');
  });

  test('S9: origem INATIVA pode ser consumida (resto do saldo); o nome do local vem do banco, não do corpo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '10');
    await prisma().localEstoque.update({ where: { id: s.local.id }, data: { ativo: false } });
    const r = await suplementar(s, e, e.sal, s.local, 4, { local_origem_nome: 'NOME INVENTADO PELO CORPO' });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal((await movimento(r.json().movimentacao.id)).local_origem, s.local.nome);
    assert.equal(await estoqueAtual(e.sal), '6.0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('T — transferência no motor (camadas preservadas, total conservado)', () => {
  test('T1: 35 kg em 3 camadas → saída 91,3885 (médio 2,6111); destino [10 de 05-01; 25 de 05-02, ambas a 2,6111]; origem A esgotado, B 25, C 20; Σ global e cache 80; Σ entrada no destino = entrada.quantidade; linhagem em JSON', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const la = await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '2.0000', dia: '2027-05-01' });
    const lb = await loteLegado(s, e, e.sal, s.local, { kg: '50', custo: '3.3333', dia: '2027-05-02' });
    const lc = await loteLegado(s, e, e.sal, s.local, { kg: '20', custo: '1.1111', dia: '2027-05-03' });
    await definirEstoqueAtual(e.sal, '80');
    const r = await transferir(s, e, e.sal, s.local, s.local2, 35, { local_destino_nome: 'NOME DO CORPO' });
    assert.equal(r.statusCode, 201, r.body);
    const corpo = r.json();
    const saida = await movimento(corpo.movimentacao_saida.id);
    const entrada = await movimento(corpo.movimentacao_entrada.id);
    assert.deepEqual([q4(saida.valor_total), q4(saida.valor_unitario), q4(saida.saldo_antes), q4(saida.saldo_depois), saida.modo_saida_fifo, saida.unidade_medida], ['91.3885', '2.6111', '80.0000', '45.0000', 'CUSTO_MEDIO', 'KG']);
    assert.deepEqual([q4(entrada.quantidade), q4(entrada.saldo_antes), q4(entrada.saldo_depois), entrada.lotes_consumidos, entrada.local_destino], ['35.0000', '0.0000', '35.0000', null, s.local2.nome]);
    const destino = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c, local_estoque_id: s.local2.id }, orderBy: { data_documento: 'asc' } });
    assert.deepEqual(destino.map((l) => [q4(l.quantidade_entrada), q4(l.quantidade_disponivel), q4(l.custo_unitario), dia(l.data_documento), l.movimentacao_entrada_id, l.local_estoque_nome]), [
      ['10.0000', '10.0000', '2.6111', '2027-05-01', entrada.id, s.local2.nome],
      ['25.0000', '25.0000', '2.6111', '2027-05-02', entrada.id, s.local2.nome],
    ]);
    assert.deepEqual(
      [[(await lote(la.id)).status, q4((await lote(la.id)).quantidade_disponivel)], q4((await lote(lb.id)).quantidade_disponivel), q4((await lote(lc.id)).quantidade_disponivel)],
      [['Esgotado', '0.0000'], '25.0000', '20.0000'],
    );
    assert.equal(await somaLotes({ cliente_id: s.c, produto_id: e.sal.id, status: 'Disponivel' }), '80.0000');
    assert.equal(await estoqueAtual(e.sal), '80.0000');
    assert.equal(destino.reduce((t, l) => t.plus(D(l.quantidade_entrada)), D(0)).toFixed(4), q4(entrada.quantidade), 'I4: Σ entrada dos lotes de destino = entrada.quantidade');
    const porOrigem = Object.fromEntries(destino.map((l) => [dia(l.data_documento), l.id]));
    assert.deepEqual(saida.lotes_consumidos.map((f) => [f.lote_id, f.quantidade, f.custo_unitario, f.lote_destino_id]), [
      [la.id, '10.0000', '2.6111', porOrigem['2027-05-01']],
      [lb.id, '25.0000', '2.6111', porOrigem['2027-05-02']],
    ]);
    assert.deepEqual([q4((await lote(lb.id)).custo_unitario), q4((await lote(lc.id)).custo_unitario)], ['2.6111', '2.6111'], 'origem reavaliada: (208,887 − 91,3885) ÷ 45');
    assert.deepEqual(corpo.rateio.map((x) => [x.lote_id, x.quantidade_consumida, x.custo_unitario, x.lote_destino_id]), [
      [la.id, 10, 2.6111, porOrigem['2027-05-01']],
      [lb.id, 25, 2.6111, porOrigem['2027-05-02']],
    ]);
    assert.equal(corpo.movimentacao_saida.movimento_filho_id, entrada.id);
    await conferirInvariantes(s, {}, 'T1');
  });

  test('T2: a mesma operation_id → 200 replay com o mesmo movimento (nada novo); corpo diferente com a mesma chave → 409 IDEMPOTENCY_CONFLICT', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '50', custo: '2.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '50');
    const corpo = { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 7 };
    const r1 = await A.req('POST', URL_TRANSF, s.token, corpo);
    assert.equal(r1.statusCode, 201, r1.body);
    const antes = await foto([s.c]);
    const r2 = await A.req('POST', URL_TRANSF, s.token, corpo);
    assert.deepEqual([r2.statusCode, r2.json().replay, r2.json().movimentacao_saida.id], [200, true, r1.json().movimentacao_saida.id], r2.body);
    assert.equal(await foto([s.c]), antes, 'replay não grava nada');
    const r3 = await A.req('POST', URL_TRANSF, s.token, { ...corpo, quantidade: 8 });
    assert.deepEqual([r3.statusCode, codigo(r3)], [409, 'IDEMPOTENCY_CONFLICT'], r3.body);
    assert.equal(await foto([s.c]), antes);
  });

  test('T3: destino inexistente → 422 ESTOQUE_LOCAL_INVALIDO local_inexistente; destino inativo → local_inativo; origem inexistente → local_origem_id; origem = destino → 400; origem inativa → 201', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.sal, s.local, { kg: '50', custo: '2.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '50');
    const inativo = await p.localEstoque.create({ data: { cliente_id: s.c, numero_local: '9', nome: `DESATIVADO ${s.c}`, ativo: false } });
    const antes = await foto([s.c]);
    const rx = await transferir(s, e, e.sal, s.local, { id: `inexistente-${randomUUID()}` }, 5);
    assert.deepEqual(recusa(rx), [422, 'ESTOQUE_LOCAL_INVALIDO', 'local_destino_id', 'local_inexistente'], rx.body);
    const ri = await transferir(s, e, e.sal, s.local, inativo, 5);
    assert.deepEqual(recusa(ri), [422, 'ESTOQUE_LOCAL_INVALIDO', 'local_destino_id', 'local_inativo'], ri.body);
    const ro = await transferir(s, e, e.sal, { id: `inexistente-${randomUUID()}` }, s.local2, 5);
    assert.deepEqual(recusa(ro), [422, 'ESTOQUE_LOCAL_INVALIDO', 'local_origem_id', 'local_inexistente'], ro.body);
    const rig = await transferir(s, e, e.sal, s.local, s.local, 5);
    assert.deepEqual(recusa(rig), [400, 'REQUEST_VALIDATION_FAILED', 'local_destino_id', 'invalid'], rig.body);
    assert.equal(await foto([s.c]), antes, 'nada gravado (nenhum lote órfão)');
    await p.localEstoque.update({ where: { id: s.local.id }, data: { ativo: false } });
    const ok = await transferir(s, e, e.sal, s.local, s.local2, 5);
    assert.equal(ok.statusCode, 201, ok.body);
  });

  test('T4: procedência nula na origem continua nula no destino (sem fabricar "S/N"); procedência presente é copiada; origem sem data → camada com o dia UTC do createdAt da origem (idade FIFO), não o da movimentação', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const nulo = await loteLegado(s, e, e.sal, s.local, { kg: '5', custo: '2.0000', dia: '2027-05-01' });
    const cheio = await p.estoqueLoteNota.create({
      data: {
        cliente_id: s.c, empresa_id: e.id, produto_id: e.sal.id, produto_nome: e.sal.nome_produto, local_estoque_id: s.local.id, local_estoque_nome: s.local.nome,
        numero_documento: 'NF-123', serie_documento: '2', fornecedor_id: e.forn.id, fornecedor_nome: e.forn.nome,
        data_documento: new Date('2027-05-02T00:00:00.000Z'), custo_unitario: '3.0000', quantidade_entrada: '5', quantidade_disponivel: '5', status: 'Disponivel',
      },
    });
    const semData = await loteCom(s, e, e.sal, s.local, { id: `lote-p0-semdata-${randomUUID()}`, kg: '5', custo: '4.0000', createdAt: new Date('2027-05-03T10:00:00.000Z') });
    await definirEstoqueAtual(e.sal, '15');
    const r = await transferir(s, e, e.sal, s.local, s.local2, 15, { data_movimentacao: '2027-06-12' });
    assert.equal(r.statusCode, 201, r.body);
    const saida = await movimento(r.json().movimentacao_saida.id);
    assert.equal(saida.data_movimentacao.toISOString(), '2027-06-12T12:00:00.000Z');
    // camadas de destino, pelo custo (único por camada de origem)
    const destino = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c, movimentacao_entrada_id: r.json().movimentacao_entrada.id } });
    // D-PROD-256: o custo das camadas de destino é o médio (todas iguais); cada uma se acha pela data de origem
    const porDia = (d) => destino.find((l) => dia(l.data_documento) === d);
    const [dn, dc, ds] = [porDia('2027-05-01'), porDia('2027-05-02'), porDia('2027-05-03')];
    assert.deepEqual(destino.map((l) => q4(l.custo_unitario)), ['3.0000', '3.0000', '3.0000'], 'médio (5×2 + 5×3 + 5×4) ÷ 15 = 3,0000');
    assert.deepEqual([dn.numero_documento, dn.serie_documento, dn.fornecedor_id, dn.fornecedor_nome, dia(dn.data_documento)], [null, null, null, null, '2027-05-01']);
    assert.deepEqual([dc.numero_documento, dc.serie_documento, dc.fornecedor_id, dc.fornecedor_nome, dia(dc.data_documento)], ['NF-123', '2', e.forn.id, e.forn.nome, '2027-05-02']);
    // D-PROD-161 (R2, achado A-02 — mudança DELIBERADA da SPEC §3.2 passo 9): o fallback era o dia da
    // movimentação (2027-06-12), que reescrevia a idade FIFO da camada no destino; agora é o dia UTC do
    // createdAt da origem (2027-05-03T10:00Z), a chave COALESCE(data_documento, createdAt) que ela tinha.
    assert.equal(dia(ds.data_documento), '2027-05-03', 'origem sem data: a camada recebe o dia (UTC) do createdAt da origem');
    assert.equal(r.json().rateio.find((x) => x.lote_id === nulo.id).numero_documento, 'S/N', 'o rateio da resposta mantém o rótulo de hoje');
    assert.deepEqual(Object.fromEntries((saida.lotes_consumidos ?? []).map((f) => [f.lote_id, f.lote_destino_id])), { [nulo.id]: dn.id, [cheio.id]: dc.id, [semData.id]: ds.id });
    await conferirInvariantes(s, {}, 'T4');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('M — guardas, tenancy, recibo antigo, empate, rollback e data', () => {
  test('M0: primitivas novas exportadas; kgDeEntrada arredonda UMA vez em HALF_UP(4) e recusa ≤ 0 e > limite; guarda de empresa do produto (fail-closed) na entrada, na saída e na transferência', async () => {
    assert.equal(typeof motor.kgDeEntrada, 'function');
    assert.equal(typeof motor.exigirLocaisEstoque, 'function');
    assert.equal(typeof motor.consumirCamadas, 'function');
    assert.equal(typeof motor.aplicarTransferenciaEstoque, 'function');
    assert.deepEqual([motor.ORIGEM_SUPLEMENTACAO, motor.ORIGEM_DEPOSITO], ['suplementacao', 'deposito']);
    assert.equal(motor.kgDeEntrada(12.34567).toFixed(4), '12.3457');
    assert.equal(motor.kgDeEntrada(0.1 * 3).toFixed(4), '0.3000');
    assert.equal(motor.kgDeEntrada('1.23455').toFixed(4), '1.2346');
    assert.throws(() => motor.kgDeEntrada(0.00004), (x) => x.code === 'OPERACAO_VALORES_INVALIDOS' && x.details.reason === 'quantidade_estoque_zero');
    assert.throws(() => motor.kgDeEntrada(1e10), (x) => x.code === 'OPERACAO_VALORES_INVALIDOS' && x.details.reason === 'valor_excede_limite_estoque');

    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '10');
    const ctx = { auth: { clienteId: s.c, usuarioId: s.admId, login: s.admLogin } };
    const produtoOutraEmpresa = await prisma().produto.findUnique({ where: { id: s.e2.sal.id } });
    const antes = await foto([s.c]);
    /** Roda dentro de uma transação que SEMPRE volta (se a guarda faltar, nada fica gravado). */
    const tentar = (fn) =>
      prisma().$transaction(async (tx) => {
        await motor.travarProdutosEstoque(tx, s.c, e.id, [produtoOutraEmpresa.id]);
        await fn(tx);
        throw new Error('SEM_GUARDA');
      }).then(() => null, (x) => x);
    const local = { id: s.local.id, nome: s.local.nome };
    const entrada = await tentar((tx) => motor.aplicarEntradaEstoque(tx, ctx, {
      empresaId: e.id, produto: produtoOutraEmpresa, local, quantidadeKg: '1.0000', custoUnitarioKg: '1.0000', valorTotal: '1.0000', dia: '2027-06-10', origem: { operacaoId: 'x' }, numeroMovimento: motor.numeroMovimentoProvisorio(),
    }));
    const saida = await tentar((tx) => motor.aplicarSaida(tx, ctx, {
      empresaId: e.id, produto: produtoOutraEmpresa, local, quantidadeKg: '1.0000', dia: '2027-06-10', origem: { operacaoId: 'x' }, numeroMovimento: motor.numeroMovimentoProvisorio(),
    }));
    const transf = await tentar((tx) => motor.aplicarTransferenciaEstoque(tx, ctx, {
      empresaId: e.id, produto: produtoOutraEmpresa, origem: local, destino: { id: s.local2.id, nome: s.local2.nome }, quantidadeKg: '1.0000', instante: new Date('2027-06-10T12:00:00.000Z'),
      numeros: { saida: motor.numeroMovimentoProvisorio(), entrada: motor.numeroMovimentoProvisorio() },
    }));
    assert.deepEqual([entrada?.code, saida?.code, transf?.code], ['PRODUTO_NOT_FOUND', 'PRODUTO_NOT_FOUND', 'PRODUTO_NOT_FOUND'], `${entrada?.message} | ${saida?.message} | ${transf?.message}`);
    assert.equal(await foto([s.c]), antes);
  });

  test('M1: produto de OUTRA empresa → 404 PRODUTO_NOT_FOUND; local de OUTRO tenant → 422 local_inexistente com o MESMO corpo de um id que não existe (sem oráculo); empresa de outro tenant → 404 EMPRESA_NOT_FOUND; nada gravado em nenhum tenant', async () => {
    const s = await montarTenant(app);
    const b = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '10');
    await loteLegado(b, b.e1, b.e1.sal, b.local, { kg: '10', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(b.e1.sal, '10');
    const antes = await foto([s.c, b.c]);
    const rp = await suplementar(s, e, s.e2.sal, s.local, 1);
    assert.deepEqual([rp.statusCode, codigo(rp)], [404, 'PRODUTO_NOT_FOUND'], rp.body);
    const tp = await transferir(s, e, s.e2.sal, s.local, s.local2, 1);
    assert.deepEqual([tp.statusCode, codigo(tp)], [404, 'PRODUTO_NOT_FOUND'], tp.body);
    const rl = await suplementar(s, e, e.sal, b.local, 1);
    assert.deepEqual(recusa(rl), [422, 'ESTOQUE_LOCAL_INVALIDO', 'local_origem_id', 'local_inexistente'], rl.body);
    const rn = await suplementar(s, e, e.sal, { id: `nao-existe-${randomUUID()}` }, 1);
    assert.deepEqual(corpoErro(rl), corpoErro(rn), 'local de outro tenant = local inexistente (mesmo corpo)');
    const tl = await transferir(s, e, e.sal, s.local, b.local, 1);
    assert.deepEqual(recusa(tl), [422, 'ESTOQUE_LOCAL_INVALIDO', 'local_destino_id', 'local_inexistente'], tl.body);
    const tlo = await transferir(s, e, e.sal, b.local, s.local2, 1);
    assert.deepEqual(recusa(tlo), [422, 'ESTOQUE_LOCAL_INVALIDO', 'local_origem_id', 'local_inexistente'], tlo.body);
    const re = await suplementar(s, b.e1, e.sal, s.local, 1);
    assert.deepEqual([re.statusCode, codigo(re)], [404, 'EMPRESA_NOT_FOUND'], re.body);
    const te = await transferir(s, b.e1, e.sal, s.local, s.local2, 1);
    assert.deepEqual([te.statusCode, codigo(te)], [404, 'EMPRESA_NOT_FOUND'], te.body);
    assert.equal(await foto([s.c, b.c]), antes);
  });

  test('M2: replay de RECIBO ANTIGO (fingerprint com quantidade Number, corpo com floats e movimento_filho_id null) → 200 replay com o corpo gravado, sem linha nova, mesmo com dado que hoje seria recusado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');
    // suplementação: local que não existe e quantidade que hoje vira 0,0000 (as validações novas ficam DENTRO de executar)
    const localSumido = `local-antigo-${randomUUID()}`;
    const kSup = opId();
    const canonSup = {
      empresa_id: e.id, produto_id: e.sal.id, local_origem_id: localSumido, quantidade: 0.00004,
      area_id: null, deposito_id: null, ponto_suplementacao_id: null, data_movimentacao: null, observacoes: null,
    };
    const corpoSup = { committed: true, operation_id: kSup, replay: false, movimentacao: { id: 'mov-antigo', numero_movimentacao: '7', quantidade: '0.0000', valor_total: 0.0001 }, rateio: [{ lote_id: 'lote-antigo', quantidade_consumida: 0.00004, custo_unitario: 2.5, valor_total: 0.0001 }] };
    await p.operacaoIdempotente.create({ data: { cliente_id: s.c, operation_key: kSup, tipo_operacao: 'saida_suplementacao', fingerprint: sha(canonSup), status: 'committed', http_status: 201, response_json: corpoSup } });
    // transferência: corpo antigo com movimento_filho_id null
    const kTr = opId();
    const canonTr = { empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 2.5, data_movimentacao: null, observacoes: null };
    const corpoTr = {
      committed: true, operation_id: kTr, replay: false,
      movimentacao_saida: { id: 'saida-antiga', movimento_filho_id: null, quantidade: '2.5000' }, movimentacao_entrada: { id: 'entrada-antiga' },
      rateio: [{ lote_id: 'lote-antigo', quantidade_consumida: 2.5, custo_unitario: 1.1, valor_total: 2.7500000000000004 }],
    };
    await p.operacaoIdempotente.create({ data: { cliente_id: s.c, operation_key: kTr, tipo_operacao: 'transferencia_locais', fingerprint: sha(canonTr), status: 'committed', http_status: 201, response_json: corpoTr } });
    const antes = await foto([s.c]);
    const gravado = async (k, tipo) => (await p.operacaoIdempotente.findUnique({ where: { cliente_id_operation_key_tipo_operacao: { cliente_id: s.c, operation_key: k, tipo_operacao: tipo } } })).response_json;
    const r1 = await A.req('POST', URL_SUP, s.token, { operation_id: kSup, empresa_id: e.id, produto_id: e.sal.id, local_origem_id: localSumido, quantidade: 0.00004 });
    assert.equal(r1.statusCode, 200, r1.body);
    assert.deepEqual(r1.json(), { ...(await gravado(kSup, 'saida_suplementacao')), replay: true });
    assert.equal(r1.json().movimentacao.id, 'mov-antigo');
    const r2 = await A.req('POST', URL_TRANSF, s.token, { operation_id: kTr, empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 2.5 });
    assert.equal(r2.statusCode, 200, r2.body);
    assert.deepEqual(r2.json(), { ...(await gravado(kTr, 'transferencia_locais')), replay: true });
    assert.equal(r2.json().movimentacao_saida.movimento_filho_id, null, 'o corpo antigo volta como foi gravado');
    assert.equal(await foto([s.c]), antes, 'replay não grava nada');
  });

  test('M3: empate de data → desempate pelo id (a antes de b), nunca pela ordem de inserção; o mesmo com data nula e o mesmo createdAt', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const suf = randomUUID().slice(0, 8);
    const b = await loteCom(s, e, e.sal, s.local, { id: `lote-p0-b-${suf}`, kg: '5', dia: '2027-05-01' });
    const a = await loteCom(s, e, e.sal, s.local, { id: `lote-p0-a-${suf}`, kg: '5', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '10');
    const r = await suplementar(s, e, e.sal, s.local, 6);
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([[(await lote(a.id)).status, q4((await lote(a.id)).quantidade_disponivel)], [(await lote(b.id)).status, q4((await lote(b.id)).quantidade_disponivel)]], [['Esgotado', '0.0000'], ['Disponivel', '4.0000']]);
    const criado = new Date('2027-05-01T10:00:00.000Z');
    const nb = await loteCom(s, e, e.milho, s.local, { id: `lote-p0-nb-${suf}`, kg: '5', createdAt: criado });
    const na = await loteCom(s, e, e.milho, s.local, { id: `lote-p0-na-${suf}`, kg: '5', createdAt: criado });
    await definirEstoqueAtual(e.milho, '10');
    const r2 = await transferir(s, e, e.milho, s.local, s.local2, 6);
    assert.equal(r2.statusCode, 201, r2.body);
    assert.deepEqual([q4((await lote(na.id)).quantidade_disponivel), q4((await lote(nb.id)).quantidade_disponivel)], ['0.0000', '4.0000']);
    assert.deepEqual(((await movimento(r2.json().movimentacao_saida.id)).lotes_consumidos ?? []).map((f) => [f.lote_id, f.quantidade]), [[na.id, '5.0000'], [nb.id, '1.0000']]);
  });

  test('M4: falha forçada no meio (lote de destino da transferência; auditoria da suplementação, depois de lotes e cache) → erro, nada gravado, nenhum recibo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.sal, s.local, { kg: '20', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '20');
    const FN = 'p0f1_falha_forcada';
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ${FN}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'falha forçada P0-F1'; END $f$`);
    try {
      await p.$executeRawUnsafe(`CREATE TRIGGER p0f1_falha_lote BEFORE INSERT ON "EstoqueLoteNota" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND NEW.movimentacao_entrada_id IS NOT NULL) EXECUTE FUNCTION ${FN}()`);
      const antes = await foto([s.c]);
      const k = opId();
      const r = await A.req('POST', URL_TRANSF, s.token, { operation_id: k, empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, local_destino_id: s.local2.id, quantidade: 5 });
      assert.ok(r.statusCode >= 500, `${r.statusCode} ${r.body}`);
      assert.equal(await foto([s.c]), antes, 'transferência: saída, CAS da origem e entrada desfeitos');
      assert.equal(await p.operacaoIdempotente.count({ where: { cliente_id: s.c, operation_key: k } }), 0);
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS p0f1_falha_lote ON "EstoqueLoteNota"');
      await p.$executeRawUnsafe(`CREATE TRIGGER p0f1_falha_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.cliente_id = '${s.c}' AND NEW.entidade = 'MovimentacaoEstoque') EXECUTE FUNCTION ${FN}()`);
      const k2 = opId();
      const r2 = await A.req('POST', URL_SUP, s.token, { operation_id: k2, empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, quantidade: 5 });
      assert.ok(r2.statusCode >= 500, `${r2.statusCode} ${r2.body}`);
      assert.equal(await foto([s.c]), antes, 'suplementação: movimento, lotes, cache e número desfeitos');
      assert.equal(await p.operacaoIdempotente.count({ where: { cliente_id: s.c, operation_key: k2 } }), 0);
    } finally {
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS p0f1_falha_lote ON "EstoqueLoteNota"');
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS p0f1_falha_audit ON "AuditLog"');
      await p.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FN}()`);
    }
    const ok = await suplementar(s, e, e.sal, s.local, 5);
    assert.equal(ok.statusCode, 201, ok.body);
  });

  test('M5: data_movimentacao com formato inválido → 400 REQUEST_VALIDATION_FAILED field data_movimentacao (nunca 500); dia inexistente também; data válida → meio-dia UTC do dia', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await loteLegado(s, e, e.sal, s.local, { kg: '20', custo: '1.0000', dia: '2027-05-01' });
    await definirEstoqueAtual(e.sal, '20');
    const antes = await foto([s.c]);
    for (const valor of ['xx', '2027-02-30', '2027-13-01T00:00:00Z']) {
      const r = await suplementar(s, e, e.sal, s.local, 1, { data_movimentacao: valor });
      assert.deepEqual(recusa(r), [400, 'REQUEST_VALIDATION_FAILED', 'data_movimentacao', 'format'], `supl ${valor}: ${r.body}`);
      const t = await transferir(s, e, e.sal, s.local, s.local2, 1, { data_movimentacao: valor });
      assert.deepEqual(recusa(t), [400, 'REQUEST_VALIDATION_FAILED', 'data_movimentacao', 'format'], `transf ${valor}: ${t.body}`);
    }
    assert.equal(await foto([s.c]), antes);
    const ok = await suplementar(s, e, e.sal, s.local, 1, { data_movimentacao: '2027-06-11T08:30:00.000Z' });
    assert.equal(ok.statusCode, 201, ok.body);
    assert.equal((await movimento(ok.json().movimentacao.id)).data_movimentacao.toISOString(), '2027-06-11T12:00:00.000Z');
  });

  test('M6: compra consumida por suplementação e transferência continua bloqueada para cancelar (prova = lotes_consumidos do movimento)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [item(e.sal, '100', '2')]));
    const t = await transferir(s, e, e.sal, s.local, s.local2, 10);
    assert.equal(t.statusCode, 201, t.body);
    const antes = await foto([s.c]);
    const rc = await A.cancelarReq(s.token, compra.id, e.id);
    assert.deepEqual([rc.statusCode, codigo(rc), motivo(rc)], [409, 'ESTOQUE_JA_CONSUMIDO', 'lote_consumido'], rc.body);
    assert.equal(await foto([s.c]), antes);
    const el = await A.ok(A.req('GET', `/operacoes-financeiras/${compra.id}/elegibilidade?empresa_id=${e.id}`, s.token));
    const m = el.excluir.motivos.find((x) => x.codigo === 'lote_consumido');
    assert.deepEqual([m?.entidade, m?.numero, m?.id], ['MovimentacaoEstoque', t.json().movimentacao_saida.numero_movimentacao, t.json().movimentacao_saida.id]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AB-X — abastecimento (litros) sobre a camada transferida', () => {
  test('transferir 50 L do local 2 (camada de 06-02) para o tanque: o abastecimento baixa os lotes A (06-01) e depois a camada transferida (06-02), antes de B (06-03); quantidade e custo na unidade do Produto (L, sem fator — D-PROD-162); o cancelamento devolve cada fatia à SUA camada', async () => {
    const s = await montarAbastecimento(app);
    const p = prisma();
    const l2 = await s.lote(s.e1, s.diesel, s.local2, { quantidade: '60.0000', custo: '5.0000', dia: '2027-06-02' });
    const rt = await A.req('POST', URL_TRANSF, s.token, {
      operation_id: opIdAb(), empresa_id: s.e1.id, produto_id: s.diesel.id, local_origem_id: s.local2.id, local_destino_id: s.local.id, quantidade: 50,
    });
    assert.equal(rt.statusCode, 201, rt.body);
    const T = await prisma().estoqueLoteNota.findFirst({ where: { cliente_id: s.c, movimentacao_entrada_id: rt.json().movimentacao_entrada.id } });
    assert.deepEqual([T.local_estoque_id, dia(T.data_documento), q4(T.quantidade_disponivel), q4(T.custo_unitario)], [s.local.id, '2027-06-02', '50.0000', '5.3000']); // D-PROD-256: destino reavaliado ao médio (50×5,2 + 100×5,5 + 50×5,0) ÷ 200
    assert.equal(q4((await lote(l2.id)).quantidade_disponivel), '10.0000');
    const d = await AB.confirmarOk(s.operador.token, corpoAbastecimento(s)); // 80 L do Produto em L (D-PROD-162: sem fator)
    const fatias = (await p.abastecimentoBemConsumoLote.findMany({ where: { abastecimento_id: d.id }, orderBy: { ordem: 'asc' } })).map((f) => [f.estoque_lote_nota_id, q4(f.quantidade), q4(f.custo_unitario)]);
    assert.deepEqual(fatias, [[s.lotes.dieselA.id, '50.0000', '5.3000'], [T.id, '30.0000', '5.3000']]);
    const linha = await p.abastecimentoBem.findUnique({ where: { id: d.id } });
    assert.deepEqual([q4(linha.quantidade), linha.unidade, q4(linha.custo_total), q4(linha.custo_unitario)], ['80.0000', 'L', '424.0000', '5.3000']);
    const c = await AB.cancelar(s.contaCancelar.token, d.id, { empresa_id: s.e1.id, versao: 1, motivo: 'lançado no bem errado', operation_id: opIdAb() });
    assert.equal(c.statusCode, 200, c.body);
    assert.deepEqual(
      [[(await lote(s.lotes.dieselA.id)).status, q4((await lote(s.lotes.dieselA.id)).quantidade_disponivel)], [(await lote(T.id)).status, q4((await lote(T.id)).quantidade_disponivel)], q4((await lote(s.lotes.dieselB.id)).quantidade_disponivel)],
      [['Disponivel', '50.0000'], ['Disponivel', '50.0000'], '100.0000'],
    );
    assert.equal(await somaLotes({ cliente_id: s.c, produto_id: s.diesel.id, status: 'Disponivel' }), await estoqueAtual(s.diesel));
    assert.equal(await estoqueAtual(s.diesel), '210.0000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F9a — o financeiro nunca gera segunda entrada', () => {
  test('confirmar duas vezes com a mesma operation_id → 1 lote e 1 movimento (replay); duplicar → rascunho sem lote até confirmar', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const doc = docCom(e, s.local, [item(e.sal, '100', '2')]);
    const d = await A.criar(s.token, doc);
    const chave = opId();
    const r1 = await A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, { empresa_id: e.id, operation_id: chave, versao: d.versao });
    const r2 = await A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, { empresa_id: e.id, operation_id: chave, versao: d.versao });
    assert.deepEqual([r1.statusCode, r2.statusCode, r2.json().replay], [200, 200, true], r2.body);
    const contar = async () => [await p.estoqueLoteNota.count({ where: { cliente_id: s.c, produto_id: e.sal.id } }), await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, produto_id: e.sal.id } }), await estoqueAtual(e.sal)];
    assert.deepEqual(await contar(), [1, 1, '100.0000']);
    const dup = await A.ok(A.req('POST', '/operacoes-financeiras', s.token, { ...doc, duplicado_de_id: d.id, operation_id: opId() }), 201);
    assert.equal(dup.status, 'RASCUNHO');
    assert.deepEqual(await contar(), [1, 1, '100.0000'], 'o duplicado é rascunho: nenhuma entrada');
    await A.confirmar(s.token, dup, e.id);
    assert.deepEqual(await contar(), [2, 2, '200.0000']);
    await conferirInvariantes(s, {}, 'F9a');
  });
});
