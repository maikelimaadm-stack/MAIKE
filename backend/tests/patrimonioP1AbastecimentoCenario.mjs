/**
 * D-PROD-159 — cenário compartilhado dos testes da Patrimônio P1-02
 * (abastecimento e consumo). Não é arquivo de teste (sem `.test.`): monta, sobre
 * `montarPatrimonio` (P1-01), produtos REAIS em KG, vínculos R2 e fatores kg/L
 * PELA API, locais, lotes FIFO coerentes com `estoque_atual`, os bens do aceite
 * (trator TP-02 com horímetro; caminhonete flex com odômetro; gerador sem
 * medidor) e contas por permissão da tela `pat-abastecimentos`.
 *
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
const ACOES = Object.freeze(['visualizar', 'novo', 'salvar', 'editar', 'excluir', 'importar', 'exportar', 'cancelar', 'configurar_conversao']);
/** Linha de permissão da tela Abastecimentos com só as ações dadas ligadas. */
export const linhaAbastecimento = (acoes = {}) => ({ modulo_id: MODULO, tela_id: TELA_ABASTECIMENTO, ...Object.fromEntries(ACOES.map((a) => [a, false])), ...acoes });

/** As 3 tabelas novas da migration P1-02. */
export const TABELAS_ABASTECIMENTO = Object.freeze(['AbastecimentoBem', 'AbastecimentoBemConsumoLote', 'ConversaoCombustivelProduto']);

export const opId = () => `abast-${randomUUID()}`;

const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);
const FOTO = Object.freeze([
  'abastecimentoBem', 'abastecimentoBemConsumoLote', 'conversaoCombustivelProduto', 'movimentacaoEstoque', 'estoqueLoteNota', 'auditLog',
  'operacaoIdempotente', 'bemPatrimonial', 'tanqueBem', 'operacaoFinanceira', 'entidadeCodigoSequencia',
]);

/**
 * Prova de "nada gravado" e "bem intocado": linhas COMPLETAS das 3 tabelas,
 * movimentos, lotes, `Produto.estoque_atual`, auditoria, recibos, bens, tanques
 * e sequências dos tenants dados.
 * @param {string|string[]} clienteIds
 */
export const fotoAbastecimento = async (clienteIds) => {
  const p = /** @type {any} */ (prisma());
  const ids = Array.isArray(clienteIds) ? clienteIds : [clienteIds];
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const m of FOTO) out[m] = await p[m].findMany({ where: { cliente_id: { in: ids } }, orderBy: { id: 'asc' } });
  out.produtos = await p.produto.findMany({ where: { cliente_id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, estoque_atual: true, empresa_id: true, ativo: true } });
  return JSON.stringify(out, replacer);
};

let n = 0;

/**
 * @param {import('fastify').FastifyInstance} app
 * @param {{ fatores?: boolean, lotes?: boolean }} [opcoes]
 */
