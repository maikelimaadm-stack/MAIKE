/**
 * Porta nativa de Centros de Resultado (D-PROD-145). Só online; tenant só no JWT.
 * O vínculo com Centros de Custo aqui é SÓ leitura (quem grava é o centro de custo).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'CentroResultado';
const CAMINHO = '/centros-resultado';

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
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listCentrosResultadoPage')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(doId(id), empresaId), { autenticado: true }, ctx('getCentroResultado', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createCentroResultado')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  update: (id, corpo) => nativeRequest(doId(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateCentroResultado', { id })),
  /** @param {string} empresaId */
  opcoesPai: (empresaId) =>
    nativeRequest(comEmpresa('/centros-resultado-opcoes/pais', empresaId), { autenticado: true }, ctx('listOpcoesPaiCentroResultado')),
  /** @param {string} id @param {string} empresaId */
  vinculos: (id, empresaId) =>
    nativeRequest(comEmpresa(`${doId(id)}/centros-custo`, empresaId), { autenticado: true }, ctx('listVinculosCentroResultado', { id })),
});
