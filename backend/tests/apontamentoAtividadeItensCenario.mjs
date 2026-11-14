/**
 * D-PROD-193 (Fatia D do apontamento) — cenário compartilhado dos testes dos
 * ITENS do Apontamento de Atividade. Não é arquivo de teste (sem `.test.`):
 * monta, sobre o cenário do abastecimento (`montarAbastecimento`, sem os lotes
 * legados dele), grupos e tipos de atividade pela API do cadastro, Produtos de
 * INSUMO que nenhum tanque aceita (herbicida em L, adubo em KG, sal mineral em
 * SACO; e os casos de recusa: Produto da fazenda 2, inativo, em unidade fora de
 * L/KG/SACO), contas por permissão da tela `op-apontamentos-atividade` e as
 * fotografias de "nada gravado".
 *
 * O caminho REAL do lote é a compra P3 confirmada pela Central (`s.compraP3`,
 * herdado do cenário do abastecimento); o lote "legado" direto no banco
 * (`s.lote`) só aparece onde o teste precisa de custo com 4 casas ou de lote
 * sem vínculo financeiro (X1). O diesel do cenário é COMBUSTÍVEL (aceito pelos
 * tanques do trator e do gerador): D-8 o recusa como item.
 *
 * Tudo contra PostgreSQL real e HTTP autenticado (`app.inject`). "Hoje" da
 * fazenda = 2027-06-15 (relógio de teste do cenário da P1-01).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { montarAbastecimento } from './patrimonioP1AbastecimentoCenario.mjs';
import { http, prisma } from './patrimonioP1Cenario.mjs';

export { HOJE, corpoErro, erro, http, prisma } from './patrimonioP1Cenario.mjs';

export const TELA = 'op-apontamentos-atividade';
export const MODULO = 'suporte-mapa';
const ACOES_TELA = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar']);
/** Linha de permissão da tela de apontamentos com só as ações dadas ligadas. */
export const linhaApontamento = (acoes = {}) => ({ modulo_id: MODULO, tela_id: TELA, ...Object.fromEntries(ACOES_TELA.map((a) => [a, false])), ...acoes });

/** Dia operacional padrão (passado em relação ao "hoje" de teste, 2027-06-15). */
export const DIA = '2027-06-10';
/** Instante da SAÍDA (meio-dia UTC da data operacional) e do ESTORNO (meio-dia UTC de hoje na fazenda). */
export const INSTANTE_SAIDA = '2027-06-10T12:00:00.000Z';
export const INSTANTE_ESTORNO = '2027-06-15T12:00:00.000Z';

export const ORIGEM = 'apontamento_atividade';
export const TIPO_ESTORNO = 'estorno_apontamento_atividade';

/** Chave de idempotência nova (o padrão do servidor: `^[A-Za-z0-9_.:-]{8,128}$`). */
export const opId = () => `apo-item-${randomUUID()}`;

/** Chaves EXATAS do item no detalhe (§3.4 do contrato). */
export const CHAVES_ITEM = Object.freeze([
  'cancelamento', 'consumos', 'criado_em', 'criado_por', 'descricao', 'id', 'local_estoque', 'movimento', 'movimento_estorno', 'ordem', 'produto', 'quantidade',
  'status', 'tipo', 'unidade', 'valor_total', 'valor_unitario',
]);
/** Custo dos itens de um apontamento sem item confirmado. */
export const CUSTO_ZERO = Object.freeze({ total: '0.0000', produto: '0.0000', servico: '0.0000', outro: '0.0000', itens_confirmados: 0 });

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

/** Tabelas que um comando de item pode tocar (prova de "nada gravado" / "nada alterado"). */
const FOTO = Object.freeze([
  'apontamentoAtividade', 'apontamentoAtividadeItem', 'apontamentoAtividadeItemConsumoLote', 'movimentacaoEstoque', 'estoqueLoteNota', 'operacaoIdempotente',
  'auditLog', 'entidadeCodigoSequencia', 'operacaoFinanceira',
]);

/**
 * Linhas COMPLETAS (ordenadas por id) de apontamentos, itens, fatias, movimentos,
 * lotes, recibos, auditoria, sequências e lançamentos financeiros, mais
 * `estoque_atual`/empresa/ativo/unidade de cada Produto, dos tenants dados.
 * @param {string|string[]} clienteIds
 */
export const foto = async (clienteIds) => {
  const p = /** @type {any} */ (prisma());
  const ids = Array.isArray(clienteIds) ? clienteIds : [clienteIds];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const m of FOTO) out[m] = await p[m].findMany({ where: { cliente_id: { in: ids } }, orderBy: { id: 'asc' } });
  out.produtos = await p.produto.findMany({
    where: { cliente_id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true, empresa_id: true, ativo: true, unidade_principal_estoque: true },
  });
  return JSON.stringify(out, replacer);
};

