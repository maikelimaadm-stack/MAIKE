/**
 * D-PROD-256 (Estoque, PR 1 de 2) — CUSTO MÉDIO PONDERADO no motor único.
 * PostgreSQL real; o motor é chamado direto em transações reais com a trava
 * canônica do produto (e, em C8, por HTTP).
 *
 *  C1. saída a médio e reavaliação do poço (o médio de depois não "pula");
 *  C2. entrada nova: médio = (valor antes + valor da entrada) ÷ (qtd antes + qtd da entrada);
 *  C3. estorno EXATO de saída a médio (devolve o valor gravado no movimento);
 *  C4. estorno EXATO de saída FIFO antiga (estado pré-cutover montado no banco);
 *  C5. transferência: origem sai pelo médio; destino entra com esse valor e recalcula o médio;
 *  C6. recusas: custo negativo e saldo insuficiente não tocam camada nenhuma;
 *  C7. concorrência: duas saídas em paralelo serializam e o valor fecha;
 *  C8. idempotência: replay HTTP não reavalia nada de novo;
 *  C9. estorno de compra intacta (camada some pelo valor vigente) e `consumirCustoMedio` pura.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, foto, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import {
  D, OPCOES_TX, conferirInvariantes, ctxDe, entrar, estornarLote, estornarUmaEntrada, itemDaEntrada, itemDaSaida, localDe, q4, recusaAntesDeEscrever, resumoErro, sairFifo,
} from './estoqueP1MCenario.mjs';
import * as motor from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';

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

const lote = (id) => prisma().estoqueLoteNota.findUnique({ where: { id } });
const movimento = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const compra = (s, e, kg, custo, extra = {}) =>
  entrar(s, e, e.sal, { quantidadeKg: kg, custoUnitarioKg: custo, valorTotal: D(kg).times(D(custo)).toFixed(4), ...extra });
/** Camadas Disponivel do poço, em ordem de criação: [disp, custo]. */
const poco = async (s, e, local = s.local) =>
  (await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, empresa_id: e.id, produto_id: e.sal.id, local_estoque_id: local.id, status: 'Disponivel' }, orderBy: { createdAt: 'asc' } }))
    .map((l) => [q4(l.quantidade_disponivel), q4(l.custo_unitario)]);
const estoqueAtual = async (produto) => q4((await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual);

describe('C1 — saída a custo médio e reavaliação do poço', () => {
  test('10 kg a 2,0000 + 10 kg a 4,0000; saída de 5 kg → 15,0000 a 3,0000 (não os 2,0000 da camada mais velha); o restante fica todo a 3,0000', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const a = await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    const b = await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const r = await sairFifo(s, e, e.sal, '5.0000');
    assert.deepEqual([q4(r.valor_total), q4(r.valor_unitario)], ['15.0000', '3.0000']);
    assert.deepEqual(r.fatias.map((f) => [f.lote_id, q4(f.quantidade), q4(f.custo_unitario)]), [[a.lote.id, '5.0000', '3.0000']], 'camada baixada na ordem de lote, valor pelo médio');
    const m = await movimento(r.movimento.id);
    assert.deepEqual([m.modo_saida_fifo, q4(m.valor_total), q4(m.valor_unitario), q4(m.saldo_antes), q4(m.saldo_depois)], ['CUSTO_MEDIO', '15.0000', '3.0000', '20.0000', '15.0000']);
    assert.deepEqual(m.lotes_consumidos, [{ lote_id: a.lote.id, quantidade: '5.0000', custo_unitario: '3.0000' }]);
    // o disponível restante é reavaliado: 5 + 10 kg a 3,0000 = 45,0000 = 60 − 15 (o médio não pula)
    assert.deepEqual(await poco(s, e), [['5.0000', '3.0000'], ['10.0000', '3.0000']]);
    assert.equal(q4((await lote(b.lote.id)).custo_unitario), '3.0000');
    assert.equal(await estoqueAtual(e.sal), '15.0000');
    await conferirInvariantes(s, 'C1');
  });

  test('duas saídas seguidas: a segunda sai pelo mesmo médio (3,0000), nunca pelo custo da camada que sobrou', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const r1 = await sairFifo(s, e, e.sal, '10.0000'); // esgota a camada de 2,0000, mas vale 3,0000
    const r2 = await sairFifo(s, e, e.sal, '10.0000'); // a camada de 4,0000 vale 3,0000 agora
    assert.deepEqual([q4(r1.valor_total), q4(r2.valor_total)], ['30.0000', '30.0000']);
    assert.deepEqual(await poco(s, e), []);
    assert.equal(await estoqueAtual(e.sal), '0.0000');
  });

  test('saída que esgota o poço inteiro vale quantidade × médio; saída de valor com arredondamento (3 camadas) fecha com (valor antes − valor da saída) ÷ restante', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '50.0000', '3.3333', { dia: '2027-06-02' });
    await compra(s, e, '20.0000', '1.1111', { dia: '2027-06-03' });
    // V = 20 + 166,665 + 22,222 = 208,887; Q = 80 → médio 2,6111 (HALF_UP uma vez)
    const r = await sairFifo(s, e, e.sal, '35.0000');
    assert.deepEqual([q4(r.valor_total), q4(r.valor_unitario)], ['91.3885', '2.6111']);
    // restante: (208,887 − 91,3885) ÷ 45 = 2,6111
    assert.deepEqual((await poco(s, e)).map((x) => x[1]), ['2.6111', '2.6111']);
    const tudo = await sairFifo(s, e, e.sal, '45.0000');
    assert.deepEqual([q4(tudo.valor_total), q4(tudo.valor_unitario)], ['117.4995', '2.6111']);
    assert.equal(await estoqueAtual(e.sal), '0.0000');
    await conferirInvariantes(s, 'C1c');
  });
});

