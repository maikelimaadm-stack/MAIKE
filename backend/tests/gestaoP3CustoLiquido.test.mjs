/**
 * D-PROD-155 — P3-01 rodada 4: política "custo de aquisição líquido".
 * PostgreSQL real, HTTP autenticado, prova pelas linhas gravadas.
 *
 * Desconto e acréscimo do CABEÇALHO são rateados (separadamente, maiores
 * restos em unidades mínimas da moeda, empate → menor ordem) entre TODAS as
 * linhas de um COM_PRODUTOS. Na compra de mercadoria o lote e o movimento de
 * entrada usam o valor LÍQUIDO da linha; o resíduo de arredondamento do custo
 * por kg (4 casas, colunas antigas) é mostrado e, acima do limite, recusado.
 * Na venda o rateio é informativo e o custo da saída continua FIFO.
 *
 * Vetores compartilhados com a tela: tests/smoke/fixtures/rateioCabecalhoVetores.json.
 *
 *  L1. vetores (BRL/PYG/KWD, sobra de centavo, empate, mercadoria+serviço,
 *      desconto e acréscimo juntos, resíduo no limite e fora dele, líquido ≤ 0,
 *      venda): rascunho, linhas gravadas, prévia, confirmação, lote e movimento;
 *  L2. cadeia: compra 100 SACO × 80 com desconto 500 → venda FIFO do lote
 *      descontado → cancelamento da venda e da compra (estornos coerentes);
 *  L3. custo do detalhe vem do lote; replanejamento na confirmação; bloqueio
 *      de representabilidade na prévia e 422 na confirmação sem efeito;
 *  L4. SEM_PRODUTOS inalterado; PUT regrava o rateio;
 *  L5. idempotência, falha forçada (gatilho) com rollback total, concorrência;
 *  L6. CHECKs novos recusam INSERT/UPDATE direto incoerente.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docCom, docSem, foto, loteLegado, montarTenant, motivo, opId, prisma } from './gestaoP3Cenario.mjs';

const VETORES = JSON.parse(readFileSync(new URL('../../tests/smoke/fixtures/rateioCabecalhoVetores.json', import.meta.url), 'utf8'));

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
const q4 = (v) => (v === null || v === undefined ? null : D(v).toFixed(4));
const CAMPOS = ['ordem', 'valor_total', 'valor_desconto_rateado', 'valor_acrescimo_rateado', 'valor_liquido', 'quantidade_estoque', 'custo_kg', 'residuo_custo'];
const linhas = (itens) => itens.map((i) => Object.fromEntries(CAMPOS.map((k) => [k, i[k] ?? null])));
const estoqueAtual = async (produto) => (await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual.toFixed(4);
const definirEstoqueAtual = (produto, kg) => prisma().produto.update({ where: { id: produto.id }, data: { estoque_atual: kg } });

let seqProduto = 0;
/** Produto novo da empresa (estoque isolado por item do vetor). */
const novoProduto = (s, e, unidade, peso) => {
  seqProduto += 1;
  return prisma().produto.create({
    data: { cliente_id: s.c, empresa_id: e.id, numero_produto: `9${seqProduto}`, nome_produto: `VETOR ${seqProduto}`, unidade_principal_estoque: unidade, peso_por_saco_kg: peso ?? null },
  });
};

/** Documento COM_PRODUTOS a partir de um vetor (1 parcela a prazo, rateio 100%). */
const documentoDoVetor = async (s, e, caso) => {
  const produtos = [];
  const itens = [];
  for (const it of caso.itens) {
    if (it.tipo_item === 'SERVICO') {
      produtos.push(null);
      itens.push({ tipo_item: 'SERVICO', unidade: 'UN', quantidade: it.quantidade, valor_unitario: it.valor_unitario, descricao: it.descricao });
      continue;
    }
    const produto = await novoProduto(s, e, it.unidade, it.peso_por_saco_kg);
    produtos.push(produto);
    itens.push({ tipo_item: 'MERCADORIA', produto_id: produto.id, local_estoque_id: s.local.id, unidade: it.unidade, quantidade: it.quantidade, valor_unitario: it.valor_unitario });
  }
  const pagar = caso.direcao === 'PAGAR';
  const doc = {
    empresa_id: e.id,
    direcao: caso.direcao,
    conteudo: 'COM_PRODUTOS',
    condicao: 'PRAZO',
    parceiro_id: (pagar ? e.forn : e.cli).id,
    data_emissao: '2027-06-10',
    data_operacional: '2027-06-10',
    efeito_fisico_confirmado: true,
    itens,
    valor_desconto: caso.valor_desconto,
    valor_acrescimo: caso.valor_acrescimo,
    rateio_modo: 'PERCENTUAL',
    rateios: [{ natureza_id: (pagar ? e.desp : e.rec).id, percentual: '100' }],
    parcelas: [{ vencimento: '2027-07-10', valor: caso.esperado.valor_total }],
  };
  return { doc, produtos };
};

