/**
 * Porta nativa de Marca (P4.4-Marcas, D-PROD-42).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'Marca';
const CAMINHO = '/marcas';

export const ENTIDADE_OFFLINE = 'Marca';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const CAMPOS_DE_CRIACAO = Object.freeze(['empresa_id', 'nome', 'descricao', 'ativo']);

const CAMPOS_DE_ATUALIZACAO = Object.freeze(
  CAMPOS_DE_CRIACAO.filter((campo) => campo !== 'empresa_id')
);

const valorDeEnvio = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/** @param {Record<string, unknown>} dados @param {readonly string[]} permitidos */
export const corpoDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = valorDeEnvio(/** @type {Record<string, unknown>} */ (dados)[campo]);
    if (valor !== undefined) corpo[campo] = valor;
  }
  return corpo;
};

/**
 * Querystring da listagem paginada (tenant só no JWT — nunca `cliente_id` aqui).
 * @param {Record<string, unknown>} [filtros]
 */
export const montarCaminhoListagem = (filtros = {}) => {
  const params = new URLSearchParams();
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  if (typeof filtros.empresa_id === 'string' && filtros.empresa_id.trim()) {
    params.set('empresa_id', filtros.empresa_id.trim());
  }
  if (typeof filtros.q === 'string' && filtros.q.trim()) params.set('q', filtros.q.trim());
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const qs = params.toString();
  return qs ? `${CAMINHO}?${qs}` : CAMINHO;
};

export const operacoesNativas = Object.freeze({
  /**
   * Compat offline/adapter: devolve **array** (unwrap de `items`).
   * Cap 500 — não é listagem de escala; a tela Marcas usa `listPage`.
   */
  list: async () => {
    const page = await nativeRequest(
      montarCaminhoListagem({ limit: 500 }),
      { autenticado: true },
      ctx('listMarcas'),
    );
    if (Array.isArray(page)) return page;
    if (page && typeof page === 'object' && Array.isArray(/** @type {{items?: unknown}} */ (page).items)) {
      return /** @type {{items: object[]}} */ (page).items;
    }
    return [];
  },

  /**
   * Página keyset — resposta `{ items, next_cursor, has_more, total, limit }`.
   * @param {Record<string, unknown>} [filtros]
   */
  listPage: (filtros = {}) =>
    nativeRequest(montarCaminhoListagem(filtros), { autenticado: true }, ctx('listMarcasPage')),

  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createMarca')
    ),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO), autenticado: true },
      ctx('updateMarca')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteMarca')
    ),
});

export const marcaPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
