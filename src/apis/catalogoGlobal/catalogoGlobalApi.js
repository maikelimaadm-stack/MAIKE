/** API do catálogo global de ícones (leitura publicada + painel do operador). */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesCatalogoGlobal as op } from './catalogoGlobalNativePort.js';

const ctx = (operation) => ({ operation, resource: 'CatalogoGlobal' });
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const lista = (v) => (Array.isArray(v) ? v : []);

export const getManifestoCatalogo = () => runProviderCall(() => op.manifesto(), ctx('manifestoCatalogo'));
export const listCategoriasCatalogoPublicadas = async () =>
  lista(await runProviderCall(() => op.categoriasPublicadas(), ctx('listarCategoriasPublicadas')));
export const listIconesCatalogoPublicados = async () =>
  lista(await runProviderCall(() => op.iconesPublicados(), ctx('listarIconesPublicados')));

export const getVisaoAdminCatalogo = () => runProviderCall(() => op.visaoAdmin(), ctx('visaoAdminCatalogo'));

/** @param {string} nome @param {Function} fn */
const escrita = (nome, fn) => async (...args) => runProviderCall(() => fn(...args), ctx(nome));

export const createTipoCatalogo = escrita('criarTipoCatalogo', (dados) => {
  assertArgument(isObjeto(dados), 'dados', ctx('criarTipoCatalogo'));
  return op.criarTipo(dados);
});
export const createCategoriaCatalogo = escrita('criarCategoriaCatalogo', (dados) => {
  assertArgument(isObjeto(dados), 'dados', ctx('criarCategoriaCatalogo'));
  return op.criarCategoria(dados);
});
export const uploadAssetCatalogo = escrita('registrarAssetCatalogo', (dados) => {
  assertArgument(isObjeto(dados), 'dados', ctx('registrarAssetCatalogo'));
  return op.registrarAsset(dados);
});
export const createIconeCatalogo = escrita('criarIconeCatalogo', (dados) => {
  assertArgument(isObjeto(dados), 'dados', ctx('criarIconeCatalogo'));
  return op.criarIcone(dados);
});
export const updateIconeCatalogo = escrita('atualizarIconeCatalogo', (id, dados) => {
  assertArgument(isId(id), 'id', ctx('atualizarIconeCatalogo'));
  return op.atualizarIcone(id, dados);
});
export const publishIconeCatalogo = escrita('publicarIconeCatalogo', (id, dados) => {
  assertArgument(isId(id), 'id', ctx('publicarIconeCatalogo'));
  return op.publicarIcone(id, dados ?? {});
});
export const deactivateIconeCatalogo = escrita('desativarIconeCatalogo', (id, dados) => {
  assertArgument(isId(id), 'id', ctx('desativarIconeCatalogo'));
  return op.desativarIcone(id, dados ?? {});
});
