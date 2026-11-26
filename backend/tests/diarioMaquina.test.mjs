/**
 * D-PROD-323 (MAIKE-DIARIO-MAQUINA) — regras puras do diário da máquina, sem banco:
 *
 *  - a quantidade de cada produto no aplicar (item × volume ÷ capacidade, 4 casas, meio para cima);
 *  - o volume do aplicar (esvaziou, ou o saldo menos a sobra, com 0 ≤ sobra < saldo);
 *  - a forma pública da mistura (decimais em texto);
 *  - a quantidade padrão do produto (texto decimal > 0, ou nulo; a unidade L ou KG).
 *
 * As escritas com banco (mistura, aplicar com sobra, transferir, devolver, perda, replay, 409, resumo com e sem custo,
 * produto com quantidade padrão) estão no bloco "integração" no fim do arquivo: precisam do PostgreSQL de teste
 * (DATABASE_URL) com as migrations aplicadas.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { comoMisturaPublica, quantidadeProporcional, volumeDaAplicacao } from '../src/modules/atividades/atividadeMisturaService.js';
import { quantidadePadraoDoCorpo, unidadeQuantidadePadraoDoCorpo } from '../src/modules/produtos/produtoService.js';
import { dec } from '../src/modules/financeiro/decimalFinanceiro.js';
import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { corpoImplemento, erro, http, prisma } from './patrimonioP1Cenario.mjs';
import { montarAbastecimento, opId } from './patrimonioP1AbastecimentoCenario.mjs';

/** @param {() => unknown} fn @returns {any} */
const erroDe = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail('esperava um erro');
};

describe('D-PROD-323 — quantidade proporcional ao volume aplicado', () => {
  test('DM-01: 4 L por implemento de 2.000 L; aplicou 1.500 L → 3,0000 L', () => {
    assert.equal(quantidadeProporcional('4', '1500', '2000').toFixed(4), '3.0000');
  });

  test('DM-02: aplicou o implemento inteiro → a quantidade cheia', () => {
    assert.equal(quantidadeProporcional('4', '2000', '2000').toFixed(4), '4.0000');
  });

  test('DM-03: arredonda para 4 casas, meio para cima (0,00015 → 0,0002; 2/3 → 0,6667)', () => {
    assert.equal(quantidadeProporcional('1', '0.00015', '1').toFixed(4), '0.0002');
    assert.equal(quantidadeProporcional('1', '2', '3').toFixed(4), '0.6667');
  });

  test('DM-04: o total dos produtos bate com o volume (proporção exata, sem perder centavo por arredondamento)', () => {
    const cap = dec('2000');
    const soma = ['4', '10'].reduce((t, q) => t.plus(quantidadeProporcional(q, '1000', cap)), dec(0));
    assert.equal(soma.toFixed(4), '7.0000');
  });
});

describe('D-PROD-323 — volume do aplicar: esvaziou ou sobra', () => {
  const saldo = dec('2000');

  test('DM-05: esvaziou leva o saldo inteiro, sem sobra', () => {
    assert.equal(volumeDaAplicacao({ esvaziou: true, sobra: null, saldo }).toFixed(4), '2000.0000');
  });

  test('DM-06: sem esvaziou, o volume é o saldo menos a sobra', () => {
    assert.equal(volumeDaAplicacao({ esvaziou: false, sobra: '300', saldo }).toFixed(4), '1700.0000');
  });

  test('DM-07: sobra zero é aplicar tudo (0 ≤ sobra)', () => {
    assert.equal(volumeDaAplicacao({ esvaziou: false, sobra: '0', saldo }).toFixed(4), '2000.0000');
  });

  test('DM-08: com esvaziou não se informa sobra (422 MISTURA_SOBRA_INVALIDA)', () => {
    const e = erroDe(() => volumeDaAplicacao({ esvaziou: true, sobra: '10', saldo }));
    assert.equal(e.code, 'MISTURA_SOBRA_INVALIDA');
  });

  test('DM-09: sem esvaziou, a sobra é obrigatória (422)', () => {
    const e = erroDe(() => volumeDaAplicacao({ esvaziou: false, sobra: null, saldo }));
    assert.equal(e.code, 'MISTURA_SOBRA_INVALIDA');
  });

  test('DM-10: a sobra tem de ficar abaixo do saldo: igual ou acima é 422', () => {
    assert.equal(erroDe(() => volumeDaAplicacao({ esvaziou: false, sobra: '2000', saldo })).code, 'MISTURA_SOBRA_INVALIDA');
    assert.equal(erroDe(() => volumeDaAplicacao({ esvaziou: false, sobra: '2500', saldo })).code, 'MISTURA_SOBRA_INVALIDA');
  });

  test('DM-11: sobra negativa, número ou fora do formato decimal é 422 MISTURA_SOBRA_INVALIDA', () => {
    assert.equal(erroDe(() => volumeDaAplicacao({ esvaziou: false, sobra: '-1', saldo })).code, 'MISTURA_SOBRA_INVALIDA');
    assert.equal(erroDe(() => volumeDaAplicacao({ esvaziou: false, sobra: '1.23456', saldo })).code, 'MISTURA_SOBRA_INVALIDA');
    assert.equal(erroDe(() => volumeDaAplicacao({ esvaziou: false, sobra: 300, saldo })).code, 'MISTURA_SOBRA_INVALIDA');
  });
});