describe('C2 — entrada nova no poço', () => {
  test('após uma saída, a entrada de 5 kg a 6,0000 leva o médio a (45 + 30) ÷ 20 = 3,7500; a saída seguinte sai a 3,7500', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    await sairFifo(s, e, e.sal, '5.0000'); // 15 kg a 3,0000 = 45
    await compra(s, e, '5.0000', '6.0000', { dia: '2027-06-03' });
    assert.deepEqual(await poco(s, e), [['5.0000', '3.0000'], ['10.0000', '3.0000'], ['5.0000', '6.0000']]);
    const r = await sairFifo(s, e, e.sal, '4.0000');
    assert.deepEqual([q4(r.valor_total), q4(r.valor_unitario)], ['15.0000', '3.7500']);
    // restante: (75 − 15) ÷ 16 = 3,7500 em todas as camadas
    assert.deepEqual((await poco(s, e)).map((x) => x[1]), ['3.7500', '3.7500', '3.7500']);
    await conferirInvariantes(s, 'C2');
  });

  test('custo zero na compra continua permitido e entra no médio (valor 0 + 10 kg a 4 → 2,0000)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '0.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const r = await sairFifo(s, e, e.sal, '10.0000');
    assert.deepEqual([q4(r.valor_total), q4(r.valor_unitario)], ['20.0000', '2.0000']);
  });
});

describe('C3 — estorno exato de saída a médio', () => {
  test('o estorno devolve quantidade e o VALOR do movimento original (15,0000); o poço é reavaliado ao médio resultante e o original fica Estornada', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const a = await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    const b = await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const v = await sairFifo(s, e, e.sal, '5.0000');
    await compra(s, e, '5.0000', '9.0000', { dia: '2027-06-03' }); // o médio de agora (3,0000 × 15 + 45 ÷ 20 = 4,5000) NÃO é o valor a estornar
    const [id] = await estornarLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' });
    const est = await movimento(id);
    assert.deepEqual([est.tipo_movimentacao, q4(est.quantidade), q4(est.valor_total), q4(est.valor_unitario), est.movimento_pai_id], ['Entrada', '5.0000', '15.0000', '3.0000', v.movimento.id]);
    assert.equal((await movimento(v.movimento.id)).status, 'Estornada');
    // poço antes do estorno: 15 kg a 3,0000 (45) + 5 kg a 9,0000 (45) = 90 em 20 kg; + 15 em 5 kg → 105 ÷ 25 = 4,2000
    assert.deepEqual((await poco(s, e)).map((x) => x[1]), ['4.2000', '4.2000', '4.2000']);
    assert.deepEqual([q4((await lote(a.lote.id)).quantidade_disponivel), q4((await lote(b.lote.id)).quantidade_disponivel)], ['10.0000', '10.0000']);
    assert.equal(await estoqueAtual(e.sal), '25.0000');
    await conferirInvariantes(s, 'C3');
  });
});

