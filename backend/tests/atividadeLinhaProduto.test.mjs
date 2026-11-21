/**
 * D-PROD-202 (Fatia 3 do Lançamento de Atividades) — a LINHA DE PRODUTO do
 * apontamento, contra PostgreSQL real e HTTP autenticado (`app.inject`).
 * Contrato: docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md (§2, §4, §7).
 *
 * Cobre: baixa e estorno exatos pelo motor FIFO (lotes, `estoque_atual`,
 * movimentos); saldo insuficiente; o FIFO igual ao do abastecimento (mesmos
 * lotes, mesmas fatias, mesmo custo); editar = estorno exato + baixa nova;
 * cancelar o apontamento e a atividade estornam tudo; `permite_produto`
 * desligado recusa; combustível recusado (e fora do seletor); a dose/ha
 * calculada e recalculada; o totalizador (duas passadas no mesmo dia somando;
 * cancelado fora); idempotência (reenvio igual → replay, corpo diferente →
 * 409); a data do apontamento não muda com linha; a conciliação do estoque sem
 * divergência depois de saídas, edições e estornos; o lote com fatia imutável;
 * o isolamento por tenant e fazenda; o "repetir" com linhas; os seletores.
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, limparBanco, encerrar } from './helpers.mjs';
import { erro, http, prisma } from './patrimonioP1Cenario.mjs';
import { acoesAbastecimento, corpoAbastecimento, montarAbastecimento, opId } from './patrimonioP1AbastecimentoCenario.mjs';

/** @type {import('fastify').FastifyInstance} */
let app;
/** @type {ReturnType<typeof http>} */
let H;
/** @type {ReturnType<typeof acoesAbastecimento>} */
let AB;
before(async () => {
  app = await criarApp();
  await app.ready();
  H = http(app);
  AB = acoesAbastecimento(app);
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

/** Os campos da linha de produto, na ordem da forma pública. */
const CAMPOS_LINHA = [
  'id', 'empresa_id', 'apontamento_id', 'ordem', 'status', 'produto_id', 'produto', 'local_estoque_id', 'local_estoque',
  'quantidade', 'unidade', 'dose_ha',
  // D-PROD-270: o VC (%) da semente (só a linha do lançamento que o trouxe; nulo aqui).
  'vc_percentual',
  'custo_unitario', 'custo_total', 'movimentacao_estoque_id', 'movimentacao_estorno_id',
  'fatias', 'observacao', 'criado_por', 'cancelado_em', 'cancelado_por', 'motivo_cancelamento', 'cancelamento_origem', 'createdAt', 'updatedAt',
];

const MODULO = 'suporte-mapa';
const TELA = 'op-atividades';

/**
 * Cenário: o do abastecimento (tenant com 2 fazendas, diesel aceito pelo
 * trator — combustível —, o local de estoque) e, na fazenda 1, um tipo que
 * PERMITE produto e outro que não; o HERBICIDA (L) com os MESMOS lotes do
 * vetor FIFO do diesel (A: 06-01, 50 L a 5,20; B: 06-03, 100 L a 5,50) e o
 * ADUBO em SACO (estoque em kg). `compra: true` cria os lotes pela compra P3
 * (o caminho real, com movimento de entrada) em vez do banco.
 */
const montar = async ({ compra = false } = {}) => {
  const s = await montarAbastecimento(app, { lotes: !compra });
  const p = prisma();
  const suf = randomUUID().slice(0, 6);
  const grupo = await p.grupoAtividade.create({ data: { cliente_id: s.c, nome_grupo: `GRUPO ${suf}` } });
  const tipo = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: 'PULVERIZAÇÃO', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo, permite_produto: true } });
  const tipoSem = await p.tipoAtividade.create({ data: { cliente_id: s.c, nome_tipo: 'ROÇADA', grupo_atividade_id: grupo.id, grupo_atividade_nome: grupo.nome_grupo } });
  const produto = (empresa, nome, unidade) =>
    p.produto.create({ data: { cliente_id: s.c, empresa_id: empresa.id, numero_produto: `HB-${randomUUID().slice(0, 8)}`, nome_produto: nome, unidade_principal_estoque: unidade } });
  const herbicida = await produto(s.e1, 'Herbicida glifosato (L)', 'L');
  const adubo = await produto(s.e1, 'Adubo NPK (saco)', 'SACO');
  const herbicidaE2 = await produto(s.e2, 'Herbicida da fazenda 2', 'L');
  const lotes = {};
  if (compra) {
    lotes.herbicidaA = (await s.compraP3(s.e1, herbicida, s.local, { quantidade: '50', preco: '5.20', dia: '2027-06-01' })).lote_id;
    lotes.herbicidaB = (await s.compraP3(s.e1, herbicida, s.local, { quantidade: '100', preco: '5.50', dia: '2027-06-03' })).lote_id;
    lotes.adubo = (await s.compraP3(s.e1, adubo, s.local, { quantidade: '200', preco: '3.00', dia: '2027-06-01' })).lote_id;
  } else {
    lotes.herbicidaA = (await s.lote(s.e1, herbicida, s.local, { quantidade: '50.0000', custo: '5.2000', dia: '2027-06-01' })).id;
    lotes.herbicidaB = (await s.lote(s.e1, herbicida, s.local, { quantidade: '100.0000', custo: '5.5000', dia: '2027-06-03' })).id;
    lotes.adubo = (await s.lote(s.e1, adubo, s.local, { quantidade: '200.0000', custo: '3.0000', dia: '2027-06-01' })).id;
    lotes.herbicidaE2 = (await s.lote(s.e2, herbicidaE2, s.local, { quantidade: '100.0000', custo: '5.0000', dia: '2027-06-01' })).id;
  }
  const abrir = async (extra = {}) =>
    H.ok(H.req('POST', '/atividades', s.token, { empresa_id: s.e1.id, nome: 'Cigarrinha Pasto 01', tipo_atividade_id: tipo.id, data_inicio: '2027-06-01', data_prevista_fim: '2027-06-30', ...extra }), 201);
  const baseAp = (a) => `/atividades/${a.id}/apontamentos`;
  const lancar = (a, corpo, tok = s.token) => H.req('POST', baseAp(a), tok, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', ...corpo });
  const lancarOk = async (a, corpo = {}) => (await H.ok(lancar(a, corpo), 201)).apontamento;
  const baseLinha = (a, ap) => `${baseAp(a)}/${ap.id}/produtos`;
  const linhaCorpo = (extra = {}) => ({ produto_id: herbicida.id, local_estoque_id: s.local.id, quantidade: '30', ...extra });
  const L = {
    lancar: (a, ap, corpo = {}, tok = s.token) => H.req('POST', baseLinha(a, ap), tok, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), ...linhaCorpo(corpo) }),
    editar: (a, ap, linhaId, corpo, tok = s.token) => H.req('PATCH', `${baseLinha(a, ap)}/${linhaId}`, tok, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), ...corpo }),
    cancelar: (a, ap, linhaId, corpo = {}, tok = s.token) =>
      H.req('POST', `${baseLinha(a, ap)}/${linhaId}/cancelar`, tok, { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), motivo: 'lançado errado', ...corpo }),
  };
  const lancarLinhaOk = async (a, ap, corpo = {}) => H.ok(L.lancar(a, ap, corpo), 201);
  const contaTela = (acoes) => s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [{ modulo_id: MODULO, tela_id: TELA, visualizar: true, ...acoes }] });
  return { ...s, tipo, tipoSem, herbicida, adubo, herbicidaE2, lotesH: lotes, abrir, lancar, lancarOk, L, lancarLinhaOk, contaTela, baseAp };
};

