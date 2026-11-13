/**
 * MAIKE-ESTOQUE-P1-02 (D-PROD-177) — M4: custo e valor negativos nunca viram
 * camada (contrato §5 C2; §6.2 item 5). PostgreSQL real.
 *
 *  N1. motor: custo < 0 → 422 OPERACAO_VALORES_INVALIDOS `custo_negativo`
 *      (field `custo_unitario`); valor < 0 → `valor_negativo` (field
 *      `valor_total`); custo antes do valor; o `contextoErro` do chamador não
 *      apaga o field; recusa ANTES de qualquer leitura (tx que explode se
 *      tocada) e nada gravado no banco real;
 *  N2. zero é aceito (camada de custo 0 baixa FIFO normalmente);
 *  N3. limites exatos: custo, valor e estoque_atual + kg = LIMITE_ESTOQUE
 *      passam; + 0,0001 → `valor_excede_limite_estoque`;
 *  N4. plano puro (o caminho da Central): `valor_unitario`, `valor_desconto`
 *      e `valor_acrescimo` negativos → `valor_negativo` com field/colecao/
 *      indice; zero segue `item_valor_zero`; quantidade não positiva primeiro;
 *  N5. HTTP da Central: negativo no criar, no editar rascunho e na retificação
 *      → 400 do schema, nada gravado, nenhum efeito físico, nenhum recibo; a
 *      MESMA operation_id com o corpo corrigido cria (201, sem replay) e só
 *      então responde replay.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, docCom, foto, fotoEstoque, montarTenant, opId, prisma } from './gestaoP3Cenario.mjs';
import { argsEntrada, conferirInvariantes, ctxDe, entrar, q4, recusaAntesDeEscrever, resumoErro, sairFifo } from './estoqueP1MCenario.mjs';
import * as motor from '../src/modules/estoqueFisico/estoqueFisicoMotor.js';
import { LIMITE_ESTOQUE } from '../src/modules/financeiro/decimalFinanceiro.js';
import { normalizarDocumento, planejarOperacao } from '../src/modules/financeiro/operacaoFinanceiraPlano.js';

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

const LIMITE = LIMITE_ESTOQUE.toFixed(4);
const ACIMA = LIMITE_ESTOQUE.plus('0.0001').toFixed(4);
/** `tx` que explode em QUALQUER acesso: prova que a recusa veio antes de qualquer leitura. */
const txIntocavel = () => new Proxy({}, { get: (_alvo, k) => { throw new Error(`tx tocada antes da recusa: ${String(k)}`); } });
const recibos = (s, chave) => prisma().operacaoIdempotente.count({ where: { cliente_id: s.c, operation_key: chave } });
const recusaHttp = (r) => [r.statusCode, r.json().code];

