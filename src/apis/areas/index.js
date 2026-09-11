/**
 * Superfície pública do módulo Áreas de Pastagem.
 *
 * Desde a P4.2 esta é a **única** porta de dados de `AreaPastagem` do frontend:
 * o módulo do mapa e o da suplementação reexportam daqui em vez de manterem
 * leituras próprias pelo provider da Base44 (D-PROD-30).
 *
 * `deleteArea` não existe. A baixa de área é lógica (`ativo: false`) e passa
 * pelo `updateArea` — como sempre passou. Ver `areaPastagemRoutes.js`.
 */
export { listAreas, filterAreas, createArea, updateArea } from './areasApi.js';
