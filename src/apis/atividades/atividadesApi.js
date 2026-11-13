/**
 * API do módulo Atividades — cadastro de tipos de atividade (D-PROD-182) e
 * apontamentos de atividade, a EXECUÇÃO de um tipo (D-PROD-188).
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

// ─── Apontamentos de atividade (D-PROD-188) ──────────────────────────────

const RESOURCE_APONTAMENTO = 'ApontamentoAtividade';
/** @param {string} operation */
const ctxApontamento = (operation) => ({ operation, resource: RESOURCE_APONTAMENTO });
/** @param {unknown} v */
const ehVersao = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 1;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

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
 * Cancelamento (sem DELETE físico): motivo obrigatório e a `versao` lida.
 * @param {string} id @param {{ empresa_id: string, versao: number, motivo: string }} corpo
 */
export const cancelarApontamentoAtividade = async (id, corpo) => {
  const contexto = ctxApontamento('cancelarApontamentoAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(isId(corpo.motivo), 'motivo', contexto);
  return runProviderCall(() => apontamentoNativo.cancelar(id, corpo), { ...contexto, details: { id } });
};

/**
 * Uma página de opções ATIVAS de um seletor da tela (`{itens, has_more,
 * next_cursor}`; `has_more` só com cursor). Em `bens`, `natureza` filtra.
 * @param {string} recurso
 * @param {{ empresa_id: string, q?: string, cursor?: string|null, limit?: number, natureza?: string[] }} filtros
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesApontamentoAtividade = async (recurso, filtros) => {
  const contexto = ctxApontamento('listOpcoesApontamentoAtividade');
  assertArgument(RECURSOS_OPCOES_APONTAMENTO.includes(recurso), 'recurso', contexto);
  assertArgument(isObjeto(filtros) && isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => apontamentoNativo.opcoes(recurso, filtros), { ...contexto, details: { recurso } });
  const o = isObjeto(bruto) ? /** @type {Record<string, unknown>} */ (bruto) : {};
  const itens = Array.isArray(o.itens) ? o.itens : [];
  const proximo = typeof o.next_cursor === 'string' && o.next_cursor ? o.next_cursor : null;
  return { itens, has_more: Boolean(o.has_more === true && proximo), next_cursor: proximo };
};