describe('D-PROD-323 — forma pública da mistura', () => {
  test('DM-12: capacidade, saldo e quantidades saem como texto de 4 casas; o produto vem com nome e unidade', () => {
    const publica = comoMisturaPublica({
      id: 'mis_1', numero: 2, implemento_bem_id: 'bem_1', area_id: 'area_1', capacidade: dec('2000'), unidade: 'L', saldo: dec('1700'), status: 'ABERTA',
      itens: [{ id: 'it_1', produto_id: 'pr_1', local_estoque_id: 'loc_1', quantidade: dec('4'), produto: { nome_produto: 'Herbicida', unidade_principal_estoque: 'L' }, localEstoque: { nome: 'Depósito' } }],
    });
    assert.equal(publica.capacidade, '2000.0000');
    assert.equal(publica.saldo, '1700.0000');
    assert.equal(publica.itens[0].quantidade, '4.0000');
    assert.equal(publica.itens[0].produto_nome, 'Herbicida');
    assert.equal(publica.itens[0].local_nome, 'Depósito');
  });
});

describe('D-PROD-323 — quantidade padrão do produto', () => {
  test('DM-13: texto decimal > 0 volta com 4 casas; sem o campo fica como estava (undefined); nulo limpa', () => {
    assert.equal(quantidadePadraoDoCorpo('4'), '4.0000');
    assert.equal(quantidadePadraoDoCorpo('0.5'), '0.5000');
    assert.equal(quantidadePadraoDoCorpo(undefined), undefined);
    assert.equal(quantidadePadraoDoCorpo(null), null);
  });

  test('DM-14: zero, negativo, número (não texto) e mais de 4 casas são 400', () => {
    assert.equal(erroDe(() => quantidadePadraoDoCorpo('0')).code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(erroDe(() => quantidadePadraoDoCorpo('-2')).code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(erroDe(() => quantidadePadraoDoCorpo(4)).code, 'REQUEST_VALIDATION_FAILED');
    assert.equal(erroDe(() => quantidadePadraoDoCorpo('1.23456')).code, 'REQUEST_VALIDATION_FAILED');
  });

  test('DM-15: a unidade da quantidade padrão é L, KG ou nula; outra sigla é 400', () => {
    assert.equal(unidadeQuantidadePadraoDoCorpo('L'), 'L');
    assert.equal(unidadeQuantidadePadraoDoCorpo('KG'), 'KG');
    assert.equal(unidadeQuantidadePadraoDoCorpo(null), null);
    assert.equal(unidadeQuantidadePadraoDoCorpo(undefined), undefined);
    assert.equal(erroDe(() => unidadeQuantidadePadraoDoCorpo('SACO')).code, 'REQUEST_VALIDATION_FAILED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integração: PostgreSQL de teste + HTTP autenticado (`app.inject`).

const MODULO = 'suporte-mapa';
const TELA = 'op-atividades';
const DIA = '2027-06-10';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;

/** Estado do banco que prova "nada gravado": misturas, itens, movimentos, linhas, estoque, lotes. */
const foto = async (c) => {
  const p = prisma();
  const lista = (x) => x.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } });
  return JSON.stringify({
    misturas: await lista(p.atividadeMistura),
    itens: await lista(p.atividadeMisturaItem),
    movs: await lista(p.atividadeMisturaMovimento),
    linhas: await lista(p.atividadeApontamentoProduto),
    mov_estoque: await lista(p.movimentacaoEstoque),
    lotes: await lista(p.estoqueLoteNota),
    produtos: await p.produto.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true, quantidade_padrao: true, quantidade_padrao_unidade: true } }),
  });
};
const estoque = async (produtoId) => (await prisma().produto.findUnique({ where: { id: produtoId } })).estoque_atual.toFixed(4);
const loteDisponivel = async (id) => (await prisma().estoqueLoteNota.findUnique({ where: { id } })).quantidade_disponivel.toFixed(4);
const contaMovEstoque = (c) => prisma().movimentacaoEstoque.count({ where: { cliente_id: c } });

/** Cenário: tenant com fazenda 1 (área "Retiro" + "PASTO 02"), herbicida em L (150 L em 2 lotes) e adubo em saco (200 kg), tipo que permite produto, implemento de 2.000 L com produto. */
const montar = async () => {
  const s = await montarAbastecimento(app, { lotes: true });
  const p = prisma();
  const H_ = H;
  const suf = randomUUID().slice(0, 6);
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({
    data: { cliente_id: s.c, nome_tipo: `PULVERIZAÇÃO ${suf}`, grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true },
  });
  const produto = (nome, unidade) =>
    p.produto.create({ data: { cliente_id: s.c, empresa_id: s.e1.id, numero_produto: `DM-${randomUUID().slice(0, 8)}`, nome_produto: nome, unidade_principal_estoque: unidade } });
  const herbicida = await produto('Herbicida glifosato (L)', 'L');
  const adubo = await produto('Adubo NPK (saco)', 'SACO');
  const lotes = {
    herbicidaA: (await s.lote(s.e1, herbicida, s.local, { quantidade: '50.0000', custo: '5.2000', dia: '2027-06-01' })).id,
    herbicidaB: (await s.lote(s.e1, herbicida, s.local, { quantidade: '100.0000', custo: '5.5000', dia: '2027-06-03' })).id,
    adubo: (await s.lote(s.e1, adubo, s.local, { quantidade: '200.0000', custo: '3.0000', dia: '2027-06-01' })).id,
  };
  const pasto2 = await p.areaPastagem.create({
    data: { cliente_id: s.c, empresa_id: s.e1.id, setor_id: s.area1.setor_id, setor_nome: s.area1.setor_nome, numero_area: `PS-${suf}`, nome: 'PASTO 02', tamanho_hectares: '25.5' },
  });
  const implemento = await H_.ok(
    H_.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, { numero_serie: `IMP-${suf}`, usa_produto: true, forma_produto: 'JATO', capacidade: '2000', capacidade_unidade: 'L' })),
    201
  );

  const detalhe = (a) => H_.ok(H_.req('GET', `/atividades/${a.id}?empresa_id=${s.e1.id}`, s.token));
  const ligacao = async (a, areaId) => (await detalhe(a)).areas.find((x) => x.area_id === areaId);
  /** Área da atividade em andamento (a Passo 2 só lança em área EM_ANDAMENTO). */
  const iniciar = async (a, areaId) => {
    const l = await ligacao(a, areaId);
    return H_.ok(H_.req('POST', `/atividades/${a.id}/areas/${l.id}/iniciar`, s.token, { empresa_id: s.e1.id, versao: l.versao, data_inicio: '2027-06-01' }));
  };
  /** Atividade com as duas áreas; a "Retiro" (área do lançamento) já em andamento. */
  const abrir = async () => {
    const a = await H_.ok(H_.req('POST', '/atividades', s.token, {
      empresa_id: s.e1.id, nome: 'Pulverização Pasto 01', tipo_atividade_id: tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30',
      areas: [{ area_id: s.area1.id }, { area_id: pasto2.id }],
    }), 201);
    await iniciar(a, s.area1.id);
    return a;
  };
  const lancarApontamento = async (a, areaId) =>
    (await H_.ok(H_.req('POST', `/atividades/${a.id}/apontamentos`, s.token, { empresa_id: s.e1.id, data_operacional: DIA, atividade_area_id: (await ligacao(a, areaId)).id }), 201)).apontamento;
  const criarMistura = (a, corpo = {}, op = opId()) =>
    H_.req('POST', `/atividades/${a.id}/misturas`, s.token, {
      empresa_id: s.e1.id, implemento_bem_id: implemento.id, area_id: s.area1.id,
      itens: [
        { produto_id: herbicida.id, local_estoque_id: s.local.id, quantidade: '4' },
        { produto_id: adubo.id, local_estoque_id: s.local.id, quantidade: '10' },
      ],
      operation_id: op, ...corpo,
    });
  const criarMisturaOk = async (a) => (await H_.ok(criarMistura(a), 201)).mistura;
  const aplicar = (a, ap, m, corpo, op = opId()) =>
    H_.req('POST', `/atividades/${a.id}/apontamentos/${ap.id}/misturas/${m.id}/aplicar`, s.token, { empresa_id: s.e1.id, esvaziou: false, operation_id: op, ...corpo });
  const sobra = (a, m, corpo, op = opId()) =>
    H_.req('POST', `/atividades/${a.id}/misturas/${m.id}/sobra`, s.token, { empresa_id: s.e1.id, operation_id: op, ...corpo });
  /** Mistura criada, apontamento em área EM_ANDAMENTO, e 500 L aplicados (sobra 500): saldo 500, 1.500 L saíram. */
  const aplicadoComSobra500 = async (a) => {
    const m = await criarMisturaOk(a);
    const ap = await lancarApontamento(a, s.area1.id);
    const r = await H_.ok(aplicar(a, ap, m, { sobra: '500' }), 201);
    return { m, ap, r };
  };
  const operador = await s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [{ modulo_id: MODULO, tela_id: TELA, visualizar: true }] });
  return { ...s, herbicida, adubo, lotes, pasto2, implemento, abrir, detalhe, ligacao, iniciar, lancarApontamento, criarMistura, criarMisturaOk, aplicar, sobra, aplicadoComSobra500, operador };
};