/** Tenant por perfil (moeda), reaproveitado entre vetores. */
const tenants = new Map();
const tenantDe = async (perfil) => {
  const chave = `${perfil.pais}|${perfil.moeda}`;
  if (!tenants.has(chave)) tenants.set(chave, await montarTenant(app, { perfil }));
  return tenants.get(chave);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('L1 — vetores compartilhados (rascunho, prévia, confirmação, lote e movimento)', () => {
  for (const caso of VETORES.casos) {
    test(`vetor ${caso.id}: ${caso.descricao}`, async () => {
      const s = await tenantDe(caso.perfil);
      const e = s.e1;
      const p = prisma();
      const { doc, produtos } = await documentoDoVetor(s, e, caso);
      const esp = caso.esperado;
      if (esp.erro) {
        const antes = await foto(s.c);
        const r = await A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: opId() });
        assert.equal(r.statusCode, esp.erro.status, r.body);
        const corpo = r.json();
        assert.deepEqual([corpo.code, corpo.field, corpo.reason], [esp.erro.code, esp.erro.field, esp.erro.reason], r.body);
        const det = { ...corpo.details };
        delete det.field;
        delete det.reason;
        assert.deepEqual(det, esp.erro.details, r.body);
        assert.equal(await foto(s.c), antes, 'nada gravado');
        return;
      }
      // compra: o lote e o movimento usam o LÍQUIDO (asserção primeiro: é o RED do código anterior)
      if (caso.direcao === 'RECEBER') {
        for (const [k, it] of caso.itens.entries()) {
          if (it.tipo_item !== 'MERCADORIA') continue;
          await loteLegado(s, e, produtos[k], s.local, { kg: '1000', custo: '2.0000', dia: '2027-05-01' });
          await definirEstoqueAtual(produtos[k], '1000');
        }
      }
      const d = await A.criar(s.token, doc);
      const confirmado = await A.confirmar(s.token, d, e.id);
      if (caso.direcao === 'PAGAR') {
        for (const [k, it] of confirmado.itens.entries()) {
          if (it.tipo_item !== 'MERCADORIA') continue;
          const lote = await p.estoqueLoteNota.findUnique({ where: { id: it.estoque_lote_nota_id } });
          const mov = await p.movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estoque_id } });
          assert.deepEqual(
            [q4(lote.custo_unitario), q4(mov.valor_total), q4(mov.valor_unitario), q4(mov.quantidade)],
            [esp.itens[k].custo_kg, q4(esp.itens[k].valor_liquido), esp.itens[k].custo_kg, esp.itens[k].quantidade_estoque],
            `item ${k + 1}: lote custo / movimento valor_total / valor_unitario / kg`,
          );
        }
      } else {
        for (const it of confirmado.itens) {
          const mov = await p.movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estoque_id } });
          // custo da saída: FIFO do lote legado (2,0000/kg), nunca o preço nem o líquido da venda
          assert.deepEqual([q4(mov.valor_total), q4(mov.valor_unitario), it.consumos.map((c) => c.custo_unitario)], [D(it.quantidade_estoque).times(2).toFixed(4), '2.0000', ['2.0000']]);
        }
      }
      // documento: totais, título e linhas
      assert.deepEqual([d.valor_bruto, d.valor_total, confirmado.titulos.map((t) => t.valor)], [esp.valor_bruto, esp.valor_total, [esp.valor_total]]);
      assert.deepEqual(linhas(d.itens), esp.itens, 'rascunho (detalhe)');
      assert.deepEqual(linhas(confirmado.itens), esp.itens, 'confirmado (detalhe; custo do lote)');
      const soma = esp.itens.reduce((t, i) => t.plus(D(i.valor_liquido)), D(0));
      assert.equal(soma.toFixed(caso.casas), esp.valor_total, 'Σ líquido = total do documento');
      const gravados = await p.operacaoFinanceiraItem.findMany({ where: { cliente_id: s.c, operacao_id: d.id }, orderBy: { ordem: 'asc' } });
      assert.deepEqual(
        gravados.map((g) => [g.ordem, q4(g.valor_desconto_rateado), q4(g.valor_acrescimo_rateado), q4(g.valor_liquido)]),
        esp.itens.map((i) => [i.ordem, q4(i.valor_desconto_rateado), q4(i.valor_acrescimo_rateado), q4(i.valor_liquido)]),
        'colunas novas gravadas',
      );
    });

    if (!caso.esperado.erro) {
      test(`vetor ${caso.id}: prévia (linhas, entradas, avisos e resíduo total)`, async () => {
        const s = await tenantDe(caso.perfil);
        const e = s.e1;
        const { doc, produtos } = await documentoDoVetor(s, e, caso);
        if (caso.direcao === 'RECEBER') {
          for (const [k, it] of caso.itens.entries()) {
            if (it.tipo_item !== 'MERCADORIA') continue;
            await loteLegado(s, e, produtos[k], s.local, { kg: '1000', custo: '2.0000', dia: '2027-05-01' });
            await definirEstoqueAtual(produtos[k], '1000');
          }
        }
        const d = await A.criar(s.token, doc);
        const prev = await A.previa(s.token, d.id, e.id);
        assert.deepEqual(prev.bloqueios, []);
        assert.deepEqual(linhas(prev.plano.itens), caso.esperado.itens);
        assert.deepEqual(prev.plano.avisos.map((a) => a.codigo), caso.esperado.avisos);
        const residuo = prev.plano.avisos.find((a) => a.codigo === 'residuo_custo_estoque');
        assert.equal(residuo?.residuo_total ?? null, caso.esperado.avisos.includes('residuo_custo_estoque') ? caso.esperado.residuo_total : null);
        // Chaves EXATAS de entradas/saídas: o backend falso da tela confere a mesma lista.
        const chaves = VETORES.formato.efeitos_estoque_chaves;
        for (const x of prev.plano.efeitos_estoque.entradas) assert.deepEqual(Object.keys(x).sort(), [...chaves.entradas].sort(), 'chaves da entrada');
        for (const x of prev.plano.efeitos_estoque.saidas) assert.deepEqual(Object.keys(x).sort(), [...chaves.saidas].sort(), 'chaves da saída');
        assert.equal(prev.plano.efeitos_estoque.entradas.length + prev.plano.efeitos_estoque.saidas.length, caso.itens.filter((i) => i.tipo_item === 'MERCADORIA').length, 'um efeito por mercadoria');
        if (caso.direcao === 'PAGAR') {
          assert.deepEqual(
            prev.plano.efeitos_estoque.entradas.map((x) => [x.item_ordem, x.kg, x.custo_kg]),
            caso.esperado.itens.filter((i) => i.custo_kg !== null).map((i) => [i.ordem, i.quantidade_estoque, i.custo_kg]),
          );
        }
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
describe('L2 — cadeia: compra com desconto → venda FIFO → cancelamentos', () => {
  test('compra 100 SACO × 80 com desconto 500: título 7.500, lote 2,5000/kg, movimento 7.500; venda FIFO a 2,5000; estornos coerentes (estoque e lote voltam)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const compra = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.racao, unidade: 'SACO', quantidade: '100', valor_unitario: '80' }], {
      valor_desconto: '500.00', total: '7500.00', documento_referencia: 'NF-DESC',
    }));
    const it = compra.itens[0];
    const lote = await p.estoqueLoteNota.findUnique({ where: { id: it.estoque_lote_nota_id } });
    const entrada = await p.movimentacaoEstoque.findUnique({ where: { id: it.movimentacao_estoque_id } });
    assert.deepEqual([q4(lote.custo_unitario), q4(entrada.valor_total), q4(entrada.valor_unitario)], ['2.5000', '7500.0000', '2.5000'], 'lote e movimento pelo líquido');
    assert.deepEqual([compra.valor_total, compra.titulos.map((t) => t.valor), it.valor_liquido, it.custo_kg, it.residuo_custo], ['7500.00', ['7500.00'], '7500.00', '2.5000', '0.00000000']);
    assert.equal(await estoqueAtual(e.racao), '3000.0000');

    // venda de 1000 kg consome o lote descontado: custo FIFO = 1000 × 2,5000
    const venda = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.racao, quantidade: '1000', valor_unitario: '4' }], { direcao: 'RECEBER' }));
    const saida = await p.movimentacaoEstoque.findUnique({ where: { id: venda.itens[0].movimentacao_estoque_id } });
    assert.deepEqual([q4(saida.valor_total), q4(saida.valor_unitario), venda.itens[0].consumos], ['2500.0000', '2.5000', [{ estoque_lote_nota_id: lote.id, quantidade: '1000.0000', custo_unitario: '2.5000' }]]);
    assert.deepEqual([venda.itens[0].custo_kg, venda.itens[0].residuo_custo, venda.itens[0].valor_liquido], [null, null, '4000.00']);

    // cancelar a venda devolve a fatia; cancelar a compra estorna pelo mesmo valor líquido
    await A.ok(A.cancelarReq(s.token, venda.id, e.id));
    assert.equal(q4((await p.estoqueLoteNota.findUnique({ where: { id: lote.id } })).quantidade_disponivel), '3000.0000');
    const canc = await A.ok(A.cancelarReq(s.token, compra.id, e.id));
    const estorno = await p.movimentacaoEstoque.findUnique({ where: { id: canc.itens[0].movimentacao_estorno_id } });
    assert.deepEqual(
      [estorno.tipo_detalhado, estorno.movimento_pai_id, q4(estorno.quantidade), q4(estorno.valor_total), q4(estorno.valor_unitario)],
      ['estorno_compra', entrada.id, '3000.0000', '7500.0000', '2.5000'],
    );
    const loteFinal = await p.estoqueLoteNota.findUnique({ where: { id: lote.id } });
    assert.deepEqual([loteFinal.status, q4(loteFinal.quantidade_disponivel), q4(loteFinal.custo_unitario), await estoqueAtual(e.racao)], ['Estornado', '0.0000', '2.5000', '0.0000']);
    assert.deepEqual([canc.status, canc.itens[0].custo_kg, canc.itens[0].residuo_custo, canc.itens[0].valor_liquido], ['CANCELADO', '2.5000', '0.00000000', '7500.00']);
  });

  test('venda com desconto e acréscimo: rateio informativo nas linhas; custo FIFO inalterado (fatia × custo do lote)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await loteLegado(s, e, e.sal, s.local, { kg: '5', custo: '2.0000', dia: '2027-05-01' });
    await loteLegado(s, e, e.sal, s.local, { kg: '10', custo: '3.0000', dia: '2027-05-02' });
    await definirEstoqueAtual(e.sal, '15');
    const venda = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '8', valor_unitario: '10' }], { direcao: 'RECEBER', valor_desconto: '10.00', valor_acrescimo: '1.00', total: '71.00' }));
    const mov = await p.movimentacaoEstoque.findUnique({ where: { id: venda.itens[0].movimentacao_estoque_id } });
    assert.deepEqual([q4(mov.valor_total), q4(mov.valor_unitario)], ['19.0000', '2.3750'], '5 × 2 + 3 × 3 = 19 (FIFO), não o preço líquido');
    assert.deepEqual(linhas(venda.itens), [{ ordem: 1, valor_total: '80.00', valor_desconto_rateado: '10.00', valor_acrescimo_rateado: '1.00', valor_liquido: '71.00', quantidade_estoque: '8.0000', custo_kg: null, residuo_custo: null }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('L3 — custo do detalhe, replanejamento e representabilidade', () => {
  test('detalhe confirmado lê o custo do LOTE gravado; confirmação replaneja o kg (peso do saco mudou) e regrava as colunas', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criar(s.token, docCom(e, s.local, [{ produto: e.racao, unidade: 'SACO', quantidade: '100', valor_unitario: '80' }], { valor_desconto: '500.00', total: '7500.00' }));
    assert.deepEqual([d.itens[0].quantidade_estoque, d.itens[0].custo_kg, d.itens[0].residuo_custo], ['3000.0000', '2.5000', '0.00000000']);
    await p.produto.update({ where: { id: e.racao.id }, data: { peso_por_saco_kg: '40' } });
    const conf = await A.confirmar(s.token, d, e.id);
    assert.deepEqual([conf.itens[0].quantidade_estoque, conf.itens[0].custo_kg, conf.itens[0].residuo_custo, conf.itens[0].valor_liquido], ['4000.0000', '1.8750', '0.00000000', '7500.00']);
    const lote = await p.estoqueLoteNota.findUnique({ where: { id: conf.itens[0].estoque_lote_nota_id } });
    assert.deepEqual([q4(lote.custo_unitario), q4(lote.quantidade_entrada)], ['1.8750', '4000.0000']);
    // prova de que o detalhe usa o lote (não recalcula): custo do lote alterado direto no banco
    await p.estoqueLoteNota.update({ where: { id: lote.id }, data: { custo_unitario: '1.8000' } });
    const det = await A.detalhe(s.token, d.id, e.id);
    assert.deepEqual([det.itens[0].custo_kg, det.itens[0].residuo_custo], ['1.8000', '300.00000000']);
  });

  test('resíduo fora do limite depois do rascunho (peso do saco mudou): prévia bloqueia com os detalhes; confirmação 422 sem efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criar(s.token, docCom(e, s.local, [{ produto: e.racao, unidade: 'SACO', quantidade: '100', valor_unitario: '80' }]));
    await p.produto.update({ where: { id: e.racao.id }, data: { peso_por_saco_kg: '30000' } });
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual(prev.plano, null);
    assert.deepEqual(prev.bloqueios.map((b) => [b.code, b.field, b.reason, b.details.indice, b.details.valor_liquido, b.details.quantidade_estoque, b.details.custo_kg, b.details.residuo_custo]), [
      ['OPERACAO_VALORES_INVALIDOS', 'valor_unitario', 'custo_kg_nao_representavel', 0, '8000.00', '3000000.0000', '0.0027', '-100.00000000'],
    ]);
    const antes = await foto(s.c);
    const r = await A.confirmarReq(s.token, d, e.id);
    assert.deepEqual([r.statusCode, codigo(r), motivo(r)], [422, 'OPERACAO_VALORES_INVALIDOS', 'custo_kg_nao_representavel'], r.body);
    assert.equal(await foto(s.c), antes, 'nada gravado');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('L4 — SEM_PRODUTOS e PUT', () => {
  test('SEM_PRODUTOS com desconto e acréscimo: inalterado (sem itens, sem aviso de rateio)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criar(s.token, docSem(e, { valor_bruto: '100.00', valor_desconto: '10.00', valor_acrescimo: '0.01', rateios: [{ natureza_id: e.desp.id, valor: '90.01' }], parcelas: [{ vencimento: '2027-07-10', valor: '90.01' }] }));
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual([d.valor_total, d.itens, prev.plano.itens, prev.plano.avisos, prev.bloqueios], ['90.01', [], [], [], []]);
    const conf = await A.confirmar(s.token, d, e.id);
    assert.deepEqual([conf.status, conf.titulos.map((t) => t.valor)], ['CONFIRMADO', ['90.01']]);
  });

  test('PUT troca o desconto: as colunas do rateio são regravadas', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const base = (desconto, total) => docCom(e, s.local, [{ produto: e.sal, quantidade: '10', valor_unitario: '1' }, { produto: e.milho, quantidade: '30', valor_unitario: '1' }], { valor_desconto: desconto, total });
    const d = await A.criar(s.token, base('0.00', '40.00'));
    assert.deepEqual(d.itens.map((i) => [i.valor_desconto_rateado, i.valor_liquido, i.custo_kg]), [['0.00', '10.00', '1.0000'], ['0.00', '30.00', '1.0000']]);
    const put = await A.ok(A.req('PUT', `/operacoes-financeiras/${d.id}`, s.token, { ...base('4.00', '36.00'), versao: d.versao }));
    assert.deepEqual(put.itens.map((i) => [i.valor_desconto_rateado, i.valor_liquido, i.custo_kg]), [['1.00', '9.00', '0.9000'], ['3.00', '27.00', '0.9000']]);
    const gravados = await p.operacaoFinanceiraItem.findMany({ where: { cliente_id: s.c, operacao_id: d.id }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(gravados.map((g) => [q4(g.valor_desconto_rateado), q4(g.valor_liquido)]), [['1.0000', '9.0000'], ['3.0000', '27.0000']]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('L5 — idempotência, falha forçada e concorrência', () => {
  const rascunhoComDesconto = async (s) =>
    A.criar(s.token, docCom(s.e1, s.local, [{ produto: s.e1.racao, unidade: 'SACO', quantidade: '100', valor_unitario: '80' }], { valor_desconto: '500.00', total: '7500.00' }));

  test('replay da confirmação (mesmo operation_id) devolve o mesmo resultado com desconto, sem segundo efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await rascunhoComDesconto(s);
    const corpo = { empresa_id: e.id, operation_id: opId(), versao: d.versao };
    const r1 = await A.ok(A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, corpo));
    const r2 = await A.ok(A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, corpo));
    assert.deepEqual([r1.replay, r2.replay], [false, true]);
    assert.deepEqual(linhas(r2.itens), linhas(r1.itens));
    assert.deepEqual([r1.itens[0].custo_kg, r1.itens[0].valor_liquido], ['2.5000', '7500.00']);
    assert.deepEqual([await p.estoqueLoteNota.count({ where: { cliente_id: s.c } }), await p.movimentacaoEstoque.count({ where: { cliente_id: s.c } }), await estoqueAtual(e.racao)], [1, 1, '3000.0000']);
  });

  test('falha forçada (gatilho temporário) no lote, no movimento e na regravação do item → 500 e rollback total', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await rascunhoComDesconto(s);
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION p3l_falha() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'falha forçada P3-01 custo líquido'; END $f$`);
    const gatilhos = [
      ['p3l_lote_ins', 'BEFORE INSERT ON "EstoqueLoteNota"'],
      ['p3l_mov_ins', 'BEFORE INSERT ON "MovimentacaoEstoque"'],
      ['p3l_item_upd', 'BEFORE UPDATE ON "OperacaoFinanceiraItem"'],
    ];
    try {
      const corpo = { empresa_id: e.id, operation_id: opId(), versao: d.versao };
      for (const [nome, quando] of gatilhos) {
        await p.$executeRawUnsafe(`CREATE TRIGGER ${nome} ${quando} FOR EACH ROW EXECUTE FUNCTION p3l_falha()`);
        const antes = await foto(s.c);
        const r = await A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, corpo);
        assert.equal(r.statusCode, 500, `${nome}: ${r.body}`);
        assert.equal(await foto(s.c), antes, `${nome}: tudo desfeito`);
        await p.$executeRawUnsafe(`DROP TRIGGER ${nome} ON ${quando.split(' ON ')[1]}`);
      }
      const ok = await A.ok(A.req('POST', `/operacoes-financeiras/${d.id}/confirmar`, s.token, corpo));
      assert.deepEqual([ok.status, ok.itens[0].custo_kg, ok.itens[0].valor_liquido], ['CONFIRMADO', '2.5000', '7500.00']);
    } finally {
      for (const [nome, quando] of gatilhos) await p.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${nome} ON ${quando.split(' ON ')[1]}`);
      await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS p3l_falha()');
    }
  });

  test('duas confirmações simultâneas (chaves diferentes) do rascunho com desconto: uma aplica, a outra 409; um lote a 2,5000', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await rascunhoComDesconto(s);
    const respostas = await Promise.all([A.confirmarReq(s.token, d, e.id), A.confirmarReq(s.token, d, e.id)]);
    assert.deepEqual(respostas.map((r) => r.statusCode).sort(), [200, 409], respostas.map((r) => r.body).join('\n'));
    const lotes = await p.estoqueLoteNota.findMany({ where: { cliente_id: s.c } });
    assert.deepEqual([lotes.length, q4(lotes[0].custo_unitario), await p.movimentacaoEstoque.count({ where: { cliente_id: s.c } }), await estoqueAtual(e.racao)], [1, '2.5000', 1, '3000.0000']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('L6 — CHECKs das colunas novas', () => {
  test('INSERT/UPDATE direto incoerente é recusado pelo banco (líquido ≠ total − desconto + acréscimo, negativos, líquido ≤ 0)', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '10', valor_unitario: '1' }, { produto: e.milho, quantidade: '30', valor_unitario: '1' }], { valor_desconto: '4.00', total: '36.00' }));
    const [i1] = await p.operacaoFinanceiraItem.findMany({ where: { cliente_id: s.c, operacao_id: d.id }, orderBy: { ordem: 'asc' } });
    const recusa = async (sql, restricao) => {
      await assert.rejects(p.$executeRawUnsafe(sql), (erro) => {
        assert.match(String(/** @type {any} */ (erro).message), new RegExp(restricao), sql);
        return true;
      });
    };
    const upd = (set) => `UPDATE "OperacaoFinanceiraItem" SET ${set} WHERE id = '${i1.id}'`;
    await recusa(upd('valor_liquido = valor_liquido + 0.01'), 'OperacaoFinanceiraItem_liquido_check');
    await recusa(upd('valor_desconto_rateado = valor_desconto_rateado + 0.01'), 'OperacaoFinanceiraItem_liquido_check');
    await recusa(upd('valor_desconto_rateado = -1, valor_liquido = valor_total + 1'), 'OperacaoFinanceiraItem_rateado_check');
    await recusa(upd('valor_acrescimo_rateado = -1, valor_liquido = valor_total - valor_desconto_rateado - 1'), 'OperacaoFinanceiraItem_rateado_check');
    await recusa(upd('valor_desconto_rateado = valor_total, valor_liquido = 0'), 'OperacaoFinanceiraItem_liquido_positivo_check');
    // NOT NULL (23502): só valor_liquido fica nulo nestes comandos
    await recusa(upd('valor_liquido = NULL'), 'Code: `23502`');
    const colunas = 'id, cliente_id, empresa_id, operacao_id, ordem, tipo_item, descricao, unidade, quantidade, valor_unitario, valor_total, "updatedAt"';
    const valores = `'p3l-direto', '${s.c}', '${e.id}', '${d.id}', 9, 'SERVICO', 'X', 'UN', 1, 5, 5, now()`;
    await recusa(`INSERT INTO "OperacaoFinanceiraItem" (${colunas}) VALUES (${valores})`, 'Code: `23502`');
    await recusa(`INSERT INTO "OperacaoFinanceiraItem" (${colunas}, valor_liquido) VALUES (${valores}, 4)`, 'OperacaoFinanceiraItem_liquido_check');
    await recusa(`INSERT INTO "OperacaoFinanceiraItem" (${colunas}, valor_desconto_rateado, valor_liquido) VALUES (${valores}, 5, 0)`, 'OperacaoFinanceiraItem_liquido_positivo_check');
    // coerente passa (prova de que a recusa é do CHECK, não do comando)
    await p.$executeRawUnsafe(`INSERT INTO "OperacaoFinanceiraItem" (${colunas}, valor_desconto_rateado, valor_acrescimo_rateado, valor_liquido) VALUES (${valores}, 1, 0.5, 4.5)`);
    await p.$executeRawUnsafe(`DELETE FROM "OperacaoFinanceiraItem" WHERE id = 'p3l-direto'`);
    const depois = await p.operacaoFinanceiraItem.findUnique({ where: { id: i1.id } });
    assert.deepEqual([q4(depois.valor_desconto_rateado), q4(depois.valor_liquido)], ['1.0000', '9.0000']);
  });
});
