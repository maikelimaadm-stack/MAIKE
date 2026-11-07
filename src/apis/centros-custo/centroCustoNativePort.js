/**
 * Porta nativa de Centros de Custo (D-PROD-145) e do vínculo N:N com Centros de
 * Resultado (escrito só por este lado). Só online; tenant só no JWT.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'CentroCusto';
const CAMINHO = '/centros-custo';

const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagem = (filtros = {}) => {
  const params = new URLSearchParams();
  if (typeof filtros.empresa_id === 'string' && filtros.empresa_id.trim()) params.set('empresa_id', filtros.empresa_id.trim());
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  if (typeof filtros.q === 'string' && filtros.q.trim()) params.set('q', filtros.q.trim());
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const qs = params.toString();
  return qs ? `${CAMINHO}?${qs}` : CAMINHO;
};

/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;
/** @param {string} id */
const doId = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} [filtros] */
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listCentrosCustoPage')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(doId(id), empresaId), { autenticado: true }, ctx('getCentroCusto', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createCentroCusto')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  update: (id, corpo) => nativeRequest(doId(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateCentroCusto', { id })),
  /** @param {string} empresaId */
  opcoesPai: (empresaId) =>
    nativeRequest(comEmpresa('/centros-custo-opcoes/pais', empresaId), { autenticado: true }, ctx('listOpcoesPaiCentroCusto')),
  /** @param {string} empresaId */
  opcoesCentrosResultado: (empresaId) =>
    nativeRequest(comEmpresa('/centros-custo-opcoes/centros-resultado', empresaId), { autenticado: true }, ctx('listOpcoesVinculoCentroCusto')),
  /** @param {string} id @param {string} empresaId */
  vinculos: (id, empresaId) =>
    nativeRequest(comEmpresa(`${doId(id)}/centros-resultado`, empresaId), { autenticado: true }, ctx('listVinculosCentroCusto', { id })),
  /** @param {string} id @param {{ empresa_id: string, centro_resultado_ids: string[] }} corpo */
  definirVinculos: (id, corpo) =>
    nativeRequest(`${doId(id)}/centros-resultado`, { method: 'PUT', body: corpo, autenticado: true }, ctx('definirVinculosCentroCusto', { id })),
});
