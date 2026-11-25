/**
 * D-PROD-155 — MAIKE Gestão P3-01: Central Única de Lançamentos (núcleo).
 * PostgreSQL real, HTTP autenticado, prova por persistência.
 *
 * Aceite da missão:
 *  1. PAGAR sem produtos, a prazo, 500 com rateio 300/200;
 *  2. RECEBER sem produtos, 900 em 3 × 300;
 *  3. PAGAR com produtos: 100 SACO × 80 (30 kg/saco) → lote + movimento +
 *     `estoque_atual` +3000 kg;
 *  4. RECEBER com produtos: 5 kg por FIFO em 2 lotes; sem saldo → 422 sem efeito;
 *  5. À vista em aberto + baixa parcial + estorno (e cancelamento bloqueado);
 *  6. falha forçada na última escrita (trigger temporário em TituloFinanceiro)
 *     → rollback total; retentativa idempotente.
 * Regressão: suplementação × venda no mesmo produto sem lost update.
 * Mais: anti-coerção de tipos, escala da moeda, perfil, exclusões (§8.5).
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { criarApp, criarTenant, limparBanco, encerrar, autenticarNoApp } from './helpers.mjs';
import { getPrismaClient } from '../src/database/prismaClient.js';

/** @type {import('fastify').FastifyInstance} */
let app;
const prisma = () => getPrismaClient();
before(async () => {
  app = await criarApp();
  await app.ready();
});
after(async () => {
  await app.close();
  await encerrar();
});
beforeEach(async () => {
  await limparBanco();
});

const req = (metodo, url, token, payload) =>
  app.inject({ method: metodo, url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload !== undefined ? { payload } : {}) });
const ok = async (r, status = 200) => {
  const x = await r;
  assert.equal(x.statusCode, status, x.body);
  return x.json();
};
const codigo = (r) => r.json().code;
const motivo = (r) => r.json().reason ?? r.json().details?.reason;
const opId = () => `op-${randomUUID()}`;