describe('D-PROD-323 — integração com PostgreSQL: mistura, aplicar, sobra, resumo e quantidade padrão', () => {
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

  test('1. Passo 1 "Implemento cheio": 201 ABERTA com saldo = capacidade; não baixa estoque', async () => {
    const s = await montar();
    const a = await s.abrir();
    const antes = await foto(s.c);
    const r = await s.criarMistura(a);
    assert.equal(r.statusCode, 201, r.body);
    const body = r.json();
    assert.equal(body.replay, false);
    assert.deepEqual(
      [body.mistura.status, body.mistura.capacidade, body.mistura.saldo, body.mistura.unidade, body.mistura.area_id],
      ['ABERTA', '2000.0000', '2000.0000', 'L', s.area1.id]
    );
    assert.deepEqual(body.mistura.itens.map((i) => [i.produto_nome, i.quantidade, i.produto_unidade]), [
      ['Herbicida glifosato (L)', '4.0000', 'L'],
      ['Adubo NPK (saco)', '10.0000', 'SACO'],
    ]);
    assert.equal(await estoque(s.herbicida.id), '150.0000');
    assert.equal(await estoque(s.adubo.id), '200.0000');
    assert.equal(await contaMovEstoque(s.c), 0, 'nenhum movimento de estoque');
    assert.equal(await prisma().atividadeApontamentoProduto.count({ where: { cliente_id: s.c } }), 0);
    assert.equal(await prisma().atividadeMistura.count({ where: { cliente_id: s.c } }), 1);
    assert.notEqual(await foto(s.c), antes);
  });

  test('2. 409 MISTURA_ABERTA se já há mistura ABERTA com saldo do mesmo implemento; nada gravado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const m1 = await s.criarMisturaOk(a);
    const antes = await foto(s.c);
    const r = await s.criarMistura(a);
    assert.deepEqual(erro(r).slice(0, 2), [409, 'MISTURA_ABERTA'], r.body);
    assert.equal(r.json().details.mistura_id, m1.id);
    assert.equal(await foto(s.c), antes);
  });

  test('3. aplicar com sobra: linhas proporcionais (item × volume ÷ capacidade), estoque baixa exato, saldo = sobra; replay não duplica', async () => {
    const s = await montar();
    const a = await s.abrir();
    const m = await s.criarMisturaOk(a);
    const ap = await s.lancarApontamento(a, s.area1.id);
    const op = opId();
    const r = await s.aplicar(a, ap, m, { sobra: '500' }, op);
    assert.equal(r.statusCode, 201, r.body);
    const body = r.json();
    assert.equal(body.volume_aplicado, '1500.0000');
    assert.deepEqual([body.mistura.saldo, body.mistura.status], ['500.0000', 'ABERTA']);
    assert.equal(body.linhas_ids.length, 2);

    // estoque: herbicida 4 × 1500 ÷ 2000 = 3 L; adubo 10 × 1500 ÷ 2000 = 7,5 kg. Lê como o teste de linha de produto.
    assert.equal(await estoque(s.herbicida.id), '147.0000');
    assert.equal(await estoque(s.adubo.id), '192.5000');
    assert.equal(await loteDisponivel(s.lotes.herbicidaA), '47.0000', 'FIFO: o lote mais antigo primeiro');

    const linhas = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c, apontamento_id: ap.id }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(
      linhas.map((l) => [l.produto_id, l.quantidade.toFixed(4), l.mistura_id, l.volume_aplicado.toFixed(4), l.jato]),
      [[s.herbicida.id, '3.0000', m.id, '1500.0000', 1], [s.adubo.id, '7.5000', m.id, '1500.0000', 1]]
    );

    // replay: mesma operation_id e mesmo corpo → 200, replay, nada a mais
    const depois = await foto(s.c);
    const re = await s.aplicar(a, ap, m, { sobra: '500' }, op);
    assert.equal(re.statusCode, 200, re.body);
    assert.equal(re.json().replay, true);
    assert.equal(await foto(s.c), depois);
  });

  test('4a. sobra TRANSFERENCIA: muda a área e guarda os horímetros; estoque intocado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const m = await s.criarMisturaOk(a);
    const r = await s.sobra(a, m, { tipo: 'TRANSFERENCIA', para_area_id: s.pasto2.id, horimetro_saida: '120.5', horimetro_chegada: '123' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().mistura.area_id, r.json().mistura.saldo, r.json().mistura.status], [s.pasto2.id, '2000.0000', 'ABERTA']);
    const mov = await prisma().atividadeMisturaMovimento.findFirst({ where: { cliente_id: s.c, mistura_id: m.id, tipo: 'TRANSFERENCIA' } });
    assert.deepEqual(
      [mov.de_area_id, mov.para_area_id, mov.horimetro_saida.toFixed(4), mov.horimetro_chegada.toFixed(4), mov.volume.toFixed(4)],
      [s.area1.id, s.pasto2.id, '120.5000', '123.0000', '2000.0000']
    );
    assert.equal(await estoque(s.herbicida.id), '150.0000');
    assert.equal(await contaMovEstoque(s.c), 0);
  });

  test('4b. sobra DEVOLUCAO: zera o saldo sem nenhum movimento de estoque novo', async () => {
    const s = await montar();
    const a = await s.abrir();
    const { m, ap } = await s.aplicadoComSobra500(a);
    const movs = await contaMovEstoque(s.c);
    const r = await s.sobra(a, m, { tipo: 'DEVOLUCAO', horimetro_saida: '50' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().mistura.status, r.json().mistura.saldo], ['DEVOLVIDA', '0.0000']);
    assert.equal(await contaMovEstoque(s.c), movs, 'devolver não mexe no estoque');
    assert.equal(await estoque(s.herbicida.id), '147.0000');
    assert.equal(await estoque(s.adubo.id), '192.5000');
    assert.equal(ap.status, 'CONFIRMADO');
    const mov = await prisma().atividadeMisturaMovimento.findFirst({ where: { cliente_id: s.c, mistura_id: m.id, tipo: 'DEVOLUCAO' } });
    assert.equal(mov.volume.toFixed(4), '500.0000');
    // O horímetro informado não cai em silêncio, mesmo sem transferência (D-PROD-325).
    assert.equal(mov.horimetro_saida.toFixed(4), '50.0000');
  });

  test('4c. PERDA sem motivo (ou motivo curto) → 422 MISTURA_MOVIMENTO_INVALIDO; nada gravado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const { m, ap } = await s.aplicadoComSobra500(a);
    const antes = await foto(s.c);
    const sem = await s.sobra(a, m, { tipo: 'PERDA', apontamento_id: ap.id });
    assert.deepEqual(erro(sem), [422, 'MISTURA_MOVIMENTO_INVALIDO', 'motivo', 'obrigatorio'], sem.body);
    const curto = await s.sobra(a, m, { tipo: 'PERDA', apontamento_id: ap.id, motivo: 'ab' });
    assert.deepEqual(erro(curto).slice(0, 2), [422, 'MISTURA_MOVIMENTO_INVALIDO'], curto.body);
    assert.equal(await foto(s.c), antes);
  });

  test('4d. PERDA com motivo: baixa proporcional ao saldo pelo motor, na linha da atividade; status PERDA', async () => {
    const s = await montar();
    const a = await s.abrir();
    const { m, ap } = await s.aplicadoComSobra500(a);
    const r = await s.sobra(a, m, { tipo: 'PERDA', apontamento_id: ap.id, motivo: 'Vazamento no tanque' });
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual([r.json().mistura.status, r.json().mistura.saldo], ['PERDA', '0.0000']);
    // saldo 500 de 2.000: herbicida 4 × 500 ÷ 2000 = 1 L; adubo 10 × 500 ÷ 2000 = 2,5 kg
    assert.equal(await estoque(s.herbicida.id), '146.0000');
    assert.equal(await estoque(s.adubo.id), '190.0000');
    const perdas = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c, apontamento_id: ap.id, observacao: 'Perda: Vazamento no tanque' } });
    assert.deepEqual(perdas.map((l) => [l.produto_id, l.quantidade.toFixed(4)]).sort(), [[s.adubo.id, '2.5000'], [s.herbicida.id, '1.0000']].sort());
  });

  test('5. GET diario-resumo: sem custo para não-administrador; com custo_total para o administrador', async () => {
    const s = await montar();
    const a = await s.abrir();
    const { ap } = await s.aplicadoComSobra500(a);
    const url = `/atividades/${a.id}/diario-resumo?empresa_id=${s.e1.id}&dia=${DIA}`;

    const admin = await H.ok(H.req('GET', url, s.token));
    assert.equal(admin.custo_visivel, true);
    assert.equal(admin.areas.length, 1);
    const area = admin.areas[0];
    assert.deepEqual([area.area_id, area.volumes_aplicados, area.implementos_cheios, area.horas_maquina], [s.area1.id, [{ unidade: 'L', volume: '1500.0000' }], 1, '0.0000']);
    assert.deepEqual(area.produtos.map((x) => [x.produto_nome, x.quantidade]).sort(), [['Adubo NPK (saco)', '7.5000'], ['Herbicida glifosato (L)', '3.0000']]);
    assert.deepEqual(area.sobra, [{ unidade: 'L', volume: '500.0000' }]);
    // custo pelo motor (custo médio do produto: (50 × 5,20 + 100 × 5,50) ÷ 150 = 5,40): herbicida 3 L × 5,40 + adubo 7,5 kg × 3,00
    assert.equal(area.custo_total, '38.7000');
    assert.equal(admin.total.custo_total, '38.7000');
    assert.ok(ap.id);

    const op = await H.ok(H.req('GET', url, s.operador.token));
    assert.equal(op.custo_visivel, false);
    assert.deepEqual(op.areas[0].volumes_aplicados, [{ unidade: 'L', volume: '1500.0000' }]);
    assert.equal(JSON.stringify(op).includes('custo_total'), false, 'nenhum valor de custo para quem não é administrador (só o sinal custo_visivel)');
    assert.equal('custo_total' in op.total, false);
  });

  test('6. produto: quantidade padrão e unidade criadas e editadas, lidas de volta; número em vez de texto → 400', async () => {
    const s = await montar();
    const criar = await H.req('POST', '/produtos', s.token, {
      empresa_id: s.e1.id, nome_produto: 'Herbicida dose padrão', unidade_principal_estoque: 'L', quantidade_padrao: '4', quantidade_padrao_unidade: 'L',
    });
    assert.equal(criar.statusCode, 201, criar.body);
    assert.deepEqual([criar.json().quantidade_padrao, criar.json().quantidade_padrao_unidade], ['4.0000', 'L']);
    const id = criar.json().id;

    const lerDeVolta = async () => (await H.ok(H.req('GET', `/produtos?empresa_id=${s.e1.id}`, s.token))).find((x) => x.id === id);
    assert.deepEqual([(await lerDeVolta()).quantidade_padrao, (await lerDeVolta()).quantidade_padrao_unidade], ['4.0000', 'L']);

    const editar = await H.req('PATCH', `/produtos/${id}`, s.token, { empresa_id: s.e1.id, quantidade_padrao: '2.5', quantidade_padrao_unidade: 'KG' });
    assert.equal(editar.statusCode, 200, editar.body);
    assert.deepEqual([(await lerDeVolta()).quantidade_padrao, (await lerDeVolta()).quantidade_padrao_unidade], ['2.5000', 'KG']);

    const limpar = await H.req('PATCH', `/produtos/${id}`, s.token, { empresa_id: s.e1.id, quantidade_padrao: null, quantidade_padrao_unidade: null });
    assert.equal(limpar.statusCode, 200, limpar.body);
    assert.deepEqual([(await lerDeVolta()).quantidade_padrao, (await lerDeVolta()).quantidade_padrao_unidade], [null, null]);

    const numeroCriar = await H.req('POST', '/produtos', s.token, { empresa_id: s.e1.id, nome_produto: 'Com número', unidade_principal_estoque: 'L', quantidade_padrao: 4 });
    assert.equal(numeroCriar.statusCode, 400, numeroCriar.body);
    const numeroEditar = await H.req('PATCH', `/produtos/${id}`, s.token, { empresa_id: s.e1.id, quantidade_padrao: 4 });
    assert.equal(numeroEditar.statusCode, 400, numeroEditar.body);
  });

  test('7. Passo 2 sem lançamento do dia: aplicar cria o lançamento de hoje da área, na mesma transação; sem ele, nada é gravado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const m = await s.criarMisturaOk(a);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c, atividade_id: a.id } }), 0, 'sem lançamento antes');

    const r = await H.req('POST', `/atividades/${a.id}/misturas/${m.id}/aplicar`, s.token, { empresa_id: s.e1.id, esvaziou: true, operation_id: opId() });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([r.json().mistura.status, r.json().mistura.saldo, r.json().volume_aplicado], ['ACABOU', '0.0000', '2000.0000']);

    const aps = await prisma().atividadeApontamento.findMany({ where: { cliente_id: s.c, atividade_id: a.id } });
    assert.equal(aps.length, 1, 'um lançamento do dia');
    assert.deepEqual([aps[0].status, aps[0].atividade_area_id], ['CONFIRMADO', (await s.ligacao(a, s.area1.id)).id]);
    const linhas = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c, mistura_id: m.id } });
    assert.deepEqual(linhas.map((l) => [l.apontamento_id, l.quantidade.toFixed(4)]).sort(), [[aps[0].id, '4.0000'], [aps[0].id, '10.0000']].sort());
    assert.equal(await estoque(s.herbicida.id), '146.0000');
    assert.equal(await estoque(s.adubo.id), '190.0000');
  });

  test('8. idempotente: aplicar e perder no mesmo dia usam o mesmo lançamento; POST diario-dia devolve o que existe', async () => {
    const s = await montar();
    const a = await s.abrir();
    const m = await s.criarMisturaOk(a);
    const r1 = await H.req('POST', `/atividades/${a.id}/misturas/${m.id}/aplicar`, s.token, { empresa_id: s.e1.id, esvaziou: false, sobra: '500', operation_id: opId() });
    assert.equal(r1.statusCode, 201, r1.body);
    // A perda, sem apontamento informado, acha o lançamento de hoje (não cria outro).
    const perda = await s.sobra(a, m, { tipo: 'PERDA', motivo: 'Vazamento no tanque' });
    assert.equal(perda.statusCode, 200, perda.body);
    assert.equal(await prisma().atividadeApontamento.count({ where: { cliente_id: s.c, atividade_id: a.id } }), 1, 'um só lançamento do dia');

    const dia = await H.ok(H.req('POST', `/atividades/${a.id}/diario-dia`, s.token, { empresa_id: s.e1.id, area_id: s.area1.id }));
    const aps = await prisma().atividadeApontamento.findMany({ where: { cliente_id: s.c, atividade_id: a.id } });
    assert.equal(dia.apontamento.id, aps[0].id);
    assert.equal(aps.length, 1);
  });

  test('9. trajeto sem sobra: só horímetros; sem estoque, sem trocar o pasto da mistura, sem custo', async () => {
    const s = await montar();
    const a = await s.abrir();
    const m = await s.criarMisturaOk(a);
    const antes = await contaMovEstoque(s.c);
    const op = opId();
    const r = await H.req('POST', `/atividades/${a.id}/trajetos`, s.token, {
      empresa_id: s.e1.id, de_area_id: s.area1.id, para_area_id: s.pasto2.id, horimetro_saida: '120.5', horimetro_chegada: '123', operation_id: op,
    });
    assert.equal(r.statusCode, 201, r.body);
    assert.deepEqual([r.json().mistura.area_id, r.json().mistura.saldo, r.json().mistura.status], [s.area1.id, '2000.0000', 'ABERTA']);
    const mov = await prisma().atividadeMisturaMovimento.findFirst({ where: { cliente_id: s.c, mistura_id: m.id, operation_id: op } });
    assert.deepEqual(
      [mov.tipo, mov.de_area_id, mov.para_area_id, mov.volume.toFixed(4), mov.horimetro_saida.toFixed(4), mov.horimetro_chegada.toFixed(4), mov.apontamento_id],
      ['TRANSFERENCIA', s.area1.id, s.pasto2.id, '0.0000', '120.5000', '123.0000', null]
    );
    assert.equal(await contaMovEstoque(s.c), antes, 'nenhum movimento de estoque');
    assert.equal(await estoque(s.herbicida.id), '150.0000');

    const re = await H.req('POST', `/atividades/${a.id}/trajetos`, s.token, {
      empresa_id: s.e1.id, de_area_id: s.area1.id, para_area_id: s.pasto2.id, horimetro_saida: '120.5', horimetro_chegada: '123', operation_id: op,
    });
    assert.equal(re.statusCode, 200, re.body);
    assert.equal(re.json().replay, true);
    assert.equal(await prisma().atividadeMisturaMovimento.count({ where: { cliente_id: s.c, mistura_id: m.id, tipo: 'TRANSFERENCIA' } }), 1);
  });

  test('9b. trajeto: sem horímetro é 422; chegada menor que a saída é 422; sem nenhuma mistura na atividade é 422 sem_mistura', async () => {
    const s = await montar();
    const a = await s.abrir();
    const corpo = { empresa_id: s.e1.id, de_area_id: s.area1.id, para_area_id: s.pasto2.id };
    const sem = await H.req('POST', `/atividades/${a.id}/trajetos`, s.token, { ...corpo, operation_id: opId() });
    assert.deepEqual(erro(sem), [422, 'MISTURA_MOVIMENTO_INVALIDO', 'horimetro', 'obrigatorio'], sem.body);
    const sem2 = await H.req('POST', `/atividades/${a.id}/trajetos`, s.token, { ...corpo, horimetro_saida: '10', horimetro_chegada: '9', operation_id: opId() });
    assert.deepEqual(erro(sem2).slice(0, 4), [422, 'MISTURA_MOVIMENTO_INVALIDO', 'horimetro_chegada', 'menor_que_saida'], sem2.body);
    const naoHa = await H.req('POST', `/atividades/${a.id}/trajetos`, s.token, { ...corpo, horimetro_saida: '10', operation_id: opId() });
    assert.deepEqual(erro(naoHa), [422, 'MISTURA_MOVIMENTO_INVALIDO', 'mistura', 'sem_mistura'], naoHa.body);
  });

  test('10. resumo por unidade: L e kg em linhas separadas (nunca somados); a lista de misturas responde items', async () => {
    const s = await montar();
    const a = await s.abrir();
    const { ap } = await s.aplicadoComSobra500(a);
    // Segundo implemento, em kg (capacidade 1.000 kg): a mistura dele sai na MESMA área e no MESMO lançamento.
    const implKg = await H.ok(H.req('POST', '/bens-patrimoniais', s.token, corpoImplemento(s, {
      numero_serie: `IMPKG-${randomUUID().slice(0, 6)}`, usa_produto: true, forma_produto: 'JATO', capacidade: '1000', capacidade_unidade: 'KG',
    })), 201);
    const m2 = (await H.ok(H.req('POST', `/atividades/${a.id}/misturas`, s.token, {
      empresa_id: s.e1.id, implemento_bem_id: implKg.id, area_id: s.area1.id,
      itens: [{ produto_id: s.adubo.id, local_estoque_id: s.local.id, quantidade: '10' }], operation_id: opId(),
    }), 201)).mistura;
    const r = await s.aplicar(a, ap, m2, { esvaziou: true }, opId());
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(r.json().mistura.unidade, 'KG');

    const url = `/atividades/${a.id}/diario-resumo?empresa_id=${s.e1.id}&dia=${DIA}`;
    const admin = await H.ok(H.req('GET', url, s.token));
    const area = admin.areas[0];
    assert.deepEqual(area.volumes_aplicados, [{ unidade: 'L', volume: '1500.0000' }, { unidade: 'KG', volume: '1000.0000' }]);
    assert.equal(area.implementos_cheios, 2);
    assert.deepEqual(admin.total.volumes_aplicados, [{ unidade: 'L', volume: '1500.0000' }, { unidade: 'KG', volume: '1000.0000' }]);
    assert.equal('volume_aplicado' in area, false, 'o campo que somava L com kg saiu');

    const lista = await H.ok(H.req('GET', `/atividades/${a.id}/misturas?empresa_id=${s.e1.id}`, s.token));
    assert.ok(Array.isArray(lista.items) && lista.items.length === 2, 'a tela lê `items`');
    assert.equal(lista.misturas, undefined);
  });
});

