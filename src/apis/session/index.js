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
  verificarSessao,
  getCapacidadesDeSessao,
  RAZOES_DE_SESSAO,
} from './sessionApi.js';