/** Tenant com empresa (fuso SP), perfil BR/BRL, parceiros, naturezas, centros, local e produtos. */
const cenario = async () => {
  const p = prisma();
  const adm = await criarTenant({ papelTenant: 'administrador' });
  const c = adm.cliente.id;
  const e1 = await p.empresa.create({ data: { cliente_id: c, numero_empresa: 1, apelido: 'E1', nome: `Fazenda 1 ${c}`, fuso_horario: 'America/Sao_Paulo' } });
  const token = (await autenticarNoApp(app, adm.credenciais)).corpo.token;
  const base = { cliente_id: c, empresa_id: e1.id };
  const forn = await p.fornecedor.create({ data: { ...base, numero_cadastro: '1', tipo_pessoa: 'Jurídica', nome: 'AGRO INSUMOS', tipos: ['fornecedor'] } });
  const cli = await p.fornecedor.create({ data: { ...base, numero_cadastro: '2', tipo_pessoa: 'Jurídica', nome: 'FRIGORIFICO', tipos: ['cliente'] } });
  const desp = await p.naturezaFinanceira.create({ data: { ...base, numero: '1', tipo: 'DESPESA', nome: 'INSUMOS' } });
  const desp2 = await p.naturezaFinanceira.create({ data: { ...base, numero: '2', tipo: 'DESPESA', nome: 'FRETE' } });
  const rec = await p.naturezaFinanceira.create({ data: { ...base, numero: '3', tipo: 'RECEITA', nome: 'VENDA DE INSUMOS' } });
  const cc = await p.centroCusto.create({ data: { ...base, numero: '1', nome: 'REBANHO' } });
  const cr = await p.centroResultado.create({ data: { ...base, numero: '1', nome: 'CRIA' } });
  const local = await p.localEstoque.create({ data: { cliente_id: c, numero_local: '1', nome: 'DEPOSITO CENTRAL' } });
  const racao = await p.produto.create({ data: { ...base, numero_produto: '1', nome_produto: 'RACAO', unidade_principal_estoque: 'SACO', peso_por_saco_kg: '30' } });
  const sal = await p.produto.create({ data: { ...base, numero_produto: '2', nome_produto: 'SAL MINERAL', unidade_principal_estoque: 'KG' } });
  await ok(req('PUT', '/perfis-financeiros-empresa', token, { empresa_id: e1.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
  return { c, e1, token, forn, cli, desp, desp2, rec, cc, cr, local, racao, sal };
};

const pagarSemProdutos = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  direcao: 'PAGAR',
  conteudo: 'SEM_PRODUTOS',
  condicao: 'PRAZO',
  parceiro_id: s.forn.id,
  data_emissao: '2027-06-10',
  documento_referencia: ' nf-100 ',
  valor_bruto: '500.00',
  rateio_modo: 'VALOR',
  rateios: [{ natureza_id: s.desp.id, centro_custo_id: s.cc.id, centro_resultado_id: s.cr.id, valor: '300.00' }, { natureza_id: s.desp2.id, valor: '200.00' }],
  parcelas: [{ vencimento: '2027-07-10', valor: '500.00' }],
  ...extra,
});

/** Compra/venda de mercadoria (1 item). */
const comProdutos = (s, { direcao = 'PAGAR', produto = s.sal, unidade = 'KG', quantidade, valorUnitario, total, dia = '2027-06-10', parceiro } = /** @type {any} */ ({})) => ({
  empresa_id: s.e1.id,
  direcao,
  conteudo: 'COM_PRODUTOS',
  condicao: 'PRAZO',
  parceiro_id: (parceiro ?? (direcao === 'PAGAR' ? s.forn : s.cli)).id,
  data_emissao: dia,
  data_operacional: dia,
  efeito_fisico_confirmado: true,
  itens: [{ tipo_item: 'MERCADORIA', produto_id: produto.id, local_estoque_id: s.local.id, unidade, quantidade, valor_unitario: valorUnitario }],
  rateio_modo: 'PERCENTUAL',
  rateios: [{ natureza_id: (direcao === 'PAGAR' ? s.desp : s.rec).id, percentual: '100' }],
  parcelas: [{ vencimento: '2027-07-10', valor: total }],
});

const criar = (s, doc, token = s.token) => ok(req('POST', '/operacoes-financeiras', token, { ...doc, operation_id: opId() }), 201);
const confirmar = (s, d, extra = {}, token = s.token) =>
  req('POST', `/operacoes-financeiras/${d.id}/confirmar`, token, { empresa_id: s.e1.id, operation_id: opId(), versao: d.versao, ...extra });
const comprarEConfirmar = async (s, opcoes) => ok(confirmar(s, await criar(s, comProdutos(s, opcoes))));

/** Estado do estoque do tenant (movimentos, lotes e estoque_atual por produto). */
const fotoEstoque = async (s) => {
  const p = prisma();
  const w = { where: { cliente_id: s.c } };
  const produtos = await p.produto.findMany({ ...w, select: { id: true, estoque_atual: true }, orderBy: { id: 'asc' } });
  const lotes = await p.estoqueLoteNota.findMany({ ...w, select: { id: true, quantidade_disponivel: true, status: true }, orderBy: { id: 'asc' } });
  return JSON.stringify({ mov: await p.movimentacaoEstoque.count(w), lotes, produtos });
};

// ─────────────────────────────────────────────────────────────────────────────
describe('aceite — fluxos da Central Única de Lançamentos', () => {
  test('1. PAGAR sem produtos a prazo 500 com rateio 300/200: rascunho, prévia, confirmação; nenhum efeito de estoque', async () => {
    const s = await cenario();
    const antes = await fotoEstoque(s);
    const d = await criar(s, pagarSemProdutos(s));
    assert.equal(d.status, 'RASCUNHO');
    assert.equal(d.documento_referencia, 'NF-100', 'documento em MAIÚSCULAS, aparado');
    assert.equal(d.valor_total, '500.00');
    assert.deepEqual(d.rateios.map((r) => [r.valor, r.percentual]), [['300.00', '60.000000'], ['200.00', '40.000000']]);
    assert.deepEqual(d.titulos.map((t) => [t.status, t.valor, t.vencimento]), [['PREVISTO', '500.00', '2027-07-10']]);
    assert.equal(d.criado_por.login.length > 0, true);
    // modo VALOR: percentual NÃO é gravado (informativo só na leitura)
    const linhas = await prisma().operacaoFinanceiraRateio.findMany({ where: { operacao_id: d.id } });
    assert.ok(linhas.every((l) => l.percentual === null));

    const prev = await ok(req('POST', `/operacoes-financeiras/${d.id}/previa`, s.token, { empresa_id: s.e1.id }));
    assert.deepEqual(prev.bloqueios, []);
    assert.equal(prev.plano.resumo.parcelas_n, 1);
    assert.equal(prev.plano.resumo.itens_estoque_n, 0);
    assert.equal(prev.plano.resumo.valor_titulos, '500.00');

    const conf = await ok(confirmar(s, d));
    assert.equal(conf.status, 'CONFIRMADO');
    assert.equal(conf.replay, false);
    assert.ok(conf.confirmado_em && conf.confirmado_por);
    assert.deepEqual(conf.titulos.map((t) => [t.status, t.saldo, t.valor_liquidado]), [['ABERTO', '500.00', '0.00']]);
    assert.deepEqual(conf.historico.map((h) => h.acao), ['operacao_financeira.criar', 'operacao_financeira.confirmar']);
    assert.equal(await fotoEstoque(s), antes, 'documento sem mercadoria não movimenta estoque');

    const lista = await ok(req('GET', `/operacoes-financeiras?empresa_id=${s.e1.id}`, s.token));
    assert.equal(lista.total, 1);
    assert.deepEqual(
      { saldo: lista.items[0].saldo_aberto, prox: lista.items[0].proximo_vencimento, est: lista.items[0].tem_estoque, emissao: lista.items[0].data_emissao },
      { saldo: '500.00', prox: '2027-07-10', est: false, emissao: '2027-06-10' }
    );
    // auditoria por allowlist: nada de texto livre/nome
    const log = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, acao: 'operacao_financeira.confirmar' } });
    assert.doesNotMatch(JSON.stringify(log.dados_novos), /AGRO|NF-100|INSUMOS/);
    // duplicidade documental: outro CONFIRMADO com o mesmo documento/parceiro/direção
    const d2 = await criar(s, pagarSemProdutos(s));
    const prev2 = await ok(req('POST', `/operacoes-financeiras/${d2.id}/previa`, s.token, { empresa_id: s.e1.id }));
    assert.deepEqual(prev2.bloqueios.map((b) => b.code), ['OPERACAO_DOCUMENTO_DUPLICADO']);
    const dup = await confirmar(s, d2);
    assert.equal(dup.statusCode, 409);
    assert.equal(codigo(dup), 'OPERACAO_DOCUMENTO_DUPLICADO');
  });

  test('2. RECEBER sem produtos 900 em 3 × 300 (parcelado, rateio percentual); soma errada → 422 ao centavo', async () => {
    const s = await cenario();
    const doc = {
      ...pagarSemProdutos(s),
      direcao: 'RECEBER',
      condicao: 'PARCELADO',
      parceiro_id: s.cli.id,
      documento_referencia: null,
      valor_bruto: '900.00',
      rateio_modo: 'PERCENTUAL',
      rateios: [{ natureza_id: s.rec.id, percentual: '100' }],
      parcelas: [{ vencimento: '2027-07-10', valor: '300.00' }, { vencimento: '2027-08-10', valor: '300.00' }, { vencimento: '2027-09-10', valor: '300.00' }],
    };
    const errado = await req('POST', '/operacoes-financeiras', s.token, { ...doc, parcelas: [...doc.parcelas.slice(0, 2), { vencimento: '2027-09-10', valor: '299.99' }], operation_id: opId() });
    assert.equal(errado.statusCode, 422, errado.body);
    assert.equal(codigo(errado), 'OPERACAO_PARCELAS_INVALIDAS');
    assert.equal(motivo(errado), 'soma_diferente');
    assert.deepEqual([errado.json().details.esperado, errado.json().details.diferenca], ['900.00', '0.01']);
    // parceiro sem papel cliente não recebe
    const semPapel = await req('POST', '/operacoes-financeiras', s.token, { ...doc, parceiro_id: s.forn.id, operation_id: opId() });
    assert.equal(semPapel.statusCode, 422);
    assert.deepEqual([codigo(semPapel), semPapel.json().field, motivo(semPapel)], ['OPERACAO_REFERENCIA_INVALIDA', 'parceiro_id', 'parceiro_sem_papel']);
    assert.equal(await prisma().operacaoFinanceira.count({ where: { cliente_id: s.c } }), 0, 'nada gravado nas recusas');

    const d = await criar(s, doc);
    assert.deepEqual(d.rateios.map((r) => [r.valor, r.percentual, r.natureza_tipo]), [['900.00', '100.000000', 'RECEITA']]);
    const conf = await ok(confirmar(s, d));
    assert.deepEqual(conf.titulos.map((t) => [t.numero_parcela, t.total_parcelas, t.status, t.valor]), [
      [1, 3, 'ABERTO', '300.00'], [2, 3, 'ABERTO', '300.00'], [3, 3, 'ABERTO', '300.00'],
    ]);
  });

  test('3. PAGAR com produtos: 100 SACO × 80 (30 kg/saco) → lote, movimento e estoque_atual +3000 kg; preco_custo intocado', async () => {
    const s = await cenario();
    const d = await criar(s, comProdutos(s, { produto: s.racao, unidade: 'SACO', quantidade: '100', valorUnitario: '80', total: '8000.00' }));
    assert.deepEqual(
      [d.itens[0].fator_kg, d.itens[0].quantidade_estoque, d.itens[0].valor_total, d.itens[0].valor_unitario, d.data_operacional],
      ['30.0000', '3000.0000', '8000.00', '80.000000', '2027-06-10']
    );
    const prev = await ok(req('POST', `/operacoes-financeiras/${d.id}/previa`, s.token, { empresa_id: s.e1.id }));
    assert.deepEqual(prev.bloqueios, []);
    assert.deepEqual(prev.plano.efeitos_estoque.entradas.map((e) => [e.kg, e.custo_kg]), [['3000.0000', '2.6667']]);

    const conf = await ok(confirmar(s, d));
    const item = conf.itens[0];
    assert.ok(item.movimentacao_estoque_id && item.estoque_lote_nota_id);
    const lote = await prisma().estoqueLoteNota.findUnique({ where: { id: item.estoque_lote_nota_id } });
    assert.deepEqual(
      [lote.quantidade_entrada.toFixed(4), lote.quantidade_disponivel.toFixed(4), lote.custo_unitario.toFixed(4), lote.status, lote.data_documento.toISOString().slice(0, 10)],
      ['3000.0000', '3000.0000', '2.6667', 'Disponivel', '2027-06-10']
    );
    assert.equal(lote.movimentacao_entrada_id, item.movimentacao_estoque_id);
    assert.equal(lote.empresa_id, s.e1.id);
    const mov = await prisma().movimentacaoEstoque.findUnique({ where: { id: item.movimentacao_estoque_id } });
    assert.deepEqual(
      [mov.tipo_movimentacao, mov.tipo_detalhado, mov.quantidade.toFixed(4), mov.valor_total.toFixed(4), mov.valor_unitario.toFixed(4), mov.unidade_medida, mov.origem_sistema, mov.lancamento_origem_id, mov.local_estoque_destino, mov.status],
      ['Entrada', 'compra_financeiro', '3000.0000', '8000.0000', '2.6667', 'KG', 'operacao_financeira', d.id, s.local.id, 'Ativa']
    );
    assert.equal(mov.data_movimentacao.toISOString(), '2027-06-10T12:00:00.000Z');
    const produto = await prisma().produto.findUnique({ where: { id: s.racao.id } });
    assert.equal(produto.estoque_atual.toFixed(4), '3000.0000');
    assert.equal(produto.preco_custo, null, 'o comando composto NÃO altera preco_custo');
    // cancelamento com o lote intocado: estorno vinculado, lote 'Estornado', estoque volta
    const canc = await ok(req('POST', `/operacoes-financeiras/${d.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'lançado em duplicidade' }));
    assert.equal(canc.status, 'CANCELADO');
    assert.ok(canc.itens[0].movimentacao_estorno_id);
    assert.deepEqual(canc.titulos.map((t) => t.status), ['CANCELADO']);
    const est = await prisma().movimentacaoEstoque.findUnique({ where: { id: canc.itens[0].movimentacao_estorno_id } });
    assert.deepEqual([est.tipo_movimentacao, est.tipo_detalhado, est.movimento_pai_id], ['Saída', 'estorno_compra', mov.id]);
    assert.equal(est.data_movimentacao.toISOString(), '2027-06-15T12:00:00.000Z', 'estorno na data de HOJE da fazenda');
    const original = await prisma().movimentacaoEstoque.findUnique({ where: { id: mov.id } });
    assert.deepEqual([original.status, original.movimento_filho_id], ['Estornada', est.id]);
    const loteDepois = await prisma().estoqueLoteNota.findUnique({ where: { id: lote.id } });
    assert.deepEqual([loteDepois.status, loteDepois.quantidade_disponivel.toFixed(4)], ['Estornado', '0.0000']);
    assert.equal((await prisma().produto.findUnique({ where: { id: s.racao.id } })).estoque_atual.toFixed(4), '0.0000');
    const log = await prisma().auditLog.findFirst({ where: { cliente_id: s.c, acao: 'operacao_financeira.cancelar' } });
    assert.equal(log.dados_novos.motivo_informado, true);
    assert.doesNotMatch(JSON.stringify(log.dados_novos), /duplicidade/);
  });

  test('4. RECEBER com produtos: 5 kg baixados de 2 lotes a custo médio (nunca o preço de venda); sem saldo → 422 sem nenhum efeito', async () => {
    const s = await cenario();
    await comprarEConfirmar(s, { quantidade: '3', valorUnitario: '10', total: '30.00', dia: '2027-06-01' });
    await comprarEConfirmar(s, { quantidade: '4', valorUnitario: '12', total: '48.00', dia: '2027-06-05' });
    const lotes = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: s.sal.id }, orderBy: { data_documento: 'asc' } });
    assert.equal(lotes.length, 2);

    const venda = await criar(s, comProdutos(s, { direcao: 'RECEBER', quantidade: '5', valorUnitario: '20', total: '100.00' }));
    const prev = await ok(req('POST', `/operacoes-financeiras/${venda.id}/previa`, s.token, { empresa_id: s.e1.id }));
    assert.deepEqual(prev.bloqueios, []);
    assert.deepEqual(prev.plano.efeitos_estoque.saidas[0].fatias.map((f) => [f.lote_id, f.quantidade]), [[lotes[0].id, '3.0000'], [lotes[1].id, '2.0000']]);
    const conf = await ok(confirmar(s, venda));
    assert.deepEqual(conf.itens[0].consumos.map((k) => [k.estoque_lote_nota_id, k.quantidade, k.custo_unitario]).sort(), [
      [lotes[0].id, '3.0000', '11.1429'], [lotes[1].id, '2.0000', '11.1429'], // médio (30 + 48) ÷ 7
    ].sort());
    assert.equal(conf.itens[0].estoque_lote_nota_id, null, 'a saída não cria lote');
    const mov = await prisma().movimentacaoEstoque.findUnique({ where: { id: conf.itens[0].movimentacao_estoque_id } });
    assert.deepEqual(
      [mov.tipo_movimentacao, mov.tipo_detalhado, mov.quantidade.toFixed(4), mov.valor_total.toFixed(4), mov.valor_unitario.toFixed(4), mov.cliente_nome, mov.local_estoque_origem],
      ['Saída', 'venda_financeiro', '5.0000', '55.7145', '11.1429', 'FRIGORIFICO', s.local.id]
    );
    const [a, b] = await Promise.all(lotes.map((l) => prisma().estoqueLoteNota.findUnique({ where: { id: l.id } })));
    assert.deepEqual([a.status, a.quantidade_disponivel.toFixed(4), b.status, b.quantidade_disponivel.toFixed(4)], ['Esgotado', '0.0000', 'Disponivel', '2.0000']);
    assert.equal((await prisma().produto.findUnique({ where: { id: s.sal.id } })).estoque_atual.toFixed(4), '2.0000');

    // sem saldo: 422 e NENHUM efeito (rascunho intacto, estoque intacto)
    const semSaldo = await criar(s, comProdutos(s, { direcao: 'RECEBER', quantidade: '5', valorUnitario: '20', total: '100.00' }));
    const prev2 = await ok(req('POST', `/operacoes-financeiras/${semSaldo.id}/previa`, s.token, { empresa_id: s.e1.id }));
    assert.deepEqual(prev2.bloqueios.map((x) => [x.code, x.reason]), [
      ['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente'], ['ESTOQUE_SALDO_INSUFICIENTE', 'estoque_atual_insuficiente'],
    ]);
    const antes = await fotoEstoque(s);
    const r = await confirmar(s, semSaldo);
    assert.equal(r.statusCode, 422, r.body);
    assert.deepEqual([codigo(r), motivo(r), r.json().field], ['ESTOQUE_SALDO_INSUFICIENTE', 'saldo_lote_insuficiente', 'quantidade']);
    assert.deepEqual([r.json().details.disponivel, r.json().details.solicitado, r.json().details.colecao, r.json().details.indice], ['2.0000', '5.0000', 'itens', 0]);
    assert.equal(await fotoEstoque(s), antes);
    const ainda = await ok(req('GET', `/operacoes-financeiras/${semSaldo.id}?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual([ainda.status, ainda.titulos[0].status, ainda.itens[0].movimentacao_estoque_id], ['RASCUNHO', 'PREVISTO', null]);

    // venda cancelada devolve cada fatia ao SEU lote
    const canc = await ok(req('POST', `/operacoes-financeiras/${venda.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'devolvido' }));
    assert.equal(canc.status, 'CANCELADO');
    const [a2, b2] = await Promise.all(lotes.map((l) => prisma().estoqueLoteNota.findUnique({ where: { id: l.id } })));
    assert.deepEqual([a2.status, a2.quantidade_disponivel.toFixed(4), b2.status, b2.quantidade_disponivel.toFixed(4)], ['Disponivel', '3.0000', 'Disponivel', '4.0000']);
    assert.equal((await prisma().produto.findUnique({ where: { id: s.sal.id } })).estoque_atual.toFixed(4), '7.0000');
    // comprar e consumir: cancelar a COMPRA consumida pela venda de depois → 409 registro posterior, nada muda.
    // D-PROD-313: o saldo negativo (D-PROD-273 fatia 5: sem a compra, a venda de 7,5 kg de 8 deixaria −0,5) agora é
    // precedido pela recusa do registro posterior: a venda ainda vale e tem de sair primeiro.
    const compra3 = await comprarEConfirmar(s, { quantidade: '1', valorUnitario: '10', total: '10.00', dia: '2027-06-02' });
    const venda2 = await comprarEConfirmar(s, { direcao: 'RECEBER', quantidade: '7.5', valorUnitario: '20', total: '150.00' });
    const antesCanc = await fotoEstoque(s);
    const consumida = await req('POST', `/operacoes-financeiras/${compra3.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'erro' });
    assert.equal(consumida.statusCode, 409, consumida.body);
    assert.deepEqual([codigo(consumida), motivo(consumida), consumida.json().details?.posterior_id], ['ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR', 'registro_posterior', venda2.itens[0].movimentacao_estoque_id]);
    assert.equal(await fotoEstoque(s), antesCanc);
    assert.equal((await prisma().operacaoFinanceira.findUnique({ where: { id: compra3.id } })).status, compra3.status, 'a compra continua confirmada');
    // do mais recente para o mais antigo: cancelada a venda, depois da compra só resta o par já excluído → a compra sai
    assert.equal((await ok(req('POST', `/operacoes-financeiras/${venda2.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'erro' }))).status, 'CANCELADO');
    assert.equal((await ok(req('POST', `/operacoes-financeiras/${compra3.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'erro' }))).status, 'CANCELADO');
    assert.equal((await prisma().produto.findUnique({ where: { id: s.sal.id } })).estoque_atual.toFixed(4), '7.0000');
  });

  test('5. à vista em aberto: baixa parcial, saldo excedido, data futura, estorno (uma vez só), cancelamento só sem baixa ativa', async () => {
    const s = await cenario();
    const d = await criar(s, pagarSemProdutos(s, { condicao: 'AVISTA', documento_referencia: null, valor_bruto: '1000.00', rateios: [{ natureza_id: s.desp.id, valor: '1000.00' }], parcelas: [{ vencimento: '2027-06-10', valor: '1000.00' }] }));
    const conf = await ok(confirmar(s, d));
    const titulo = conf.titulos[0];
    assert.equal(titulo.status, 'ABERTO');
    const liquidar = (corpo, operationId = opId()) =>
      req('POST', `/titulos-financeiros/${titulo.id}/liquidacoes`, s.token, { empresa_id: s.e1.id, operation_id: operationId, data: '2027-06-12', metodo: 'PIX', ...corpo });

    const parcial = await ok(liquidar({ valor: '400.00', referencia: 'comprovante 1' }), 201);
    assert.deepEqual([parcial.titulos[0].status, parcial.titulos[0].valor_liquidado, parcial.titulos[0].saldo], ['PARCIAL', '400.00', '600.00']);
    const liq = parcial.titulos[0].liquidacoes[0];
    assert.deepEqual([liq.tipo, liq.valor, liq.metodo, liq.data, liq.estornada], ['LIQUIDACAO', '400.00', 'PIX', '2027-06-12', false]);

    const excede = await liquidar({ valor: '600.01' });
    assert.equal(excede.statusCode, 422);
    assert.deepEqual([codigo(excede), excede.json().details.saldo], ['LIQUIDACAO_EXCEDE_SALDO', '600.00']);
    const futura = await liquidar({ valor: '10.00', data: '2027-06-16' });
    assert.equal(futura.statusCode, 422);
    assert.deepEqual([codigo(futura), futura.json().details.hoje], ['FINANCEIRO_DATA_FUTURA', '2027-06-15']);
    const casas = await liquidar({ valor: '10.001' });
    assert.equal(casas.statusCode, 400);
    assert.equal(motivo(casas), 'casas_decimais_excedidas');

    const bloqueado = await req('POST', `/operacoes-financeiras/${d.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'teste' });
    assert.equal(bloqueado.statusCode, 409);
    assert.equal(codigo(bloqueado), 'OPERACAO_COM_LIQUIDACOES');

    const chaveEstorno = opId();
    const estornar = (operationId) => req('POST', `/liquidacoes-financeiras/${liq.id}/estorno`, s.token, { empresa_id: s.e1.id, operation_id: operationId, motivo: 'pago em duplicidade' });
    const est = await ok(estornar(chaveEstorno), 201);
    assert.deepEqual([est.titulos[0].status, est.titulos[0].valor_liquidado, est.titulos[0].saldo], ['ABERTO', '0.00', '1000.00']);
    assert.deepEqual(est.titulos[0].liquidacoes.map((l) => [l.tipo, l.estornada, l.estorna_liquidacao_id]), [['LIQUIDACAO', true, null], ['ESTORNO', false, liq.id]]);
    const replay = await ok(estornar(chaveEstorno), 201);
    assert.equal(replay.replay, true);
    const deNovo = await estornar(opId());
    assert.equal(deNovo.statusCode, 409);
    assert.equal(codigo(deNovo), 'LIQUIDACAO_JA_ESTORNADA');
    assert.equal(await prisma().liquidacaoFinanceiraEstorno.count({ where: { cliente_id: s.c } }), 1);

    const canc = await ok(req('POST', `/operacoes-financeiras/${d.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'desistência' }));
    assert.deepEqual([canc.status, canc.titulos[0].status, canc.titulos[0].saldo], ['CANCELADO', 'CANCELADO', '0.00']);
    const depois = await liquidar({ valor: '1.00' });
    assert.equal(depois.statusCode, 409);
    assert.equal(codigo(depois), 'TITULO_NAO_LIQUIDAVEL');
    // fatos imutáveis: a liquidação continua lá, com o estorno
    assert.equal(await prisma().liquidacaoFinanceira.count({ where: { cliente_id: s.c } }), 1);
  });

  test('5b. à vista com baixa no ato: exige a ação liquidar, método do perfil e data ≤ hoje; título QUITADO; só à vista', async () => {
    const s = await cenario();
    const avista = (extra = {}) => pagarSemProdutos(s, { condicao: 'AVISTA', documento_referencia: null, parcelas: [{ vencimento: '2027-06-10', valor: '500.00' }], ...extra });
    const p = prisma();
    const hash = (await p.usuario.findFirst({ where: { cliente_id: s.c } })).senha_hash;
    const login = `op-${randomUUID().slice(0, 8)}`;
    await p.usuario.create({ data: { cliente_id: s.c, nome: 'Op', login, senha_hash: hash, papel_tenant: 'usuario' } });
    await p.permissao.create({
      data: {
        cliente_id: s.c, user_email: login, user_nome: 'Op', modulos_permitidos: ['gestao-rural'],
        permissoes_telas: [{ modulo_id: 'gestao-rural', tela_id: 'ges-lancamentos-financeiros', visualizar: true, novo: true, confirmar: true }],
      },
    });
    const semLiquidar = (await autenticarNoApp(app, { login, senha: 'senha-de-teste-1' })).corpo.token;
    const d = await criar(s, avista(), semLiquidar);
    const negado = await confirmar(s, d, { baixa_no_ato: { metodo: 'DINHEIRO', data: '2027-06-10' } }, semLiquidar);
    assert.deepEqual([negado.statusCode, codigo(negado)], [403, 'ACAO_NAO_PERMITIDA']);
    assert.equal((await p.operacaoFinanceira.findUnique({ where: { id: d.id } })).status, 'RASCUNHO', 'a negação desfaz tudo');
    const futura = await confirmar(s, d, { baixa_no_ato: { metodo: 'DINHEIRO', data: '2027-06-16' } });
    assert.deepEqual([futura.statusCode, codigo(futura)], [422, 'FINANCEIRO_DATA_FUTURA']);
    const conf = await ok(confirmar(s, d, { baixa_no_ato: { metodo: 'PIX', data: '2027-06-10', referencia: 'pix 123' } }));
    assert.deepEqual([conf.titulos[0].status, conf.titulos[0].valor_liquidado, conf.titulos[0].saldo], ['QUITADO', '500.00', '0.00']);
    assert.deepEqual(conf.titulos[0].liquidacoes.map((l) => [l.tipo, l.valor, l.metodo, l.referencia]), [['LIQUIDACAO', '500.00', 'PIX', 'pix 123']]);
    const prazo = await criar(s, pagarSemProdutos(s, { documento_referencia: null }));
    const soAvista = await confirmar(s, prazo, { baixa_no_ato: { metodo: 'PIX', data: '2027-06-10' } });
    assert.deepEqual([soAvista.statusCode, motivo(soAvista)], [400, 'baixa_no_ato_so_avista']);
  });

  test('6. falha forçada na última escrita (trigger temporário em TituloFinanceiro): rollback total; retentativa idempotente aplica UMA vez', async () => {
    const s = await cenario();
    const p = prisma();
    await p.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION p3_falha_forcada() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'falha forçada P3-01'; END $f$`);
    const doc = comProdutos(s, { produto: s.racao, unidade: 'SACO', quantidade: '100', valorUnitario: '80', total: '8000.00' });
    const chaveCriar = opId();
    try {
      // (a) último INSERT do rascunho (títulos) falha → nada do documento fica
      await p.$executeRawUnsafe('CREATE TRIGGER p3_falha_insert BEFORE INSERT ON "TituloFinanceiro" FOR EACH ROW EXECUTE FUNCTION p3_falha_forcada()');
      const r0 = await req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: chaveCriar });
      assert.equal(r0.statusCode, 500, r0.body);
      for (const m of ['operacaoFinanceira', 'operacaoFinanceiraItem', 'operacaoFinanceiraRateio', 'tituloFinanceiro', 'operacaoIdempotente']) {
        assert.equal(await p[m].count({ where: { cliente_id: s.c } }), 0, `${m} desfeito`);
      }
      await p.$executeRawUnsafe('DROP TRIGGER p3_falha_insert ON "TituloFinanceiro"');
      const criado = await ok(req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: chaveCriar }), 201);
      const replayCriar = await ok(req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: chaveCriar }), 200);
      assert.deepEqual([replayCriar.id, replayCriar.replay], [criado.id, true]);

      // (b) a confirmação falha na promoção dos títulos (depois de lote, movimento e estoque) → tudo desfeito
      const antes = await fotoEstoque(s);
      await p.$executeRawUnsafe('CREATE TRIGGER p3_falha_update BEFORE UPDATE ON "TituloFinanceiro" FOR EACH ROW EXECUTE FUNCTION p3_falha_forcada()');
      const chave = opId();
      const corpo = { empresa_id: s.e1.id, operation_id: chave, versao: criado.versao };
      const r1 = await req('POST', `/operacoes-financeiras/${criado.id}/confirmar`, s.token, corpo);
      assert.equal(r1.statusCode, 500, r1.body);
      assert.equal(await fotoEstoque(s), antes, 'lote, movimento e estoque_atual desfeitos');
      const ainda = await p.operacaoFinanceira.findUnique({ where: { id: criado.id } });
      assert.deepEqual([ainda.status, ainda.versao], ['RASCUNHO', criado.versao]);
      assert.equal(await p.operacaoIdempotente.count({ where: { cliente_id: s.c, tipo_operacao: 'confirmar_operacao_financeira' } }), 0);
      await p.$executeRawUnsafe('DROP TRIGGER p3_falha_update ON "TituloFinanceiro"');

      const r2 = await ok(req('POST', `/operacoes-financeiras/${criado.id}/confirmar`, s.token, corpo));
      assert.deepEqual([r2.status, r2.replay], ['CONFIRMADO', false]);
      const r3 = await ok(req('POST', `/operacoes-financeiras/${criado.id}/confirmar`, s.token, corpo));
      assert.deepEqual([r3.status, r3.replay, r3.itens[0].movimentacao_estoque_id], ['CONFIRMADO', true, r2.itens[0].movimentacao_estoque_id]);
      assert.equal(await p.movimentacaoEstoque.count({ where: { cliente_id: s.c } }), 1, 'efeito aplicado UMA vez');
      assert.equal((await p.produto.findUnique({ where: { id: s.racao.id } })).estoque_atual.toFixed(4), '3000.0000');
      // mesma chave com corpo diferente → conflito, nunca outro efeito
      const outra = await req('POST', `/operacoes-financeiras/${criado.id}/confirmar`, s.token, { ...corpo, versao: criado.versao + 1 });
      assert.equal(outra.statusCode, 409);
      assert.equal(codigo(outra), 'IDEMPOTENCY_CONFLICT');
    } finally {
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS p3_falha_insert ON "TituloFinanceiro"');
      await p.$executeRawUnsafe('DROP TRIGGER IF EXISTS p3_falha_update ON "TituloFinanceiro"');
      await p.$executeRawUnsafe('DROP FUNCTION IF EXISTS p3_falha_forcada()');
    }
  });
});

describe('regressão — trava única do produto (suplementação × venda)', () => {
  test('suplementação e venda simultâneas no mesmo produto: nenhum lost update em estoque_atual nem nos lotes', async () => {
    const s = await cenario();
    await comprarEConfirmar(s, { quantidade: '100', valorUnitario: '2', total: '200.00', dia: '2027-06-01' });
    const suplementar = () =>
      req('POST', '/movimentacoes-estoque/comandos/saida-suplementacao', s.token, {
        operation_id: opId(), empresa_id: s.e1.id, produto_id: s.sal.id, local_origem_id: s.local.id, quantidade: 5,
      });
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const venda = await criar(s, comProdutos(s, { direcao: 'RECEBER', quantidade: '10', valorUnitario: '20', total: '200.00' }));
      const respostas = await Promise.all([suplementar(), confirmar(s, venda), suplementar()]);
      assert.deepEqual(respostas.map((r) => r.statusCode), [201, 200, 201], respostas.map((r) => r.body).join('\n'));
    }
    const produto = await prisma().produto.findUnique({ where: { id: s.sal.id } });
    assert.equal(produto.estoque_atual.toFixed(4), '40.0000', '100 − 3 × (5 + 10 + 5)');
    const lotes = await prisma().estoqueLoteNota.findMany({ where: { cliente_id: s.c, produto_id: s.sal.id, status: 'Disponivel' } });
    assert.equal(lotes.reduce((t, l) => t + Number(l.quantidade_disponivel), 0), 40);
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c, produto_id: s.sal.id } }), 1 + 3 * 3);
  });
});

describe('corridas — ordem única de travas (§8.4)', () => {
  test('cancelar × liquidar o mesmo documento: um vence; nunca 500 nem título PARCIAL em documento CANCELADO', async () => {
    const s = await cenario();
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const d = await criar(s, pagarSemProdutos(s, { documento_referencia: null }));
      const titulo = (await ok(confirmar(s, d))).titulos[0];
      const [c, l] = await Promise.all([
        req('POST', `/operacoes-financeiras/${d.id}/cancelar`, s.token, { empresa_id: s.e1.id, operation_id: opId(), motivo: 'corrida' }),
        req('POST', `/titulos-financeiros/${titulo.id}/liquidacoes`, s.token, { empresa_id: s.e1.id, operation_id: opId(), valor: '100.00', data: '2027-06-12', metodo: 'PIX' }),
      ]);
      const op = await prisma().operacaoFinanceira.findUnique({ where: { id: d.id }, include: { titulos: true } });
      if (c.statusCode === 200) {
        assert.deepEqual([l.statusCode, codigo(l), op.status, op.titulos[0].status], [409, 'TITULO_NAO_LIQUIDAVEL', 'CANCELADO', 'CANCELADO'], l.body);
      } else {
        assert.deepEqual([c.statusCode, codigo(c), l.statusCode, op.status, op.titulos[0].status], [409, 'OPERACAO_COM_LIQUIDACOES', 201, 'CONFIRMADO', 'PARCIAL'], c.body);
      }
    }
  });

  test('duas confirmações simultâneas (chaves diferentes) do mesmo rascunho com mercadoria: uma aplica, a outra 409; efeito UMA vez', async () => {
    const s = await cenario();
    const d = await criar(s, comProdutos(s, { produto: s.racao, unidade: 'SACO', quantidade: '10', valorUnitario: '80', total: '800.00' }));
    const respostas = await Promise.all([confirmar(s, d), confirmar(s, d)]);
    assert.deepEqual(respostas.map((r) => r.statusCode).sort(), [200, 409], respostas.map((r) => r.body).join('\n'));
    assert.equal(codigo(respostas.find((r) => r.statusCode === 409)), 'OPERACAO_STATUS_INVALIDO');
    assert.equal(await prisma().movimentacaoEstoque.count({ where: { cliente_id: s.c } }), 1);
    assert.equal((await prisma().produto.findUnique({ where: { id: s.racao.id } })).estoque_atual.toFixed(4), '300.0000');
  });
});

describe('contrato — validação antes de gravar', () => {
  test('valores como número → 400 valor_deve_ser_texto (sem coerção do AJV); declaração não booleana → tipo_invalido; casas da moeda', async () => {
    const s = await cenario();
    const numero = await req('POST', '/operacoes-financeiras', s.token, { ...pagarSemProdutos(s), valor_bruto: 500, operation_id: opId() });
    assert.equal(numero.statusCode, 400);
    assert.deepEqual([codigo(numero), motivo(numero), numero.json().details.campo], ['REQUEST_VALIDATION_FAILED', 'valor_deve_ser_texto', 'valor_bruto']);
    const naLinha = await req('POST', '/operacoes-financeiras', s.token, { ...pagarSemProdutos(s), parcelas: [{ vencimento: '2027-07-10', valor: 500 }], operation_id: opId() });
    assert.deepEqual([naLinha.statusCode, motivo(naLinha), naLinha.json().details.colecao, naLinha.json().details.indice], [400, 'valor_deve_ser_texto', 'parcelas', 0]);
    const declaracao = await req('POST', '/operacoes-financeiras', s.token, {
      ...comProdutos(s, { quantidade: '1', valorUnitario: '1', total: '1.00' }), efeito_fisico_confirmado: 1, operation_id: opId(),
    });
    assert.deepEqual([declaracao.statusCode, motivo(declaracao)], [400, 'tipo_invalido']);
    const casas = await req('POST', '/operacoes-financeiras', s.token, { ...pagarSemProdutos(s), valor_bruto: '500.001', operation_id: opId() });
    assert.deepEqual([casas.statusCode, motivo(casas), casas.json().field], [400, 'casas_decimais_excedidas', 'valor_bruto']);
    const semDeclaracao = await req('POST', '/operacoes-financeiras', s.token, {
      ...comProdutos(s, { quantidade: '1', valorUnitario: '1', total: '1.00' }), efeito_fisico_confirmado: false, operation_id: opId(),
    });
    assert.deepEqual([semDeclaracao.statusCode, motivo(semDeclaracao)], [400, 'declaracao_obrigatoria']);
    const futura = await criar(s, comProdutos(s, { quantidade: '1', valorUnitario: '1', total: '1.00', dia: '2027-06-20' }));
    const conf = await confirmar(s, futura);
    assert.deepEqual([conf.statusCode, codigo(conf)], [422, 'FINANCEIRO_DATA_FUTURA']);
    assert.equal(await prisma().operacaoFinanceira.count({ where: { cliente_id: s.c } }), 1, 'só o rascunho válido foi gravado');
  });

  test('rateio percentual distribui o resto ao centavo; linha que zera → 422 valor_linha_zero; PUT troca a direção com rateio gravado', async () => {
    const s = await cenario();
    const base = pagarSemProdutos(s, { documento_referencia: null, valor_bruto: '100.00', rateio_modo: 'PERCENTUAL', parcelas: [{ vencimento: '2027-07-10', valor: '100.00' }] });
    const tres = await criar(s, {
      ...base,
      rateios: [{ natureza_id: s.desp.id, percentual: '33.333333' }, { natureza_id: s.desp2.id, percentual: '33.333333' }, { natureza_id: s.desp.id, centro_custo_id: s.cc.id, percentual: '33.333334' }],
    });
    assert.deepEqual(tres.rateios.map((r) => r.valor), ['33.33', '33.33', '33.34']);
    const zera = await req('POST', '/operacoes-financeiras', s.token, {
      ...base, valor_bruto: '5.00', parcelas: [{ vencimento: '2027-07-10', valor: '5.00' }],
      rateios: [{ natureza_id: s.desp.id, percentual: '99.9' }, { natureza_id: s.desp2.id, percentual: '0.1' }], operation_id: opId(),
    });
    assert.equal(zera.statusCode, 422, zera.body);
    assert.deepEqual([codigo(zera), motivo(zera), zera.json().details.indice], ['OPERACAO_RATEIO_INVALIDO', 'valor_linha_zero', 1]);
    // PUT: PAGAR → RECEBER com rateio gravado (FK com a direção, ON UPDATE RESTRICT)
    const put = await ok(req('PUT', `/operacoes-financeiras/${tres.id}`, s.token, {
      ...base, direcao: 'RECEBER', parceiro_id: s.cli.id, rateio_modo: 'VALOR', rateios: [{ natureza_id: s.rec.id, valor: '100.00' }], versao: tres.versao,
    }));
    assert.deepEqual([put.direcao, put.versao, put.rateios.map((r) => r.natureza_tipo)], ['RECEBER', tres.versao + 1, ['RECEITA']]);
    const velho = await req('PUT', `/operacoes-financeiras/${tres.id}`, s.token, { ...base, versao: tres.versao });
    assert.deepEqual([velho.statusCode, codigo(velho)], [409, 'OPERACAO_VERSAO_CONFLITO']);
    const descarte = await req('DELETE', `/operacoes-financeiras/${tres.id}?empresa_id=${s.e1.id}&versao=${put.versao}`, s.token);
    assert.equal(descarte.statusCode, 204);
    assert.equal(await prisma().operacaoFinanceira.count({ where: { cliente_id: s.c } }), 0);
  });

  test('perfil: sem perfil → 409; moeda fora do catálogo → 400; moeda não muda com lançamentos; PIX só BR+BRL; leitura traz fuso e catálogo', async () => {
    const s = await cenario();
    const e2 = await prisma().empresa.create({ data: { cliente_id: s.c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${s.c}` } });
    const semPerfil = await req('POST', '/operacoes-financeiras', s.token, { ...pagarSemProdutos(s), empresa_id: e2.id, operation_id: opId() });
    assert.deepEqual([semPerfil.statusCode, codigo(semPerfil)], [409, 'PERFIL_FINANCEIRO_NAO_CONFIGURADO']);
    const vazio = await ok(req('GET', `/perfis-financeiros-empresa?empresa_id=${e2.id}`, s.token));
    assert.deepEqual([vazio.perfil, vazio.fuso_horario], [null, null]);
    assert.ok(vazio.catalogo.moedas.some((m) => m.codigo === 'PYG' && m.casas === 0));
    const fora = await req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: e2.id, pais: 'BR', moeda: 'XYZ', locale: 'pt-BR' });
    assert.deepEqual([fora.statusCode, motivo(fora)], [400, 'moeda_nao_suportada']);
    const usd = await ok(req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: e2.id, pais: 'BR', moeda: 'USD', locale: 'en-US' }));
    assert.equal(usd.metodos_permitidos.includes('PIX'), false, 'BR em USD não tem PIX');
    const lido = await ok(req('GET', `/perfis-financeiros-empresa?empresa_id=${s.e1.id}`, s.token));
    assert.deepEqual([lido.perfil.moeda, lido.perfil.moeda_casas, lido.fuso_horario, lido.perfil.metodos_permitidos.includes('PIX')], ['BRL', 2, 'America/Sao_Paulo', true]);
    await criar(s, pagarSemProdutos(s));
    const troca = await req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'BR', moeda: 'USD', locale: 'pt-BR' });
    assert.deepEqual([troca.statusCode, codigo(troca), motivo(troca)], [409, 'PERFIL_FINANCEIRO_MOEDA_EM_USO', 'operacoes_existentes']);
    const so_locale = await ok(req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: s.e1.id, pais: 'PT', moeda: 'BRL', locale: 'pt-PT' }));
    assert.deepEqual([so_locale.pais, so_locale.locale], ['PT', 'pt-PT']);
  });
});

