/**
 * D-PROD-154 — P3-01 Central Única de Lançamentos: FINANCEIRO (matriz exaustiva).
 * PostgreSQL real, HTTP autenticado, prova por linhas gravadas.
 *
 *  F1. rateio VALOR (falta/sobra de 0,01) e PERCENTUAL (maior resto, empate
 *      pela ordem, linha que zera) em BRL, PYG e KWD;
 *  F2. referências do rateio (tipo, inativa, sintética, centros, duplicada);
 *  F3. parcelas (soma, À VISTA, PRAZO, PARCELADO 3 e 120, datas, ordem);
 *  F4. liquidação/estorno (parcial, total, excede, situação, data, fuso, PIX)
 *      e cancelamento com/sem baixa ativa; duplicidade documental;
 *  F5. ciclo de vida do rascunho (versão, troca de direção/conteúdo, DELETE,
 *      prévia sem gravar, perfil removido);
 *  F6. idempotência (replay idêntico, corpo diferente, corridas);
 *  F7. internacional (casas, catálogo, troca de moeda, estoque legado, locale)
 *      e anti-coerção em todos os níveis; limites das colunas;
 *  F8. volume: 200 itens MERCADORIA × 120 parcelas (tempo medido);
 *  F9. listagem keyset com filtros e paginação; histórico; auditoria sem PII.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { acoes, codigo, docAvista, docCom, docSem, foto, loteLegado, montarTenant, motivo, opId, prisma } from './gestaoP3Cenario.mjs';

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

const post = (s, doc, chave = opId()) => A.req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: chave });
const somaDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);
const recusa = (r, status, code, reason) => {
  assert.equal(r.statusCode, status, r.body);
  assert.equal(codigo(r), code, r.body);
  if (reason !== undefined) assert.equal(motivo(r), reason, r.body);
  return r.json();
};
const rateiosGravados = async (id) =>
  (await prisma().operacaoFinanceiraRateio.findMany({ where: { operacao_id: id }, orderBy: { ordem: 'asc' } })).map((r) => [r.valor.toFixed(4), r.percentual?.toFixed(6) ?? null]);

// ─────────────────────────────────────────────────────────────────────────────
describe('F1 — rateio ao centavo', () => {
  test('VALOR: falta e sobra de 0,01 → 422 soma_diferente {esperado, informado, diferenca} no POST e no PUT, nada gravado; exato grava percentual NULL', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const antes = await foto(s.c);
    for (const [linhas, informado, diferenca] of [[['300.00', '199.99'], '499.99', '0.01'], [['300.00', '200.01'], '500.01', '-0.01']]) {
      const doc = docSem(e, { rateios: [{ natureza_id: e.desp.id, valor: linhas[0] }, { natureza_id: e.desp2.id, valor: linhas[1] }] });
      const r = recusa(await post(s, doc), 422, 'OPERACAO_RATEIO_INVALIDO', 'soma_diferente');
      assert.deepEqual([r.details.esperado, r.details.informado, r.details.diferenca, r.details.modo], ['500.00', informado, diferenca, 'VALOR']);
    }
    assert.equal(await foto(s.c), antes);
    const d = await A.criar(s.token, docSem(e, { rateios: [{ natureza_id: e.desp.id, valor: '300.00' }, { natureza_id: e.desp2.id, valor: '200.00' }] }));
    const put = recusa(await A.req('PUT', `/operacoes-financeiras/${d.id}`, s.token, { ...docSem(e, { rateios: [{ natureza_id: e.desp.id, valor: '300.00' }, { natureza_id: e.desp2.id, valor: '200.01' }] }), versao: d.versao }), 422, 'OPERACAO_RATEIO_INVALIDO', 'soma_diferente');
    assert.equal(put.details.diferenca, '-0.01');
    assert.deepEqual(await rateiosGravados(d.id), [['300.0000', null], ['200.0000', null]], 'PUT recusado não tocou nas linhas');
    assert.equal((await prisma().operacaoFinanceira.findUnique({ where: { id: d.id } })).versao, 1);
    const zero = recusa(await post(s, docSem(e, { rateios: [{ natureza_id: e.desp.id, valor: '500.00' }, { natureza_id: e.desp2.id, valor: '0.00' }] })), 422, 'OPERACAO_RATEIO_INVALIDO', 'valor_linha_zero');
    assert.deepEqual([zero.details.colecao, zero.details.indice], ['rateios', 1]);
    // percentual informado no modo VALOR é ignorado (não é gravado)
    const ign = await A.criar(s.token, docSem(e, { rateios: [{ natureza_id: e.desp.id, valor: '500.00', percentual: '37' }] }));
    assert.deepEqual([ign.rateios[0].percentual, await rateiosGravados(ign.id)], ['100.000000', [['500.0000', null]]]);
  });

  test('PERCENTUAL: 33,333333/33,333333/33,333334 sobre 100,00 e 0,05 (maior resto; empate → menor ordem); 0,02 zera uma linha → 422 valor_linha_zero; soma ≠ 100 → 422; PYG e KWD na escala da moeda', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const tres = [e.desp, e.desp2, e.desp3].map((n, k) => ({ natureza_id: n.id, percentual: k === 2 ? '33.333334' : '33.333333' }));
    const comTotal = (ent, total, rateios = tres) => docSem(ent, { valor_bruto: total, rateio_modo: 'PERCENTUAL', rateios, parcelas: [{ vencimento: '2027-07-10', valor: total }] });
    const d100 = await A.criar(s.token, comTotal(e, '100.00'));
    assert.deepEqual(d100.rateios.map((r) => [r.valor, r.percentual]), [['33.33', '33.333333'], ['33.33', '33.333333'], ['33.34', '33.333334']]);
    assert.deepEqual(await rateiosGravados(d100.id), [['33.3300', '33.333333'], ['33.3300', '33.333333'], ['33.3400', '33.333334']]);
    const d005 = await A.criar(s.token, comTotal(e, '0.05'));
    assert.deepEqual(d005.rateios.map((r) => r.valor), ['0.02', '0.01', '0.02'], 'resto 2 centavos: linha 3 (maior resto) e linha 1 (empate, menor ordem)');
    const zera = recusa(await post(s, comTotal(e, '0.02')), 422, 'OPERACAO_RATEIO_INVALIDO', 'valor_linha_zero');
    assert.deepEqual([zera.details.indice, zera.details.colecao], [1, 'rateios']);
    const soma = recusa(await post(s, comTotal(e, '100.00', [{ natureza_id: e.desp.id, percentual: '60' }, { natureza_id: e.desp2.id, percentual: '39.999999' }])), 422, 'OPERACAO_RATEIO_INVALIDO', 'soma_diferente');
    assert.deepEqual([soma.details.esperado, soma.details.informado, soma.details.diferenca], ['100.000000', '99.999999', '0.000001']);
    const linhaZero = recusa(await post(s, comTotal(e, '100.00', [{ natureza_id: e.desp.id, percentual: '100' }, { natureza_id: e.desp2.id, percentual: '0' }])), 422, 'OPERACAO_RATEIO_INVALIDO', 'valor_linha_zero');
    assert.equal(linhaZero.details.indice, 1);
    // auto 100% numa linha só; desconto/acréscimo: o rateio é sobre o TOTAL
    const comDesc = await A.criar(s.token, docSem(e, { valor_bruto: '100.00', valor_desconto: '10.00', valor_acrescimo: '0.01', rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: e.desp.id, percentual: '50' }, { natureza_id: e.desp2.id, percentual: '50' }], parcelas: [{ vencimento: '2027-07-10', valor: '90.01' }] }));
    assert.deepEqual([comDesc.valor_total, comDesc.rateios.map((r) => r.valor)], ['90.01', ['45.01', '45.00']]);
    // PYG (0 casas) e KWD (3 casas)
    const s2 = await montarTenant(app, { perfil: null });
    await A.ok(A.req('PUT', '/perfis-financeiros-empresa', s2.token, { empresa_id: s2.e1.id, pais: 'PY', moeda: 'PYG', locale: 'es-PY' }));
    await A.ok(A.req('PUT', '/perfis-financeiros-empresa', s2.token, { empresa_id: s2.e2.id, pais: 'KW', moeda: 'KWD', locale: 'en-US' }));
    const tresDe = (ent) => [ent.desp, ent.desp2, ent.desp3].map((n, k) => ({ natureza_id: n.id, percentual: k === 2 ? '33.333334' : '33.333333' }));
    const pyg = await A.criar(s2.token, comTotal(s2.e1, '100', tresDe(s2.e1)));
    assert.deepEqual([pyg.moeda, pyg.moeda_casas, pyg.valor_total, pyg.rateios.map((r) => r.valor)], ['PYG', 0, '100', ['33', '33', '34']]);
    const kwd = await A.criar(s2.token, comTotal(s2.e2, '10.000', tresDe(s2.e2)));
    assert.deepEqual([kwd.moeda, kwd.moeda_casas, kwd.valor_total, kwd.rateios.map((r) => r.valor)], ['KWD', 3, '10.000', ['3.333', '3.333', '3.334']]);
    const kwd2 = await A.criar(s2.token, comTotal(s2.e2, '0.002', [{ natureza_id: s2.e2.desp.id, percentual: '50' }, { natureza_id: s2.e2.desp2.id, percentual: '50' }]));
    assert.deepEqual(kwd2.rateios.map((r) => r.valor), ['0.001', '0.001']);
  });
});

describe('F1b — Decimal ponta a ponta', () => {
  test('vetor do contrato: 7984815747,9459 × 219,522662 = 1752848008568,6049999858 → 1752848008568,60 (float daria ,61); quantidade 4 e preço 6 casas preservados', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const total = '1752848008568.60';
    const d = await A.criar(s.token, {
      empresa_id: e.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: e.prest.id, data_emissao: '2027-06-10',
      itens: [{ tipo_item: 'SERVICO', descricao: 'CONTRATO', unidade: 'UN', quantidade: '7984815747.9459', valor_unitario: '219.522662' }],
      rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: e.desp.id, percentual: '33.333333' }, { natureza_id: e.desp2.id, percentual: '66.666667' }],
      parcelas: [{ vencimento: '2027-07-10', valor: total }],
    });
    assert.deepEqual([d.itens[0].quantidade, d.itens[0].valor_unitario, d.itens[0].valor_total, d.valor_total], ['7984815747.9459', '219.522662', total, total]);
    const soma = d.rateios.reduce((t, r) => t + BigInt(r.valor.replace('.', '')), 0n);
    assert.equal(soma, BigInt(total.replace('.', '')), 'o rateio soma exatamente o total (centavos inteiros)');
    const item = await prisma().operacaoFinanceiraItem.findFirst({ where: { operacao_id: d.id } });
    assert.deepEqual([item.quantidade.toFixed(4), item.valor_unitario.toFixed(6), item.valor_total.toFixed(4)], ['7984815747.9459', '219.522662', '1752848008568.6000']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F2 — classificação do rateio', () => {
  test('natureza de tipo errado, inativa, sintética (filha ATIVA) e analítica com filha inativa; centros inativos; linha duplicada; > 50 linhas → recusas com field/reason/indice e nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const base = { cliente_id: s.c, empresa_id: e.id };
    const pai = await p.naturezaFinanceira.create({ data: { ...base, numero: '90', tipo: 'DESPESA', nome: 'PAI SINTETICA' } });
    await p.naturezaFinanceira.create({ data: { ...base, numero: '91', tipo: 'DESPESA', nome: 'FILHA ATIVA', pai_id: pai.id } });
    const paiAnalitico = await p.naturezaFinanceira.create({ data: { ...base, numero: '92', tipo: 'DESPESA', nome: 'PAI SO COM FILHA INATIVA' } });
    await p.naturezaFinanceira.create({ data: { ...base, numero: '93', tipo: 'DESPESA', nome: 'FILHA INATIVA', pai_id: paiAnalitico.id, ativo: false } });
    const inativa = await p.naturezaFinanceira.create({ data: { ...base, numero: '94', tipo: 'DESPESA', nome: 'INATIVA', ativo: false } });
    const ccInativo = await p.centroCusto.create({ data: { ...base, numero: '9', nome: 'CC INATIVO', ativo: false } });
    const crInativo = await p.centroResultado.create({ data: { ...base, numero: '9', nome: 'CR INATIVO', ativo: false } });
    const com = (linha) => docSem(e, { rateios: [{ natureza_id: e.desp.id, valor: '100.00' }, { ...linha, valor: '400.00' }] });
    const antes = await foto(s.c);
    for (const [linha, field, reason] of [
      [{ natureza_id: e.rec.id }, 'natureza_id', 'natureza_tipo_incompativel'],
      [{ natureza_id: inativa.id }, 'natureza_id', 'natureza_inativa'],
      [{ natureza_id: pai.id }, 'natureza_id', 'natureza_sintetica'],
      [{ natureza_id: e.desp2.id, centro_custo_id: ccInativo.id }, 'centro_custo_id', 'centro_custo_inativo'],
      [{ natureza_id: e.desp2.id, centro_resultado_id: crInativo.id }, 'centro_resultado_id', 'centro_resultado_inativo'],
    ]) {
      const r = recusa(await post(s, com(linha)), 422, 'OPERACAO_REFERENCIA_INVALIDA', reason);
      assert.deepEqual([r.field, r.details.colecao, r.details.indice], [field, 'rateios', 1], reason);
    }
    // RECEBER com natureza DESPESA
    const rec = recusa(await post(s, docSem(e, { direcao: 'RECEBER', rateios: [{ natureza_id: e.desp.id, valor: '500.00' }] })), 422, 'OPERACAO_REFERENCIA_INVALIDA', 'natureza_tipo_incompativel');
    assert.equal(rec.details.esperado, 'RECEITA');
    const dup = recusa(await post(s, docSem(e, { rateios: [{ natureza_id: e.desp.id, centro_custo_id: e.cc.id, valor: '250.00' }, { natureza_id: e.desp.id, centro_custo_id: e.cc.id, valor: '250.00' }] })), 422, 'OPERACAO_RATEIO_INVALIDO', 'linha_duplicada');
    assert.deepEqual([dup.details.indice, dup.details.repete_indice], [1, 0]);
    const muitas = await post(s, docSem(e, { valor_bruto: '51.00', parcelas: [{ vencimento: '2027-07-10', valor: '51.00' }], rateios: Array.from({ length: 51 }, () => ({ natureza_id: e.desp.id, valor: '1.00' })) }));
    assert.deepEqual([muitas.statusCode, codigo(muitas)], [400, 'REQUEST_VALIDATION_FAILED']);
    assert.equal(await foto(s.c), antes, 'nada gravado');
    // mesma natureza com centros diferentes NÃO é duplicada; analítica com filha só inativa vale
    const ok = await A.criar(s.token, docSem(e, { rateios: [{ natureza_id: e.desp.id, centro_custo_id: e.cc.id, valor: '250.00' }, { natureza_id: e.desp.id, centro_custo_id: e.cc2.id, valor: '200.00' }, { natureza_id: paiAnalitico.id, valor: '50.00' }] }));
    assert.deepEqual(ok.rateios.map((r) => [r.natureza_nome, r.centro_custo_nome, r.valor]), [['INSUMOS 1', 'REBANHO 1', '250.00'], ['INSUMOS 1', 'LAVOURA 1', '200.00'], ['PAI SO COM FILHA INATIVA', null, '50.00']]);
    // o seletor de naturezas só oferece analíticas ativas do tipo
    const opcoes = await A.ok(A.req('GET', `/operacoes-financeiras-opcoes/naturezas?empresa_id=${e.id}&tipo=DESPESA`, s.token));
    const nomes = opcoes.itens.map((n) => n.nome);
    assert.ok(nomes.includes('PAI SO COM FILHA INATIVA') && nomes.includes('FILHA ATIVA') && !nomes.includes('PAI SINTETICA') && !nomes.includes('INATIVA') && !nomes.includes('VENDA 1'), nomes.join());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F3 — parcelas e condição', () => {
  test('soma exata; À VISTA (1, vencimento = emissão); PRAZO (1, ≥ emissão); PARCELADO 3 × 300 e 120 parcelas; datas inválidas, fora de ordem, antes da emissão, valor zero, 121 → recusas sem gravar', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const comParcelas = (condicao, parcelas, total = '900.00') => docSem(e, { condicao, valor_bruto: total, rateios: [{ natureza_id: e.desp.id, valor: total }], parcelas });
    const antes = await foto(s.c);
    const casos = [
      [comParcelas('AVISTA', [{ vencimento: '2027-06-11', valor: '900.00' }]), 'vencimento_invalido', 0],
      [comParcelas('AVISTA', [{ vencimento: '2027-06-10', valor: '450.00' }, { vencimento: '2027-06-10', valor: '450.00' }]), 'quantidade_invalida', undefined],
      [comParcelas('PRAZO', [{ vencimento: '2027-06-09', valor: '900.00' }]), 'vencimento_invalido', 0],
      [comParcelas('PRAZO', [{ vencimento: '2027-07-10', valor: '450.00' }, { vencimento: '2027-08-10', valor: '450.00' }]), 'quantidade_invalida', undefined],
      [comParcelas('PARCELADO', [{ vencimento: '2027-07-10', valor: '900.00' }]), 'quantidade_invalida', undefined],
      [comParcelas('PARCELADO', [{ vencimento: '2027-07-10', valor: '300.00' }, { vencimento: '2027-09-10', valor: '300.00' }, { vencimento: '2027-08-10', valor: '300.00' }]), 'vencimento_invalido', 2],
      [comParcelas('PARCELADO', [{ vencimento: '2027-06-09', valor: '300.00' }, { vencimento: '2027-07-10', valor: '300.00' }, { vencimento: '2027-08-10', valor: '300.00' }]), 'vencimento_invalido', 0],
      [comParcelas('PARCELADO', [{ vencimento: '2027-07-10', valor: '900.00' }, { vencimento: '2027-08-10', valor: '0.00' }]), 'valor_invalido', 1],
      [comParcelas('PARCELADO', [{ vencimento: '2027-07-10', valor: '300.00' }, { vencimento: '2027-08-10', valor: '300.00' }, { vencimento: '2027-09-10', valor: '300.01' }]), 'soma_diferente', undefined],
    ];
    for (const [doc, reason, indice] of casos) {
      const r = recusa(await post(s, doc), 422, 'OPERACAO_PARCELAS_INVALIDAS', reason);
      if (indice !== undefined) assert.deepEqual([r.details.colecao, r.details.indice], ['parcelas', indice], reason);
    }
    const dataRuim = recusa(await post(s, comParcelas('PRAZO', [{ vencimento: '2027-02-30', valor: '900.00' }])), 400, 'REQUEST_VALIDATION_FAILED', 'data_invalida');
    assert.equal(dataRuim.field, 'vencimento');
    recusa(await post(s, docSem(e, { data_emissao: '2027-13-01' })), 400, 'REQUEST_VALIDATION_FAILED', 'data_invalida');
    const n121 = Array.from({ length: 121 }, (_, k) => ({ vencimento: somaDias('2027-06-10', k), valor: '1.00' }));
    recusa(await post(s, comParcelas('PARCELADO', n121, '121.00')), 400, 'REQUEST_VALIDATION_FAILED');
    assert.equal(await foto(s.c), antes, 'nada gravado');

    const tres = await A.criarConfirmar(s.token, comParcelas('PARCELADO', [{ vencimento: '2027-07-10', valor: '300.00' }, { vencimento: '2027-07-10', valor: '300.00' }, { vencimento: '2027-09-10', valor: '300.00' }]));
    assert.deepEqual(tres.titulos.map((t) => [t.numero_parcela, t.total_parcelas, t.vencimento, t.valor, t.status]), [
      [1, 3, '2027-07-10', '300.00', 'ABERTO'], [2, 3, '2027-07-10', '300.00', 'ABERTO'], [3, 3, '2027-09-10', '300.00', 'ABERTO'],
    ], 'vencimentos iguais são não decrescentes');
    const titulos = await prisma().tituloFinanceiro.findMany({ where: { operacao_id: tres.id }, orderBy: { numero_parcela: 'asc' } });
    assert.ok(titulos.every((t) => t.direcao === 'PAGAR' && t.parceiro_id === e.forn.id && t.moeda === 'BRL' && t.empresa_id === e.id));
    const avista = await A.criarConfirmar(s.token, comParcelas('AVISTA', [{ vencimento: '2027-06-10', valor: '900.00' }]));
    assert.deepEqual(avista.titulos.map((t) => [t.vencimento, t.status]), [['2027-06-10', 'ABERTO']]);
    const prazoMesmoDia = await A.criar(s.token, comParcelas('PRAZO', [{ vencimento: '2027-06-10', valor: '900.00' }]));
    assert.equal(prazoMesmoDia.titulos[0].vencimento, '2027-06-10');
    // 120 parcelas com o resto do arredondamento na última: 1000,00 / 120
    const n120 = Array.from({ length: 120 }, (_, k) => ({ vencimento: somaDias('2027-07-01', k * 7), valor: k === 119 ? '8.73' : '8.33' }));
    const d120 = await A.criarConfirmar(s.token, comParcelas('PARCELADO', n120, '1000.00'));
    assert.equal(d120.titulos.length, 120);
    assert.deepEqual([d120.titulos[0].vencimento, d120.titulos[119].vencimento, d120.titulos[119].valor, d120.titulos[119].total_parcelas], ['2027-07-01', somaDias('2027-07-01', 119 * 7), '8.73', 120]);
    assert.equal(await prisma().tituloFinanceiro.count({ where: { operacao_id: d120.id, status: 'ABERTO' } }), 120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F4 — liquidação, estorno, cancelamento e duplicidade', () => {
  test('parcial + parcial = QUITADO; QUITADO/PREVISTO/CANCELADO → 409; > saldo → 422 {saldo, valor}; zero → 422; estorno da 2ª volta a PARCIAL e o saldo vem dos FATOS; estorno repetido → 409', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criarConfirmar(s.token, docSem(e, { condicao: 'PARCELADO', valor_bruto: '1000.00', rateios: [{ natureza_id: e.desp.id, valor: '1000.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '600.00' }, { vencimento: '2027-08-10', valor: '400.00' }] }));
    const [t1, t2] = d.titulos;
    const l1 = await A.ok(A.liquidarReq(s.token, t1.id, e.id, { valor: '250.00', metodo: 'TRANSFERENCIA', data: '2027-06-11' }), 201);
    assert.deepEqual([l1.titulos[0].status, l1.titulos[0].saldo, l1.titulos[1].status], ['PARCIAL', '350.00', 'ABERTO']);
    const excede = recusa(await A.liquidarReq(s.token, t1.id, e.id, { valor: '350.01' }), 422, 'LIQUIDACAO_EXCEDE_SALDO', 'excede_saldo');
    assert.deepEqual([excede.details.saldo, excede.details.valor], ['350.00', '350.01']);
    recusa(await A.liquidarReq(s.token, t1.id, e.id, { valor: '0.00' }), 422, 'OPERACAO_VALORES_INVALIDOS', 'valor_nao_positivo');
    const l2 = await A.ok(A.liquidarReq(s.token, t1.id, e.id, { valor: '350.00', metodo: 'CARTAO', data: '2027-06-15' }), 201);
    assert.deepEqual([l2.titulos[0].status, l2.titulos[0].valor_liquidado, l2.titulos[0].saldo], ['QUITADO', '600.00', '0.00']);
    recusa(await A.liquidarReq(s.token, t1.id, e.id, { valor: '0.01' }), 409, 'TITULO_NAO_LIQUIDAVEL');
    const liqs = l2.titulos[0].liquidacoes;
    assert.deepEqual(liqs.map((l) => [l.tipo, l.valor, l.metodo, l.data, l.estornada]), [['LIQUIDACAO', '250.00', 'TRANSFERENCIA', '2027-06-11', false], ['LIQUIDACAO', '350.00', 'CARTAO', '2027-06-15', false]]);
    const est = await A.ok(A.estornarReq(s.token, liqs[1].id, e.id), 201);
    assert.deepEqual([est.titulos[0].status, est.titulos[0].valor_liquidado, est.titulos[0].saldo], ['PARCIAL', '250.00', '350.00']);
    const estorno = await p.liquidacaoFinanceiraEstorno.findFirst({ where: { liquidacao_id: liqs[1].id } });
    assert.deepEqual([estorno.data.toISOString().slice(0, 10), estorno.titulo_id, estorno.motivo], ['2027-06-15', t1.id, 'estorno de teste'], 'data do estorno = hoje da fazenda');
    const linhaTitulo = await p.tituloFinanceiro.findUnique({ where: { id: t1.id } });
    assert.deepEqual([linhaTitulo.status, linhaTitulo.valor_liquidado.toFixed(2)], ['PARCIAL', '250.00']);
    assert.equal(await p.liquidacaoFinanceira.count({ where: { titulo_id: t1.id } }), 2, 'a liquidação estornada continua lá (fato imutável)');
    recusa(await A.estornarReq(s.token, liqs[1].id, e.id), 409, 'LIQUIDACAO_JA_ESTORNADA');
    // a 2ª parcela segue independente
    const l3 = await A.ok(A.liquidarReq(s.token, t2.id, e.id, { valor: '400.00' }), 201);
    assert.deepEqual(l3.titulos.map((t) => t.status), ['PARCIAL', 'QUITADO']);
    // título PREVISTO (de rascunho) e título de documento CANCELADO
    const rasc = await A.criar(s.token, docSem(e));
    recusa(await A.liquidarReq(s.token, rasc.titulos[0].id, e.id, { valor: '1.00' }), 409, 'TITULO_NAO_LIQUIDAVEL');
    const canc = await A.criarConfirmar(s.token, docSem(e));
    await A.ok(A.cancelarReq(s.token, canc.id, e.id));
    const tc = recusa(await A.liquidarReq(s.token, canc.titulos[0].id, e.id, { valor: '1.00' }), 409, 'TITULO_NAO_LIQUIDAVEL');
    assert.deepEqual([tc.details.status, tc.details.operacao_status], ['CANCELADO', 'CANCELADO']);
  });

  test('5 liquidações simultâneas de 30 num título de 100: exatamente 3 passam, 2 → 422; 2 estornos simultâneos da mesma baixa: 1 passa; motivo em branco → 400', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criarConfirmar(s.token, docAvista(e, '100.00'));
    const t = d.titulos[0];
    const rs = await Promise.all(Array.from({ length: 5 }, () => A.liquidarReq(s.token, t.id, e.id, { valor: '30.00' })));
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [201, 201, 201, 422, 422], rs.map((r) => r.body).join('\n'));
    assert.ok(rs.filter((r) => r.statusCode === 422).every((r) => codigo(r) === 'LIQUIDACAO_EXCEDE_SALDO'));
    const linha = await p.tituloFinanceiro.findUnique({ where: { id: t.id } });
    assert.deepEqual([linha.status, linha.valor_liquidado.toFixed(2), await p.liquidacaoFinanceira.count({ where: { titulo_id: t.id } })], ['PARCIAL', '90.00', 3]);
    const liq = (await p.liquidacaoFinanceira.findFirst({ where: { titulo_id: t.id } })).id;
    const es = await Promise.all([0, 1].map(() => A.estornarReq(s.token, liq, e.id)));
    assert.deepEqual(es.map((r) => r.statusCode).sort(), [201, 409], es.map((r) => r.body).join('\n'));
    assert.equal(codigo(es.find((r) => r.statusCode === 409)), 'LIQUIDACAO_JA_ESTORNADA');
    assert.equal(await p.liquidacaoFinanceiraEstorno.count({ where: { liquidacao_id: liq } }), 1);
    assert.equal((await p.tituloFinanceiro.findUnique({ where: { id: t.id } })).valor_liquidado.toFixed(2), '60.00');
    const antes = await foto(s.c);
    recusa(await A.estornarReq(s.token, liq, e.id, { motivo: '   ' }), 400, 'REQUEST_VALIDATION_FAILED');
    recusa(await A.cancelarReq(s.token, d.id, e.id, { motivo: '  ' }), 400, 'REQUEST_VALIDATION_FAILED');
    recusa(await A.cancelarReq(s.token, d.id, e.id, { motivo: '<b>x</b>' }), 400, 'REQUEST_VALIDATION_FAILED', 'caractere_invalido');
    recusa(await A.liquidarReq(s.token, t.id, e.id, { valor: '1.00', observacao: '<script>' }), 400, 'REQUEST_VALIDATION_FAILED', 'caractere_invalido');
    assert.equal(await foto(s.c), antes);
  });

  test('data da liquidação: futura → 422 {data, hoje, fuso}; sem fuso → 409; dia inválido → 400; PIX só BR+BRL (BR/USD e PT/BRL recusam); método preferido validado contra o perfil', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const d = await A.criarConfirmar(s.token, docAvista(e));
    const t = d.titulos[0];
    const futura = recusa(await A.liquidarReq(s.token, t.id, e.id, { data: '2027-06-16' }), 422, 'FINANCEIRO_DATA_FUTURA', 'data_futura');
    assert.deepEqual([futura.details.data, futura.details.hoje, futura.details.fuso], ['2027-06-16', '2027-06-15', 'America/Sao_Paulo']);
    recusa(await A.liquidarReq(s.token, t.id, e.id, { data: '2027-02-29' }), 400, 'REQUEST_VALIDATION_FAILED', 'data_invalida');
    await A.ok(A.liquidarReq(s.token, t.id, e.id, { data: '2027-06-15', metodo: 'PIX' }), 201);
    // sem fuso: o documento sem mercadoria confirma, mas a liquidação exige o fuso
    const semFuso = await montarTenant(app, { fuso: null });
    const d2 = await A.criarConfirmar(semFuso.token, docAvista(semFuso.e1));
    const baixa = await A.criar(semFuso.token, docAvista(semFuso.e1, '10.00'));
    const antes = await foto(semFuso.c);
    recusa(await A.liquidarReq(semFuso.token, d2.titulos[0].id, semFuso.e1.id), 409, 'EMPRESA_FUSO_NAO_CONFIGURADO');
    recusa(await A.confirmarReq(semFuso.token, baixa, semFuso.e1.id, { baixa_no_ato: { metodo: 'DINHEIRO', data: '2027-06-10' } }), 409, 'EMPRESA_FUSO_NAO_CONFIGURADO');
    assert.equal(await foto(semFuso.c), antes, 'nada gravado sem fuso');
    // PIX: só BR + BRL
    const fora = await montarTenant(app, { perfil: null });
    await A.ok(A.req('PUT', '/perfis-financeiros-empresa', fora.token, { empresa_id: fora.e1.id, pais: 'BR', moeda: 'USD', locale: 'pt-BR' }));
    const pt = await A.ok(A.req('PUT', '/perfis-financeiros-empresa', fora.token, { empresa_id: fora.e2.id, pais: 'PT', moeda: 'BRL', locale: 'pt-PT' }));
    assert.deepEqual(pt.metodos_permitidos, ['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'OUTRO']);
    for (const ent of [fora.e1, fora.e2]) {
      const usd = ent === fora.e1;
      const dd = await A.criarConfirmar(fora.token, docAvista(ent, usd ? '10.00' : '10.00'));
      const pix = recusa(await A.liquidarReq(fora.token, dd.titulos[0].id, ent.id, { valor: '1.00', metodo: 'PIX' }), 422, 'OPERACAO_REFERENCIA_INVALIDA', 'metodo_nao_permitido');
      assert.equal(pix.field, 'metodo');
      assert.ok(!pix.details.metodos_permitidos.includes('PIX'));
      recusa(await post(fora, docAvista(ent, '10.00', { metodo_preferido: 'PIX' })), 422, 'OPERACAO_REFERENCIA_INVALIDA', 'metodo_nao_permitido');
      const rasc = await A.criar(fora.token, docAvista(ent, '10.00'));
      recusa(await A.confirmarReq(fora.token, rasc, ent.id, { baixa_no_ato: { metodo: 'PIX', data: '2027-06-10' } }), 422, 'OPERACAO_REFERENCIA_INVALIDA', 'metodo_nao_permitido');
      await A.ok(A.liquidarReq(fora.token, dd.titulos[0].id, ent.id, { valor: '1.00', metodo: 'OUTRO' }), 201);
    }
  });

  test('cancelar com baixa não estornada (em QUALQUER parcela) → 409 sem efeito; após estornar → CANCELADO, títulos CANCELADO, fatos preservados e chave documental liberada', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criarConfirmar(s.token, docSem(e, { condicao: 'PARCELADO', documento_referencia: 'NF-9', valor_bruto: '300.00', rateios: [{ natureza_id: e.desp.id, valor: '300.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '100.00' }, { vencimento: '2027-08-10', valor: '100.00' }, { vencimento: '2027-09-10', valor: '100.00' }] }));
    const liq = (await A.ok(A.liquidarReq(s.token, d.titulos[2].id, e.id, { valor: '30.00' }), 201)).titulos[2].liquidacoes[0];
    const antes = await foto(s.c);
    const r = recusa(await A.cancelarReq(s.token, d.id, e.id), 409, 'OPERACAO_COM_LIQUIDACOES');
    assert.deepEqual(r.details.titulos.map((t) => t.numero_parcela), [3]);
    assert.equal(await foto(s.c), antes);
    const dup = await A.criar(s.token, docSem(e, { documento_referencia: 'nf-9' }));
    recusa(await A.confirmarReq(s.token, dup, e.id), 409, 'OPERACAO_DOCUMENTO_DUPLICADO');
    await A.ok(A.estornarReq(s.token, liq.id, e.id), 201);
    const canc = await A.ok(A.cancelarReq(s.token, d.id, e.id, { motivo: 'erro de digitação' }));
    assert.deepEqual([canc.status, canc.titulos.map((t) => [t.status, t.saldo])], ['CANCELADO', [['CANCELADO', '0.00'], ['CANCELADO', '0.00'], ['CANCELADO', '0.00']]]);
    const op = await p.operacaoFinanceira.findUnique({ where: { id: d.id } });
    assert.deepEqual([op.documento_chave_ativa, op.motivo_cancelamento, op.cancelado_por_usuario_id === s.admId, op.versao], [null, 'erro de digitação', true, 3]);
    assert.deepEqual([await p.liquidacaoFinanceira.count({ where: { cliente_id: s.c } }), await p.liquidacaoFinanceiraEstorno.count({ where: { cliente_id: s.c } })], [1, 1]);
    // a chave foi liberada: o outro rascunho com o mesmo documento agora confirma
    const conf = await A.confirmar(s.token, dup, e.id);
    assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: conf.id } })).documento_chave_ativa, 'NF-9');
    recusa(await A.estornarReq(s.token, liq.id, e.id), 409, 'OPERACAO_STATUS_INVALIDO');
  });

  test('duplicidade documental: mesma empresa+direção+parceiro+documento (maiúsculas, aparado) → 409; outro parceiro, outra direção ou outra empresa → ok; 2 confirmações simultâneas com o mesmo documento → 1 passa', async () => {
    const s = await montarTenant(app);
    const { e1, e2 } = s;
    await A.criarConfirmar(s.token, docSem(e1, { documento_referencia: 'NF-100' }));
    const mesma = await A.criar(s.token, docSem(e1, { documento_referencia: '  nf-100 ' }));
    const prev = await A.previa(s.token, mesma.id, e1.id);
    assert.deepEqual(prev.bloqueios.map((b) => [b.code, b.field, b.reason]), [['OPERACAO_DOCUMENTO_DUPLICADO', 'documento_referencia', 'documento_duplicado']]);
    const antes = await foto(s.c);
    recusa(await A.confirmarReq(s.token, mesma, e1.id), 409, 'OPERACAO_DOCUMENTO_DUPLICADO', 'documento_duplicado');
    assert.equal(await foto(s.c), antes);
    for (const doc of [
      docSem(e1, { documento_referencia: 'NF-100', parceiro_id: e1.prest.id }),
      docSem(e1, { documento_referencia: 'NF-100', direcao: 'RECEBER' }),
      docSem(e2, { documento_referencia: 'NF-100' }),
      docSem(e1, { documento_referencia: 'NF-1000' }),
    ]) assert.equal((await A.criarConfirmar(s.token, doc)).status, 'CONFIRMADO');
    const a = await A.criar(s.token, docSem(e1, { documento_referencia: 'NF-CORRIDA' }));
    const b = await A.criar(s.token, docSem(e1, { documento_referencia: 'NF-CORRIDA' }));
    const rs = await Promise.all([A.confirmarReq(s.token, a, e1.id), A.confirmarReq(s.token, b, e1.id)]);
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409], rs.map((r) => r.body).join('\n'));
    assert.equal(codigo(rs.find((r) => r.statusCode === 409)), 'OPERACAO_DOCUMENTO_DUPLICADO');
    assert.equal(await prisma().operacaoFinanceira.count({ where: { cliente_id: s.c, documento_chave_ativa: 'NF-CORRIDA' } }), 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F5 — ciclo de vida do rascunho', () => {
  test('PUT com versão errada → 409 {versao_atual, versao_informada}; PUT troca direção e conteúdo regravando os filhos; DELETE com versão errada → 409 e certo apaga tudo; confirmado não aceita PUT/DELETE/prévia', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criar(s.token, docSem(e, { rateios: [{ natureza_id: e.desp.id, valor: '300.00' }, { natureza_id: e.desp2.id, valor: '200.00' }] }));
    const filhos = async (id) => ({
      itens: await p.operacaoFinanceiraItem.count({ where: { operacao_id: id } }),
      rateios: (await p.operacaoFinanceiraRateio.findMany({ where: { operacao_id: id }, orderBy: { ordem: 'asc' } })).map((r) => [r.operacao_direcao, r.natureza_tipo, r.natureza_id]),
      titulos: (await p.tituloFinanceiro.findMany({ where: { operacao_id: id } })).map((t) => [t.direcao, t.parceiro_id, t.status, t.valor.toFixed(2)]),
    });
    const conflito = recusa(await A.req('PUT', `/operacoes-financeiras/${d.id}`, s.token, { ...docSem(e), versao: 2 }), 409, 'OPERACAO_VERSAO_CONFLITO');
    assert.deepEqual([conflito.details.versao_atual, conflito.details.versao_informada], [1, 2]);
    // troca para RECEBER com produtos (venda) — os filhos antigos somem, os novos seguem a nova direção
    await loteLegado(s, e, e.sal, s.local, { kg: '10' });
    const venda = docCom(e, s.local, [{ produto: e.sal, quantidade: '4', valor_unitario: '25' }], { direcao: 'RECEBER' });
    const v2 = await A.ok(A.req('PUT', `/operacoes-financeiras/${d.id}`, s.token, { ...venda, versao: 1 }));
    assert.deepEqual([v2.versao, v2.direcao, v2.conteudo, v2.parceiro_nome, v2.valor_total, v2.data_operacional], [2, 'RECEBER', 'COM_PRODUTOS', e.cli.nome, '100.00', '2027-06-10']);
    assert.deepEqual(await filhos(d.id), { itens: 1, rateios: [['RECEBER', 'RECEITA', e.rec.id]], titulos: [['RECEBER', e.cli.id, 'PREVISTO', '100.00']] });
    // e de volta para PAGAR sem produtos
    const v3 = await A.ok(A.req('PUT', `/operacoes-financeiras/${d.id}`, s.token, { ...docSem(e), versao: 2 }));
    assert.deepEqual([v3.versao, v3.direcao, v3.conteudo, v3.data_operacional, v3.itens.length], [3, 'PAGAR', 'SEM_PRODUTOS', null, 0]);
    assert.deepEqual(await filhos(d.id), { itens: 0, rateios: [['PAGAR', 'DESPESA', e.desp.id]], titulos: [['PAGAR', e.forn.id, 'PREVISTO', '500.00']] });
    // corrida de PUTs com a mesma versão: um vence
    const rs = await Promise.all([1, 2].map((k) => A.req('PUT', `/operacoes-financeiras/${d.id}`, s.token, { ...docSem(e, { valor_bruto: `${k}00.00`, rateios: [{ natureza_id: e.desp.id, valor: `${k}00.00` }], parcelas: [{ vencimento: '2027-07-10', valor: `${k}00.00` }] }), versao: 3 })));
    assert.deepEqual(rs.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(codigo(rs.find((r) => r.statusCode === 409)), 'OPERACAO_VERSAO_CONFLITO');
    const atual = await p.operacaoFinanceira.findUnique({ where: { id: d.id } });
    assert.equal(atual.versao, 4);
    assert.equal((await p.tituloFinanceiro.findMany({ where: { operacao_id: d.id } })).length, 1, 'filhos de UM só PUT');
    // DELETE
    recusa(await A.req('DELETE', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}&versao=3`, s.token), 409, 'OPERACAO_VERSAO_CONFLITO');
    await A.ok(A.req('DELETE', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}&versao=4`, s.token), 204);
    for (const m of ['operacaoFinanceira', 'operacaoFinanceiraItem', 'operacaoFinanceiraRateio', 'tituloFinanceiro']) {
      assert.equal(await p[m].count({ where: m === 'operacaoFinanceira' ? { id: d.id } : { operacao_id: d.id } }), 0, m);
    }
    const descarte = await p.auditLog.findFirst({ where: { cliente_id: s.c, acao: 'operacao_financeira.descartar', entidade_id: d.id } });
    assert.deepEqual(Object.keys(descarte.dados_anteriores).sort(), ['empresa_id', 'id', 'numero']);
    recusa(await A.req('GET', `/operacoes-financeiras/${d.id}?empresa_id=${e.id}`, s.token), 404, 'OPERACAO_FINANCEIRA_NOT_FOUND');
    // confirmado: nada de PUT/DELETE/prévia
    const c = await A.criarConfirmar(s.token, docSem(e));
    recusa(await A.req('PUT', `/operacoes-financeiras/${c.id}`, s.token, { ...docSem(e), versao: c.versao }), 409, 'OPERACAO_STATUS_INVALIDO');
    recusa(await A.req('DELETE', `/operacoes-financeiras/${c.id}?empresa_id=${e.id}&versao=${c.versao}`, s.token), 409, 'OPERACAO_STATUS_INVALIDO');
    recusa(await A.req('POST', `/operacoes-financeiras/${c.id}/previa`, s.token, { empresa_id: e.id }), 409, 'OPERACAO_STATUS_INVALIDO');
    recusa(await A.confirmarReq(s.token, c, e.id), 409, 'OPERACAO_STATUS_INVALIDO');
  });

  test('prévia com vários bloqueios (duplicidade, saldo, data futura, perfil removido) devolve 200 e NÃO grava; confirmar/PUT sem perfil → 409; SEM produtos não aceita itens nem data operacional', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    await A.criarConfirmar(s.token, docSem(e, { direcao: 'RECEBER', documento_referencia: 'V-1' }));
    const futura = await A.criar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '5', valor_unitario: '10' }], { direcao: 'RECEBER', documento_referencia: 'V-1', data_emissao: '2027-06-16', data_operacional: '2027-06-16', parcelas: [{ vencimento: '2027-07-10', valor: '50.00' }] }));
    const antes = await foto(s.c);
    const prev = await A.previa(s.token, futura.id, e.id);
    assert.deepEqual(prev.bloqueios.map((b) => [b.code, b.reason]).sort(), [
      ['ESTOQUE_SALDO_INSUFICIENTE', 'estoque_atual_insuficiente'], ['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente'],
      ['FINANCEIRO_DATA_FUTURA', 'data_futura'], ['OPERACAO_DOCUMENTO_DUPLICADO', 'documento_duplicado'],
    ]);
    assert.equal(prev.plano.valor_total, '50.00');
    assert.equal(await foto(s.c), antes, 'prévia não grava nada (nem auditoria)');
    recusa(await A.confirmarReq(s.token, futura, e.id), 422, 'FINANCEIRO_DATA_FUTURA');
    // perfil removido pela operação (nenhum documento o referencia por FK)
    const rasc = await A.criar(s.token, docSem(e));
    await p.perfilFinanceiroEmpresa.delete({ where: { cliente_id_empresa_id: { cliente_id: s.c, empresa_id: e.id } } });
    const prevSem = await A.previa(s.token, rasc.id, e.id);
    assert.ok(prevSem.bloqueios.some((b) => b.code === 'PERFIL_FINANCEIRO_NAO_CONFIGURADO'));
    const antes2 = await foto(s.c);
    recusa(await A.confirmarReq(s.token, rasc, e.id), 409, 'PERFIL_FINANCEIRO_NAO_CONFIGURADO');
    recusa(await A.req('PUT', `/operacoes-financeiras/${rasc.id}`, s.token, { ...docSem(e), versao: rasc.versao }), 409, 'PERFIL_FINANCEIRO_NAO_CONFIGURADO');
    recusa(await post(s, docSem(e)), 409, 'PERFIL_FINANCEIRO_NAO_CONFIGURADO');
    assert.equal(await foto(s.c), antes2);
    // estrutura
    const e2 = s.e2;
    recusa(await post(s, { ...docSem(e2), itens: [{ tipo_item: 'SERVICO', descricao: 'X', unidade: 'UN', quantidade: '1', valor_unitario: '1' }] }), 400, 'REQUEST_VALIDATION_FAILED', 'itens_nao_permitidos');
    recusa(await post(s, { ...docSem(e2), data_operacional: '2027-06-10' }), 400, 'REQUEST_VALIDATION_FAILED', 'nao_permitido_sem_mercadoria');
    const semBruto = /** @type {Record<string, unknown>} */ ({ ...docSem(e2) });
    delete semBruto.valor_bruto;
    recusa(await post(s, semBruto), 400, 'REQUEST_VALIDATION_FAILED', 'obrigatorio');
    recusa(await post(s, { ...docCom(e2, s.local, [{ produto: e2.sal, quantidade: '1', valor_unitario: '1' }], { total: '1.00' }), valor_bruto: '1.00' }), 400, 'REQUEST_VALIDATION_FAILED', 'valor_bruto_so_sem_produtos');
    recusa(await post(s, { ...docCom(e2, s.local, [{ produto: e2.sal, quantidade: '1', valor_unitario: '1' }], { total: '1.00' }), efeito_fisico_confirmado: false }), 400, 'REQUEST_VALIDATION_FAILED', 'declaracao_obrigatoria');
    recusa(await post(s, { ...docCom(e2, s.local, [{ produto: e2.sal, quantidade: '1', valor_unitario: '1' }], { total: '1.00' }), data_operacional: null }), 400, 'REQUEST_VALIDATION_FAILED', 'obrigatorio');
    recusa(await post(s, { ...docCom(e2, s.local, [], { total: '1.00' }) }), 400, 'REQUEST_VALIDATION_FAILED', 'itens_obrigatorios');
    recusa(await post(s, { ...docSem(e2), condicao: 'AVISTA', parcelas: [{ vencimento: '2027-06-10', valor: '500.00' }], valor_desconto: '500.00' }), 422, 'OPERACAO_VALORES_INVALIDOS', 'total_nao_positivo');
  });
});

