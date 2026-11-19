/**
 * Porta nativa das Entradas do Estoque (D-PROD-257): lista, detalhe, criação (entrada manual e saldo de
 * implantação), edição da observação e exclusão. O tenant vem só do JWT; a fazenda (`empresa_id`) vai na query
 * (leitura) ou no corpo (escrita). A permissão é conferida no servidor (403).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'EntradaEstoque';
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

const BASE = '/estoque/entradas';

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} filtros */
  listar: (filtros) => nativeRequest(comQuery(BASE, filtros), { autenticado: true }, ctx('listEntradasEstoque')),
  /** @param {string} id @param {string} empresaId */
  detalhar: (id, empresaId) => nativeRequest(comQuery(`${BASE}/${encodeURIComponent(id)}`, { empresa_id: empresaId }), { autenticado: true }, ctx('getEntradaEstoque', { id })),
  /** @param {Record<string, unknown>} corpo */
  criar: (corpo) => nativeRequest(BASE, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('createEntradaEstoque')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  editar: (id, corpo) => nativeRequest(`${BASE}/${encodeURIComponent(id)}`, { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateEntradaEstoque', { id })),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  excluir: (id, corpo) =>
    nativeRequest(`${BASE}/${encodeURIComponent(id)}/excluir`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('deleteEntradaEstoque', { id })),
  /** @param {Record<string, unknown>} filtros */
  opcoesProdutos: (filtros) => nativeRequest(comQuery(`${BASE}/opcoes/produtos`, filtros), { autenticado: true }, ctx('listOpcoesProdutosEntrada')),
  /** @param {Record<string, unknown>} filtros */
  opcoesLocais: (filtros) => nativeRequest(comQuery(`${BASE}/opcoes/locais`, filtros), { autenticado: true }, ctx('listOpcoesLocaisEntrada')),
  // D-PROD-259: fornecedor e centros do cabeçalho; cadastro de motivos de entrada.
  /** @param {Record<string, unknown>} filtros */
  opcoesFornecedores: (filtros) => nativeRequest(comQuery(`${BASE}/opcoes/fornecedores`, filtros), { autenticado: true }, ctx('listOpcoesFornecedoresEntrada')),
  /** @param {'custo'|'resultado'} lado @param {Record<string, unknown>} filtros */
  opcoesCentros: (lado, filtros) => nativeRequest(comQuery(`${BASE}/opcoes/centros-${lado}`, filtros), { autenticado: true }, ctx('listOpcoesCentrosEntrada', { lado })),
  /** @param {Record<string, unknown>} filtros */
  listarMotivos: (filtros) => nativeRequest(comQuery('/estoque/motivos-entrada', filtros), { autenticado: true }, ctx('listMotivosEntrada')),
  /** @param {Record<string, unknown>} corpo */
  criarMotivo: (corpo) => nativeRequest('/estoque/motivos-entrada', { method: 'POST', body: corpo, autenticado: true }, ctx('createMotivoEntrada')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  editarMotivo: (id, corpo) => nativeRequest(`/estoque/motivos-entrada/${encodeURIComponent(id)}`, { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateMotivoEntrada', { id })),
});
