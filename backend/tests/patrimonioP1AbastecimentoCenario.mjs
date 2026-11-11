/**
 * D-PROD-159, revisto pela D-PROD-162 — cenário compartilhado dos testes do
 * abastecimento e do consumo. Não é arquivo de teste (sem `.test.`): monta,
 * sobre `montarPatrimonio` (P1-01), Produtos REAIS em litros (`L`) e em quilos
 * (`KG`), um Produto em SACO (fora do abastecimento), locais, lotes FIFO
 * coerentes com `estoque_atual`, os bens do aceite com os "Produtos aceitos"
 * de cada tanque PELA API do cadastro de Bens (trator TP-02 com horímetro e
 * tanque de 180 L aceitando o diesel em L e o diesel em kg; caminhonete flex
 * com odômetro aceitando gasolina e etanol; gerador sem medidor) e contas por
 * permissão da tela `pat-abastecimentos`.
 *
 * Sem tipo de combustível, sem vínculo e sem fator kg/L (saíram na D-PROD-162).
 * Tudo contra PostgreSQL real e HTTP autenticado (`app.inject`). "Hoje" da
 * fazenda = 2027-06-15 (relógio de teste do cenário da P1-01).
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { corpoCaminhonete, corpoGerador, corpoTrator, http, montarPatrimonio, prisma } from './patrimonioP1Cenario.mjs';

export { HOJE, corpoErro, erro, http, prisma } from './patrimonioP1Cenario.mjs';

export const TELA_ABASTECIMENTO = 'pat-abastecimentos';
const MODULO = 'patrimonio';
const ACOES = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar', 'cancelar']);
/** Linha de permissão da tela Abastecimentos com só as ações dadas ligadas. */
export const linhaAbastecimento = (acoes = {}) => ({ modulo_id: MODULO, tela_id: TELA_ABASTECIMENTO, ...Object.fromEntries(ACOES.map((a) => [a, false])), ...acoes });