describe('C4 — estorno exato de saída FIFO antiga (estado pré-cutover)', () => {
  test('saída gravada a custo FIFO (28,0000 = 10×2 + 2×4, modo FIFO) devolve 28,0000 — nunca o médio de agora; as camadas voltam ao médio do poço (60 ÷ 20 = 3,0000)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const a = await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    const b = await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const v = await sairFifo(s, e, e.sal, '12.0000');
    // reescreve o banco para o estado de ANTES do cutover: custos de camada de aquisição e a saída a custo FIFO
    const p = prisma();
    await p.estoqueLoteNota.update({ where: { id: a.lote.id }, data: { custo_unitario: '2.0000' } });
    await p.estoqueLoteNota.update({ where: { id: b.lote.id }, data: { custo_unitario: '4.0000' } });
    await p.movimentacaoEstoque.update({
      where: { id: v.movimento.id },
      data: {
        modo_saida_fifo: 'FIFO', valor_total: '28.0000', valor_unitario: '2.3333',
        lotes_consumidos: [{ lote_id: a.lote.id, quantidade: '10.0000', custo_unitario: '2.0000' }, { lote_id: b.lote.id, quantidade: '2.0000', custo_unitario: '4.0000' }],
      },
    });
    assert.deepEqual([q4((await lote(a.lote.id)).quantidade_disponivel), q4((await lote(b.lote.id)).quantidade_disponivel)], ['0.0000', '8.0000'], 'estado pré-cutover coerente');
    // a fatia do estorno é a gravada no movimento (A 10, B 2), não a do plano a médio
    const item = itemDaSaida(v, e.sal, s.local, 1, { consumos: [{ estoque_lote_nota_id: a.lote.id, quantidade: D('10') }, { estoque_lote_nota_id: b.lote.id, quantidade: D('2') }] });
    const [id] = await estornarLote(s, e, [item], { direcao: 'RECEBER' });
    const est = await movimento(id);
    assert.deepEqual([q4(est.quantidade), q4(est.valor_total), q4(est.valor_unitario)], ['12.0000', '28.0000', '2.3333'], 'estorno exato do valor FIFO gravado');
    // poço: B 8 kg a 4,0000 (32) + 28 = 60 em 20 kg → 3,0000 nas duas camadas
    assert.deepEqual(await poco(s, e), [['10.0000', '3.0000'], ['10.0000', '3.0000']]);
    assert.equal(await estoqueAtual(e.sal), '20.0000');
    await conferirInvariantes(s, 'C4');
  });

  test('a próxima saída depois do estorno de uma saída antiga já sai pelo médio novo', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const a = await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const v = await sairFifo(s, e, e.sal, '12.0000');
    const [id] = await estornarLote(s, e, [itemDaSaida(v, e.sal, s.local)], { direcao: 'RECEBER' });
    assert.equal(q4((await movimento(id)).valor_total), '36.0000', 'saída a médio estorna o valor a médio (12 × 3,0000)');
    const r = await sairFifo(s, e, e.sal, '1.0000');
    assert.equal(q4(r.valor_unitario), '3.0000');
    assert.equal(q4((await lote(a.lote.id)).custo_unitario), '3.0000');
  });
});

describe('C5 — transferência', () => {
  const transferirNoMotor = (s, e, kg, origem, destino) =>
    prisma().$transaction(async (tx) => {
      await motor.exigirLocaisEstoque(tx, s.c, [{ id: origem.id, field: 'local_origem_id', exigirAtivo: false }, { id: destino.id, field: 'local_destino_id', exigirAtivo: true }]);
      await motor.travarProdutosEstoque(tx, s.c, e.id, [e.sal.id]);
      const lido = await tx.produto.findUnique({ where: { id: e.sal.id } });
      const r = await motor.aplicarTransferenciaEstoque(tx, ctxDe(s), {
        empresaId: e.id, produto: lido, origem: localDe(origem), destino: localDe(destino), quantidadeKg: kg, instante: new Date('2027-06-10T12:00:00.000Z'),
        numeros: { saida: motor.numeroMovimentoProvisorio(), entrada: motor.numeroMovimentoProvisorio() },
      });
      await motor.numerarMovimentos(tx, s.c, [r.saida.id, r.entrada.id]);
      return r;
    }, OPCOES_TX);

  test('origem 20 kg (10 a 2 + 10 a 4 → médio 3); destino já tem 10 kg a 5; transferir 10 → saída 30,0000; destino (50 + 30) ÷ 20 = 4,0000 em todas as camadas; origem fica a 3,0000', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    await compra(s, e, '10.0000', '5.0000', { dia: '2027-06-03', local: localDe(s.local2) });
    const r = await transferirNoMotor(s, e, '10.0000', s.local, s.local2);
    assert.deepEqual([q4(r.valor_total), q4(r.valor_unitario)], ['30.0000', '3.0000']);
    const saida = await movimento(r.saida.id);
    const entrada = await movimento(r.entrada.id);
    assert.deepEqual([saida.modo_saida_fifo, q4(saida.valor_total), q4(entrada.valor_total), q4(entrada.saldo_antes), q4(entrada.saldo_depois)], ['CUSTO_MEDIO', '30.0000', '30.0000', '10.0000', '20.0000']);
    assert.deepEqual(await poco(s, e, s.local2), [['10.0000', '4.0000'], ['10.0000', '4.0000']]);
    assert.deepEqual(await poco(s, e, s.local), [['10.0000', '3.0000']]);
    assert.equal(await estoqueAtual(e.sal), '30.0000', 'a transferência não muda o cache');
    await conferirInvariantes(s, 'C5');
  });

  test('o valor da transferência é conservado: Σ(disponível × custo) do produto não muda além do arredondamento de 4 casas', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '7.0000', '1.3333', { dia: '2027-06-01' });
    await compra(s, e, '5.0000', '2.7777', { dia: '2027-06-02' });
    const valorTotal = async () =>
      (await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: e.sal.id, status: 'Disponivel' } })).reduce((t, l) => t.plus(D(l.quantidade_disponivel).times(D(l.custo_unitario))), D(0));
    const antes = await valorTotal();
    await transferirNoMotor(s, e, '4.0000', s.local, s.local2);
    const depois = await valorTotal();
    assert.ok(antes.minus(depois).abs().lte(D('0.0006')), `antes ${antes} depois ${depois}`);
  });
});