describe('N1 — motor recusa custo e valor negativos antes de qualquer leitura', () => {
  test('custo −0,0001 → custo_negativo; valor −0,0001 → valor_negativo; os dois → custo primeiro; contextoErro não apaga o field; tx intocada; nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    await entrar(s, e, e.sal);
    const produto = await prisma().produto.findUnique({ where: { id: e.sal.id } });

    const sync = async (extra) => {
      try {
        await motor.aplicarEntradaEstoque(txIntocavel(), ctxDe(s), argsEntrada(s, e, produto, extra));
      } catch (x) {
        return x;
      }
      return null;
    };
    const custo = await sync({ custoUnitarioKg: '-0.0001' });
    assert.deepEqual(resumoErro(custo), [422, 'OPERACAO_VALORES_INVALIDOS', 'custo_unitario', 'custo_negativo'], custo?.message);
    assert.equal(custo.message, 'custo unitário não pode ser negativo; nada foi gravado');
    assert.deepEqual([custo.details.custo_unitario, custo.details.produto_id], ['-0.0001', e.sal.id]);

    const valor = await sync({ valorTotal: '-0.0001' });
    assert.deepEqual(resumoErro(valor), [422, 'OPERACAO_VALORES_INVALIDOS', 'valor_total', 'valor_negativo'], valor?.message);
    assert.equal(valor.message, 'valor total não pode ser negativo; nada foi gravado');
    assert.equal(valor.details.valor_total, '-0.0001');

    const ambos = await sync({ custoUnitarioKg: '-1', valorTotal: '-10' });
    assert.deepEqual(resumoErro(ambos), [422, 'OPERACAO_VALORES_INVALIDOS', 'custo_unitario', 'custo_negativo']);

    // o financeiro passa contextoErro.field = 'quantidade': o field da recusa continua o certo
    const ctxErro = await sync({ custoUnitarioKg: '-2.5', contextoErro: { field: 'quantidade', colecao: 'itens', indice: 3, item_ordem: 4 } });
    assert.deepEqual(resumoErro(ctxErro), [422, 'OPERACAO_VALORES_INVALIDOS', 'custo_unitario', 'custo_negativo']);
    assert.deepEqual([ctxErro.details.colecao, ctxErro.details.indice, ctxErro.details.item_ordem], ['itens', 3, 4]);
    const ctxValor = await sync({ valorTotal: '-2.5', contextoErro: { field: 'quantidade' } });
    assert.deepEqual(resumoErro(ctxValor), [422, 'OPERACAO_VALORES_INVALIDOS', 'valor_total', 'valor_negativo']);

    // também com a origem nova (a recusa de valor é da camada, não do chamador)
    const nova = await sync({
      custoUnitarioKg: '-1',
      origem: { operacaoId: 'doc', sistema: motor.ORIGEM_ENTRADA_ESTOQUE, tipoDetalhado: 'entrada_doacao', motivo: 'Doação' },
    });
    assert.deepEqual(resumoErro(nova), [422, 'OPERACAO_VALORES_INVALIDOS', 'custo_unitario', 'custo_negativo']);

    // no banco real, com a trava: nenhuma escrita antes da recusa, nada gravado depois
    for (const extra of [{ custoUnitarioKg: '-0.0001' }, { valorTotal: '-0.0001' }, { custoUnitarioKg: '-5', quantidadeKg: '1.0000' }]) {
      const erro = await recusaAntesDeEscrever(s, e.id, [e.sal.id], async (tx) => {
        const lido = await tx.produto.findUnique({ where: { id: e.sal.id } });
        await motor.aplicarEntradaEstoque(tx, ctxDe(s), argsEntrada(s, e, lido, extra));
      });
      assert.equal(resumoErro(erro)[1], 'OPERACAO_VALORES_INVALIDOS', JSON.stringify(extra));
    }
    await conferirInvariantes(s, 'N1');
  });
});

describe('N2 — zero é aceito', () => {
  test('custo 0 e valor 0 → camada de custo 0,0000; a baixa FIFO dessa camada grava fatia de custo 0 (CHECK custo ≥ 0 ok)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const r = await entrar(s, e, e.milho, { custoUnitarioKg: '0', valorTotal: '0.0000' });
    assert.deepEqual([q4(r.lote.custo_unitario), q4(r.movimento.valor_total), q4(r.movimento.valor_unitario)], ['0.0000', '0.0000', '0.0000']);
    const venda = await sairFifo(s, e, e.milho, '4.0000');
    assert.deepEqual(venda.fatias.map((f) => [f.lote_id, q4(f.quantidade), q4(f.custo_unitario)]), [[r.lote.id, '4.0000', '0.0000']]);
    assert.equal(q4(venda.valor_total), '0.0000');
    // "-0" não é negativo
    const menosZero = await entrar(s, e, e.milho, { custoUnitarioKg: '-0', valorTotal: '-0.0000' });
    assert.equal(q4(menosZero.lote.custo_unitario), '0.0000');
    await conferirInvariantes(s, 'N2');
  });
});