/** As tabelas do abastecimento (D-PROD-162: `ConversaoCombustivelProduto` saiu; o aceite do tanque entrou). */
export const TABELAS_ABASTECIMENTO = Object.freeze(['AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'TanqueBemProduto']);

export const opId = () => `abast-${randomUUID()}`;

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
const FOTO = Object.freeze([
  'abastecimentoBem', 'abastecimentoBemConsumoLote', 'tanqueBemProduto', 'movimentacaoEstoque', 'estoqueLoteNota', 'auditLog',
  'operacaoIdempotente', 'bemPatrimonial', 'tanqueBem', 'operacaoFinanceira', 'entidadeCodigoSequencia',
]);

/**
 * Prova de "nada gravado" e "bem intocado": linhas COMPLETAS das tabelas do
 * abastecimento, aceites, movimentos, lotes, `Produto.estoque_atual` e
 * unidade, auditoria, recibos, bens, tanques e sequências dos tenants dados.
 * @param {string|string[]} clienteIds
 */
export const fotoAbastecimento = async (clienteIds) => {
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

let n = 0;

/** Item de tanque para o PATCH do bem (D-PROD-162: com `produto_ids`). @param {any} t @param {string[]} produtoIds @param {Record<string, unknown>} [extra] */
export const itemTanque = (t, produtoIds, extra = {}) => ({
  id: t.id, identificador: t.identificador, capacidade_litros: t.capacidade_litros, observacao: t.observacao ?? null, produto_ids: produtoIds, ...extra,
});

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ lotes?: boolean }} [opcoes]
 */
export const montarAbastecimento = async (app, { lotes = true } = {}) => {
  const s = await montarPatrimonio(app);
  const p = prisma();
  const { req, ok } = http(app);

  /** Produto do estoque direto no banco (o cadastro de Produto não é o objeto destes testes). */
  const produto = (empresa, nome, unidade) =>
    p.produto.create({
      data: { cliente_id: s.c, empresa_id: empresa.id, numero_produto: `AB-${(n += 1)}-${randomUUID().slice(0, 6)}`, nome_produto: nome, unidade_principal_estoque: unidade },
    });
  const diesel = await produto(s.e1, 'Diesel S10 (L)', 'L');
  const dieselKg = await produto(s.e1, 'Diesel S10 granel (kg)', 'KG');
  const gasolina = await produto(s.e1, 'Gasolina comum (L)', 'L');
  const etanol = await produto(s.e1, 'Etanol hidratado (L)', 'L');
  const arla = await produto(s.e1, 'Arla 32 (L)', 'L');
  const emSaco = await produto(s.e1, 'Aditivo em saco', 'SACO');
  const diesel2 = await produto(s.e2, 'Diesel S10 (L)', 'L');

  const sufixo = randomUUID().slice(0, 6);
  const local = await p.localEstoque.create({ data: { cliente_id: s.c, numero_local: `L1-${sufixo}`, nome: `Tanque de combustível ${sufixo}` } });
  const localInativo = await p.localEstoque.create({ data: { cliente_id: s.c, numero_local: `L2-${sufixo}`, nome: `Tanque desativado ${sufixo}`, ativo: false } });
  /** Local ATIVO sem nenhum lote do cenário (compras P3 e "sem saldo"). */
  const local2 = await p.localEstoque.create({ data: { cliente_id: s.c, numero_local: `L3-${sufixo}`, nome: `Tanque da sede ${sufixo}` } });

  // ── compra P3 confirmada pela Central (caminho REAL do lote: lançamento → motor de estoque) ──
  /** @type {Map<string, {forn: any, desp: any}>} */
  const financeiro = new Map();
  const preparoFinanceiro = async (empresa) => {
    const pronto = financeiro.get(empresa.id);
    if (pronto) return pronto;
    await ok(req('PUT', '/perfis-financeiros-empresa', s.token, { empresa_id: empresa.id, pais: 'BR', moeda: 'BRL', locale: 'pt-BR' }));
    const base = { cliente_id: s.c, empresa_id: empresa.id };
    const marca = randomUUID().slice(0, 6);
    const forn = await p.fornecedor.create({ data: { ...base, numero_cadastro: `DC-${marca}`, tipo_pessoa: 'Jurídica', nome: `Distribuidora de combustível ${marca}`, tipos: ['fornecedor'] } });
    const desp = await p.naturezaFinanceira.create({ data: { ...base, numero: `NC-${marca}`, tipo: 'DESPESA', nome: `COMBUSTIVEIS ${marca}` } });
    const r = { forn, desp };
    financeiro.set(empresa.id, r);
    return r;
  };
  /**
   * Corpo de uma compra PAGAR com 1 mercadoria na unidade do Produto (L para
   * Produto em L, KG para os outros; D-PROD-162 §4.7). Total em Decimal, 2 casas.
   * @param {any} empresa @param {any} prod @param {any} loc @param {{ quantidade: string, preco: string, dia?: string }} a
   */
  const docCompraP3 = async (empresa, prod, loc, { quantidade, preco, dia = '2027-06-10' }) => {
    const { forn, desp } = await preparoFinanceiro(empresa);
    const total = new Prisma.Decimal(quantidade).times(new Prisma.Decimal(preco)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
    return {
      empresa_id: empresa.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: forn.id, data_emissao: dia, data_operacional: dia,
      efeito_fisico_confirmado: true,
      itens: [{
        tipo_item: 'MERCADORIA', produto_id: prod.id, local_estoque_id: loc.id, unidade: prod.unidade_principal_estoque === 'L' ? 'L' : 'KG', quantidade, valor_unitario: preco,
      }],
      rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: desp.id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
    };
  };
  /**
   * Compra P3 criada e CONFIRMADA pela API da Central: o lote nasce do motor de
   * estoque (não do banco). Devolve o lançamento confirmado, o corpo e o lote.
   * @param {any} empresa @param {any} prod @param {any} loc @param {{ quantidade: string, preco: string, dia?: string }} a
   */
  const compraP3 = async (empresa, prod, loc, a) => {
    const doc = await docCompraP3(empresa, prod, loc, a);
    const criada = await ok(req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: opId() }), 201);
    const operacao = await ok(req('POST', `/operacoes-financeiras/${criada.id}/confirmar`, s.token, { empresa_id: empresa.id, operation_id: opId(), versao: criada.versao }));
    return { operacao, doc, lote_id: operacao.itens[0].estoque_lote_nota_id };
  };

  /** Lote "legado" direto no banco + `estoque_atual` coerente (incremento), na unidade do Produto. */
  const lote = async (empresa, prod, loc, { quantidade, custo, dia }) => {
    const l = await p.estoqueLoteNota.create({
      data: {
        cliente_id: s.c, empresa_id: empresa.id, produto_id: prod.id, produto_nome: prod.nome_produto, local_estoque_id: loc.id, local_estoque_nome: loc.nome,
        data_documento: new Date(`${dia}T00:00:00.000Z`), custo_unitario: custo, quantidade_entrada: quantidade, quantidade_disponivel: quantidade, status: 'Disponivel',
      },
    });
    await p.produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: prod.id } }, data: { estoque_atual: { increment: new Prisma.Decimal(quantidade) } } });
    return l;
  };
  /** @type {Record<string, any>} */
  const lotesCriados = {};
  if (lotes) {
    // Vetor `fifo` de abastecimentoVetores.json: A (06-01, 50 L a 5,20) e B (06-03, 100 L a 5,50).
    lotesCriados.dieselA = await lote(s.e1, diesel, local, { quantidade: '50.0000', custo: '5.2000', dia: '2027-06-01' });
    lotesCriados.dieselB = await lote(s.e1, diesel, local, { quantidade: '100.0000', custo: '5.5000', dia: '2027-06-03' });
    lotesCriados.dieselKg = await lote(s.e1, dieselKg, local, { quantidade: '300.0000', custo: '6.1000', dia: '2027-06-01' });
    lotesCriados.gasolina = await lote(s.e1, gasolina, local, { quantidade: '300.0000', custo: '6.0000', dia: '2027-06-01' });
    lotesCriados.etanol = await lote(s.e1, etanol, local, { quantidade: '300.0000', custo: '4.0000', dia: '2027-06-01' });
    lotesCriados.arla = await lote(s.e1, arla, local, { quantidade: '100.0000', custo: '3.0000', dia: '2027-06-01' });
    lotesCriados.emSaco = await lote(s.e1, emSaco, local, { quantidade: '100.0000', custo: '3.0000', dia: '2027-06-01' });
    lotesCriados.diesel2 = await lote(s.e2, diesel2, local, { quantidade: '500.0000', custo: '5.0000', dia: '2027-06-01' });
  }

  const criarBem = (corpo) => ok(req('POST', '/bens-patrimoniais', s.token, corpo), 201);
  const trator = await criarBem(corpoTrator(s, { tanques: [{ identificador: 'Tanque principal', capacidade_litros: '180', produto_ids: [diesel.id, dieselKg.id] }] }));
  const caminhonete = await criarBem(corpoCaminhonete(s, { tanques: [{ identificador: 'Tanque', capacidade_litros: '80', produto_ids: [gasolina.id, etanol.id] }] }));
  const gerador = await criarBem(corpoGerador(s, { tanques: [{ identificador: 'Tanque do gerador', capacidade_litros: '100', produto_ids: [diesel.id] }] }));

  /** GET do bem público. */
  const bemAtual = (bem) => ok(req('GET', `/bens-patrimoniais/${bem.id}?empresa_id=${bem.empresa_id}`, s.token));
  /**
   * PATCH do bem trocando os Produtos aceitos de cada tanque (na ordem dos
   * tanques do bem; `null` mantém os aceites ativos de hoje). Devolve a resposta crua.
   * @param {any} bem @param {Array<string[]|null>} aceites @param {string} [tok]
   */
  const patchAceites = async (bem, aceites, tok = s.token) => {
    const atual = await bemAtual(bem);
    const tanques = atual.tanques.map((t, i) =>
      itemTanque(t, aceites[i] ?? t.produtos.map((x) => x.produto_id), t.ativo === false ? { ativo: false } : {}));
    return req('PATCH', `/bens-patrimoniais/${bem.id}`, tok, { empresa_id: bem.empresa_id, versao: atual.versao, tanques });
  };

  /** Conta com a linha da tela Abastecimentos (visualizar + as ações dadas). `s.conta(permissao)` segue o da P1-01. */
  const contaAbastecimento = (acoes, extra = {}) =>
    s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAbastecimento({ visualizar: true, ...acoes })] }, extra);
  const operador = await contaAbastecimento({ novo: true });
  const contaCancelar = await contaAbastecimento({ novo: true, cancelar: true });
  const leitor = await contaAbastecimento({});

  return {
    ...s, diesel, dieselKg, gasolina, etanol, arla, emSaco, diesel2, local, localInativo, local2, lotes: lotesCriados, trator, caminhonete, gerador,
    lote, docCompraP3, compraP3, bemAtual, patchAceites, contaAbastecimento, operador, contaCancelar, leitor,
  };
};