const lote = async (id) => {
  const l = await prisma().estoqueLoteNota.findUnique({ where: { id } });
  return [l.quantidade_disponivel.toFixed(4), l.status];
};
const estoque = async (produtoId) => (await prisma().produto.findUnique({ where: { id: produtoId } })).estoque_atual.toFixed(4);
const movimento = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
/** Prova de "nada gravado": linhas, fatias, lotes, movimentos, produtos, apontamentos e recibos do tenant. */
const foto = async (c) => {
  const p = prisma();
  return JSON.stringify({
    li: await p.atividadeApontamentoProduto.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    fa: await p.atividadeApontamentoProdutoConsumoLote.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    lo: await p.estoqueLoteNota.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    mv: await p.movimentacaoEstoque.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
    pr: await p.produto.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true } }),
    ap: await p.atividadeApontamento.findMany({ where: { cliente_id: c }, orderBy: { id: 'asc' } }),
  }, replacer);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('baixa e estorno', () => {
  test('lançar: 201, forma pública, unidade efetiva, custo FIFO, fatias, movimento numerado na data do apontamento, versão + 1; cancelar devolve exatamente', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a, { area_executada_dia: '10' });
    const r = await s.L.lancar(a, ap, { quantidade: '30', observacao: 'texto secreto' });
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.deepEqual(Object.keys(c), ['linha', 'apontamento', 'atividade', 'replay']);
    assert.equal(c.replay, false);
    assert.deepEqual(Object.keys(c.linha), CAMPOS_LINHA);
    const l = c.linha;
    assert.deepEqual(
      [l.ordem, l.status, l.quantidade, l.unidade, l.dose_ha, l.custo_unitario, l.custo_total, l.produto.nome, l.local_estoque.id, l.empresa_id],
      [1, 'CONFIRMADO', '30.0000', 'L', '3.0000', '5.4000', '162.0000', 'Herbicida glifosato (L)', s.local.id, s.e1.id]
    );
    assert.deepEqual(l.fatias, [{ ordem: 1, lote_id: s.lotesH.herbicidaA, quantidade: '30.0000', custo_unitario: '5.4000' }]);
    assert.equal(c.apontamento.versao, 2, 'a escrita da linha incrementa a versão do apontamento uma vez');
    assert.deepEqual(c.apontamento.produtos.map((x) => x.id), [l.id]);
    assert.deepEqual(c.apontamento.maquinas, []);
    assert.equal(c.atividade.id, a.id);
    const mov = await movimento(l.movimentacao_estoque_id);
    assert.deepEqual(
      [mov.tipo_movimentacao, mov.origem_sistema, mov.tipo_detalhado, mov.data_movimentacao.toISOString().slice(0, 10), mov.quantidade.toFixed(4), mov.valor_total.toFixed(4), mov.numero_documento, mov.lancamento_origem_id],
      ['Saída', 'apontamento_atividade', 'apontamento_atividade', '2027-06-10', '30.0000', '162.0000', a.numero, a.id]
    );
    assert.ok(!mov.numero_movimentacao.startsWith('p-'), 'numerado no fim da transação');
    assert.deepEqual(await lote(s.lotesH.herbicidaA), ['20.0000', 'Disponivel']);
    assert.equal(await estoque(s.herbicida.id), '120.0000');
    const au = await prisma().auditLog.findMany({ where: { cliente_id: s.c, entidade: 'AtividadeApontamentoProduto' } });
    assert.deepEqual(au.map((x) => x.acao), ['atividade_linha_produto.lancar']);
    assert.ok(!JSON.stringify(au).includes('texto secreto'), 'auditoria sem texto livre');

    // cancelar: estorno exato (lote e estoque voltam), origem LINHA, versão + 1
    const ap2 = c.apontamento;
    const cancelOp = opId();
    const cr = await s.L.cancelar(a, ap2, l.id, { operation_id: cancelOp });
    assert.equal(cr.statusCode, 200, cr.body);
    const cc = cr.json();
    assert.deepEqual([cc.linha.status, cc.linha.cancelamento_origem, cc.linha.motivo_cancelamento, cc.apontamento.versao], ['CANCELADO', 'LINHA', 'lançado errado', 3]);
    assert.deepEqual(await lote(s.lotesH.herbicidaA), ['50.0000', 'Disponivel']);
    assert.equal(await estoque(s.herbicida.id), '150.0000');
    assert.equal((await movimento(l.movimentacao_estoque_id)).status, 'Estornada');
    const est = await movimento(cc.linha.movimentacao_estorno_id);
    assert.deepEqual([est.tipo_movimentacao, est.tipo_detalhado, est.movimento_pai_id, est.valor_total.toFixed(4), est.data_movimentacao.toISOString().slice(0, 10)], ['Entrada', 'estorno_apontamento_atividade', l.movimentacao_estoque_id, '162.0000', '2027-06-15']);
    // reenvio igual do cancelamento: replay, nada muda
    const antes = await foto(s.c);
    const re = await H.req('POST', `/atividades/${a.id}/apontamentos/${ap.id}/produtos/${l.id}/cancelar`, s.token, { empresa_id: a.empresa_id, versao: ap2.versao, operation_id: cancelOp, motivo: 'lançado errado' });
    assert.equal(re.statusCode, 200, re.body);
    assert.equal(re.json().replay, true);
    assert.equal(await foto(s.c), antes);
    // cancelar de novo (chave nova): já cancelada → 409
    assert.deepEqual(erro(await s.L.cancelar(a, cc.apontamento, l.id)).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
  });

  test('saldo insuficiente → 422 ESTOQUE_SALDO_INSUFICIENTE com disponível × solicitado; nada gravado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const antes = await foto(s.c);
    const r = await s.L.lancar(a, ap, { quantidade: '200' });
    assert.deepEqual(erro(r).slice(0, 2), [422, 'ESTOQUE_SALDO_INSUFICIENTE'], r.body);
    assert.match(r.json().message, /disponível 150\.0000 L, solicitado 200\.0000 L/);
    assert.deepEqual([r.json().details.disponivel, r.json().details.solicitado], ['150.0000', '200.0000']);
    assert.equal(await foto(s.c), antes);
    const zero = await s.L.lancar(a, ap, { quantidade: '0' });
    assert.deepEqual(erro(zero), [422, 'ATIVIDADE_LINHA_INVALIDA', 'quantidade', 'quantidade_nao_positiva']);
    const numero = await s.L.lancar(a, ap, { quantidade: 30 });
    assert.deepEqual(erro(numero).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED'], 'decimal só como texto');
  });

  test('custo médio igual ao do abastecimento: os mesmos lotes dão as mesmas fatias e o mesmo custo (80 L: 50 + 30 kg baixados, tudo a 5,40)', async () => {
    const s = await montar();
    const abast = await AB.confirmarOk(s.operador.token, corpoAbastecimento(s, { quantidade: '80' }));
    const fatiasAbast = await prisma().abastecimentoBemConsumoLote.findMany({ where: { cliente_id: s.c }, orderBy: { ordem: 'asc' } });
    const linhaAbast = await prisma().abastecimentoBem.findFirst({ where: { cliente_id: s.c, id: abast.id } });
    const movAbast = await movimento(linhaAbast.movimentacao_estoque_id);
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const l = (await s.lancarLinhaOk(a, ap, { quantidade: '80' })).linha;
    const movLinha = await movimento(l.movimentacao_estoque_id);
    const doLote = new Map([[s.lotes.dieselA.id, 'A'], [s.lotes.dieselB.id, 'B'], [s.lotesH.herbicidaA, 'A'], [s.lotesH.herbicidaB, 'B']]);
    assert.deepEqual(
      l.fatias.map((f) => [doLote.get(f.lote_id), f.quantidade, f.custo_unitario]),
      fatiasAbast.map((f) => [doLote.get(f.estoque_lote_nota_id), f.quantidade.toFixed(4), f.custo_unitario.toFixed(4)])
    );
    assert.deepEqual(l.fatias.map((f) => [doLote.get(f.lote_id), f.quantidade]), [['A', '50.0000'], ['B', '30.0000']]);
    assert.deepEqual([movLinha.valor_unitario.toFixed(4), movLinha.valor_total.toFixed(4)], [movAbast.valor_unitario.toFixed(4), movAbast.valor_total.toFixed(4)]);
    assert.deepEqual([l.custo_unitario, l.custo_total], ['5.4000', '432.0000']);
  });
});