describe('N3 — limites exatos', () => {
  test('custo = LIMITE e valor = LIMITE passam; + 0,0001 → valor_excede_limite_estoque; estoque_atual + kg = LIMITE passa, + 0,0001 recusa; nada gravado nas recusas', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const custoMax = await entrar(s, e, e.sal, { quantidadeKg: '1.0000', custoUnitarioKg: LIMITE, valorTotal: '1.0000' });
    assert.equal(q4(custoMax.lote.custo_unitario), LIMITE);
    const valorMax = await entrar(s, e, e.sal, { quantidadeKg: '1.0000', custoUnitarioKg: '1.0000', valorTotal: LIMITE });
    assert.equal(q4(valorMax.movimento.valor_total), LIMITE);
    for (const extra of [{ custoUnitarioKg: ACIMA }, { valorTotal: ACIMA }, { quantidadeKg: ACIMA }]) {
      const erro = await recusaAntesDeEscrever(s, e.id, [e.sal.id], async (tx) => {
        const lido = await tx.produto.findUnique({ where: { id: e.sal.id } });
        await motor.aplicarEntradaEstoque(tx, ctxDe(s), argsEntrada(s, e, lido, extra));
      });
      assert.deepEqual(resumoErro(erro).slice(1), ['OPERACAO_VALORES_INVALIDOS', 'quantidade', 'valor_excede_limite_estoque'], JSON.stringify(extra));
    }
    // estoque_atual + kg: o milho começa em LIMITE − 10 (cache sem camada: diferença declarada nos invariantes)
    const base = LIMITE_ESTOQUE.minus(10).toFixed(4);
    await prisma().produto.update({ where: { id: e.milho.id }, data: { estoque_atual: base } });
    const noLimite = await entrar(s, e, e.milho, { quantidadeKg: '10.0000', custoUnitarioKg: '0.0001', valorTotal: '0.0010' });
    assert.equal(q4(noLimite.estoque_atual), LIMITE);
    await prisma().produto.update({ where: { id: e.milho.id }, data: { estoque_atual: LIMITE_ESTOQUE.minus('0.0001').toFixed(4) } });
    const erro = await recusaAntesDeEscrever(s, e.id, [e.milho.id], async (tx) => {
      const lido = await tx.produto.findUnique({ where: { id: e.milho.id } });
      await motor.aplicarEntradaEstoque(tx, ctxDe(s), argsEntrada(s, e, lido, { quantidadeKg: '0.0002', custoUnitarioKg: '1', valorTotal: '0.0002' }));
    });
    assert.deepEqual(resumoErro(erro).slice(1), ['OPERACAO_VALORES_INVALIDOS', 'quantidade', 'valor_excede_limite_estoque']);
    assert.equal(erro.details.estoque_atual, LIMITE_ESTOQUE.minus('0.0001').toFixed(4));
    await conferirInvariantes(s, 'N3', { [e.milho.id]: LIMITE_ESTOQUE.minus('10.0001').toFixed(4) });
  });
});

// ─── N4: plano puro (o mesmo da Central) ────────────────────────────────────
const produtoPuro = (n, unidade, peso = null) => ({ id: `P${n}`, empresa_id: 'E', nome_produto: `PRODUTO ${n}`, ativo: true, unidade_principal_estoque: unidade, peso_por_saco_kg: peso, estoque_atual: '0' });
const corpoPuro = (itens, parcela, extra = {}) => ({
  empresa_id: 'E', direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: 'F', data_emissao: '2027-06-10', data_operacional: '2027-06-10',
  efeito_fisico_confirmado: true, rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: 'N', percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: parcela }],
  itens: itens.map((i, k) => ({ tipo_item: 'MERCADORIA', produto_id: `P${k + 1}`, local_estoque_id: 'L1', unidade: 'KG', quantidade: i.quantidade ?? '10', valor_unitario: i.valor_unitario })),
  ...extra,
});
/** Plano em 2 passos (o 1º descobre o total para a parcela); devolve `{ok}` ou `{erro: [code, field, reason, colecao, indice]}`. */
const planoPuro = (itens, extra = {}) => {
  const refs = { casas: 2, moeda: 'BRL', produtos: new Map(itens.map((_i, k) => [`P${k + 1}`, produtoPuro(k + 1, 'KG')])) };
  const tentar = (parcela) => planejarOperacao(normalizarDocumento(corpoPuro(itens, parcela, extra), 2), refs);
  const comoErro = (x) => ({ erro: [x.code, x.details?.field ?? null, x.details?.reason ?? null, x.details?.colecao ?? null, x.details?.indice ?? null], mensagem: x.message });
  try {
    return { ok: tentar('1') };
  } catch (x) {
    if (/** @type {any} */ (x)?.details?.reason !== 'soma_diferente') return comoErro(x);
    try {
      return { ok: tentar(/** @type {any} */ (x).details.esperado) };
    } catch (x2) {
      return comoErro(x2);
    }
  }
};