/** Ações HTTP da tela (itens, cancelamentos, detalhe, opções). @param {import('fastify').FastifyInstance} app */
export const acoesItens = (app) => {
  const { req, ok } = http(app);
  return {
    req,
    ok,
    criarApontamento: (tok, corpo) => req('POST', '/apontamentos-atividade', tok, corpo),
    editar: (tok, id, corpo) => req('PATCH', `/apontamentos-atividade/${id}`, tok, corpo),
    cancelarApontamento: (tok, id, corpo) => req('POST', `/apontamentos-atividade/${id}/cancelar`, tok, corpo),
    detalhe: (tok, id, empresaId) => req('GET', `/apontamentos-atividade/${id}?empresa_id=${empresaId}`, tok),
    lista: (tok, empresaId, extra = '') => req('GET', `/apontamentos-atividade?empresa_id=${empresaId}${extra}`, tok),
    adicionar: (tok, id, corpo) => req('POST', `/apontamentos-atividade/${id}/itens`, tok, corpo),
    cancelarItem: (tok, id, itemId, corpo) => req('POST', `/apontamentos-atividade/${id}/itens/${itemId}/cancelar`, tok, corpo),
    opcoes: (tok, recurso, query) => req('GET', `/apontamentos-atividade-opcoes/${recurso}?${query}`, tok),
    reconciliacao: (tok, query) => req('GET', `/estoque-fisico/reconciliacao?${query}`, tok),
  };
};

let n = 0;

/**
 * Cenário dos itens: o do abastecimento SEM os lotes legados (as compras P3 de
 * cada teste criam os lotes), mais grupo e tipo de atividade pela API, os
 * Produtos de insumo e as contas da tela de apontamentos.
 * @param {import('fastify').FastifyInstance} app
 */
export const montarItens = async (app) => {
  const s = await montarAbastecimento(app, { lotes: false });
  const { req, ok } = http(app);
  const p = prisma();
  const grupo = await ok(req('POST', '/grupos-atividade', s.token, { nome_grupo: 'Pastagem' }), 201);
  const tipo = await ok(req('POST', '/tipos-atividade', s.token, { nome_tipo: 'Roçada química', grupo_atividade_id: grupo.id }), 201);
  /** Produto de INSUMO direto no banco (o cadastro de Produto não é o objeto destes testes); nenhum tanque o aceita. */
  const produto = (empresa, nome, unidade, extra = {}) =>
    p.produto.create({
      data: {
        cliente_id: s.c, empresa_id: empresa.id, numero_produto: `AP-${(n += 1)}-${randomUUID().slice(0, 6)}`, nome_produto: nome, unidade_principal_estoque: unidade, ...extra,
      },
    });
  const herbicida = await produto(s.e1, 'Herbicida glifosato (L)', 'L');
  const adubo = await produto(s.e1, 'Adubo NPK (kg)', 'KG');
  const sal = await produto(s.e1, 'Sal mineral (saco 25 kg)', 'SACO', { peso_por_saco_kg: '25' });
  const herbicida2 = await produto(s.e2, 'Herbicida da fazenda 2 (L)', 'L');
  const inativo = await produto(s.e1, 'Formicida antigo (L)', 'L', { ativo: false });
  const emUnidade = await produto(s.e1, 'Arame liso (UN)', 'UN');

  const contaApontamento = (acoes = {}) =>
    s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaApontamento({ visualizar: true, ...acoes })] });
  /** Quem lança item (editar) e quem cancela (excluir). */
  const lancador = await contaApontamento({ editar: true });
  const cancelador = await contaApontamento({ excluir: true });

  /**
   * Apontamento CONFIRMADO na fazenda (padrão: F1, DIA) pela API.
   * @param {Record<string, unknown>} [extra]
   */
  const apontamento = async (extra = {}) =>
    ok(req('POST', '/apontamentos-atividade', s.token, { empresa_id: s.e1.id, tipo_atividade_id: tipo.id, data_operacional: DIA, ...extra }), 201);

  return { ...s, grupo, tipo, herbicida, adubo, sal, herbicida2, inativo, emUnidade, contaApontamento, lancador, cancelador, apontamento };
};

/**
 * Corpo do item PRODUTO (A1). `extra` sobrescreve.
 * @param {any} ap apontamento (id, empresa_id, versao) @param {any} produto @param {any} local @param {string} quantidade
 * @param {Record<string, unknown>} [extra]
 */
export const corpoProduto = (ap, produto, local, quantidade, extra = {}) => ({
  empresa_id: ap.empresa_id, versao: ap.versao, operation_id: opId(), tipo: 'PRODUTO', produto_id: produto.id, local_estoque_id: local.id, quantidade, ...extra,
});

/**
 * Corpo do item SERVICO/OUTRO (A1).
 * @param {any} ap @param {'SERVICO'|'OUTRO'} tipo @param {string} descricao @param {string} quantidade @param {string} valorUnitario
 * @param {Record<string, unknown>} [extra]
 */
export const corpoServico = (ap, tipo, descricao, quantidade, valorUnitario, extra = {}) => ({
  empresa_id: ap.empresa_id, versao: ap.versao, operation_id: opId(), tipo, descricao, quantidade, valor_unitario: valorUnitario, ...extra,
});