describe('editar e cancelar em cascata', () => {
  test('editar = estorno exato (EDICAO) + baixa nova numa linha nova, na mesma transação', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a, { area_executada_dia: '20' });
    const c1 = await s.lancarLinhaOk(a, ap, { quantidade: '30' });
    const r = await s.L.editar(a, c1.apontamento, c1.linha.id, { quantidade: '60' });
    assert.equal(r.statusCode, 200, r.body);
    const c = r.json();
    assert.deepEqual(Object.keys(c), ['linha', 'linha_anterior_id', 'apontamento', 'atividade', 'replay']);
    assert.equal(c.linha_anterior_id, c1.linha.id);
    assert.notEqual(c.linha.id, c1.linha.id);
    const velha = c.apontamento.produtos.find((x) => x.id === c1.linha.id);
    assert.deepEqual([velha.status, velha.cancelamento_origem, typeof velha.movimentacao_estorno_id], ['CANCELADO', 'EDICAO', 'string']);
    assert.deepEqual([c.linha.ordem, c.linha.status, c.linha.quantidade, c.linha.dose_ha, c.linha.custo_total], [2, 'CONFIRMADO', '60.0000', '3.0000', '324.0000']);
    assert.deepEqual(c.linha.fatias.map((f) => [f.lote_id, f.quantidade]), [[s.lotesH.herbicidaA, '50.0000'], [s.lotesH.herbicidaB, '10.0000']]);
    assert.deepEqual(await lote(s.lotesH.herbicidaA), ['0.0000', 'Esgotado']);
    assert.deepEqual(await lote(s.lotesH.herbicidaB), ['90.0000', 'Disponivel']);
    assert.equal(await estoque(s.herbicida.id), '90.0000');
    assert.equal(c.apontamento.versao, 3);
    // trocar o produto: o herbicida volta inteiro e o adubo (SACO → kg) baixa
    const t = await H.ok(s.L.editar(a, c.apontamento, c.linha.id, { produto_id: s.adubo.id, quantidade: '25' }));
    assert.deepEqual([t.linha.unidade, t.linha.custo_total], ['KG', '75.0000']);
    assert.equal(await estoque(s.herbicida.id), '150.0000');
    assert.equal(await estoque(s.adubo.id), '175.0000');
    // versão velha: 409, nada gravado
    const antes = await foto(s.c);
    assert.deepEqual(erro(await s.L.editar(a, c.apontamento, t.linha.id, { quantidade: '1' })).slice(0, 2), [409, 'ATIVIDADE_VERSAO_CONFLITO']);
    // linha cancelada não edita
    assert.deepEqual(erro(await s.L.editar(a, t.apontamento, c.linha.id, { quantidade: '1' })).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
    assert.equal(await foto(s.c), antes);
  });

  test('cancelar o apontamento estorna todas as linhas confirmadas (origem APONTAMENTO); estoque e lotes voltam exatos', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const c1 = await s.lancarLinhaOk(a, ap, { quantidade: '70' });
    const c2 = await s.lancarLinhaOk(a, c1.apontamento, { produto_id: s.adubo.id, quantidade: '12' });
    const r = await H.ok(H.req('POST', `${s.baseAp(a)}/${ap.id}/cancelar`, s.token, { empresa_id: a.empresa_id, versao: c2.apontamento.versao, motivo: 'chuva' }));
    assert.equal(r.apontamento.status, 'CANCELADO');
    assert.deepEqual(r.apontamento.produtos.map((x) => [x.status, x.cancelamento_origem, x.motivo_cancelamento]), [['CANCELADO', 'APONTAMENTO', 'chuva'], ['CANCELADO', 'APONTAMENTO', 'chuva']]);
    assert.deepEqual(await lote(s.lotesH.herbicidaA), ['50.0000', 'Disponivel']);
    assert.deepEqual(await lote(s.lotesH.herbicidaB), ['100.0000', 'Disponivel']);
    assert.deepEqual(await lote(s.lotesH.adubo), ['200.0000', 'Disponivel']);
    assert.deepEqual([await estoque(s.herbicida.id), await estoque(s.adubo.id)], ['150.0000', '200.0000']);
    // linha em apontamento cancelado: 409
    assert.deepEqual(erro(await s.L.lancar(a, r.apontamento)).slice(0, 2), [409, 'ATIVIDADE_STATUS_INVALIDO']);
  });

  test('cancelar a atividade estorna as linhas de todos os apontamentos (origem ATIVIDADE); o já cancelado fica como estava', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap1 = await s.lancarOk(a);
    await s.lancarLinhaOk(a, ap1, { quantidade: '40' });
    const ap2 = await s.lancarOk(a, { data_operacional: '2027-06-11' });
    const c2 = await s.lancarLinhaOk(a, ap2, { quantidade: '20' });
    const c3 = await s.lancarLinhaOk(a, c2.apontamento, { produto_id: s.adubo.id, quantidade: '10' });
    const c4 = await s.L.cancelar(a, c3.apontamento, c3.linha.id);
    assert.equal(c4.statusCode, 200, c4.body);
    assert.equal(await estoque(s.herbicida.id), '90.0000');
    const at = await H.ok(H.req('GET', `/atividades/${a.id}?empresa_id=${a.empresa_id}`, s.token));
    const r = await H.ok(H.req('POST', `/atividades/${a.id}/cancelar`, s.token, { empresa_id: a.empresa_id, versao: at.versao, motivo: 'safra perdida' }));
    assert.equal(r.status, 'CANCELADA');
    const linhas = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(linhas.map((x) => [x.status, x.cancelamento_origem]), [['CANCELADO', 'ATIVIDADE'], ['CANCELADO', 'ATIVIDADE'], ['CANCELADO', 'LINHA']]);
    assert.deepEqual([await estoque(s.herbicida.id), await estoque(s.adubo.id)], ['150.0000', '200.0000']);
    assert.deepEqual(await lote(s.lotesH.herbicidaA), ['50.0000', 'Disponivel']);
  });
});

