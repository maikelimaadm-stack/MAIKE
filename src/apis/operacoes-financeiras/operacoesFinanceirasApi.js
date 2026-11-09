/**
 * API da Central Única de Lançamentos (D-PROD-155): documento gerencial
 * `OperacaoFinanceira` (PAGAR|RECEBER × COM|SEM produtos × AVISTA|PRAZO|PARCELADO),
 * títulos, liquidações manuais e o perfil financeiro da empresa. Online só.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './operacaoFinanceiraNativePort.js';
import { normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'OperacaoFinanceira';
/** Teto do servidor para a listagem (§4: limit 1..100). */
export const LIMITE_MAXIMO_LISTA = 100;
const RECURSOS_OPCOES = new Set(['parceiros', 'produtos', 'locais', 'saldos', 'naturezas', 'centros-custo', 'centros-resultado']);

/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });
/** @param {Record<string, unknown>} corpo @param {string} operation */
const exigirCorpoComEmpresa = (corpo, operation) => assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', ctx(operation));
/** @param {Record<string, unknown>} corpo @param {string} operation */
const exigirOperationId = (corpo, operation) =>
  assertArgument(typeof corpo.operation_id === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(corpo.operation_id), 'operation_id', ctx(operation));

/** @param {string} empresaId */
export const getPerfilFinanceiroEmpresa = async (empresaId) => {
  const contexto = ctx('getPerfilFinanceiroEmpresa');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.getPerfil(empresaId), contexto);
};

/** @param {{ empresa_id: string, pais: string, moeda: string, locale: string }} corpo */
export const putPerfilFinanceiroEmpresa = async (corpo) => {
  exigirCorpoComEmpresa(corpo, 'putPerfilFinanceiroEmpresa');
  return runProviderCall(() => operacoesNativas.putPerfil(corpo), ctx('putPerfilFinanceiroEmpresa'));
};

/** @param {Record<string, unknown>} [filtros] */
export const listOperacoesFinanceirasPage = async (filtros = {}) => {
  const contexto = ctx('listOperacoesFinanceirasPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const limit = Math.min(Math.max(Number(filtros.limit) || 50, 1), LIMITE_MAXIMO_LISTA);
  const bruto = await runProviderCall(() => operacoesNativas.listPage({ ...filtros, limit }), contexto);
  return normalizarEnvelopePagina(bruto, limit);
};

/** @param {string} id @param {string} empresaId */
export const getOperacaoFinanceira = async (id, empresaId) => {
  const contexto = ctx('getOperacaoFinanceira');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo DOC + operation_id */
export const createOperacaoFinanceira = async (corpo) => {
  exigirCorpoComEmpresa(corpo, 'createOperacaoFinanceira');
  exigirOperationId(corpo, 'createOperacaoFinanceira');
  return runProviderCall(() => operacoesNativas.create(corpo), ctx('createOperacaoFinanceira'));
};

/** @param {string} id @param {Record<string, unknown>} corpo DOC + versao */
export const replaceOperacaoFinanceira = async (id, corpo) => {
  const contexto = ctx('replaceOperacaoFinanceira');
  assertArgument(isId(id), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'replaceOperacaoFinanceira');
  assertArgument(Number.isInteger(corpo.versao), 'versao', contexto);
  return runProviderCall(() => operacoesNativas.replace(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} id @param {string} empresaId @param {number} versao */
export const deleteOperacaoFinanceira = async (id, empresaId, versao) => {
  const contexto = ctx('deleteOperacaoFinanceira');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  assertArgument(Number.isInteger(versao), 'versao', contexto);
  return runProviderCall(() => operacoesNativas.remove(id, empresaId, versao), { ...contexto, details: { id } });
};

/**
 * `plano: null` é preservado: o servidor o devolve quando o PLANEJAMENTO recusa
 * (os `bloqueios` dizem por quê) e a tela não pode anunciar parcelas nem títulos.
 * @param {string} id @param {string} empresaId @returns {Promise<{ plano: any|null, bloqueios: any[] }>}
 */
export const previaOperacaoFinanceira = async (id, empresaId) => {
  const contexto = ctx('previaOperacaoFinanceira');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.previa(id, empresaId), contexto));
  return { plano: isObjeto(bruto?.plano) ? bruto.plano : null, bloqueios: Array.isArray(bruto?.bloqueios) ? bruto.bloqueios : [] };
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const confirmarOperacaoFinanceira = async (id, corpo) => {
  const contexto = ctx('confirmarOperacaoFinanceira');
  assertArgument(isId(id), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'confirmarOperacaoFinanceira');
  exigirOperationId(corpo, 'confirmarOperacaoFinanceira');
  return runProviderCall(() => operacoesNativas.confirmar(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const cancelarOperacaoFinanceira = async (id, corpo) => {
  const contexto = ctx('cancelarOperacaoFinanceira');
  assertArgument(isId(id), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'cancelarOperacaoFinanceira');
  exigirOperationId(corpo, 'cancelarOperacaoFinanceira');
  return runProviderCall(() => operacoesNativas.cancelar(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} tituloId @param {Record<string, unknown>} corpo */
export const registrarLiquidacaoTitulo = async (tituloId, corpo) => {
  const contexto = ctx('registrarLiquidacaoTitulo');
  assertArgument(isId(tituloId), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'registrarLiquidacaoTitulo');
  exigirOperationId(corpo, 'registrarLiquidacaoTitulo');
  return runProviderCall(() => operacoesNativas.liquidar(tituloId, corpo), { ...contexto, details: { id: tituloId } });
};

/** @param {string} liquidacaoId @param {Record<string, unknown>} corpo */
export const estornarLiquidacaoFinanceira = async (liquidacaoId, corpo) => {
  const contexto = ctx('estornarLiquidacaoFinanceira');
  assertArgument(isId(liquidacaoId), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'estornarLiquidacaoFinanceira');
  exigirOperationId(corpo, 'estornarLiquidacaoFinanceira');
  return runProviderCall(() => operacoesNativas.estornar(liquidacaoId, corpo), { ...contexto, details: { id: liquidacaoId } });
};

/**
 * Uma página de opções de um seletor da tela (rotas próprias guardadas pela
 * tela de Lançamentos — quem só tem esta tela não leva 403).
 * @param {string} recurso
 * @param {Record<string, unknown>} filtros
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesOperacaoFinanceira = async (recurso, filtros) => {
  const contexto = ctx(`listOpcoes:${recurso}`);
  assertArgument(RECURSOS_OPCOES.has(recurso), 'recurso', contexto);
  assertArgument(isObjeto(filtros), 'filtros', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.opcoes(recurso, filtros), contexto));
  const itens = isObjeto(bruto) && Array.isArray(bruto.itens) ? bruto.itens : [];
  const proximo = isObjeto(bruto) && typeof bruto.next_cursor === 'string' && bruto.next_cursor ? bruto.next_cursor : null;
  return { itens, has_more: Boolean(isObjeto(bruto) && bruto.has_more === true && proximo), next_cursor: proximo };
};