describe('§8.5 — exclusões existentes não viram 403 enganoso', () => {
  test('parceiro, produto e local usados por rascunho; lote de compra confirmada (PATCH/DELETE); empresa com perfil → 409 com código próprio', async () => {
    const s = await cenario();
    const rascunho = await criar(s, comProdutos(s, { quantidade: '1', valorUnitario: '1', total: '1.00' }));
    assert.ok(rascunho.id);
    const delForn = await req('DELETE', `/fornecedores/${s.forn.id}`, s.token);
    assert.deepEqual([delForn.statusCode, codigo(delForn), delForn.json().details?.operacoes_financeiras], [409, 'PARCEIRO_EM_USO', 1]);
    const delProd = await req('DELETE', `/produtos/${s.sal.id}`, s.token);
    assert.deepEqual([delProd.statusCode, codigo(delProd)], [409, 'PRODUTO_DELETE_BLOCKED']);
    const delLocal = await req('DELETE', `/locais-estoque/${s.local.id}`, s.token);
    assert.deepEqual([delLocal.statusCode, codigo(delLocal), delLocal.json().details?.motivo], [409, 'LOCAL_ESTOQUE_DELETE_BLOCKED', 'lancamentos_financeiros_vinculados']);
    const compra = await comprarEConfirmar(s, { quantidade: '2', valorUnitario: '3', total: '6.00' });
    const loteId = compra.itens[0].estoque_lote_nota_id;
    const patch = await req('PATCH', `/estoque-lotes-nota/${loteId}`, s.token, { quantidade_disponivel: 99 });
    assert.deepEqual([patch.statusCode, codigo(patch)], [409, 'REGISTRO_OPERACIONAL_IMUTAVEL']);
    const del = await req('DELETE', `/estoque-lotes-nota/${loteId}`, s.token);
    assert.deepEqual([del.statusCode, codigo(del)], [409, 'REGISTRO_OPERACIONAL_IMUTAVEL']);
    const e2 = await prisma().empresa.create({ data: { cliente_id: s.c, numero_empresa: 2, apelido: 'E2', nome: `Fazenda 2 ${s.c}` } });
    await ok(req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: e2.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
    const delEmp = await req('DELETE', `/empresas/${e2.id}`, s.token);
    assert.equal(delEmp.statusCode, 409, delEmp.body);
    assert.equal(codigo(delEmp), 'EMPRESA_COM_VINCULOS');
    assert.ok(delEmp.json().details.vinculos.some((v) => v.entidade === 'PerfilFinanceiroEmpresa'));
  });
});