describe('regras da linha', () => {
  test('permite_produto desligado no tipo → 422 ATIVIDADE_EXIGIDA_PELO_TIPO (reason permite_produto), também no lançamento com produtos[]', async () => {
    const s = await montar();
    const a = await s.abrir({ tipo_atividade_id: s.tipoSem.id });
    const ap = await s.lancarOk(a);
    const antes = await foto(s.c);
    assert.deepEqual(erro(await s.L.lancar(a, ap)), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'produto_id', 'permite_produto']);
    const r = await s.lancar(a, { operation_id: opId(), produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '5' }] });
    assert.deepEqual(erro(r), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'produto_id', 'permite_produto']);
    assert.equal(await foto(s.c), antes);
    // a flag vale na hora da escrita: desligar no tipo também recusa na atividade que já existe
    const b = await s.abrir();
    const bp = await s.lancarOk(b);
    await prisma().tipoAtividade.update({ where: { id: s.tipo.id }, data: { permite_produto: false } });
    assert.deepEqual(erro(await s.L.lancar(b, bp)).slice(0, 4), [422, 'ATIVIDADE_EXIGIDA_PELO_TIPO', 'produto_id', 'permite_produto']);
  });

  test('combustível (aceito por tanque ativo) recusado; produto de outra fazenda, inativo, local inexistente → 422; nada gravado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const antes = await foto(s.c);
    assert.deepEqual(erro(await s.L.lancar(a, ap, { produto_id: s.diesel.id })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'produto_id', 'combustivel_no_abastecimento']);
    assert.deepEqual(erro(await s.L.lancar(a, ap, { produto_id: s.herbicidaE2.id })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'produto_id', 'outra_empresa']);
    assert.deepEqual(erro(await s.L.lancar(a, ap, { produto_id: 'nao-existe' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'produto_id', 'inexistente']);
    assert.deepEqual(erro(await s.L.lancar(a, ap, { local_estoque_id: s.localInativo.id })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'local_estoque_id', 'inativo']);
    assert.deepEqual(erro(await s.L.lancar(a, ap, { local_estoque_id: 'nao-existe' })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'local_estoque_id', 'inexistente']);
    await prisma().produto.update({ where: { id: s.adubo.id }, data: { ativo: false } });
    assert.deepEqual(erro(await s.L.lancar(a, ap, { produto_id: s.adubo.id })), [422, 'ATIVIDADE_LINHA_INVALIDA', 'produto_id', 'inativo']);
    // campos do servidor no corpo → 400
    assert.deepEqual(erro(await s.L.lancar(a, ap, { unidade: 'KG' })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.deepEqual(erro(await s.L.lancar(a, ap, { custo_unitario: '1' })).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.equal(await foto(s.c), antes);
  });

  test('dose/ha = quantidade / área do dia, recalculada quando a área muda (nula sem área)', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a, { area_executada_dia: '12.5' });
    const c = await s.lancarLinhaOk(a, ap, { quantidade: '25' });
    assert.equal(c.linha.dose_ha, '2.0000');
    const e1 = await H.ok(H.req('PATCH', `${s.baseAp(a)}/${ap.id}`, s.token, { versao: c.apontamento.versao, area_executada_dia: '10' }));
    assert.equal(e1.apontamento.produtos[0].dose_ha, '2.5000');
    const e2 = await H.ok(H.req('PATCH', `${s.baseAp(a)}/${ap.id}`, s.token, { versao: e1.apontamento.versao, area_executada_dia: null }));
    assert.equal(e2.apontamento.produtos[0].dose_ha, null);
    const e3 = await H.ok(H.req('PATCH', `${s.baseAp(a)}/${ap.id}`, s.token, { versao: e2.apontamento.versao, area_executada_dia: '3' }));
    assert.equal(e3.apontamento.produtos[0].dose_ha, '8.3333');
  });

  test('a data do apontamento não muda com linha confirmada (409 ATIVIDADE_DATA_COM_LINHAS); turno e área mudam; sem linha confirmada, a data muda', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const c = await s.lancarLinhaOk(a, ap);
    const antes = await foto(s.c);
    const r = await H.req('PATCH', `${s.baseAp(a)}/${ap.id}`, s.token, { versao: c.apontamento.versao, data_operacional: '2027-06-12' });
    assert.deepEqual(erro(r), [409, 'ATIVIDADE_DATA_COM_LINHAS', 'data_operacional', 'data_com_linhas']);
    assert.deepEqual([r.json().details.linhas_produto, r.json().details.linhas_maquina], [1, 0]);
    assert.equal(await foto(s.c), antes);
    const t = await H.ok(H.req('PATCH', `${s.baseAp(a)}/${ap.id}`, s.token, { versao: c.apontamento.versao, turno: 'TARDE' }));
    const x = await H.ok(s.L.cancelar(a, t.apontamento, c.linha.id));
    const d = await H.ok(H.req('PATCH', `${s.baseAp(a)}/${ap.id}`, s.token, { versao: x.apontamento.versao, data_operacional: '2027-06-12' }));
    assert.equal(d.apontamento.data_operacional, '2027-06-12');
  });
});

