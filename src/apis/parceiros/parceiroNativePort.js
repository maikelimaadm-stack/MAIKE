/**
 * Porta nativa de Parceiros (D-PROD-145) — sobre o model Fornecedor no servidor.
 *
 * Só online: o servidor valida documento e duplicata; uma fila offline mostraria
 * "sucesso" que o servidor pode recusar depois.
 * Tenant só no JWT; a empresa vai explícita em toda chamada (escopo da rota).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'Parceiro';
const CAMINHO = '/parceiros';

const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagem = (filtros = {}) => {
  const params = new URLSearchParams();
  if (typeof filtros.empresa_id === 'string' && filtros.empresa_id.trim()) params.set('empresa_id', filtros.empresa_id.trim());
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  if (typeof filtros.q === 'string' && filtros.q.trim()) params.set('q', filtros.q.trim());
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  if (typeof filtros.papel === 'string' && filtros.papel) params.set('papel', filtros.papel);
  const qs = params.toString();
  return qs ? `${CAMINHO}?${qs}` : CAMINHO;
};

/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} [filtros] */
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listParceirosPage')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) =>
    nativeRequest(comEmpresa(`${CAMINHO}/${encodeURIComponent(id)}`, empresaId), { autenticado: true }, ctx('getParceiro', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createParceiro')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  update: (id, corpo) =>
    nativeRequest(`${CAMINHO}/${encodeURIComponent(id)}`, { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateParceiro', { id })),
});