/** Corpo do cancelamento do item (A2) ou do apontamento (A3). @param {any} ap @param {string} motivo @param {Record<string, unknown>} [extra] */
export const corpoCancelar = (ap, motivo, extra = {}) => ({ empresa_id: ap.empresa_id, versao: ap.versao, operation_id: opId(), motivo, ...extra });

// ─── leituras do banco ──────────────────────────────────────────────────────

export const p4 = (v) => (v === null || v === undefined ? null : v.toFixed(4));
export const loteDe = (id) => prisma().estoqueLoteNota.findUnique({ where: { id } });
/** `[disponível, situação]` do lote. */
export const saldoLote = async (id) => {
  const l = await loteDe(id);
  return [p4(l.quantidade_disponivel), l.status];
};
export const estoqueAtual = async (produto) => p4((await prisma().produto.findUnique({ where: { id: produto.id } })).estoque_atual);
export const itemDe = (id) => prisma().apontamentoAtividadeItem.findUnique({ where: { id } });
export const fatiasDe = async (itemId) =>
  (await prisma().apontamentoAtividadeItemConsumoLote.findMany({ where: { item_id: itemId }, orderBy: { ordem: 'asc' } }))
    .map((f) => [f.ordem, f.estoque_lote_nota_id, p4(f.quantidade), p4(f.custo_unitario)]);
export const movimentoDe = (id) => prisma().movimentacaoEstoque.findUnique({ where: { id } });
/**
 * Item PRODUTO cancelado amarrado ao SEU estorno: a Entrada apontada pelo item é
 * filha da saída DELE (pai → filho e filho → pai), do mesmo Produto, com a mesma
 * quantidade e o mesmo valor do item. Pega estorno trocado entre itens.
 * @param {any} item item público CANCELADO (do detalhe) @param {string} rotulo
 */
export const conferirEstornoDoItem = async (item, rotulo) => {
  assert.ok(item.movimento?.id && item.movimento_estorno?.id, `${rotulo}: item PRODUTO cancelado tem saída e estorno`);
  const original = await movimentoDe(item.movimento.id);
  const estorno = await movimentoDe(item.movimento_estorno.id);
  assert.deepEqual(
    [estorno.movimento_pai_id, original.movimento_filho_id, estorno.produto_id, p4(estorno.quantidade), p4(estorno.valor_total)],
    [original.id, estorno.id, item.produto.id, item.quantidade, item.valor_total],
    `${rotulo}: o estorno é o do PRÓPRIO item (pai/filho, Produto, quantidade e valor)`
  );
  return { original, estorno };
};
export const versaoDe = async (apontamentoId) => (await prisma().apontamentoAtividade.findUnique({ where: { id: apontamentoId } })).versao;
/** Σ lotes Disponivel do produto = `estoque_atual` (nenhum saldo fantasma, nenhum negativo). */
export const coerente = async (s, produto, rotulo) => {
  const r = await prisma().estoqueLoteNota.aggregate({ _sum: { quantidade_disponivel: true }, where: { cliente_id: s.c, produto_id: produto.id, status: 'Disponivel' } });
  const lotes = p4(r._sum.quantidade_disponivel) ?? '0.0000';
  const atual = await estoqueAtual(produto);
  assert.equal(lotes, atual, `${rotulo}: Σ lotes Disponivel = estoque_atual`);
  assert.ok(!atual.startsWith('-'), `${rotulo}: estoque nunca negativo (${atual})`);
  assert.equal(await prisma().estoqueLoteNota.count({ where: { cliente_id: s.c, quantidade_disponivel: { lt: 0 } } }), 0, `${rotulo}: nenhum lote negativo`);
  return atual;
};
/** Numeração de movimentos do tenant: só números da sequência, únicos, nenhum provisório `p-…`. */
export const numeracaoLimpa = async (s) => {
  const ns = (await prisma().movimentacaoEstoque.findMany({ where: { cliente_id: s.c }, select: { numero_movimentacao: true } })).map((m) => m.numero_movimentacao);
  assert.deepEqual(ns.filter((x) => !/^\d+$/.test(String(x))), [], 'nenhum movimento commitado com número provisório');
  assert.equal(new Set(ns).size, ns.length, `números de movimento únicos: ${ns.join(',')}`);
};
/** Invariante C3: nunca item CONFIRMADO em apontamento CANCELADO (SQL direto, todos os tenants). */
export const itensConfirmadosEmCancelado = async () => {
  const [r] = /** @type {any[]} */ (await prisma().$queryRaw`SELECT COUNT(*)::int AS n FROM "ApontamentoAtividadeItem" i
    JOIN "ApontamentoAtividade" a ON a.cliente_id = i.cliente_id AND a.empresa_id = i.empresa_id AND a.id = i.apontamento_id
    WHERE i.status = 'CONFIRMADO' AND a.status = 'CANCELADO'`);
  return r.n;
};
