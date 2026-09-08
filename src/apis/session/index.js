/**
 * Superfície pública do módulo Sessão.
 *
 * Desde a P4.0 o módulo tem duas metades, e a divisão é intencional:
 *
 *  - **sessão nativa** (`nativeSessionApi`): autenticação do aplicativo contra
 *    o backend MAIKE. É esta que decide se o usuário entra;
 *  - **sessão do provider** (`sessionApi`): usuários, permissões e
 *    configurações públicas que ainda vivem na Base44, até a capacidade migrar.
 *
 * Elas não se cruzam. Não existe fallback de uma para a outra — ver D-PROD-24.
 */

export {
  login as loginNativo,
  obterContexto as obterContextoNativo,
  restaurarSessao as restaurarSessaoNativa,
  logout as logoutNativo,
  temSessaoLocal as temSessaoNativaLocal,
} from './nativeSessionApi.js';

export {
  getCurrentUser,
  listUsuarios,
  listPermissoes,
  updateUsuario,
  createPermissao,
  updatePermissao,
  deletePermissao,
  getAppPublicSettings,
  verificarSessao,
  getCapacidadesDeSessao,
  RAZOES_DE_SESSAO,
} from './sessionApi.js';