describe('N4 — plano (Central) recusa valores negativos pelo nome', () => {
  test('valor_unitario/valor_desconto/valor_acrescimo < 0 → OPERACAO_VALORES_INVALIDOS valor_negativo; zero passa ou cai em item_valor_zero; quantidade não positiva vem antes', () => {
    const neg = planoPuro([{ valor_unitario: '2' }, { valor_unitario: '-0.01' }]);
    assert.deepEqual(neg.erro, ['OPERACAO_VALORES_INVALIDOS', 'valor_unitario', 'valor_negativo', 'itens', 1]);
    assert.equal(neg.mensagem, 'o valor unitário não pode ser negativo; nada foi gravado');
    assert.deepEqual(planoPuro([{ valor_unitario: '0' }]).erro, ['OPERACAO_VALORES_INVALIDOS', 'valor_unitario', 'item_valor_zero', 'itens', 0], 'zero continua item_valor_zero');
    assert.deepEqual(planoPuro([{ valor_unitario: '-0' }]).erro?.[2], 'item_valor_zero', '"-0" não é negativo');
    assert.deepEqual(planoPuro([{ quantidade: '0', valor_unitario: '-1' }]).erro?.[2], 'quantidade_nao_positiva');
    assert.deepEqual(planoPuro([{ valor_unitario: '2' }], { valor_desconto: '-1.00' }).erro, ['OPERACAO_VALORES_INVALIDOS', 'valor_desconto', 'valor_negativo', null, null]);
    assert.deepEqual(planoPuro([{ valor_unitario: '2' }], { valor_acrescimo: '-0.01' }).erro, ['OPERACAO_VALORES_INVALIDOS', 'valor_acrescimo', 'valor_negativo', null, null]);
    const zeros = planoPuro([{ valor_unitario: '2' }], { valor_desconto: '0.00', valor_acrescimo: '0' });
    assert.ok(zeros.ok, JSON.stringify(zeros.erro));
    const ok = planoPuro([{ valor_unitario: '2' }], { valor_desconto: '5.00', valor_acrescimo: '1.00' });
    assert.ok(ok.ok, JSON.stringify(ok.erro));
  });
});

describe('N5 — HTTP da Central: negativo nunca chega ao banco nem deixa recibo', () => {
  test('criar com valor_unitario/desconto/acréscimo negativos → 400 do schema; nada gravado; sem recibo; a mesma operation_id corrigida cria (201) e só então é replay', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const base = docCom(e, s.local, [{ produto: e.sal, quantidade: '10', valor_unitario: '2' }]);
    const casos = [
      ['valor_unitario', { ...base, itens: [{ ...base.itens[0], valor_unitario: '-2' }] }],
      ['valor_desconto', { ...base, valor_desconto: '-1.00' }],
      ['valor_acrescimo', { ...base, valor_acrescimo: '-0.01' }],
    ];
    for (const [campo, corpo] of casos) {
      const antes = await foto(s.c);
      const chave = opId();
      const r = await A.req('POST', '/operacoes-financeiras', s.token, { ...corpo, operation_id: chave });
      assert.deepEqual(recusaHttp(r), [400, 'REQUEST_VALIDATION_FAILED'], `${campo}: ${r.body}`);
      assert.equal(await foto(s.c), antes, `${campo}: nada gravado`);
      assert.equal(await recibos(s, chave), 0, `${campo}: nenhum recibo`);
      // a MESMA chave, com o corpo corrigido: cria de verdade (a recusa não deixou recibo)
      const ok = await A.req('POST', '/operacoes-financeiras', s.token, { ...base, operation_id: chave });
      assert.equal(ok.statusCode, 201, ok.body);
      assert.equal(ok.json().replay, false);
      const replay = await A.req('POST', '/operacoes-financeiras', s.token, { ...base, operation_id: chave });
      assert.deepEqual([replay.statusCode, replay.json().replay, replay.json().id], [200, true, ok.json().id]);
    }
  });

  test('editar rascunho e retificar confirmado com negativo → 400; rascunho/documento intactos; nenhum efeito físico; sem recibo da retificação', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const corpo = docCom(e, s.local, [{ produto: e.sal, quantidade: '10', valor_unitario: '2' }]);
    const rascunho = await A.criar(s.token, corpo);
    const antes = await foto(s.c);
    const put = await A.req('PUT', `/operacoes-financeiras/${rascunho.id}`, s.token, { ...corpo, versao: rascunho.versao, itens: [{ ...corpo.itens[0], valor_unitario: '-2' }] });
    assert.deepEqual(recusaHttp(put), [400, 'REQUEST_VALIDATION_FAILED'], put.body);
    assert.equal(await foto(s.c), antes, 'editar rascunho: nada mudou');

    const confirmado = await A.confirmar(s.token, rascunho, e.id);
    const fisico = await fotoEstoque(s.c);
    const docAntes = await foto(s.c);
    const chave = opId();
    const ret = await A.req('POST', `/operacoes-financeiras/${confirmado.id}/retificar`, s.token, {
      ...corpo, versao: confirmado.versao, operation_id: chave, motivo: 'teste de retificação negativa', valor_desconto: '-3.00',
    });
    assert.deepEqual(recusaHttp(ret), [400, 'REQUEST_VALIDATION_FAILED'], ret.body);
    assert.equal(await fotoEstoque(s.c), fisico, 'nenhum efeito físico');
    assert.equal(await foto(s.c), docAntes, 'nada gravado');
    assert.equal(await recibos(s, chave), 0);
    await conferirInvariantes(s, 'N5');
  });
});