describe('totalizador', () => {
  test('GET /atividades/:id/totais: duas passadas no mesmo dia somando; cancelados fora; custo/ha', async () => {
    const s = await montar();
    const a = await s.abrir({ area_planejada: '40' });
    const p1 = await s.lancarOk(a, { area_executada_dia: '10' });
    const p2 = await s.lancarOk(a, { area_executada_dia: '5' });
    assert.deepEqual([p1.data_operacional, p1.sequencia, p2.data_operacional, p2.sequencia], ['2027-06-10', 1, '2027-06-10', 2], 'duas passadas no mesmo dia');
    await s.lancarLinhaOk(a, p1, { quantidade: '20' }); // 20 × 5,40 (médio de 50×5,20 + 100×5,50 ÷ 150) = 108
    const c2 = await s.lancarLinhaOk(a, p2, { quantidade: '10' }); // 10 × 5,40 = 54
    const c3 = await s.lancarLinhaOk(a, c2.apontamento, { produto_id: s.adubo.id, quantidade: '4' }); // 4 × 3 = 12
    // uma linha cancelada e um apontamento cancelado não contam
    const c4 = await s.lancarLinhaOk(a, c3.apontamento, { quantidade: '1' });
    await H.ok(s.L.cancelar(a, c4.apontamento, c4.linha.id));
    const p3 = await s.lancarOk(a, { area_executada_dia: '7' });
    const c5 = await s.lancarLinhaOk(a, p3, { quantidade: '9' });
    await H.ok(H.req('POST', `${s.baseAp(a)}/${p3.id}/cancelar`, s.token, { empresa_id: a.empresa_id, versao: c5.apontamento.versao, motivo: 'repetido' }));
    const t = await H.ok(H.req('GET', `/atividades/${a.id}/totais?empresa_id=${a.empresa_id}`, s.token));
    assert.deepEqual(t, {
      area_executada: '15.0000',
      area_planejada: '40.0000',
      unidade_area: 'ha',
      produtos: [
        { produto_id: s.adubo.id, nome: 'Adubo NPK (saco)', unidade: 'KG', quantidade: '4.0000', custo_total: '12.0000' },
        { produto_id: s.herbicida.id, nome: 'Herbicida glifosato (L)', unidade: 'L', quantidade: '30.0000', custo_total: '162.0000' },
      ],
      maquinas: [],
      mao_obra: [],
      servicos: [],
      // D-PROD-211 (Fatia 5): sem abastecimento ligado, o combustível fica vazio.
      combustivel: { quantidade_l: null, quantidade_kg: null, custo_total: null },
      consumo_por_bem: [],
      custo_total: '174.0000',
      custo_por_ha: '11.6000',
      custo_combustivel_por_ha: null,
      // D-PROD-234: as parcelas do custo por tipo (só produto aqui) e os litros por ha (sem combustível, nulo).
      custo_por_tipo: { maquinas: null, produtos: '174.0000', mao_obra: null, servicos: null, combustivel: null },
      litros_combustivel_por_ha: null,
      // D-PROD-249: a atividade sem área não tem números por área.
      por_area: [],
    });
    // sem linha: custo nulo; outra fazenda → 404
    const b = await s.abrir();
    const tb = await H.ok(H.req('GET', `/atividades/${b.id}/totais?empresa_id=${b.empresa_id}`, s.token));
    assert.deepEqual([tb.area_executada, tb.produtos, tb.custo_total, tb.custo_por_ha], [null, [], null, null]);
    assert.deepEqual(erro(await H.req('GET', `/atividades/${a.id}/totais?empresa_id=${s.e2.id}`, s.token)).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
  });
});

describe('idempotência', () => {
  test('mesma operation_id e mesmo corpo → 200 replay com o mesmo corpo; corpo diferente → 409 IDEMPOTENCY_CONFLICT; nada a mais gravado', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const corpo = { empresa_id: a.empresa_id, versao: ap.versao, operation_id: opId(), produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '30' };
    const url = `${s.baseAp(a)}/${ap.id}/produtos`;
    const r1 = await H.ok(H.req('POST', url, s.token, corpo), 201);
    const depois = await foto(s.c);
    const r2 = await H.ok(H.req('POST', url, s.token, corpo), 200);
    assert.equal(r2.replay, true);
    assert.deepEqual({ ...r2, replay: false }, r1);
    assert.equal(await foto(s.c), depois);
    const r3 = await H.req('POST', url, s.token, { ...corpo, quantidade: '31' });
    assert.deepEqual(erro(r3).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    assert.equal(await foto(s.c), depois);
    // sem o recibo (expurgado), a chave gravada na linha ainda é conflito
    await prisma().operacaoIdempotente.deleteMany({ where: { cliente_id: s.c, operation_key: corpo.operation_id } });
    assert.deepEqual(erro(await H.req('POST', url, s.token, { ...corpo, versao: r1.apontamento.versao })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
  });

  test('lançamento com produtos[]: tudo numa transação com UMA operation_id; replay; linha recusada não grava nem o apontamento; sem chave → 400', async () => {
    const s = await montar();
    const a = await s.abrir();
    const op = opId();
    const corpo = {
      operation_id: op, area_executada_dia: '10',
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '30' }, { produto_id: s.adubo.id, local_estoque_id: s.local.id, quantidade: '10' }],
    };
    const r = await s.lancar(a, corpo);
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.deepEqual(Object.keys(c), ['apontamento', 'atividade', 'alertas', 'replay']);
    assert.deepEqual(c.apontamento.produtos.map((x) => [x.ordem, x.quantidade, x.unidade, x.dose_ha]), [[1, '30.0000', 'L', '3.0000'], [2, '10.0000', 'KG', '1.0000']]);
    assert.equal(c.apontamento.versao, 1);
    const linhas = await prisma().atividadeApontamentoProduto.findMany({ where: { cliente_id: s.c }, orderBy: { ordem: 'asc' } });
    assert.deepEqual(linhas.map((x) => x.operation_id), [`${op}:p1`, `${op}:p2`]);
    const depois = await foto(s.c);
    const re = await s.lancar(a, corpo);
    assert.equal(re.statusCode, 200, re.body);
    assert.equal(re.json().replay, true);
    assert.equal(await foto(s.c), depois);
    assert.deepEqual(erro(await s.lancar(a, { ...corpo, area_executada_dia: '11' })).slice(0, 2), [409, 'IDEMPOTENCY_CONFLICT']);
    // a 2ª linha sem saldo derruba tudo (nem o apontamento fica)
    const falha = await s.lancar(a, { operation_id: opId(), produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '1' }, { produto_id: s.adubo.id, local_estoque_id: s.local.id, quantidade: '999' }] });
    assert.deepEqual(erro(falha).slice(0, 2), [422, 'ESTOQUE_SALDO_INSUFICIENTE']);
    assert.deepEqual([falha.json().details.colecao, falha.json().details.indice], ['produtos', 1]);
    assert.equal(await foto(s.c), depois);
    const semChave = await s.lancar(a, { produtos: corpo.produtos });
    assert.deepEqual(erro(semChave), [400, 'REQUEST_VALIDATION_FAILED', 'operation_id', 'obrigatorio']);
    const numero = await s.lancar(a, { operation_id: opId(), produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: 3 }] });
    assert.deepEqual(erro(numero).slice(0, 2), [400, 'REQUEST_VALIDATION_FAILED']);
    assert.equal(numero.json().details.campo, 'produtos[0].quantidade');
  });

  test('repetir (duplicar) com as linhas: apontamento novo com sequência nova e as linhas do corpo, numa transação', async () => {
    const s = await montar();
    const a = await s.abrir();
    const base = (await H.ok(s.lancar(a, { area_executada_dia: '8', operation_id: opId(), produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '16' }] }), 201)).apontamento;
    const prefill = base.produtos.map((x) => ({ produto_id: x.produto_id, local_estoque_id: x.local_estoque_id, quantidade: '20' }));
    const op = opId();
    const r = await H.req('POST', `${s.baseAp(a)}/${base.id}/duplicar`, s.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', operation_id: op, produtos: prefill });
    assert.equal(r.statusCode, 201, r.body);
    const c = r.json();
    assert.deepEqual([c.apontamento.sequencia, c.apontamento.area_executada_dia, c.apontamento.produtos.length, c.apontamento.produtos[0].quantidade, c.apontamento.produtos[0].dose_ha], [2, '8.0000', 1, '20.0000', '2.5000']);
    assert.equal(await estoque(s.herbicida.id), '114.0000');
    const re = await H.req('POST', `${s.baseAp(a)}/${base.id}/duplicar`, s.token, { empresa_id: a.empresa_id, data_operacional: '2027-06-10', operation_id: op, produtos: prefill });
    assert.deepEqual([re.statusCode, re.json().replay, re.json().apontamento.id], [200, true, c.apontamento.id]);
    // sem linhas e sem chave, como na Fatia 2
    const sem = await H.ok(H.req('POST', `${s.baseAp(a)}/${base.id}/duplicar`, s.token, { empresa_id: a.empresa_id }), 201);
    assert.deepEqual(sem.apontamento.produtos, []);
  });
});

