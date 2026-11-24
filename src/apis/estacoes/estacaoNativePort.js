/**
 * Porta nativa de Estações da fazenda (D-PROD-188), tabela CADESTACOES.
 * Só online; o tenant vem só do JWT e a fazenda (`empresa_id`) vai na query
 * das leituras e da exclusão e no corpo das escritas.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'Estacao';
const CAMINHO = '/estacoes';

const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;
/** @param {string} id */
const doId = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;

export const operacoesNativas = Object.freeze({
  /** @param {string} empresaId */
  list: (empresaId) => nativeRequest(comEmpresa(CAMINHO, empresaId), { autenticado: true }, ctx('listEstacoes')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(doId(id), empresaId), { autenticado: true }, ctx('getEstacao', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createEstacao')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  update: (id, corpo) => nativeRequest(doId(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateEstacao', { id })),
  /** @param {string} id @param {string} empresaId */
  remove: (id, empresaId) =>
    nativeRequest(comEmpresa(doId(id), empresaId), { method: 'DELETE', autenticado: true }, ctx('deleteEstacao', { id })),
});

// D-PROD-291: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/estacoes?empresa_id={empresa}',
]);
