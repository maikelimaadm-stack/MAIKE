/**
 * Porta nativa das Saídas do Estoque (D-PROD-263): lista, detalhe, criação (saída manual valorizada pelo custo
 * médio, calculado no servidor), edição da observação, exclusão e o cadastro de motivos de saída. O tenant vem só
 * do JWT; a fazenda (`empresa_id`) vai na query (leitura) ou no corpo (escrita). A permissão é conferida no
 * servidor (403). Os seletores do formulário são os da entrada (`/estoque/entradas/opcoes/*`).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'SaidaEstoque';
const TIMEOUT_COMANDO_MS = 30000;

/** @param {string} operation @param {Record<string, unknown>} [details] */
const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** Só chaves com valor: o servidor tem querystring fechada. @param {string} caminho @param {Record<string, unknown>} filtros */
const comQuery = (caminho, filtros) => {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(chave, String(valor));
  }
  const qs = params.toString();
  return qs ? `${caminho}?${qs}` : caminho;
};

const BASE = '/estoque/saidas';
const MOTIVOS = '/estoque/motivos-saida';

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} filtros */
  listar: (filtros) => nativeRequest(comQuery(BASE, filtros), { autenticado: true }, ctx('listSaidasEstoque')),
  /** @param {string} id @param {string} empresaId */
  detalhar: (id, empresaId) => nativeRequest(comQuery(`${BASE}/${encodeURIComponent(id)}`, { empresa_id: empresaId }), { autenticado: true }, ctx('getSaidaEstoque', { id })),
  /** @param {Record<string, unknown>} corpo */
  criar: (corpo) => nativeRequest(BASE, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('createSaidaEstoque')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  editar: (id, corpo) => nativeRequest(`${BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateSaidaEstoque', { id })),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  excluir: (id, corpo) =>
    nativeRequest(`${BASE}/${encodeURIComponent(id)}/excluir`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('deleteSaidaEstoque', { id })),
  /** @param {Record<string, unknown>} filtros */
  listarMotivos: (filtros) => nativeRequest(comQuery(MOTIVOS, filtros), { autenticado: true }, ctx('listMotivosSaida')),
  /** @param {Record<string, unknown>} corpo */
  criarMotivo: (corpo) => nativeRequest(MOTIVOS, { method: 'POST', body: corpo, autenticado: true }, ctx('createMotivoSaida')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  editarMotivo: (id, corpo) => nativeRequest(`${MOTIVOS}/${encodeURIComponent(id)}`, { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateMotivoSaida', { id })),
});
