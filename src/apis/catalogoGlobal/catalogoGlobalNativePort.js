/**
 * Porta nativa do catálogo global de ícones do produto (D-PROD-57).
 *
 * Leitura publicada: qualquer sessão autenticada. Escrita (`/admin/*`): só
 * OperadorProdutoMaike — o backend decide (403 PRODUCT_OPERATOR_REQUIRED);
 * nada aqui concede ou esconde privilégio.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'CatalogoGlobal';
const ctx = (operation, details) => ({ operation, resource: RESOURCE, ...(details ? { details } : {}) });
const get = (caminho, operation) => nativeRequest(caminho, { autenticado: true }, ctx(operation));
const post = (caminho, body, operation, details) =>
  nativeRequest(caminho, { method: 'POST', body, autenticado: true }, ctx(operation, details));
const patch = (caminho, body, operation, details) =>
  nativeRequest(caminho, { method: 'PATCH', body, autenticado: true }, ctx(operation, details));

export const operacoesCatalogoGlobal = Object.freeze({
  manifesto: () => get('/catalogo-global/manifest', 'manifestoCatalogo'),
  tiposPublicados: () => get('/catalogo-global/tipos', 'listarTiposPublicados'),
  categoriasPublicadas: () => get('/catalogo-global/categorias', 'listarCategoriasPublicadas'),
  iconesPublicados: () => get('/catalogo-global/icones', 'listarIconesPublicados'),

  visaoAdmin: () => get('/catalogo-global/admin/visao', 'visaoAdminCatalogo'),
  criarTipo: (dados) => post('/catalogo-global/admin/tipos', dados, 'criarTipoCatalogo'),
  criarCategoria: (dados) => post('/catalogo-global/admin/categorias', dados, 'criarCategoriaCatalogo'),
  registrarAsset: (dados) => post('/catalogo-global/admin/assets', dados, 'registrarAssetCatalogo'),
  criarIcone: (dados) => post('/catalogo-global/admin/icones', dados, 'criarIconeCatalogo'),
  atualizarIcone: (id, dados) => patch(`/catalogo-global/admin/icones/${encodeURIComponent(id)}`, dados, 'atualizarIconeCatalogo', { id }),
  publicarIcone: (id, dados) =>
    post(`/catalogo-global/admin/icones/${encodeURIComponent(id)}/publicar`, dados, 'publicarIconeCatalogo', { id }),
  desativarIcone: (id, dados) =>
    post(`/catalogo-global/admin/icones/${encodeURIComponent(id)}/desativar`, dados, 'desativarIconeCatalogo', { id }),
});
