/**
 * Porta nativa de Patrimônio e Frota (D-PROD-156). Só online; tenant só no JWT.
 *
 * Catálogos (famílias, tipos, perfis de medição, combustíveis) são do TENANT:
 * nenhuma rota de catálogo leva `empresa_id`. Bens pertencem a uma empresa:
 * `empresa_id` vai na query da leitura e no corpo da gravação.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

/** Caminho de cada catálogo (recurso → rota). */
export const CAMINHOS_CATALOGO = Object.freeze({
  familias: '/patrimonio-familias',
  tipos: '/patrimonio-tipos',
  'perfis-medicao': '/patrimonio-perfis-medicao',
  combustiveis: '/patrimonio-combustiveis',
});

const RECURSO_DO_CATALOGO = Object.freeze({
  familias: 'FamiliaPatrimonial',
  tipos: 'TipoPatrimonial',
  'perfis-medicao': 'PerfilMedicao',
  combustiveis: 'TipoCombustivel',
});

const CAMINHO_CATALOGO_PADRAO = '/patrimonio-catalogo-padrao';
const CAMINHO_BENS = '/bens-patrimoniais';
const CAMINHO_PREVIA = '/bens-patrimoniais-previa-depreciacao';
const CAMINHO_OPCOES = '/bens-patrimoniais-opcoes';

const RESOURCE_BEM = 'BemPatrimonial';

/** @param {string} operation @param {string} resource @param {Record<string, unknown>} [details] */
const ctx = (operation, resource, details) => ({ operation, resource, ...(details ? { details } : {}) });

/** @param {unknown} v */
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** @param {string} recurso @returns {string} */
const caminhoDoCatalogo = (recurso) => /** @type {Record<string, string>} */ (CAMINHOS_CATALOGO)[recurso];
/** @param {string} recurso @returns {string} */
const recursoDoCatalogo = (recurso) => /** @type {Record<string, string>} */ (RECURSO_DO_CATALOGO)[recurso];

/**
 * @param {URLSearchParams} params
 * @param {Record<string, unknown>} filtros
 */
const paginacao = (params, filtros) => {
  const q = texto(filtros.q);
  if (q) params.set('q', q);
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
};

/** @param {string} caminho @param {URLSearchParams} params */
const comQuery = (caminho, params) => {
  const qs = params.toString();
  return qs ? `${caminho}?${qs}` : caminho;
};

/**
 * Listagem keyset de um catálogo: `q`, `ativo`, `natureza` (famílias) e
 * `familia_id` (tipos).
 * @param {string} recurso @param {Record<string, unknown>} [filtros]
 */
export const montarCaminhoListagemCatalogo = (recurso, filtros = {}) => {
  const params = new URLSearchParams();
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const natureza = texto(filtros.natureza);
  if (natureza) params.set('natureza', natureza);
  const familia = texto(filtros.familia_id);
  if (familia) params.set('familia_id', familia);
  paginacao(params, filtros);
  return comQuery(caminhoDoCatalogo(recurso), params);
};

/** @param {Record<string, unknown>} [filtros] */
export const montarCaminhoListagemBens = (filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  for (const chave of ['familia_id', 'tipo_id', 'natureza']) {
    const valor = texto(filtros[chave]);
    if (valor) params.set(chave, valor);
  }
  paginacao(params, filtros);
  return comQuery(CAMINHO_BENS, params);
};

/** @param {string} recurso @param {Record<string, unknown>} [filtros] */
export const montarCaminhoOpcoes = (recurso, filtros = {}) => {
  const params = new URLSearchParams();
  const empresa = texto(filtros.empresa_id);
  if (empresa) params.set('empresa_id', empresa);
  const familia = texto(filtros.familia_id);
  if (familia) params.set('familia_id', familia);
  paginacao(params, filtros);
  return comQuery(`${CAMINHO_OPCOES}/${encodeURIComponent(recurso)}`, params);
};

/** @param {string} recurso @param {string} id */
const doCatalogo = (recurso, id) => `${caminhoDoCatalogo(recurso)}/${encodeURIComponent(id)}`;
/** @param {string} id */
const doBem = (id) => `${CAMINHO_BENS}/${encodeURIComponent(id)}`;
/** @param {string} caminho @param {string} empresaId */
const comEmpresa = (caminho, empresaId) => `${caminho}?${new URLSearchParams({ empresa_id: String(empresaId) }).toString()}`;

export const operacoesNativas = Object.freeze({
  /** @param {string} recurso @param {Record<string, unknown>} [filtros] */
  catalogoListPage: (recurso, filtros = {}) =>
    nativeRequest(montarCaminhoListagemCatalogo(recurso, filtros), { autenticado: true }, ctx('listPatrimonioCatalogoPage', recursoDoCatalogo(recurso))),
  /** @param {string} recurso @param {string} id */
  catalogoGet: (recurso, id) => nativeRequest(doCatalogo(recurso, id), { autenticado: true }, ctx('getPatrimonioCatalogo', recursoDoCatalogo(recurso), { id })),
  /** @param {string} recurso @param {Record<string, unknown>} corpo */
  catalogoCreate: (recurso, corpo) =>
    nativeRequest(caminhoDoCatalogo(recurso), { method: 'POST', body: corpo, autenticado: true }, ctx('createPatrimonioCatalogo', recursoDoCatalogo(recurso))),
  /** @param {string} recurso @param {string} id @param {Record<string, unknown>} corpo */
  catalogoUpdate: (recurso, id, corpo) =>
    nativeRequest(doCatalogo(recurso, id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updatePatrimonioCatalogo', recursoDoCatalogo(recurso), { id })),
  catalogoPadrao: () =>
    nativeRequest(CAMINHO_CATALOGO_PADRAO, { method: 'POST', body: {}, autenticado: true }, ctx('instalarPatrimonioCatalogoPadrao', 'PatrimonioCatalogoPadrao')),
  /** @param {Record<string, unknown>} [filtros] */
  bensListPage: (filtros = {}) => nativeRequest(montarCaminhoListagemBens(filtros), { autenticado: true }, ctx('listBensPatrimoniaisPage', RESOURCE_BEM)),
  /** @param {string} id @param {string} empresaId */
  bemGet: (id, empresaId) => nativeRequest(comEmpresa(doBem(id), empresaId), { autenticado: true }, ctx('getBemPatrimonial', RESOURCE_BEM, { id })),
  /** @param {Record<string, unknown>} corpo */
  bemCreate: (corpo) => nativeRequest(CAMINHO_BENS, { method: 'POST', body: corpo, autenticado: true }, ctx('createBemPatrimonial', RESOURCE_BEM)),
  /** @param {string} id @param {Record<string, unknown>} corpo */
  bemUpdate: (id, corpo) => nativeRequest(doBem(id), { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateBemPatrimonial', RESOURCE_BEM, { id })),
  /** @param {Record<string, unknown>} corpo */
  previaDepreciacao: (corpo) =>
    nativeRequest(CAMINHO_PREVIA, { method: 'POST', body: corpo, autenticado: true }, ctx('previaDepreciacaoBemPatrimonial', RESOURCE_BEM)),
  /** @param {string} recurso @param {Record<string, unknown>} [filtros] */
  opcoes: (recurso, filtros = {}) =>
    nativeRequest(montarCaminhoOpcoes(recurso, filtros), { autenticado: true }, ctx('listOpcoesBemPatrimonial', RESOURCE_BEM, { recurso })),
});
