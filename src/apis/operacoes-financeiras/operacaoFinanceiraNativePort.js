/**
 * Porta nativa da Central Única de Lançamentos (D-PROD-155). Só online; o
 * tenant vem só do JWT; `empresa_id` é ESCOPO (query na leitura, corpo na
 * gravação) e o servidor o valida. Valores monetários, quantidades e
 * percentuais viajam como STRING canônica ("1234.56") — nunca número.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'OperacaoFinanceira';
const CAMINHO = '/operacoes-financeiras';
const CAMINHO_OPCOES = '/operacoes-financeiras-opcoes';
const CAMINHO_PERFIL = '/perfis-financeiros-empresa';

/** Confirmar, cancelar, retificar e excluir podem mexer em centenas de linhas: prazo próprio (§8.7). */
export const TIMEOUT_COMANDO_MS = 60000;

const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// `situacao` (D-PROD-157): OPERACIONAIS (padrão do servidor) | EXCLUIDOS | TODOS.
const FILTROS_LISTA = Object.freeze([
  'empresa_id', 'direcao', 'status', 'situacao', 'conteudo', 'parceiro_id', 'emissao_de', 'emissao_ate', 'vencimento_de', 'vencimento_ate', 'q', 'cursor',
]);

/** @param {string} caminho @param {Record<string, unknown>} params */
const comQuery = (caminho, params) => {
  const qs = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === undefined || valor === null || valor === '') continue;
    qs.set(chave, String(valor));
  }
  const s = qs.toString();
  return s ? `${caminho}?${s}` : caminho;
};

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagem = (filtros = {}) => {
  /** @type {Record<string, unknown>} */
  const params = {};
  for (const chave of FILTROS_LISTA) {
    const v = texto(filtros[chave]);
    if (v) params[chave] = v;
  }
  if (filtros.com_estoque === true || filtros.com_estoque === false) params.com_estoque = String(filtros.com_estoque);
  if (filtros.limit != null) params.limit = String(filtros.limit);
  return comQuery(CAMINHO, params);
};

/** @param {string} recurso @param {Record<string, unknown>} [filtros] */
export const montarCaminhoOpcoes = (recurso, filtros = {}) => {
  /** @type {Record<string, unknown>} */
  const params = {};
  for (const chave of ['empresa_id', 'direcao', 'tipo', 'produto_id', 'q', 'cursor']) {
    const v = texto(filtros[chave]);
    if (v) params[chave] = v;
  }
  if (filtros.limit != null) params.limit = String(filtros.limit);
  return comQuery(`${CAMINHO_OPCOES}/${recurso}`, params);
};

/** @param {string} id */
const doId = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;

export const operacoesNativas = Object.freeze({
  /** @param {string} empresaId */
  getPerfil: (empresaId) => nativeRequest(comQuery(CAMINHO_PERFIL, { empresa_id: empresaId }), { autenticado: true }, ctx('getPerfilFinanceiroEmpresa')),
  /** @param {Record<string, unknown>} corpo */
  putPerfil: (corpo) => nativeRequest(CAMINHO_PERFIL, { method: 'PUT', body: corpo, autenticado: true }, ctx('putPerfilFinanceiroEmpresa')),
  /** @param {Record<string, unknown>} [filtros] */
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listOperacoesFinanceirasPage')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comQuery(doId(id), { empresa_id: empresaId }), { autenticado: true }, ctx('getOperacaoFinanceira', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createOperacaoFinanceira')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  replace: (id, corpo) => nativeRequest(doId(id), { method: 'PUT', body: corpo, autenticado: true }, ctx('replaceOperacaoFinanceira', { id })),
  /** @param {string} id @param {string} empresaId @param {number} versao */
  remove: (id, empresaId, versao) =>
    nativeRequest(comQuery(doId(id), { empresa_id: empresaId, versao }), { method: 'DELETE', autenticado: true }, ctx('deleteOperacaoFinanceira', { id })),
  /** @param {string} id @param {string} empresaId */
  previa: (id, empresaId) =>
    nativeRequest(`${doId(id)}/previa`, { method: 'POST', body: { empresa_id: empresaId }, autenticado: true }, ctx('previaOperacaoFinanceira', { id })),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  confirmar: (id, corpo) =>
    nativeRequest(`${doId(id)}/confirmar`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('confirmarOperacaoFinanceira', { id })),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  cancelar: (id, corpo) =>
    nativeRequest(`${doId(id)}/cancelar`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('cancelarOperacaoFinanceira', { id })),
  /** Elegibilidade de editar/excluir/duplicar (D-PROD-157): só leitura. @param {string} id @param {string} empresaId */
  elegibilidade: (id, empresaId) =>
    nativeRequest(comQuery(`${doId(id)}/elegibilidade`, { empresa_id: empresaId }), { autenticado: true }, ctx('elegibilidadeOperacaoFinanceira', { id })),
  /** Correção de confirmado (no lugar ou por substituição atômica). @param {string} id @param {Record<string, unknown>} corpo */
  retificar: (id, corpo) =>
    nativeRequest(`${doId(id)}/retificar`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('retificarOperacaoFinanceira', { id })),
  /** Exclusão LÓGICA de confirmado (estorna como o cancelamento). @param {string} id @param {Record<string, unknown>} corpo */
  excluir: (id, corpo) =>
    nativeRequest(`${doId(id)}/excluir`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('excluirOperacaoFinanceira', { id })),
  /** @param {string} tituloId @param {Record<string, unknown>} corpo */
  liquidar: (tituloId, corpo) =>
    nativeRequest(`/titulos-financeiros/${encodeURIComponent(tituloId)}/liquidacoes`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('registrarLiquidacaoTitulo', { id: tituloId })),
  /** @param {string} liquidacaoId @param {Record<string, unknown>} corpo */
  estornar: (liquidacaoId, corpo) =>
    nativeRequest(`/liquidacoes-financeiras/${encodeURIComponent(liquidacaoId)}/estorno`, { method: 'POST', body: corpo, autenticado: true, timeoutMs: TIMEOUT_COMANDO_MS }, ctx('estornarLiquidacaoFinanceira', { id: liquidacaoId })),
  /** @param {string} recurso @param {Record<string, unknown>} filtros */
  opcoes: (recurso, filtros) => nativeRequest(montarCaminhoOpcoes(recurso, filtros), { autenticado: true }, ctx(`listOpcoes:${recurso}`)),
});
