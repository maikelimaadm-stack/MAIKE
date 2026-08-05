/** Superfície pública do módulo Sessão. */

export {
  getCurrentUser,
  listUsuarios,
  listPermissoes,
  updateUsuario,
  createPermissao,
  updatePermissao,
  deletePermissao,
  logout,
  redirectToLogin,
  getAppPublicSettings,
  getCapacidadesDeSessao,
} from './sessionApi.js';
