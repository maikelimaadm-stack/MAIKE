/**
 * Superfície pública do módulo Empresa.
 *
 * Consumidores importam `@/apis/empresa` — nunca `_providers/` nem `_core/`.
 */

export {
  listEmpresas,
  createEmpresa,
  updateEmpresa,
  deleteEmpresa,
  EMPRESA_DEFAULT_ORDER,
} from './empresaApi.js';