/**
 * Corpo da CONFIRMAÇÃO do trator TP-02 com o diesel em L (80 L, horímetro
 * 1550.5, tanque cheio). `extra` sobrescreve.
 * @param {any} s @param {Record<string, unknown>} [extra]
 */
export const corpoAbastecimento = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  bem_id: s.trator.id,
  tanque_id: s.trator.tanques[0].id,
  produto_id: s.diesel.id,
  local_estoque_id: s.local.id,
  data_operacional: '2027-06-10',
  quantidade: '80',
  medidor_leitura: '1550.5',
  tanque_cheio: true,
  observacao: null,
  referencia_externa: null,
  operation_id: opId(),
  ...extra,
});

/** Corpo da PRÉVIA: o da confirmação sem operation_id. */
export const corpoPrevia = (s, extra = {}) => {
  const c = /** @type {Record<string, unknown>} */ (corpoAbastecimento(s, extra));
  delete c.operation_id;
  return c;
};

/** A prévia que a tela montaria a partir do corpo da confirmação. @param {Record<string, unknown>} corpo */
export const previaDe = (corpo) => {
  const c = { ...corpo };
  delete c.operation_id;
  return c;
};

/** Ações HTTP do abastecimento. @param {import('fastify').FastifyInstance} app */
export const acoesAbastecimento = (app) => {
  const { req, ok } = http(app);
  const previa = (tok, corpo) => req('POST', '/patrimonio-abastecimentos-previa', tok, corpo);
  const confirmar = (tok, corpo) => req('POST', '/patrimonio-abastecimentos', tok, corpo);
  const cancelar = (tok, id, corpo) => req('POST', `/patrimonio-abastecimentos/${id}/cancelar`, tok, corpo);
  const detalhe = (tok, id, empresaId) => req('GET', `/patrimonio-abastecimentos/${id}?empresa_id=${empresaId}`, tok);
  const lista = (tok, empresaId, extra = '') => req('GET', `/patrimonio-abastecimentos?empresa_id=${empresaId}${extra}`, tok);
  const confirmarOk = async (tok, corpo) => {
    const r = await confirmar(tok, corpo);
    assert.equal(r.statusCode, 201, r.body);
    return r.json();
  };
  /** A6: consumo do bem (`extra` = query adicional, começando por `&`). */
  const consumo = (tok, empresaId, bemId, extra = '') => req('GET', `/patrimonio-abastecimentos-consumo?empresa_id=${empresaId}&bem_id=${bemId}${extra}`, tok);
  /** A7, A8, A11, A12 e A16: `recurso` = bens | tanques | produtos-filtro | locais | produtos-do-bem; `query` sem o `?`. */
  const opcoes = (tok, recurso, query) => req('GET', `/patrimonio-abastecimentos-opcoes/${recurso}?${query}`, tok);
  /** A16: Produtos do bem (`extra` = query adicional, começando por `&`). */
  const produtosDoBem = (tok, empresaId, bemId, extra = '') => opcoes(tok, 'produtos-do-bem', `empresa_id=${empresaId}&bem_id=${bemId}${extra}`);
  /** Detalhe público do bem (P1-01 + `medidor_operacional`). */
  const bem = (tok, empresaId, id) => ok(req('GET', `/bens-patrimoniais/${id}?empresa_id=${empresaId}`, tok));
  return { req, ok, previa, confirmar, confirmarOk, cancelar, detalhe, lista, consumo, opcoes, produtosDoBem, bem };
};