export const montarAbastecimento = async (app, { fatores = true, lotes = true } = {}) => {
  const s = await montarPatrimonio(app);
  const p = prisma();
  const { req, ok } = http(app);

  const produto = (empresa, nome, unidade = 'KG') =>
    p.produto.create({
      data: { cliente_id: s.c, empresa_id: empresa.id, numero_produto: `AB-${(n += 1)}-${randomUUID().slice(0, 6)}`, nome_produto: nome, unidade_principal_estoque: unidade },
    });
  const diesel = await produto(s.e1, 'Diesel S10 granel');
  const gasolina = await produto(s.e1, 'Gasolina comum');
  const etanol = await produto(s.e1, 'Etanol hidratado');
  const oleoLitro = await produto(s.e1, 'Óleo em litro', 'L');
  const diesel2 = await produto(s.e2, 'Diesel S10 granel');

  const vincular = (tipoId, empresa, prod) => ok(req('POST', `/patrimonio-combustiveis/${tipoId}/produtos`, s.token, { empresa_id: empresa.id, produto_id: prod.id }), 201);
  const vinculos = {
    diesel: await vincular(s.comb.DIESEL_S10, s.e1, diesel),
    gasolina: await vincular(s.comb.GASOLINA, s.e1, gasolina),
    etanol: await vincular(s.comb.ETANOL, s.e1, etanol),
    oleoLitro: await vincular(s.comb.DIESEL_S500, s.e1, oleoLitro),
    diesel2: await vincular(s.comb.DIESEL_S10, s.e2, diesel2),
  };

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
   * Corpo de uma compra PAGAR com 1 mercadoria em KG (total em Decimal, 2 casas).
   * @param {any} empresa @param {any} prod @param {any} loc @param {{ kg: string, preco: string, dia?: string }} a
   */
  const docCompraP3 = async (empresa, prod, loc, { kg, preco, dia = '2027-06-10' }) => {
    const { forn, desp } = await preparoFinanceiro(empresa);
    const total = new Prisma.Decimal(kg).times(new Prisma.Decimal(preco)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
    return {
      empresa_id: empresa.id, direcao: 'PAGAR', conteudo: 'COM_PRODUTOS', condicao: 'PRAZO', parceiro_id: forn.id, data_emissao: dia, data_operacional: dia,
      efeito_fisico_confirmado: true,
      itens: [{ tipo_item: 'MERCADORIA', produto_id: prod.id, local_estoque_id: loc.id, unidade: 'KG', quantidade: kg, valor_unitario: preco }],
      rateio_modo: 'PERCENTUAL', rateios: [{ natureza_id: desp.id, percentual: '100' }], parcelas: [{ vencimento: '2027-07-10', valor: total }],
    };
  };
  /**
   * Compra P3 criada e CONFIRMADA pela API da Central: o lote nasce do motor de
   * estoque (não do banco). Devolve o lançamento confirmado, o corpo e o lote.
   * @param {any} empresa @param {any} prod @param {any} loc @param {{ kg: string, preco: string, dia?: string }} a
   */
  const compraP3 = async (empresa, prod, loc, a) => {
    const doc = await docCompraP3(empresa, prod, loc, a);
    const criada = await ok(req('POST', '/operacoes-financeiras', s.token, { ...doc, operation_id: opId() }), 201);
    const operacao = await ok(req('POST', `/operacoes-financeiras/${criada.id}/confirmar`, s.token, { empresa_id: empresa.id, operation_id: opId(), versao: criada.versao }));
    return { operacao, doc, lote_id: operacao.itens[0].estoque_lote_nota_id };
  };

  /** POST do fator pela API (A14). */
  const configurarFator = (empresa, tipoId, prod, kgPorLitro, vigenteId = null, tok = s.token) =>
    req('POST', '/patrimonio-conversoes-combustivel', tok, {
      empresa_id: empresa.id, tipo_combustivel_id: tipoId, produto_id: prod.id, kg_por_litro: kgPorLitro, declara_estoque_em_kg: true, conversao_vigente_id: vigenteId,
    });
  /** @type {Record<string, any>} */
  const fator = {};
  if (fatores) {
    fator.diesel = await ok(configurarFator(s.e1, s.comb.DIESEL_S10, diesel, '0.840000'), 201);
    fator.gasolina = await ok(configurarFator(s.e1, s.comb.GASOLINA, gasolina, '0.745000'), 201);
    fator.etanol = await ok(configurarFator(s.e1, s.comb.ETANOL, etanol, '0.789100'), 201);
    fator.diesel2 = await ok(configurarFator(s.e2, s.comb.DIESEL_S10, diesel2, '0.840000'), 201);
  }

  /** Lote "legado" direto no banco + `estoque_atual` coerente (incremento). */
  const lote = async (empresa, prod, loc, { kg, custo, dia }) => {
    const l = await p.estoqueLoteNota.create({
      data: {
        cliente_id: s.c, empresa_id: empresa.id, produto_id: prod.id, produto_nome: prod.nome_produto, local_estoque_id: loc.id, local_estoque_nome: loc.nome,
        data_documento: new Date(`${dia}T00:00:00.000Z`), custo_unitario: custo, quantidade_entrada: kg, quantidade_disponivel: kg, status: 'Disponivel',
      },
    });
    await p.produto.update({ where: { cliente_id_id: { cliente_id: s.c, id: prod.id } }, data: { estoque_atual: { increment: new Prisma.Decimal(kg) } } });
    return l;
  };
  /** @type {Record<string, any>} */
  const lotesCriados = {};
  if (lotes) {
    // Vetor `fifo` de abastecimentoVetores.json: A (06-01, 50 kg a 5,20) e B (06-03, 100 kg a 5,50).
    lotesCriados.dieselA = await lote(s.e1, diesel, local, { kg: '50.0000', custo: '5.2000', dia: '2027-06-01' });
    lotesCriados.dieselB = await lote(s.e1, diesel, local, { kg: '100.0000', custo: '5.5000', dia: '2027-06-03' });
    lotesCriados.gasolina = await lote(s.e1, gasolina, local, { kg: '300.0000', custo: '6.0000', dia: '2027-06-01' });
    lotesCriados.etanol = await lote(s.e1, etanol, local, { kg: '300.0000', custo: '4.0000', dia: '2027-06-01' });
    lotesCriados.oleoLitro = await lote(s.e1, oleoLitro, local, { kg: '100.0000', custo: '3.0000', dia: '2027-06-01' });
    lotesCriados.diesel2 = await lote(s.e2, diesel2, local, { kg: '500.0000', custo: '5.0000', dia: '2027-06-01' });
  }

  const criarBem = (corpo) => ok(req('POST', '/bens-patrimoniais', s.token, corpo), 201);
  const trator = await criarBem(corpoTrator(s));
  const caminhonete = await criarBem(corpoCaminhonete(s));
  const gerador = await criarBem(
    corpoGerador(s, { tanques: [{ identificador: 'Tanque do gerador', capacidade_litros: '100', combustivel_ids: [s.comb.DIESEL_S10, s.comb.DIESEL_S500] }] })
  );

  /** Conta com a linha da tela Abastecimentos (visualizar + as ações dadas). `s.conta(permissao)` segue o da P1-01. */
  const contaAbastecimento = (acoes, extra = {}) =>
    s.conta({ modulos_permitidos: [MODULO], permissoes_telas: [linhaAbastecimento({ visualizar: true, ...acoes })] }, extra);
  const operador = await contaAbastecimento({ novo: true });
  const contaCancelar = await contaAbastecimento({ novo: true, cancelar: true });
  const contaFator = await contaAbastecimento({ configurar_conversao: true });
  const leitor = await contaAbastecimento({});

  return {
    ...s, diesel, gasolina, etanol, oleoLitro, diesel2, vinculos, local, localInativo, local2, fator, lotes: lotesCriados, trator, caminhonete, gerador,
    configurarFator, lote, docCompraP3, compraP3, contaAbastecimento, operador, contaCancelar, contaFator, leitor,
  };
};

/**
 * Corpo da CONFIRMAÇÃO do trator TP-02 com diesel S10 (80 L, horímetro 1550.5,
 * tanque cheio), com o fator vigente do cenário. `extra` sobrescreve.
 * @param {any} s @param {Record<string, unknown>} [extra]
 */
export const corpoAbastecimento = (s, extra = {}) => ({
  empresa_id: s.e1.id,
  bem_id: s.trator.id,
  tanque_id: s.trator.tanques[0].id,
  tipo_combustivel_id: s.comb.DIESEL_S10,
  produto_id: s.diesel.id,
  local_estoque_id: s.local.id,
  data_operacional: '2027-06-10',
  quantidade_litros: '80',
  medidor_leitura: '1550.5',
  tanque_cheio: true,
  observacao: null,
  referencia_externa: null,
  operation_id: opId(),
  conversao_id: s.fator.diesel?.id,
  conversao_versao: s.fator.diesel?.versao,
  ...extra,
});

/** Corpo da PRÉVIA: o da confirmação sem operation_id nem conversão vista. */
export const corpoPrevia = (s, extra = {}) => {
  const c = /** @type {Record<string, unknown>} */ (corpoAbastecimento(s, extra));
  delete c.operation_id;
  delete c.conversao_id;
  delete c.conversao_versao;
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
  /** A7–A12: `recurso` = bens | tanques | tipos | produtos | produtos-filtro | locais; `query` sem o `?`. */
  const opcoes = (tok, recurso, query) => req('GET', `/patrimonio-abastecimentos-opcoes/${recurso}?${query}`, tok);
  /** Detalhe público do bem (P1-01 + `medidor_operacional`). */
  const bem = (tok, empresaId, id) => ok(req('GET', `/bens-patrimoniais/${id}?empresa_id=${empresaId}`, tok));
  return { req, ok, previa, confirmar, confirmarOk, cancelar, detalhe, lista, consumo, opcoes, bem };
};
