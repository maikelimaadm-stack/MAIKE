/**
 * Porta nativa de Curvas de Ganho de Peso da fazenda (D-PROD-189), tabela
 * CADCURVAGANHO. Só online; o tenant vem só do JWT e a fazenda (`empresa_id`)
 * vai na query das leituras e da exclusão e no corpo das escritas.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'CurvaGanho';
const CAMINHO = '/curvas-ganho';

const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;
/** @param {string} id */
const doId = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;

export const operacoesNativas = Object.freeze({
  /** @param {string} empresaId */
  list: (empresaId) => nativeRequest(comEmpresa(CAMINHO, empresaId), { autenticado: true }, ctx('listCurvasGanho')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(doId(id), empresaId), { autenticado: true }, ctx('getCurvaGanho', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createCurvaGanho')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  update: (id, corpo) => nativeRequest(doId(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateCurvaGanho', { id })),
  /** @param {string} id @param {string} empresaId */
  remove: (id, empresaId) =>
    nativeRequest(comEmpresa(doId(id), empresaId), { method: 'DELETE', autenticado: true }, ctx('deleteCurvaGanho', { id })),
});

// D-PROD-294: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/curvas-ganho?empresa_id={empresa}',
]);
