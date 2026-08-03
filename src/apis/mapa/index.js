/**
 * Superfície pública do módulo Mapa.
 *
 * Consumidores importam `@/apis/mapa` — nunca `_providers/` nem o arquivo
 * interno `mapaApi.js`.
 */

export {
  listAreas,
  filterAreas,
  createArea,
  updateArea,
  listPontos,
  createPonto,
  updatePonto,
  deletePonto,
  listPontosSuplementacao,
  createPontoSuplementacao,
  updatePontoSuplementacao,
  deletePontoSuplementacao,
  listLinhas,
  createLinha,
  updateLinha,
  listSetores,
  listIcones,
  listBebedouros,
} from './mapaApi.js';
