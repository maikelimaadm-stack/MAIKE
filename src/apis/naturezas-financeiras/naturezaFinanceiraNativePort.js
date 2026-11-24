/**
 * Porta nativa das Naturezas Financeiras gerenciais (D-PROD-153). Só online;
 * tenant só no JWT; `empresa_id` é escopo (query na leitura, corpo na gravação).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

const RESOURCE = 'NaturezaFinanceira';
const CAMINHO = '/naturezas-financeiras';
const CAMINHO_PAIS = '/naturezas-financeiras-opcoes/pais';
const TIPOS = new Set(['RECEITA', 'DESPESA']);

const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagem = (filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  if (typeof filtros.tipo === 'string' && TIPOS.has(filtros.tipo)) params.set('tipo', filtros.tipo);
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const pai = texto(filtros.pai_id);
  if (pai) params.set('pai_id', pai);
  const q = texto(filtros.q);
  if (q) params.set('q', q);
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  const qs = params.toString();
  return qs ? `${CAMINHO}?${qs}` : CAMINHO;
};

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoOpcoesPais = (filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  if (typeof filtros.tipo === 'string' && TIPOS.has(filtros.tipo)) params.set('tipo', filtros.tipo);
  const q = texto(filtros.q);
  if (q) params.set('q', q);
  const excluir = texto(filtros.excluir_id);
  if (excluir) params.set('excluir_id', excluir);
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  return `${CAMINHO_PAIS}?${params.toString()}`;
};

/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;
/** @param {string} id */
const doId = (id) => `${CAMINHO}/${encodeURIComponent(id)}`;

export const operacoesNativas = Object.freeze({
  /** @param {Record<string, unknown>} [filtros] */
  listPage: (filtros = {}) => nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listNaturezasFinanceirasPage')),
  /** @param {string} id @param {string} empresaId */
  get: (id, empresaId) => nativeRequest(comEmpresa(doId(id), empresaId), { autenticado: true }, ctx('getNaturezaFinanceira', { id })),
  /** @param {Record<string, unknown>} corpo */
  create: (corpo) => nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createNaturezaFinanceira')),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  update: (id, corpo) => nativeRequest(doId(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateNaturezaFinanceira', { id })),
  /** @param {Record<string, unknown>} filtros */
  opcoesPais: (filtros) => nativeRequest(montarCaminhoOpcoesPais(filtros), { autenticado: true }, ctx('listOpcoesPaiNaturezaFinanceira')),
});

// D-PROD-289: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/naturezas-financeiras?empresa_id={empresa}&tipo=DESPESA&ativo=true&limit=100',
]);