describe('F5b — retrato dos nomes', () => {
  test('parceiro, natureza, centros, produto e local: o nome vale o da CONFIRMAÇÃO (relido sob trava); renomear depois não muda documento, lote nem movimento', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d = await A.criar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '2', valor_unitario: '5' }], {
      rateio_modo: 'VALOR', rateios: [{ natureza_id: e.desp.id, centro_custo_id: e.cc.id, centro_resultado_id: e.cr.id, valor: '10.00' }],
    }));
    const renomear = async (sufixo) => {
      await p.fornecedor.update({ where: { id: e.forn.id }, data: { nome: `FORNECEDOR ${sufixo}` } });
      await p.naturezaFinanceira.update({ where: { id: e.desp.id }, data: { nome: `NATUREZA ${sufixo}` } });
      await p.centroCusto.update({ where: { id: e.cc.id }, data: { nome: `CC ${sufixo}` } });
      await p.centroResultado.update({ where: { id: e.cr.id }, data: { nome: `CR ${sufixo}` } });
      await p.produto.update({ where: { id: e.sal.id }, data: { nome_produto: `PRODUTO ${sufixo}` } });
      await p.localEstoque.update({ where: { id: s.local.id }, data: { nome: `LOCAL ${sufixo}` } });
    };
    const retrato = (doc) => [doc.parceiro_nome, doc.rateios[0].natureza_nome, doc.rateios[0].centro_custo_nome, doc.rateios[0].centro_resultado_nome, doc.itens[0].produto_nome, doc.itens[0].local_estoque_nome];
    await renomear('ANTES');
    const conf = await A.confirmar(s.token, d, e.id);
    const esperado = ['FORNECEDOR ANTES', 'NATUREZA ANTES', 'CC ANTES', 'CR ANTES', 'PRODUTO ANTES', 'LOCAL ANTES'];
    assert.deepEqual(retrato(conf), esperado, 'a confirmação grava os nomes vigentes');
    await renomear('DEPOIS');
    assert.deepEqual(retrato(await A.detalhe(s.token, d.id, e.id)), esperado, 'o documento confirmado guarda o retrato');
    const lote = await p.estoqueLoteNota.findUnique({ where: { id: conf.itens[0].estoque_lote_nota_id } });
    const mov = await p.movimentacaoEstoque.findUnique({ where: { id: conf.itens[0].movimentacao_estoque_id } });
    assert.deepEqual([lote.produto_nome, lote.local_estoque_nome, lote.fornecedor_nome, mov.produto_nome, mov.local_destino, mov.fornecedor_nome],
      ['PRODUTO ANTES', 'LOCAL ANTES', 'FORNECEDOR ANTES', 'PRODUTO ANTES', 'LOCAL ANTES', 'FORNECEDOR ANTES']);
    const lista = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&q=antes`, s.token));
    assert.deepEqual(lista.items.map((i) => i.id), [d.id], 'a busca usa o retrato do parceiro');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F6 — idempotência', () => {
  test('POST/confirmar/liquidar/estornar/cancelar: mesma chave + mesmo corpo → replay idêntico sem novo efeito; mesma chave + corpo diferente → 409; mesma chave em paralelo → 1 efeito', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const chave = opId();
    const doc = docSem(e, { condicao: 'PARCELADO', parcelas: [{ vencimento: '2027-07-10', valor: '250.00' }, { vencimento: '2027-08-10', valor: '250.00' }] });
    const r1 = await A.ok(post(s, doc, chave), 201);
    const r2 = await A.ok(post(s, doc, chave), 200);
    const { replay: rp1, ...c1 } = r1;
    const { replay: rp2, ...c2 } = r2;
    assert.deepEqual([rp1, rp2], [false, true]);
    assert.deepEqual(c2, c1, 'replay devolve o MESMO corpo');
    assert.equal(await p.operacaoFinanceira.count({ where: { cliente_id: s.c } }), 1);
    recusa(await post(s, { ...doc, descricao: 'outra coisa' }, chave), 409, 'IDEMPOTENCY_CONFLICT');
    // confirmar em paralelo com a MESMA chave: 2 × 200, um replay, efeito único
    const corpo = { empresa_id: e.id, operation_id: opId(), versao: r1.versao };
    const par = await Promise.all([0, 1].map(() => A.req('POST', `/operacoes-financeiras/${r1.id}/confirmar`, s.token, corpo)));
    assert.deepEqual(par.map((r) => r.statusCode), [200, 200], par.map((r) => r.body).join('\n'));
    assert.deepEqual(par.map((r) => r.json().replay).sort(), [false, true]);
    assert.equal(await p.auditLog.count({ where: { cliente_id: s.c, acao: 'operacao_financeira.confirmar' } }), 1);
    assert.equal(await p.tituloFinanceiro.count({ where: { operacao_id: r1.id, status: 'ABERTO' } }), 2);
    // liquidar
    const t = par[0].json().titulos[0];
    const lc = { empresa_id: e.id, operation_id: opId(), valor: '100.00', data: '2027-06-12', metodo: 'DINHEIRO', referencia: 'REC-1' };
    const l1 = await A.ok(A.req('POST', `/titulos-financeiros/${t.id}/liquidacoes`, s.token, lc), 201);
    const l2 = await A.ok(A.req('POST', `/titulos-financeiros/${t.id}/liquidacoes`, s.token, lc), 201);
    assert.deepEqual([l1.replay, l2.replay, l2.titulos[0].liquidacoes.length], [false, true, 1]);
    recusa(await A.req('POST', `/titulos-financeiros/${t.id}/liquidacoes`, s.token, { ...lc, valor: '100.01' }), 409, 'IDEMPOTENCY_CONFLICT');
    const outroTitulo = par[0].json().titulos[1];
    recusa(await A.req('POST', `/titulos-financeiros/${outroTitulo.id}/liquidacoes`, s.token, lc), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await p.liquidacaoFinanceira.count({ where: { cliente_id: s.c } }), 1);
    // estornar
    const liqId = l1.titulos[0].liquidacoes[0].id;
    const ec = { empresa_id: e.id, operation_id: opId(), motivo: 'duplicado' };
    const e1 = await A.ok(A.req('POST', `/liquidacoes-financeiras/${liqId}/estorno`, s.token, ec), 201);
    const e2 = await A.ok(A.req('POST', `/liquidacoes-financeiras/${liqId}/estorno`, s.token, ec), 201);
    assert.deepEqual([e1.replay, e2.replay], [false, true]);
    recusa(await A.req('POST', `/liquidacoes-financeiras/${liqId}/estorno`, s.token, { ...ec, motivo: 'outro' }), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await p.liquidacaoFinanceiraEstorno.count({ where: { cliente_id: s.c } }), 1);
    // cancelar
    const cc = { empresa_id: e.id, operation_id: opId(), motivo: 'fim' };
    const k1 = await A.ok(A.req('POST', `/operacoes-financeiras/${r1.id}/cancelar`, s.token, cc));
    const k2 = await A.ok(A.req('POST', `/operacoes-financeiras/${r1.id}/cancelar`, s.token, cc));
    assert.deepEqual([k1.replay, k2.replay, k2.status], [false, true, 'CANCELADO']);
    recusa(await A.req('POST', `/operacoes-financeiras/${r1.id}/cancelar`, s.token, { ...cc, motivo: 'outro' }), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await p.auditLog.count({ where: { cliente_id: s.c, acao: 'operacao_financeira.cancelar' } }), 1);
    // duas chaves DIFERENTES confirmando o mesmo rascunho parcelado: 1 sucesso + 409, um só conjunto de títulos
    const r3 = await A.criar(s.token, doc);
    const duas = await Promise.all([A.confirmarReq(s.token, r3, e.id), A.confirmarReq(s.token, r3, e.id)]);
    assert.deepEqual(duas.map((r) => r.statusCode).sort(), [200, 409]);
    assert.ok(['OPERACAO_STATUS_INVALIDO', 'OPERACAO_VERSAO_CONFLITO'].includes(codigo(duas.find((r) => r.statusCode === 409))));
    assert.deepEqual((await p.tituloFinanceiro.findMany({ where: { operacao_id: r3.id } })).map((t2) => t2.status), ['ABERTO', 'ABERTO']);
    assert.equal(await p.auditLog.count({ where: { cliente_id: s.c, acao: 'operacao_financeira.confirmar', entidade_id: r3.id } }), 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F7 — internacional, anti-coerção e limites', () => {
  test('casas por moeda (BRL 2, PYG 0, JPY 0, KWD 3) em valor, desconto, rateio, parcela e liquidação; catálogo fechado; troca de moeda com lançamentos ou estoque legado custado → 409; país/locale mudam', async () => {
    const s = await montarTenant(app, { perfil: null });
    const p = prisma();
    const perfil = (e, pais, moeda, locale, t = s.token) => A.req('PUT', '/perfis-financeiros-empresa', t, { empresa_id: e.id, pais, moeda, locale });
    recusa(await perfil(s.e1, 'BR', 'GBP', 'pt-BR'), 400, 'REQUEST_VALIDATION_FAILED', 'moeda_nao_suportada');
    recusa(await perfil(s.e1, 'XX', 'BRL', 'pt-BR'), 400, 'REQUEST_VALIDATION_FAILED', 'pais_nao_suportado');
    for (const locale of ['fr-FR', 'pt_BR', 'PT-br', 'pt-br', 'en']) recusa(await perfil(s.e1, 'BR', 'BRL', locale), 400, 'REQUEST_VALIDATION_FAILED', 'locale_nao_suportado');
    assert.equal(await p.perfilFinanceiroEmpresa.count({ where: { cliente_id: s.c } }), 0);
    const leitura = await A.ok(A.req('GET', `/perfis-financeiros-empresa?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual([leitura.perfil, leitura.fuso_horario, leitura.catalogo.moedas.find((m) => m.codigo === 'KWD').casas, leitura.catalogo.locales.length], [null, 'America/Sao_Paulo', 3, 8]);
    recusa(await post(s, docSem(s.e1)), 409, 'PERFIL_FINANCEIRO_NAO_CONFIGURADO');

    const casos = [['PY', 'PYG', 'es-PY', 0, '1000', '1000.5'], ['JP', 'JPY', 'ja-JP', 0, '1000', '1000.1'], ['KW', 'KWD', 'en-US', 3, '10.005', '10.0005'], ['BR', 'BRL', 'pt-BR', 2, '10.05', '10.001']];
    for (const [pais, moeda, locale, casas, bom, ruim] of casos) {
      const t = await montarTenant(app, { perfil: { pais, moeda, locale } });
      const e = t.e1;
      const doc = (v, extra = {}) => docSem(e, { condicao: 'AVISTA', valor_bruto: v, rateios: [{ natureza_id: e.desp.id, valor: v }], parcelas: [{ vencimento: '2027-06-10', valor: v }], ...extra });
      for (const campo of ['valor_bruto', 'valor_desconto', 'rateio', 'parcela']) {
        const corpo = campo === 'valor_bruto' ? doc(ruim) : campo === 'valor_desconto' ? doc(bom, { valor_desconto: ruim }) : campo === 'rateio' ? doc(bom, { rateios: [{ natureza_id: e.desp.id, valor: ruim }] }) : doc(bom, { parcelas: [{ vencimento: '2027-06-10', valor: ruim }] });
        const r = recusa(await post(t, corpo), 400, 'REQUEST_VALIDATION_FAILED', 'casas_decimais_excedidas');
        assert.equal(r.details.casas, casas, `${moeda} ${campo}`);
      }
      const d = await A.criarConfirmar(t.token, doc(bom));
      assert.deepEqual([d.moeda, d.moeda_casas, d.valor_total, d.titulos[0].valor, d.titulos[0].saldo], [moeda, casas, bom, bom, bom]);
      recusa(await A.liquidarReq(t.token, d.titulos[0].id, e.id, { valor: ruim, metodo: 'DINHEIRO' }), 400, 'REQUEST_VALIDATION_FAILED', 'casas_decimais_excedidas');
      const liq = await A.ok(A.liquidarReq(t.token, d.titulos[0].id, e.id, { valor: bom, metodo: 'DINHEIRO' }), 201);
      assert.deepEqual([liq.titulos[0].status, liq.titulos[0].valor_liquidado, liq.titulos[0].liquidacoes[0].valor], ['QUITADO', bom, bom]);
      // moeda congelada: com lançamento, não muda; país e locale mudam
      const troca = recusa(await perfil(e, pais, moeda === 'USD' ? 'EUR' : 'USD', locale, t.token), 409, 'PERFIL_FINANCEIRO_MOEDA_EM_USO', 'operacoes_existentes');
      assert.equal(troca.details.operacoes, 1);
      await A.ok(perfil(e, 'US', moeda, 'en-US', t.token));
      assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: d.id } })).moeda, moeda, 'o documento guarda a moeda da criação');
    }
    // estoque legado com custo > 0 (BRL implícito): a primeira gravação e a troca só aceitam BRL
    const l = await montarTenant(app, { perfil: null });
    await loteLegado(l, l.e1, l.e1.sal, l.local, { kg: '10', custo: '2.5000' });
    await loteLegado(l, l.e2, l.e2.sal, l.local, { kg: '10', custo: '0.0000' });
    const leg = recusa(await perfil(l.e1, 'US', 'USD', 'en-US', l.token), 409, 'PERFIL_FINANCEIRO_MOEDA_EM_USO', 'estoque_legado_brl');
    assert.equal(leg.details.lotes, 1);
    await A.ok(perfil(l.e1, 'BR', 'BRL', 'pt-BR', l.token));
    recusa(await perfil(l.e1, 'BR', 'EUR', 'pt-BR', l.token), 409, 'PERFIL_FINANCEIRO_MOEDA_EM_USO', 'estoque_legado_brl');
    await A.ok(perfil(l.e2, 'US', 'USD', 'en-US', l.token));
    assert.equal(await p.perfilFinanceiroEmpresa.count({ where: { cliente_id: l.c } }), 2);
  });

  test('corridas do perfil: troca de moeda × criação de rascunho nunca deixa documento numa moeda diferente da do perfil; 2 primeiras gravações simultâneas → 1 linha', async () => {
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const s = await montarTenant(app);
      const e = s.e1;
      const [rd, rp] = await Promise.all([
        post(s, docSem(e)),
        A.req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: e.id, pais: 'US', moeda: 'USD', locale: 'en-US' }),
      ]);
      const perfil = await prisma().perfilFinanceiroEmpresa.findUnique({ where: { cliente_id_empresa_id: { cliente_id: s.c, empresa_id: e.id } } });
      const docs = await prisma().operacaoFinanceira.findMany({ where: { cliente_id: s.c, empresa_id: e.id } });
      if (rp.statusCode === 200) {
        assert.equal(perfil.moeda, 'USD');
        assert.ok(rd.statusCode === 201, rd.body);
        assert.ok(docs.every((d) => d.moeda === 'USD'), 'o rascunho esperou a troca e nasceu em USD');
      } else {
        recusa(rp, 409, 'PERFIL_FINANCEIRO_MOEDA_EM_USO', 'operacoes_existentes');
        assert.deepEqual([perfil.moeda, rd.statusCode, docs.map((d) => d.moeda)], ['BRL', 201, ['BRL']]);
      }
      const novo = await montarTenant(app, { perfil: null });
      const duas = await Promise.all([0, 1].map(() => A.req('PUT', '/perfis-financeiros-empresa', novo.token, { empresa_id: novo.e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' })));
      assert.deepEqual(duas.map((r) => r.statusCode), [200, 200], duas.map((r) => r.body).join('\n'));
      assert.equal(await prisma().perfilFinanceiroEmpresa.count({ where: { cliente_id: novo.c } }), 1);
    }
  });

  test('anti-coerção: número no lugar de string em QUALQUER valor (topo, itens, rateios, parcelas, liquidação) → 400 valor_deve_ser_texto com o caminho; declaração não booleana → tipo_invalido; nada gravado', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const base = docCom(e, s.local, [{ produto: e.sal, quantidade: '10', valor_unitario: '5' }], { total: '50.00' });
    const conf = await A.criarConfirmar(s.token, docSem(e));
    const antes = await foto(s.c);
    const casos = [
      [{ ...docSem(e), valor_bruto: 500 }, 'valor_bruto', 'valor_bruto'],
      [{ ...docSem(e), valor_desconto: 0 }, 'valor_desconto', 'valor_desconto'],
      [{ ...docSem(e), valor_acrescimo: 1.5 }, 'valor_acrescimo', 'valor_acrescimo'],
      [{ ...base, itens: [{ ...base.itens[0], quantidade: 10 }] }, 'quantidade', 'itens.0.quantidade'],
      [{ ...base, itens: [{ ...base.itens[0] }, { ...base.itens[0], valor_unitario: 5 }] }, 'valor_unitario', 'itens.1.valor_unitario'],
      [{ ...docSem(e), rateios: [{ natureza_id: e.desp.id, valor: 500 }] }, 'valor', 'rateios.0.valor'],
      [{ ...base, rateios: [{ natureza_id: e.desp.id, percentual: 100 }] }, 'percentual', 'rateios.0.percentual'],
      [{ ...docSem(e), parcelas: [{ vencimento: '2027-07-10', valor: 500 }] }, 'valor', 'parcelas.0.valor'],
      [{ ...docSem(e), valor_bruto: true }, 'valor_bruto', 'valor_bruto'],
      [{ ...docSem(e), valor_bruto: ['500.00'] }, 'valor_bruto', 'valor_bruto'],
    ];
    for (const [corpo, field, campo] of casos) {
      for (const enviar of [(c) => post(s, c), (c) => A.req('PUT', `/operacoes-financeiras/${conf.id}`, s.token, { ...c, versao: conf.versao })]) {
        const r = recusa(await enviar(corpo), 400, 'REQUEST_VALIDATION_FAILED', 'valor_deve_ser_texto');
        assert.deepEqual([r.field, r.details.campo], [field, campo]);
      }
    }
    for (const v of ['true', 1, 'sim']) recusa(await post(s, { ...base, efeito_fisico_confirmado: v }), 400, 'REQUEST_VALIDATION_FAILED', 'tipo_invalido');
    const liq = recusa(await A.liquidarReq(s.token, conf.titulos[0].id, e.id, { valor: 10 }), 400, 'REQUEST_VALIDATION_FAILED', 'valor_deve_ser_texto');
    assert.equal(liq.field, 'valor');
    // formato do texto: vírgula, sinal, expoente, espaço, mais de 4 casas → 400 do schema
    for (const v of ['10,00', '-10.00', '1e3', ' 10.00', '10.00001', '.5', '']) recusa(await post(s, { ...docSem(e), valor_bruto: v }), 400, 'REQUEST_VALIDATION_FAILED');
    assert.equal(await foto(s.c), antes, 'nada gravado');
  });

  test('limites das colunas: total acima de 99.999.999.999.999,9999 → 422 valor_excede_limite; mercadoria acima de 9.999.999.999,9999 (kg, custo ou estoque_atual + kg) → 422/bloqueio valor_excede_limite_estoque', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const grande = '99999999999999.99';
    recusa(await post(s, docSem(e, { valor_bruto: grande, valor_acrescimo: '0.01', rateios: [{ natureza_id: e.desp.id, valor: grande }], parcelas: [{ vencimento: '2027-07-10', valor: grande }] })), 422, 'OPERACAO_VALORES_INVALIDOS', 'valor_excede_limite');
    const ok = await A.criar(s.token, docSem(e, { valor_bruto: grande, rateios: [{ natureza_id: e.desp.id, valor: grande }], parcelas: [{ vencimento: '2027-07-10', valor: grande }] }));
    assert.equal(ok.valor_total, grande);
    recusa(await post(s, docCom(e, s.local, [{ produto: e.sal, quantidade: '1', valor_unitario: '10000000000' }], { total: '10000000000.00' })), 422, 'OPERACAO_VALORES_INVALIDOS', 'valor_excede_limite_estoque');
    // estoque_atual + kg acima do teto: bloqueio na prévia e 422 na confirmação (estado)
    await p.produto.update({ where: { id: e.sal.id }, data: { estoque_atual: '9999999999.0000' } });
    const d = await A.criar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '1', valor_unitario: '1' }], { total: '1.00' }));
    const prev = await A.previa(s.token, d.id, e.id);
    assert.deepEqual(prev.bloqueios.map((b) => [b.code, b.reason]), [['OPERACAO_VALORES_INVALIDOS', 'valor_excede_limite_estoque']]);
    const antes = await foto(s.c);
    recusa(await A.confirmarReq(s.token, d, e.id), 422, 'OPERACAO_VALORES_INVALIDOS', 'valor_excede_limite_estoque');
    assert.equal(await foto(s.c), antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F8 — volume', () => {
  test('200 itens MERCADORIA × 120 parcelas: compra e venda confirmam dentro do timeout (tempo medido) e cancelam; efeitos exatos', async (t) => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const produtos = [];
    for (let k = 0; k < 20; k += 1) {
      produtos.push(await p.produto.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_produto: `V${k}`, nome_produto: `VOLUME ${String(k).padStart(2, '0')}`, unidade_principal_estoque: 'KG' } }));
    }
    const itens = (qtd, vu) => Array.from({ length: 200 }, (_, k) => ({
      tipo_item: 'MERCADORIA', produto_id: produtos[k % 20].id, local_estoque_id: (k % 2 ? s.local2 : s.local).id, unidade: 'KG', quantidade: qtd, valor_unitario: vu,
    }));
    const parcelas = (total) => Array.from({ length: 120 }, (_, k) => ({ vencimento: somaDias('2027-06-10', k), valor: total }));
    const doc = (direcao, qtd, vu, parcela) => ({
      empresa_id: e.id, direcao, conteudo: 'COM_PRODUTOS', condicao: 'PARCELADO', parceiro_id: (direcao === 'PAGAR' ? e.forn : e.cli).id, data_emissao: '2027-06-10',
      data_operacional: '2027-06-10', efeito_fisico_confirmado: true, itens: itens(qtd, vu), rateio_modo: 'PERCENTUAL',
      rateios: [{ natureza_id: (direcao === 'PAGAR' ? e.desp : e.rec).id, percentual: '60' }, { natureza_id: (direcao === 'PAGAR' ? e.desp2 : e.rec2).id, percentual: '40' }],
      parcelas: parcelas(parcela),
    });
    const medir = async (rotulo, fn) => {
      const t0 = performance.now();
      const r = await fn();
      const ms = Math.round(performance.now() - t0);
      t.diagnostic(`${rotulo}: ${ms} ms`);
      return { r, ms };
    };
    // compra: 200 × 10 kg × 1,50 = 3000,00 = 120 × 25,00
    const criarC = await medir('POST rascunho compra (200 itens, 120 parcelas)', () => A.ok(post(s, doc('PAGAR', '10', '1.5', '25.00')), 201));
    const previaC = await medir('prévia compra', () => A.previa(s.token, criarC.r.id, e.id));
    assert.deepEqual(previaC.r.bloqueios, []);
    const confC = await medir('confirmar compra', () => A.confirmar(s.token, criarC.r, e.id));
    assert.ok(confC.ms < 30000, `confirmar compra em ${confC.ms} ms (timeout 30 s)`);
    assert.deepEqual([confC.r.titulos.length, confC.r.itens.length, confC.r.valor_total], [120, 200, '3000.00']);
    assert.equal(await p.estoqueLoteNota.count({ where: { cliente_id: s.c } }), 200);
    assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c, tipo_detalhado: 'compra_financeiro' } }), 200);
    for (const prod of produtos) assert.equal((await p.produto.findUnique({ where: { id: prod.id } })).estoque_atual.toFixed(4), '100.0000');
    // venda: 200 × 4 kg × 3,75 = 3000,00 — FIFO em lotes do mesmo produto/local nas linhas repetidas
    const criarV = await medir('POST rascunho venda', () => A.ok(post(s, doc('RECEBER', '4', '3.75', '25.00')), 201));
    const previaV = await medir('prévia venda (FIFO simulado em sequência)', () => A.previa(s.token, criarV.r.id, e.id));
    assert.deepEqual(previaV.r.bloqueios, []);
    const confV = await medir('confirmar venda', () => A.confirmar(s.token, criarV.r, e.id));
    assert.ok(confV.ms < 30000, `confirmar venda em ${confV.ms} ms`);
    assert.equal(await p.operacaoFinanceiraConsumoLote.count({ where: { cliente_id: s.c } }) >= 200, true);
    for (const prod of produtos) assert.equal((await p.produto.findUnique({ where: { id: prod.id } })).estoque_atual.toFixed(4), '60.0000');
    const cancV = await medir('cancelar venda', () => A.ok(A.cancelarReq(s.token, confV.r.id, e.id)));
    assert.ok(cancV.ms < 30000);
    const cancC = await medir('cancelar compra', () => A.ok(A.cancelarReq(s.token, confC.r.id, e.id)));
    assert.ok(cancC.ms < 30000);
    for (const prod of produtos) assert.equal((await p.produto.findUnique({ where: { id: prod.id } })).estoque_atual.toFixed(4), '0.0000');
    assert.equal(await p.estoqueLoteNota.count({ where: { cliente_id: s.c, status: 'Estornado' } }), 200);
    const lista = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}`, s.token));
    assert.equal(lista.total, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('F9 — listagem, histórico e auditoria', () => {
  test('keyset (createdAt desc, id desc) com empates: filtros direção, situação, conteúdo, parceiro, emissão, vencimento, com_estoque e q; páginas sem perda nem duplicação; cursor e datas inválidos → 400', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const d1 = await A.criarConfirmar(s.token, docSem(e, { data_emissao: '2027-06-01', documento_referencia: 'NF-A1', descricao: 'adubo AZUL com 5% de desconto', parcelas: [{ vencimento: '2027-07-01', valor: '500.00' }] }));
    const d2 = await A.criar(s.token, docSem(e, { parceiro_id: e.prest.id, data_emissao: '2027-06-05', parcelas: [{ vencimento: '2027-08-01', valor: '500.00' }] }));
    const d3 = await A.criarConfirmar(s.token, docSem(e, { direcao: 'RECEBER', condicao: 'PARCELADO', data_emissao: '2027-06-10', parcelas: [{ vencimento: '2027-06-20', valor: '200.00' }, { vencimento: '2027-07-20', valor: '300.00' }] }));
    const d4 = await A.criarConfirmar(s.token, docCom(e, s.local, [{ produto: e.sal, quantidade: '10', valor_unitario: '2' }], { data_emissao: '2027-06-02', data_operacional: '2027-06-02' }));
    const d5 = await A.criar(s.token, {
      empresa_id: e.id, direcao: 'RECEBER', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: e.cli.id, data_emissao: '2027-06-12',
      itens: [{ tipo_item: 'SERVICO', descricao: 'ASSISTENCIA', unidade: 'UN', quantidade: '1', valor_unitario: '80' }],
      rateio_modo: 'VALOR', rateios: [{ natureza_id: e.rec2.id, valor: '80.00' }], parcelas: [{ vencimento: '2027-07-25', valor: '80.00' }],
    });
    const d6 = await A.criarConfirmar(s.token, docSem(e, { data_emissao: '2027-06-15', documento_referencia: 'XYZ-9' }));
    await A.ok(A.cancelarReq(s.token, d6.id, e.id));
    const genericos = [];
    for (let k = 0; k < 15; k += 1) genericos.push(await A.criar(s.token, docSem(e, { data_emissao: '2027-06-03', valor_bruto: '10.00', rateios: [{ natureza_id: e.desp.id, valor: '10.00' }], parcelas: [{ vencimento: '2027-07-10', valor: '10.00' }] })));
    // empate proposital de createdAt em 15 + 1 documentos (o desempate é o id)
    await p.$executeRawUnsafe(`UPDATE "OperacaoFinanceira" SET "createdAt" = '2027-06-03T10:00:00.000Z' WHERE id IN (${[...genericos.map((g) => g.id), d2.id].map((id) => `'${id}'`).join(',')})`);
    const todos = [d1, d2, d3, d4, d5, d6, ...genericos].map((d) => d.id);
    const ordemEsperada = async (ids) => (await p.operacaoFinanceira.findMany({ where: { id: { in: ids } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } })).map((r) => r.id);
    const paginar = async (filtros, limit) => {
      const vistos = [];
      let cursor = null;
      let paginas = 0;
      let total = null;
      do {
        const qs = new URLSearchParams({ empresa_id: e.id, limit: String(limit), ...filtros, ...(cursor ? { cursor } : {}) });
        const pg = await A.ok(A.req('GET', `/operacoes-financeiras?${qs}`, s.token));
        total ??= pg.total;
        assert.equal(pg.total, total, 'total estável entre páginas');
        assert.ok(pg.items.length <= limit);
        vistos.push(...pg.items.map((i) => i.id));
        cursor = pg.next_cursor;
        assert.equal(pg.has_more, Boolean(cursor));
        paginas += 1;
      } while (cursor && paginas < 50);
      assert.equal(new Set(vistos).size, vistos.length, `sem duplicação (${JSON.stringify(filtros)})`);
      return { vistos, total, paginas };
    };
    const casos = [
      [{}, todos],
      [{ direcao: 'RECEBER' }, [d3.id, d5.id]],
      [{ status: 'CONFIRMADO' }, [d1.id, d3.id, d4.id]],
      [{ status: 'CANCELADO' }, [d6.id]],
      [{ status: 'RASCUNHO' }, [d2.id, d5.id, ...genericos.map((g) => g.id)]],
      [{ conteudo: 'COM_PRODUTOS' }, [d4.id, d5.id]],
      [{ parceiro_id: e.prest.id }, [d2.id]],
      [{ emissao_de: '2027-06-10' }, [d3.id, d5.id, d6.id]],
      [{ emissao_ate: '2027-06-02' }, [d1.id, d4.id]],
      [{ emissao_de: '2027-06-02', emissao_ate: '2027-06-05' }, [d4.id, d2.id, ...genericos.map((g) => g.id)]],
      [{ vencimento_de: '2027-07-15', vencimento_ate: '2027-07-31' }, [d3.id, d5.id]],
      [{ vencimento_de: '2027-08-01' }, [d2.id]],
      [{ com_estoque: 'true' }, [d4.id]],
      [{ com_estoque: 'false' }, todos.filter((id) => id !== d4.id)],
      [{ q: 'nf-a' }, [d1.id]],
      [{ q: 'azul' }, [d1.id]],
      [{ q: 'prestador' }, [d2.id]],
      [{ q: 'xyz-9' }, [d6.id]],
      [{ direcao: 'PAGAR', status: 'CONFIRMADO', com_estoque: 'false' }, [d1.id]],
      [{ q: 'nada-disso' }, []],
      [{ q: '%' }, [d1.id]],
      [{ q: '_' }, []],
      [{ q: '\\' }, []],
    ];
    for (const [filtros, esperado] of casos) {
      for (const limit of [3, 100]) {
        const { vistos, total } = await paginar(filtros, limit);
        assert.equal(total, esperado.length, `total ${JSON.stringify(filtros)}`);
        assert.deepEqual(vistos, await ordemEsperada(esperado), `ordem/conjunto ${JSON.stringify(filtros)} limit=${limit}`);
      }
    }
    const numero = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&q=${d4.numero}`, s.token));
    assert.ok(numero.items.some((i) => i.id === d4.id));
    const { paginas } = await paginar({}, 4);
    assert.equal(paginas, Math.ceil(todos.length / 4));
    // campos do item
    const lista = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&direcao=RECEBER&status=CONFIRMADO`, s.token));
    assert.deepEqual(lista.items.map((i) => [i.id, i.saldo_aberto, i.proximo_vencimento, i.tem_estoque, i.condicao, i.moeda, i.moeda_casas]), [[d3.id, '500.00', '2027-06-20', false, 'PARCELADO', 'BRL', 2]]);
    await A.ok(A.liquidarReq(s.token, d3.titulos[0].id, e.id, { valor: '200.00' }), 201);
    await A.ok(A.liquidarReq(s.token, d3.titulos[1].id, e.id, { valor: '100.00' }), 201);
    const depois = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&direcao=RECEBER&status=CONFIRMADO`, s.token));
    assert.deepEqual([depois.items[0].saldo_aberto, depois.items[0].proximo_vencimento], ['200.00', '2027-07-20']);
    const cancelado = await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&status=CANCELADO`, s.token));
    assert.deepEqual([cancelado.items[0].saldo_aberto, cancelado.items[0].proximo_vencimento], ['0.00', null]);
    assert.equal((await A.ok(A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&com_estoque=true`, s.token))).items[0].tem_estoque, true);
    // entradas inválidas
    recusa(await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&cursor=lixo`, s.token), 400, 'REQUEST_VALIDATION_FAILED', 'cursor_invalido');
    recusa(await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&emissao_de=2027-02-30`, s.token), 400, 'REQUEST_VALIDATION_FAILED', 'data_invalida');
    recusa(await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&limit=101`, s.token), 400, 'REQUEST_VALIDATION_FAILED');
    recusa(await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&status=PREVISTO`, s.token), 400, 'REQUEST_VALIDATION_FAILED');
    recusa(await A.req('GET', `/operacoes-financeiras?empresa_id=${e.id}&q=${'x'.repeat(121)}`, s.token), 400, 'REQUEST_VALIDATION_FAILED');
    recusa(await A.req('GET', '/operacoes-financeiras', s.token), 400, 'REQUEST_VALIDATION_FAILED');
  });

  test('seletores (parceiros, produtos, locais, naturezas, centros): keyset (nome, id) com nomes empatados sem perda/duplicação; busca literal (curingas % e _ não casam tudo); só ativos e só o papel da direção', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const base = { cliente_id: s.c, empresa_id: e.id };
    for (let k = 0; k < 7; k += 1) {
      await p.fornecedor.create({ data: { ...base, numero_cadastro: `9${k}`, tipo_pessoa: 'Jurídica', nome: 'EMPATE', tipos: ['cliente'] } });
      // nome é único em produto, natureza e centros: lá o empate é de prefixo; parceiro e local empatam no nome inteiro
      await p.produto.create({ data: { ...base, numero_produto: `9${k}`, nome_produto: `EMPATE ${k}`, unidade_principal_estoque: 'KG' } });
      await p.localEstoque.create({ data: { cliente_id: s.c, numero_local: `9${k}`, nome: 'EMPATE' } });
      await p.naturezaFinanceira.create({ data: { ...base, numero: `9${k}`, tipo: 'RECEITA', nome: `EMPATE ${k}` } });
      await p.centroCusto.create({ data: { ...base, numero: `9${k}`, nome: `EMPATE ${k}` } });
      await p.centroResultado.create({ data: { ...base, numero: `9${k}`, nome: `EMPATE ${k}` } });
    }
    await p.fornecedor.create({ data: { ...base, numero_cadastro: '80', tipo_pessoa: 'Jurídica', nome: 'CLIENTE INATIVO', tipos: ['cliente'], ativo: false } });
    await p.produto.create({ data: { ...base, numero_produto: '80', nome_produto: 'PRODUTO INATIVO', unidade_principal_estoque: 'KG', ativo: false } });
    const esperado = {
      parceiros: await p.fornecedor.findMany({ where: { ...base, ativo: true, tipos: { has: 'cliente' } }, orderBy: [{ nome: 'asc' }, { id: 'asc' }], select: { id: true } }),
      produtos: await p.produto.findMany({ where: { ...base, ativo: true }, orderBy: [{ nome_produto: 'asc' }, { id: 'asc' }], select: { id: true } }),
      locais: await p.localEstoque.findMany({ where: { cliente_id: s.c, ativo: true }, orderBy: [{ nome: 'asc' }, { id: 'asc' }], select: { id: true } }),
      naturezas: await p.naturezaFinanceira.findMany({ where: { ...base, ativo: true, tipo: 'RECEITA' }, orderBy: [{ nome: 'asc' }, { id: 'asc' }], select: { id: true } }),
      'centros-custo': await p.centroCusto.findMany({ where: { ...base, ativo: true }, orderBy: [{ nome: 'asc' }, { id: 'asc' }], select: { id: true } }),
      'centros-resultado': await p.centroResultado.findMany({ where: { ...base, ativo: true }, orderBy: [{ nome: 'asc' }, { id: 'asc' }], select: { id: true } }),
    };
    const extra = { parceiros: `empresa_id=${e.id}&direcao=RECEBER`, produtos: `empresa_id=${e.id}`, locais: '', naturezas: `empresa_id=${e.id}&tipo=RECEITA`, 'centros-custo': `empresa_id=${e.id}`, 'centros-resultado': `empresa_id=${e.id}` };
    for (const [rota, linhas] of Object.entries(esperado)) {
      const vistos = [];
      let cursor = null;
      let n = 0;
      do {
        const pg = await A.ok(A.req('GET', `/operacoes-financeiras-opcoes/${rota}?limit=2${extra[rota] ? `&${extra[rota]}` : ''}${cursor ? `&cursor=${cursor}` : ''}`, s.token));
        vistos.push(...pg.itens.map((i) => i.id));
        cursor = pg.next_cursor;
        n += 1;
      } while (cursor && n < 50);
      assert.deepEqual(vistos, linhas.map((l) => l.id), `${rota}: todas as páginas, na ordem (nome, id)`);
      for (const curinga of ['%', '_', '%_%']) {
        const r = await A.ok(A.req('GET', `/operacoes-financeiras-opcoes/${rota}?q=${encodeURIComponent(curinga)}${extra[rota] ? `&${extra[rota]}` : ''}`, s.token));
        assert.deepEqual(r.itens, [], `${rota}: q=${curinga} é literal`);
      }
      const r = await A.ok(A.req('GET', `/operacoes-financeiras-opcoes/${rota}?q=empate${extra[rota] ? `&${extra[rota]}` : ''}`, s.token));
      assert.equal(r.itens.length, 7, `${rota}: busca sem caixa`);
    }
    const pagar = await A.ok(A.req('GET', `/operacoes-financeiras-opcoes/parceiros?empresa_id=${e.id}&direcao=PAGAR&limit=100`, s.token));
    assert.deepEqual(pagar.itens.map((i) => i.id).sort(), [e.forn.id, e.prest.id, e.legado.id].sort(), 'pagar: fornecedor, prestador e legado sem papel');
    recusa(await A.req('GET', `/operacoes-financeiras-opcoes/locais?cursor=lixo`, s.token), 400, 'REQUEST_VALIDATION_FAILED', 'cursor_invalido');
  });

  test('histórico do detalhe: quem/quando/ação de cada passo (2 usuários), em ordem; auditoria por allowlist: descrição, documento, motivos, referência, observação e nome do parceiro NUNCA no AuditLog', async () => {
    const s = await montarTenant(app);
    const e = s.e1;
    const p = prisma();
    const tudo = { novo: true, salvar: true, editar: true, confirmar: true, liquidar: true, estornar_liquidacao: true, cancelar: true };
    const outro = await s.contaCom(tudo);
    const parceiro = await p.fornecedor.create({ data: { cliente_id: s.c, empresa_id: e.id, numero_cadastro: '777', tipo_pessoa: 'Física', nome: 'MARCA-PARCEIRO JOAO DA SILVA', tipos: ['fornecedor', 'cliente'] } });
    const marcas = ['MARCA-DESCRICAO', 'MARCA-DOC', 'MARCA-SERVICO', 'MARCA-REF-BAIXA', 'MARCA-MOTIVO-EST1', 'MARCA-REF-LIQ', 'MARCA-OBS-LIQ', 'MARCA-MOTIVO-EST2', 'MARCA-MOTIVO-CANC', 'MARCA-PARCEIRO', 'JOAO DA SILVA'];
    const doc = {
      empresa_id: e.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'AVISTA', parceiro_id: parceiro.id, data_emissao: '2027-06-10', descricao: 'MARCA-DESCRICAO compra',
      documento_referencia: 'marca-doc-1', itens: [{ tipo_item: 'SERVICO', descricao: 'MARCA-SERVICO frete', unidade: 'UN', quantidade: '1', valor_unitario: '100' }],
      rateio_modo: 'VALOR', rateios: [{ natureza_id: e.desp.id, valor: '100.00' }], parcelas: [{ vencimento: '2027-06-10', valor: '100.00' }],
    };
    const d = await A.criar(s.token, doc);
    const ed = await A.ok(A.req('PUT', `/operacoes-financeiras/${d.id}`, outro.token, { ...doc, versao: d.versao }));
    const conf = await A.confirmar(s.token, ed, e.id, { baixa_no_ato: { metodo: 'PIX', data: '2027-06-10', referencia: 'MARCA-REF-BAIXA' } });
    await A.ok(A.estornarReq(outro.token, conf.titulos[0].liquidacoes[0].id, e.id, { motivo: 'MARCA-MOTIVO-EST1' }), 201);
    const l2 = await A.ok(A.liquidarReq(outro.token, conf.titulos[0].id, e.id, { valor: '40.00', referencia: 'MARCA-REF-LIQ', observacao: 'MARCA-OBS-LIQ' }), 201);
    await A.ok(A.estornarReq(s.token, l2.titulos[0].liquidacoes.find((l) => l.tipo === 'LIQUIDACAO' && !l.estornada).id, e.id, { motivo: 'MARCA-MOTIVO-EST2' }), 201);
    const fim = await A.ok(A.cancelarReq(outro.token, d.id, e.id, { motivo: 'MARCA-MOTIVO-CANC' }));
    assert.deepEqual(fim.historico.map((h) => [h.acao, h.usuario_login]), [
      ['operacao_financeira.criar', s.admLogin], ['operacao_financeira.editar', outro.login], ['operacao_financeira.confirmar', s.admLogin],
      ['liquidacao_financeira.estornar', outro.login], ['titulo_financeiro.liquidar', outro.login], ['liquidacao_financeira.estornar', s.admLogin],
      ['operacao_financeira.cancelar', outro.login],
    ]);
    const instantes = fim.historico.map((h) => h.em);
    assert.ok(instantes.every((x) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)));
    assert.deepEqual([...instantes].sort(), instantes, 'em ordem cronológica');
    // os fatos guardam o texto (é o registro do usuário) — só a auditoria não
    const det = await A.detalhe(s.token, d.id, e.id);
    assert.deepEqual([det.descricao, det.documento_referencia, det.motivo_cancelamento, det.parceiro_nome], ['MARCA-DESCRICAO compra', 'MARCA-DOC-1', 'MARCA-MOTIVO-CANC', 'MARCA-PARCEIRO JOAO DA SILVA']);
    assert.ok(det.titulos[0].liquidacoes.some((l) => l.referencia === 'MARCA-REF-LIQ' && l.observacao === 'MARCA-OBS-LIQ'));
    assert.ok(det.titulos[0].liquidacoes.some((l) => l.tipo === 'ESTORNO' && l.motivo === 'MARCA-MOTIVO-EST1'));
    // um rascunho descartado também audita sem texto
    const r = await A.criar(outro.token, { ...doc, documento_referencia: 'marca-doc-2' });
    await A.ok(A.req('DELETE', `/operacoes-financeiras/${r.id}?empresa_id=${e.id}&versao=${r.versao}`, outro.token), 204);
    const logs = await p.auditLog.findMany({ where: { cliente_id: s.c } });
    const acoesP3 = new Set(logs.map((l) => l.acao));
    for (const a of ['operacao_financeira.criar', 'operacao_financeira.editar', 'operacao_financeira.confirmar', 'operacao_financeira.cancelar', 'operacao_financeira.descartar', 'titulo_financeiro.liquidar', 'liquidacao_financeira.estornar']) {
      assert.ok(acoesP3.has(a), a);
    }
    const texto = JSON.stringify(logs.map((l) => [l.acao, l.dados_anteriores, l.dados_novos])).toUpperCase();
    for (const m of marcas) assert.ok(!texto.includes(m.toUpperCase()), `AuditLog não contém ${m}`);
    const confLog = logs.find((l) => l.acao === 'operacao_financeira.confirmar');
    assert.deepEqual([confLog.dados_novos.baixa_no_ato, confLog.dados_novos.valor_total, confLog.dados_novos.parcelas_n], [true, '100.00', 1]);
    const cancLog = logs.find((l) => l.acao === 'operacao_financeira.cancelar');
    assert.equal(cancLog.dados_novos.motivo_informado, true);
  });
});