describe('C6 — recusas não tocam camada nenhuma', () => {
  test('custo negativo na entrada → 422 custo_negativo (D-PROD-184 / M4) e as camadas do poço seguem intactas', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    const antes = await poco(s, e);
    const erro = await recusaAntesDeEscrever(s, e.id, [e.sal.id], (tx) =>
      motor.aplicarEntradaEstoque(tx, ctxDe(s), {
        empresaId: e.id, produto: e.sal, local: localDe(s.local), quantidadeKg: '1.0000', custoUnitarioKg: '-1.0000', valorTotal: '1.0000', dia: '2027-06-10',
        origem: { operacaoId: 'x' }, numeroMovimento: motor.numeroMovimentoProvisorio(),
      }));
    assert.deepEqual([erro.code, erro.details.reason], ['OPERACAO_VALORES_INVALIDOS', 'custo_negativo'], resumoErro(erro));
    assert.deepEqual(await poco(s, e), antes);
  });

  test('saldo insuficiente (30 kg com 20 no poço) → 422 saldo_lote_insuficiente; nenhuma camada é reavaliada e o estoque não muda', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const antes = await poco(s, e);
    const erro = await recusaAntesDeEscrever(s, e.id, [e.sal.id], (tx) =>
      motor.aplicarSaida(tx, ctxDe(s), {
        empresaId: e.id, produto: e.sal, local: localDe(s.local), quantidadeKg: '30.0000', dia: '2027-06-11', origem: { operacaoId: 'x' }, numeroMovimento: motor.numeroMovimentoProvisorio(),
      }));
    assert.deepEqual([erro.code, erro.details.reason], ['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente'], resumoErro(erro));
    assert.deepEqual(await poco(s, e), antes);
    assert.equal(await estoqueAtual(e.sal), '20.0000');
  });
});

describe('C7 — concorrência', () => {
  test('duas saídas de 5 kg em paralelo (poço 10 a 2 + 10 a 4): serializadas pela trava do produto, 15,0000 cada, restante 10 kg a 3,0000', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const rs = await Promise.all([sairFifo(s, e, e.sal, '10.0000'), sairFifo(s, e, e.sal, '5.0000')]);
    assert.deepEqual(rs.map((r) => q4(r.valor_unitario)), ['3.0000', '3.0000']);
    assert.deepEqual(rs.map((r) => q4(r.valor_total)).sort(), ['15.0000', '30.0000']);
    assert.deepEqual(await poco(s, e), [['5.0000', '3.0000']]);
    await conferirInvariantes(s, 'C7');
  });

  test('duas saídas disputando o último saldo: uma passa, a outra 422; saldo nunca negativo e valor da vencedora = quantidade × médio', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const rs = await Promise.allSettled([sairFifo(s, e, e.sal, '15.0000'), sairFifo(s, e, e.sal, '15.0000')]);
    const ok = rs.filter((r) => r.status === 'fulfilled');
    const nok = rs.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(nok.length, 1);
    assert.equal(/** @type {any} */ (nok[0]).reason.code, 'ESTOQUE_SALDO_INSUFICIENTE');
    assert.equal(q4(/** @type {any} */ (ok[0]).value.valor_total), '45.0000');
    assert.deepEqual(await poco(s, e), [['5.0000', '3.0000']]);
    await conferirInvariantes(s, 'C7b');
  });
});

