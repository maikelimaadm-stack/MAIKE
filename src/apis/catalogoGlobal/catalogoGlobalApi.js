/** API do catálogo global de ícones — somente leitura publicada. */

import { runProviderCall } from '../_core/normalizeApiError.js';
import { operacoesCatalogoGlobal as op } from './catalogoGlobalNativePort.js';

const ctx = (operation) => ({ operation, resource: 'CatalogoGlobal' });
const lista = (v) => (Array.isArray(v) ? v : []);

export const listTiposCatalogoPublicados = async () =>
  lista(await runProviderCall(() => op.tiposPublicados(), ctx('listarTiposPublicados')));
export const listCategoriasCatalogoPublicadas = async () =>
  lista(await runProviderCall(() => op.categoriasPublicadas(), ctx('listarCategoriasPublicadas')));
export const listIconesCatalogoPublicados = async () =>
  lista(await runProviderCall(() => op.iconesPublicados(), ctx('listarIconesPublicados')));
