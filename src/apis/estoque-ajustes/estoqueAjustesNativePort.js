/**
 * Porta nativa dos Ajustes de inventário do Estoque (D-PROD-265): lista, detalhe, saldo do depósito (para a tela
 * mostrar o saldo atual e a diferença), criação, edição da observação e exclusão. O tenant vem só do JWT; a fazenda
 * (`empresa_id`) vai na query (leitura) ou no corpo (escrita). A permissão é conferida no servidor (403). Os
 * seletores do formulário são os da entrada (`/estoque/entradas/opcoes/*`).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'AjusteEstoque';
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

const BASE = '/estoque/ajustes';

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} filtros */
  listar: (filtros) => nativeRequest(comQuery(BASE, filtros), { autenticado: true }, ctx('listAjustesEstoque')),
  /** @param {string} id @param {string} empresaId */
  detalhar: (id, empresaId) => nativeRequest(comQuery(`${BASE}/${encodeURIComponent(id)}`, { empresa_id: empresaId }), { autenticado: true }, ctx('getAjusteEstoque', { id })),
  /** @param {Record<string, unknown>} filtros `empresa_id`, `produto_id`, `local_estoque_id` */
  saldo: (filtros) => nativeRequest(comQuery(`${BASE}/saldo`, filtros), { autenticado: true }, ctx('getSaldoAjusteEstoque')),
  /** @param {Record<string, unknown>} corpo */
  criar: (corpo) => nativeRequest(BASE, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('createAjusteEstoque')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  editar: (id, corpo) => nativeRequest(`${BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateAjusteEstoque', { id })),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  excluir: (id, corpo) =>
    nativeRequest(`${BASE}/${encodeURIComponent(id)}/excluir`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('deleteAjusteEstoque', { id })),
});