describe('lançamento com as duas linhas', () => {
  test('produtos[] e maquinas[] numa transação; o totalizador soma os dois; cancelar o apontamento derruba as duas (origem APONTAMENTO)', async () => {
    const s = await montar();
    const a = await s.abrir();
    const r = await s.lancar(a, {
      area_executada_dia: '10',
      operation_id: opId(),
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '20' }],
      maquinas: [{ bem_id: s.trator.id, leitura_inicial: '1520.5', leitura_final: '1528.5' }],
    });
    assert.equal(r.statusCode, 201, r.body);
    const ap = r.json().apontamento;
    assert.deepEqual([ap.produtos.length, ap.maquinas.length, ap.maquinas[0].quantidade_uso, ap.maquinas[0].status], [1, 1, '8.0000', 'CONFIRMADO']);
    const t = await H.ok(H.req('GET', `/atividades/${a.id}/totais?empresa_id=${a.empresa_id}`, s.token));
    assert.deepEqual(t.maquinas.map((m) => [m.bem_id, m.quantidade_uso]), [[s.trator.id, '8.0000']]);
    assert.equal(t.produtos[0].custo_total, '108.0000');
    const c = await H.ok(H.req('POST', `${s.baseAp(a)}/${ap.id}/cancelar`, s.token, { empresa_id: a.empresa_id, versao: ap.versao, motivo: 'chuva' }));
    assert.deepEqual([c.apontamento.produtos[0].cancelamento_origem, c.apontamento.maquinas[0].cancelamento_origem], ['APONTAMENTO', 'APONTAMENTO']);
    assert.equal(await estoque(s.herbicida.id), '150.0000');
    // uma linha de máquina recusada derruba tudo (nem o produto baixa)
    const antes = await foto(s.c);
    const falha = await s.lancar(a, {
      operation_id: opId(),
      produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '5' }],
      maquinas: [{ bem_id: s.trator.id, leitura_inicial: '1528.5', leitura_final: '1500' }],
    });
    assert.equal(falha.statusCode, 422, falha.body);
    assert.equal(await foto(s.c), antes);
  });
});

