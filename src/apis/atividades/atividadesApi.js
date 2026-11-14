/**
 * API do módulo Atividades — cadastro de tipos de atividade (D-PROD-182),
 * apontamentos de atividade, a EXECUÇÃO de um tipo (D-PROD-190), e os itens de
 * custo do apontamento (D-PROD-191: produto, serviço e outro custo).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { tipoAtividadePort } from './tipoAtividadePort.js';
import { RECURSOS_OPCOES_APONTAMENTO, operacoesNativas as apontamentoNativo } from './apontamentoAtividadePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'TipoAtividade';
/** @param {unknown} valor */
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
/** @param {unknown} valor */
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {unknown} registros */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listTiposAtividade = async (_opcoes = {}) =>
  comoLista(await runProviderCall(() => tipoAtividadePort.list(), ctx('listTiposAtividade')));

/** @param {string} id */
export const getTipoAtividade = async (id) => {
  const contexto = ctx('getTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => tipoAtividadePort.get(id), { ...contexto, details: { id } });
};

/** @param {Record<string, unknown>} dados */
export const createTipoAtividade = async (dados) => {
  const contexto = ctx('createTipoAtividade');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tipoAtividadePort.create(dados), contexto);
};

/** @param {string} id @param {Record<string, unknown>} dados */
export const updateTipoAtividade = async (id, dados) => {
  const contexto = ctx('updateTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => tipoAtividadePort.update(id, dados), { ...contexto, details: { id } });
};

/** @param {string} id */
export const deleteTipoAtividade = async (id) => {
  const contexto = ctx('deleteTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => tipoAtividadePort.delete(id), { ...contexto, details: { id } });
};

// ─── Apontamentos de atividade (D-PROD-190) ──────────────────────────────

const RESOURCE_APONTAMENTO = 'ApontamentoAtividade';
/** @param {string} operation */
const ctxApontamento = (operation) => ({ operation, resource: RESOURCE_APONTAMENTO });
/** @param {unknown} v */
const ehVersao = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 1;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
/** Chave de idempotência (o mesmo padrão do servidor e do abastecimento). */
const RE_OPERATION_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
/** @param {unknown} v */
const ehOperationId = (v) => typeof v === 'string' && RE_OPERATION_ID.test(v);
/** Tipos do item (D-PROD-191): fechados no servidor. */
const TIPOS_ITEM = Object.freeze(['PRODUTO', 'SERVICO', 'OUTRO']);

export { RECURSOS_OPCOES_APONTAMENTO };

/**
 * Uma página (keyset) dos apontamentos da EMPRESA, com os filtros da tela.
 * @param {Record<string, unknown>} [filtros]
 */
export const listApontamentosAtividadePage = async (filtros = {}) => {
  const contexto = ctxApontamento('listApontamentosAtividadePage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => apontamentoNativo.listPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getApontamentoAtividade = async (id, empresaId) => {
  const contexto = ctxApontamento('getApontamentoAtividade');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => apontamentoNativo.get(id, empresaId), { ...contexto, details: { id } });
};

/**
 * POST: empresa, tipo e dia são obrigatórios (falha ANTES da rede).
 * @param {Record<string, unknown>} corpo
 */
export const createApontamentoAtividade = async (corpo) => {
  const contexto = ctxApontamento('createApontamentoAtividade');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(isId(corpo.tipo_atividade_id), 'tipo_atividade_id', contexto);
  assertArgument(typeof corpo.data_operacional === 'string' && RE_DIA.test(corpo.data_operacional), 'data_operacional', contexto);
  return runProviderCall(() => apontamentoNativo.create(corpo), contexto);
};

/**
 * PATCH mínimo com a `versao` lida (CAS no servidor).
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const updateApontamentoAtividade = async (id, corpo) => {
  const contexto = ctxApontamento('updateApontamentoAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  return runProviderCall(() => apontamentoNativo.update(id, corpo), { ...contexto, details: { id } });
};

/**
 * Cancelamento (sem DELETE físico): motivo obrigatório, a `versao` lida e o
 * `operation_id` do recibo (D-PROD-191, D-2: o cancelamento estorna os itens de
 * Produto, então repetir o envio tem de devolver o gravado, nunca estornar de novo).
 * @param {string} id @param {{ empresa_id: string, versao: number, motivo: string, operation_id: string }} corpo
 */
export const cancelarApontamentoAtividade = async (id, corpo) => {
  const contexto = ctxApontamento('cancelarApontamentoAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(isId(corpo.motivo), 'motivo', contexto);
  assertArgument(ehOperationId(corpo.operation_id), 'operation_id', contexto);
  return runProviderCall(() => apontamentoNativo.cancelar(id, corpo), { ...contexto, details: { id } });
};

/**
 * Adiciona UM item ao apontamento CONFIRMADO (D-PROD-191): empresa, `versao`
 * do apontamento, `operation_id`, tipo e quantidade (texto) são obrigatórios
 * (falha ANTES da rede). A resposta é o DETALHE do apontamento com `item_id` e
 * `replay`.
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const adicionarItemApontamentoAtividade = async (id, corpo) => {
  const contexto = ctxApontamento('adicionarItemApontamentoAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(ehOperationId(corpo.operation_id), 'operation_id', contexto);
  assertArgument(typeof corpo.tipo === 'string' && TIPOS_ITEM.includes(corpo.tipo), 'tipo', contexto);
  assertArgument(isId(corpo.quantidade), 'quantidade', contexto);
  return runProviderCall(() => apontamentoNativo.adicionarItem(id, corpo), { ...contexto, details: { id } });
};

/**
 * Cancela UM item (D-PROD-191): o de Produto volta exatamente aos lotes de
 * origem. Motivo, `versao` do apontamento e `operation_id` obrigatórios.
 * @param {string} id @param {string} itemId
 * @param {{ empresa_id: string, versao: number, motivo: string, operation_id: string }} corpo
 */
export const cancelarItemApontamentoAtividade = async (id, itemId, corpo) => {
  const contexto = ctxApontamento('cancelarItemApontamentoAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isId(itemId), 'itemId', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(isId(corpo.motivo), 'motivo', contexto);
  assertArgument(ehOperationId(corpo.operation_id), 'operation_id', contexto);
  return runProviderCall(() => apontamentoNativo.cancelarItem(id, itemId, corpo), { ...contexto, details: { id, itemId } });
};

/**
 * Uma página de opções ATIVAS de um seletor da tela (`{itens, has_more,
 * next_cursor}`; `has_more` só com cursor). Em `bens`, `natureza` filtra; em
 * `locais` (D-PROD-191: locais com saldo do Produto na fazenda), `produto_id`
 * é obrigatório e a resposta vem inteira (sem página).
 * @param {string} recurso
 * @param {{ empresa_id: string, q?: string, cursor?: string|null, limit?: number, natureza?: string[], produto_id?: string }} filtros
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesApontamentoAtividade = async (recurso, filtros) => {
  const contexto = ctxApontamento('listOpcoesApontamentoAtividade');
  assertArgument(RECURSOS_OPCOES_APONTAMENTO.includes(recurso), 'recurso', contexto);
  assertArgument(isObjeto(filtros) && isId(filtros.empresa_id), 'empresa_id', contexto);
  if (recurso === 'locais') assertArgument(isId(filtros.produto_id), 'produto_id', contexto);
  const bruto = await runProviderCall(() => apontamentoNativo.opcoes(recurso, filtros), { ...contexto, details: { recurso } });
  const o = isObjeto(bruto) ? /** @type {Record<string, unknown>} */ (bruto) : {};
  const itens = Array.isArray(o.itens) ? o.itens : [];
  const proximo = typeof o.next_cursor === 'string' && o.next_cursor ? o.next_cursor : null;
  return { itens, has_more: Boolean(o.has_more === true && proximo), next_cursor: proximo };
};