describe('C8 — idempotência', () => {
  test('replay da suplementação com a mesma operation_id: 200 replay, nenhuma camada reavaliada de novo e nenhum movimento a mais', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    const corpo = { operation_id: opId(), empresa_id: e.id, produto_id: e.sal.id, local_origem_id: s.local.id, quantidade: 4 };
    const r1 = await A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, corpo);
    assert.equal(r1.statusCode, 201, r1.body);
    const m = await movimento(r1.json().movimentacao.id);
    assert.deepEqual([m.modo_saida_fifo, q4(m.valor_total), q4(m.custo_medio_antes), q4(m.custo_medio_depois)], ['CUSTO_MEDIO', '12.0000', '3.0000', '3.0000']);
    const antes = await foto([s.c]);
    const r2 = await A.req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, corpo);
    assert.deepEqual([r2.statusCode, r2.json().replay], [200, true], r2.body);
    assert.equal(await foto([s.c]), antes, 'replay não grava nada');
    assert.deepEqual(await poco(s, e), [['6.0000', '3.0000'], ['10.0000', '3.0000']]);
  });
});

describe('C9 — compra intacta estornada e a simulação pura', () => {
  test('estornar a compra intacta de 10 kg a 4,0000 (camada B) tira o valor DELA do poço: sobra a camada A a 2,0000, sem reavaliação artificial', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    const b = await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    await estornarUmaEntrada(s, e, b);
    assert.deepEqual(await poco(s, e), [['10.0000', '2.0000']]);
    const r = await sairFifo(s, e, e.sal, '10.0000');
    assert.deepEqual([q4(r.valor_total), q4(r.valor_unitario)], ['20.0000', '2.0000']);
  });

  test('estornar em lote a compra intacta (efeito ENTRADA) idem; e a compra estornada continua sem entrar no médio', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await compra(s, e, '10.0000', '2.0000', { dia: '2027-06-01' });
    const b = await compra(s, e, '10.0000', '4.0000', { dia: '2027-06-02' });
    await estornarLote(s, e, [itemDaEntrada(b)], { direcao: 'PAGAR' });
    assert.deepEqual(await poco(s, e), [['10.0000', '2.0000']]);
  });

  test('consumirCustoMedio (pura): médio = V ÷ Q em 4 casas, fatias na ordem de lote com o mesmo médio, restante e camadas restantes; insuficiente não inventa valor', () => {
    const t = (n) => new Date(`2027-06-0${n}T12:00:00.000Z`);
    const lotes = [
      { id: 'b', quantidade_disponivel: D('10'), custo_unitario: D('4'), data_documento: t(2), createdAt: t(2) },
      { id: 'a', quantidade_disponivel: D('10'), custo_unitario: D('2'), data_documento: t(1), createdAt: t(1) },
    ];
    const r = motor.consumirCustoMedio(lotes, D('12'));
    assert.equal(r.suficiente, true);
    assert.deepEqual(r.fatias.map((f) => [f.lote_id, f.quantidade.toFixed(4), f.custo_unitario.toFixed(4)]), [['a', '10.0000', '3.0000'], ['b', '2.0000', '3.0000']]);
    assert.deepEqual([r.valorTotal.toFixed(4), r.valorUnitario.toFixed(4), r.custoMedioAntes.toFixed(4), r.custoMedioDepois.toFixed(4), r.camadasRestantes], ['36.0000', '3.0000', '3.0000', '3.0000', ['b']]);
    const curto = motor.consumirCustoMedio(lotes, D('21'));
    assert.deepEqual([curto.suficiente, curto.disponivel.toFixed(4)], [false, '20.0000']);
    const vazio = motor.consumirCustoMedio([], D('1'));
    assert.deepEqual([vazio.suficiente, vazio.valorTotal.toFixed(4), vazio.custoMedioAntes.toFixed(4)], [false, '0.0000', '0.0000']);
    // poço de custo zero: médio 0, restante 0, sem divisão por zero
    const zero = motor.consumirCustoMedio([{ id: 'z', quantidade_disponivel: D('5'), custo_unitario: D('0'), createdAt: t(1) }], D('2'));
    assert.deepEqual([zero.valorTotal.toFixed(4), zero.custoMedioDepois.toFixed(4)], ['0.0000', '0.0000']);
  });
});
