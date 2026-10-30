/**
 * Porta nativa do catálogo global de ícones do produto (D-PROD-57/69).
 *
 * Somente LEITURA publicada (qualquer sessão autenticada). O frontend não
 * escreve no catálogo: a manutenção é server-only, feita pelo proprietário
 * (runbook `docs/engineering/MAIKE-CATALOGO-OPERACAO-SUPABASE.md`).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'CatalogoGlobal';
const get = (caminho, operation) => nativeRequest(caminho, { autenticado: true }, { operation, resource: RESOURCE });

export const operacoesCatalogoGlobal = Object.freeze({
  tiposPublicados: () => get('/catalogo-global/tipos', 'listarTiposPublicados'),
  categoriasPublicadas: () => get('/catalogo-global/categorias', 'listarCategoriasPublicadas'),
  iconesPublicados: () => get('/catalogo-global/icones', 'listarIconesPublicados'),
});
