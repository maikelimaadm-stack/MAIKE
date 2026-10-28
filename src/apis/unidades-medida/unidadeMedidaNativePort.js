/**
 * Porta nativa de UnidadeMedida (P4.5, D-PROD-44).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'UnidadeMedida';
const CAMINHO = '/unidades-medida';
const CAMINHO_PAGINA = '/unidades-medida/page';

/** @param {Record<string, unknown>} [filtros] */
const montarQueryPagina = (filtros = {}) => {
  const params = new URLSearchParams();
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  if (typeof filtros.q === 'string' && filtros.q.trim()) params.set('q', filtros.q.trim());
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const qs = params.toString();
  return qs ? `${CAMINHO_PAGINA}?${qs}` : CAMINHO_PAGINA;
};

export const ENTIDADE_OFFLINE = 'UnidadeMedida';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const CAMPOS_DE_CRIACAO = Object.freeze(['sigla', 'descricao', 'ativo']);

const CAMPOS_DE_ATUALIZACAO = Object.freeze([...CAMPOS_DE_CRIACAO]);

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

export const operacoesNativas = Object.freeze({
  list: () => nativeRequest(CAMINHO, { autenticado: true }, ctx('listUnidades')),

  /** Página keyset — não passa pelo adapter offline (janela ≠ lista completa). */
  listPage: (filtros = {}) =>
    nativeRequest(montarQueryPagina(filtros), { autenticado: true }, ctx('listUnidadesPage')),

  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createUnidade')
    ),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO), autenticado: true },
      ctx('updateUnidade')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteUnidade')
    ),
});

export const unidadeMedidaPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