describe('estoque: conciliação e lote', () => {
  test('conciliação do estoque sem divergência depois de saídas, edição e estornos (lotes da compra real)', async () => {
    const s = await montar({ compra: true });
    const a = await s.abrir();
    const ap = await s.lancarOk(a, { area_executada_dia: '10' });
    const c1 = await s.lancarLinhaOk(a, ap, { quantidade: '70' });
    const c2 = await H.ok(s.L.editar(a, c1.apontamento, c1.linha.id, { quantidade: '60' }));
    const c3 = await s.lancarLinhaOk(a, c2.apontamento, { produto_id: s.adubo.id, quantidade: '15' });
    await H.ok(s.L.cancelar(a, c3.apontamento, c3.linha.id));
    const ap2 = await s.lancarOk(a, { data_operacional: '2027-06-11', operation_id: opId(), produtos: [{ produto_id: s.adubo.id, local_estoque_id: s.local.id, quantidade: '5' }] });
    void ap2;
    const ap3 = (await H.ok(s.lancar(a, { data_operacional: '2027-06-12', operation_id: opId(), produtos: [{ produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '3' }] }), 201)).apontamento;
    await H.ok(H.req('POST', `${s.baseAp(a)}/${ap3.id}/cancelar`, s.token, { empresa_id: a.empresa_id, versao: ap3.versao, motivo: 'repetido' }));
    for (const produto of [s.herbicida, s.adubo]) {
      const rel = await H.ok(H.req('GET', `/estoque-fisico/reconciliacao?empresa_id=${s.e1.id}&produto_id=${produto.id}`, s.token));
      assert.deepEqual(rel.achados, [], JSON.stringify(rel.achados));
      assert.equal(rel.resumo.por_classe.DIVERGENCIA_REAL, 0);
      assert.ok(rel.resumo.por_classe.OK > 0);
    }
    assert.deepEqual([await estoque(s.herbicida.id), await estoque(s.adubo.id)], ['90.0000', '195.0000']);
  });

  test('lote com fatia de linha de atividade: PATCH e DELETE → 409 REGISTRO_OPERACIONAL_IMUTAVEL (também depois de cancelada)', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const c = await s.lancarLinhaOk(a, ap, { quantidade: '10' });
    const patch = await H.req('PATCH', `/estoque-lotes-nota/${s.lotesH.herbicidaA}`, s.token, { quantidade_disponivel: 1000 });
    assert.deepEqual(erro(patch).slice(0, 2), [409, 'REGISTRO_OPERACIONAL_IMUTAVEL'], patch.body);
    assert.equal(patch.json().details.vinculo, 'atividade_apontamento_produto');
    assert.deepEqual(erro(await H.req('DELETE', `/estoque-lotes-nota/${s.lotesH.herbicidaA}`, s.token)).slice(0, 2), [409, 'REGISTRO_OPERACIONAL_IMUTAVEL']);
    await H.ok(s.L.cancelar(a, c.apontamento, c.linha.id));
    assert.deepEqual(erro(await H.req('PATCH', `/estoque-lotes-nota/${s.lotesH.herbicidaA}`, s.token, { quantidade_disponivel: 10 })).slice(0, 2), [409, 'REGISTRO_OPERACIONAL_IMUTAVEL']);
    // o lote B, sem fatia, segue editável pelos caminhos de sempre (nome do local)
    const nome = await H.req('PATCH', `/estoque-lotes-nota/${s.lotesH.herbicidaB}`, s.token, { local_estoque_nome: s.local.nome });
    assert.equal(nome.statusCode, 200, nome.body);
  });
});

