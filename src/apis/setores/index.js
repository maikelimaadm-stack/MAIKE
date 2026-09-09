/**
 * Superfície pública do módulo Setores.
 *
 * Desde a P4.1 esta é a **única** porta de dados de Setor do frontend: o módulo
 * do mapa reexporta `listSetores` daqui em vez de manter uma leitura própria
 * pelo provider da Base44 (D-PROD-25).
 *
 * `deleteSetor` não existe. Ver `setoresApi.js`.
 */
export {
  listSetores,
  createSetor,
  updateSetor,
  sincronizarReferenciasSetor,
} from './setoresApi.js';
