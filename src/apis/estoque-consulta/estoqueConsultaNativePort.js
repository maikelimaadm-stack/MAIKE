/**
 * Porta nativa das consultas de Estoque (D-PROD-255): saldo por produto × depósito,
 * movimentos (kardex) e as opções dos filtros. SOMENTE LEITURA, só online; o tenant
 * vem só do JWT e a fazenda (`empresa_id`) vai na query.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'Estoque';

/** @param {string} operation @param {Record<string, unknown>} [details] */
const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** Só chaves com valor: o servidor tem querystring fechada. @param {Record<string, unknown>} filtros */
const comQuery = (caminho, filtros) => {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(chave, String(valor));
  }
  const qs = params.toString();
  return qs ? `${caminho}?${qs}` : caminho;
};

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} filtros */
  saldo: (filtros) => nativeRequest(comQuery('/estoque/saldo', filtros), { autenticado: true }, ctx('listSaldoEstoque')),
  /** @param {Record<string, unknown>} filtros */
  movimentos: (filtros) => nativeRequest(comQuery('/estoque/movimentos', filtros), { autenticado: true }, ctx('listMovimentosEstoque')),
  /** @param {string} id @param {string} empresaId */
  movimento: (id, empresaId) =>
    nativeRequest(comQuery(`/estoque/movimentos/${encodeURIComponent(id)}`, { empresa_id: empresaId }), { autenticado: true }, ctx('getMovimentoEstoque', { id })),
  /** @param {Record<string, unknown>} filtros */
  opcoesProdutos: (filtros) => nativeRequest(comQuery('/estoque/opcoes/produtos', filtros), { autenticado: true }, ctx('listOpcoesProdutosEstoque')),
  /** @param {Record<string, unknown>} filtros */
  opcoesLocais: (filtros) => nativeRequest(comQuery('/estoque/opcoes/locais', filtros), { autenticado: true }, ctx('listOpcoesLocaisEstoque')),
});