describe('isolamento e permissões', () => {
  test('outro tenant, outra fazenda e outro apontamento: 404, nunca 403; nada gravado', async () => {
    const s = await montar();
    const outro = await montarAbastecimento(app, { lotes: false });
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const ap2 = await s.lancarOk(a, { data_operacional: '2027-06-11' });
    const c = await s.lancarLinhaOk(a, ap);
    const antes = await foto(s.c);
    const url = `${s.baseAp(a)}/${ap.id}/produtos`;
    const corpo = { versao: c.apontamento.versao, operation_id: opId(), produto_id: s.herbicida.id, local_estoque_id: s.local.id, quantidade: '1' };
    assert.deepEqual(erro(await H.req('POST', url, outro.token, { ...corpo, empresa_id: outro.e1.id })).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
    assert.deepEqual(erro(await H.req('POST', url, outro.token, { ...corpo, empresa_id: s.e1.id })).slice(0, 2), [404, 'EMPRESA_NOT_FOUND']);
    assert.deepEqual(erro(await H.req('POST', url, s.token, { ...corpo, empresa_id: s.e2.id })).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
    // a linha de outro apontamento da mesma atividade
    const r = await s.L.cancelar(a, ap2, c.linha.id);
    assert.deepEqual(erro(r).slice(0, 2), [404, 'ATIVIDADE_LINHA_NOT_FOUND']);
    assert.equal(r.json().details.entidade, 'linha_produto');
    assert.equal(await foto(s.c), antes);
    // o detalhe do apontamento traz a linha; o de outro tenant não vê
    const d = await H.ok(H.req('GET', `${s.baseAp(a)}/${ap.id}?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual(d.produtos.map((x) => x.id), [c.linha.id]);
    assert.deepEqual(erro(await H.req('GET', `/atividades/${a.id}/totais?empresa_id=${outro.e1.id}`, outro.token)).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
  });

  test('permissões: lançar/editar/cancelar a linha são as ações extras do apontamento; os seletores pedem só "ver"', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    const leitor = await s.contaTela({});
    assert.equal((await s.L.lancar(a, ap, {}, leitor.token)).statusCode, 403);
    assert.equal((await H.req('GET', `/atividades-opcoes/produtos?empresa_id=${s.e1.id}`, leitor.token)).statusCode, 200);
    assert.equal((await H.req('GET', `/atividades-opcoes/locais?empresa_id=${s.e1.id}&produto_id=${s.herbicida.id}`, leitor.token)).statusCode, 200);
    assert.equal((await H.req('GET', `/atividades/${a.id}/totais?empresa_id=${s.e1.id}`, leitor.token)).statusCode, 200);
    const lancador = await s.contaTela({ lancar_apontamento: true });
    const c = await H.ok(s.L.lancar(a, ap, {}, lancador.token), 201);
    assert.equal((await s.L.editar(a, c.apontamento, c.linha.id, { quantidade: '2' }, lancador.token)).statusCode, 403);
    assert.equal((await s.L.cancelar(a, c.apontamento, c.linha.id, {}, lancador.token)).statusCode, 403);
    const editor = await s.contaTela({ editar_apontamento: true, cancelar_apontamento: true });
    const e = await H.ok(s.L.editar(a, c.apontamento, c.linha.id, { quantidade: '2' }, editor.token));
    await H.ok(s.L.cancelar(a, e.apontamento, e.linha.id, {}, editor.token));
  });
});

describe('seletores', () => {
  test('produtos: os já usados na atividade primeiro (favorito), sem combustível; locais com saldo na unidade efetiva', async () => {
    const s = await montar();
    const a = await s.abrir();
    const ap = await s.lancarOk(a);
    await s.lancarLinhaOk(a, ap, { produto_id: s.adubo.id, quantidade: '1' });
    const r = await H.ok(H.req('GET', `/atividades-opcoes/produtos?empresa_id=${s.e1.id}&atividade_id=${a.id}`, s.token));
    assert.deepEqual(Object.keys(r), ['itens', 'has_more', 'next_cursor']);
    assert.deepEqual(r.itens[0], { id: s.adubo.id, numero: s.adubo.numero_produto, nome: 'Adubo NPK (saco)', unidade: 'KG', unidade_principal_estoque: 'SACO', estoque_atual: '199.0000', carencia_dias: null, favorito: true });
    const ids = r.itens.map((x) => x.id);
    assert.equal(ids.filter((id) => id === s.adubo.id).length, 1, 'o favorito não se repete');
    assert.ok(ids.includes(s.herbicida.id));
    for (const combustivel of [s.diesel, s.dieselKg, s.gasolina, s.etanol]) assert.ok(!ids.includes(combustivel.id), `sem combustível: ${combustivel.nome_produto}`);
    assert.ok(!ids.includes(s.herbicidaE2.id), 'só da fazenda');
    assert.ok(r.itens.slice(1).every((x) => x.favorito === false));
    // busca
    const q = await H.ok(H.req('GET', `/atividades-opcoes/produtos?empresa_id=${s.e1.id}&atividade_id=${a.id}&q=glifo`, s.token));
    assert.deepEqual(q.itens.map((x) => x.id), [s.herbicida.id]);
    // atividade de outra fazenda → 404
    assert.deepEqual(erro(await H.req('GET', `/atividades-opcoes/produtos?empresa_id=${s.e2.id}&atividade_id=${a.id}`, s.token)).slice(0, 2), [404, 'ATIVIDADE_NOT_FOUND']);
    const locais = await H.ok(H.req('GET', `/atividades-opcoes/locais?empresa_id=${s.e1.id}&produto_id=${s.adubo.id}`, s.token));
    assert.deepEqual(locais.itens, [{ local_estoque_id: s.local.id, local_nome: s.local.nome, disponivel: '199.0000', unidade: 'KG', unidade_principal_estoque: 'SACO' }]);
    assert.deepEqual(erro(await H.req('GET', `/atividades-opcoes/locais?empresa_id=${s.e1.id}&produto_id=${s.herbicidaE2.id}`, s.token)).slice(0, 2), [404, 'PRODUTO_NOT_FOUND']);
  });
});
