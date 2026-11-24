/**
 * Porta nativa de Formulações de suplemento da fazenda (D-PROD-203), tabelas
 * CADFORMULACAO, CADFORMULACAOINGREDIENTE e CADFORMULACAOREGRA. Só online; o
 * tenant vem só do JWT e a fazenda (`empresa_id`) vai na query das leituras e
 * da exclusão e no corpo das escritas.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'Formulacao';
const CAMINHO = '/formulacoes';

const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;
/** @param {string} id */
const doId = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;

export const operacoesNativas = Object.freeze({
  /** @param {string} empresaId */
  list: (empresaId) => nativeRequest(comEmpresa(CAMINHO, empresaId), { autenticado: true }, ctx('listFormulacoes')),
  /** Só as ativas, para o lançamento de suplementação. @param {string} empresaId */
  opcoesLancamento: (empresaId) =>
    nativeRequest(comEmpresa(`${CAMINHO}/opcoes-lancamento`, empresaId), { autenticado: true }, ctx('listFormulacoesOpcoesLancamento')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(doId(id), empresaId), { autenticado: true }, ctx('getFormulacao', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createFormulacao')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  update: (id, corpo) => nativeRequest(doId(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateFormulacao', { id })),
  /** @param {string} id @param {string} empresaId */
  remove: (id, empresaId) =>
    nativeRequest(comEmpresa(doId(id), empresaId), { method: 'DELETE', autenticado: true }, ctx('deleteFormulacao', { id })),
});

// D-PROD-289: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/formulacoes?empresa_id={empresa}',
]);
