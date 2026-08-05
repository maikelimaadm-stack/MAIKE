/**
 * Service de sessão (P1.2 · ampliado em P1.4).
 *
 * A política de fallback offline vive aqui, não na API: `MapaGeral`,
 * `DetalhesLote` e o `Layout` chamavam o `auth.me()` do SDK direto e gravavam
 * `offline_current_user` no `localStorage`. O comportamento observável é o
 * mesmo; o que muda é quem conhece o quê.
 *
 * Esta slice **não** redesenha autenticação: nada de login novo, token novo ou
 * mudança em `requiresAuth`.
 */

import {
  getCurrentUser as getCurrentUserApi,
  listUsuarios,
  listPermissoes,
  updateUsuario,
  createPermissao,
  updatePermissao,
  deletePermissao,
  logout as logoutApi,
  redirectToLogin as redirectToLoginApi,
  getAppPublicSettings,
  getCapacidadesDeSessao,
} from '@/apis/session';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

const OFFLINE_USER_KEY = 'offline_current_user';

const estaOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

const lerUsuarioLocal = () => {
  try {
    const bruto = localStorage.getItem(OFFLINE_USER_KEY);
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
};

const gravarUsuarioLocal = (usuario) => {
  try {
    localStorage.setItem(OFFLINE_USER_KEY, JSON.stringify(usuario));
  } catch {
    // Armazenamento indisponível não pode derrubar a sessão.
  }
};

/**
 * Usuário atual, com o mesmo fallback offline de antes.
 *
 * Online: lê do provider e persiste para uso offline.
 * Offline ou falha: devolve o último usuário conhecido, ou `null`.
 *
 * @returns {Promise<object|null>}
 */
export const getCurrentUser = async () => {
  if (estaOnline()) {
    try {
      const usuario = await getCurrentUserApi();
      if (usuario) gravarUsuarioLocal(usuario);
      return usuario ?? null;
    } catch {
      // Sem rede útil: cai no último usuário conhecido, como antes.
      return lerUsuarioLocal();
    }
  }
  return lerUsuarioLocal();
};

/** Último usuário conhecido, sem tocar no provider. */
export const getCachedUser = () => lerUsuarioLocal();

/** Status HTTP que o provider expõe em campos variados, dentro de `cause`. */
const statusDaFalha = (erro) => {
  const bruto = erro?.status ?? erro?.cause?.status ?? erro?.cause?.statusCode ?? erro?.cause?.response?.status;
  return Number.isInteger(bruto) ? bruto : null;
};

/**
 * Verifica a autenticação **sem** fallback offline.
 *
 * `getCurrentUser` existe para telas que precisam continuar funcionando sem
 * rede — ele engole a falha e devolve o último usuário conhecido. O
 * `AuthContext` precisa do oposto: se a chamada falhou, a sessão não está
 * autenticada, e um token expirado precisa levar à tela de login.
 *
 * O resultado é um veredito, não uma exceção: assim o `AuthContext` não
 * inspeciona `status` de erro de provider nenhum.
 *
 * @returns {Promise<{autenticado: boolean, usuario: object|null, precisaAutenticar: boolean}>}
 */
export const verificarAutenticacao = async () => {
  try {
    const usuario = await getCurrentUserApi();
    if (usuario) gravarUsuarioLocal(usuario);
    return { autenticado: true, usuario: usuario ?? null, precisaAutenticar: false };
  } catch (erro) {
    const status = statusDaFalha(erro);
    return { autenticado: false, usuario: null, precisaAutenticar: status === 401 || status === 403 };
  }
};

export const listarUsuarios = () => listUsuarios();
export const listarPermissoes = () => listPermissoes();

/** Capacidades de sessão do provider atual. */
export const capacidadesDeSessao = () => getCapacidadesDeSessao();

/**
 * Configurações públicas do app.
 *
 * Repassa o erro do provider como veio: `AuthContext` classifica a tela de
 * login por `status` e por `data.extra_data.reason`.
 */
export const carregarConfiguracoesPublicas = () => getAppPublicSettings();

/**
 * Encerra a sessão e limpa o usuário offline.
 *
 * Sem `urlDeRetorno` o provider só descarta o token; com ela, redireciona.
 */
export const encerrarSessao = async (urlDeRetorno) => {
  try {
    localStorage.removeItem(OFFLINE_USER_KEY);
  } catch {
    // Falha ao limpar o cache local não pode impedir o logout.
  }
  return logoutApi(urlDeRetorno);
};

export const irParaLogin = (urlDeRetorno) => redirectToLoginApi(urlDeRetorno);

/** Permissão do usuário informado, ou `null`. */
export const permissaoDoUsuario = (permissoes, email) =>
  (Array.isArray(permissoes) ? permissoes : []).find((item) => item.user_email === email) || null;

/**
 * O usuário é administrador?
 *
 * Mesma regra em `Layout` e `ConfiguracoesGerais`: papel `admin` no provider
 * **ou** `is_admin` na permissão. Estava duplicada nas duas telas.
 */
export const ehAdministrador = (usuario, permissao) =>
  usuario?.role === 'admin' || permissao?.is_admin === true;

/**
 * Grava a permissão de um usuário, criando ou atualizando.
 *
 * O nome do usuário é propagado para `User.nome` quando mudou — a regra que a
 * página de Usuários montava dentro do `mutationFn`.
 *
 * @param {object} p
 * @param {object} p.dados formulário já validado pela tela
 * @param {Array<object>} p.permissoes lista atual, para achar a permissão existente
 * @param {Array<object>} p.usuarios lista atual, para achar o usuário
 * @param {string} p.userNome nome final já resolvido pela tela
 * @param {string} [p.nomeAtualUsuario] nome hoje gravado no usuário
 */
export const salvarPermissao = async ({ dados, permissoes, usuarios, userNome, nomeAtualUsuario }) => {
  const existente = permissaoDoUsuario(permissoes, dados.user_email);
  const usuario = (Array.isArray(usuarios) ? usuarios : []).find((item) => item.email === dados.user_email);

  if (usuario?.id && userNome && userNome !== nomeAtualUsuario) {
    await updateUsuario(usuario.id, { nome: userNome });
  }

  const payload = {
    user_email: dados.user_email,
    user_nome: userNome,
    modulos_permitidos: dados.modulos_permitidos || [],
    permissoes_telas: dados.permissoes_telas || [],
    mobile_menu_ids: dados.mobile_menu_ids || [],
    is_admin: !!dados.is_admin,
    mapa_geral_permissoes: dados.mapa_geral_permissoes || {},
  };

  return existente ? updatePermissao(existente.id, payload) : createPermissao(payload);
};

/**
 * Remove a permissão de um usuário.
 *
 * Remover a própria permissão é bloqueado **aqui**, não na tela: era um `if`
 * dentro do `handleDelete` de `Usuarios.jsx`, e qualquer chamador novo
 * atravessaria a regra sem perceber.
 */
export const removerPermissao = async ({ userEmail, permissoes, emailDoUsuarioAtual }) => {
  if (userEmail && emailDoUsuarioAtual && userEmail === emailDoUsuarioAtual) {
    throw new ApiError(API_ERROR_CODES.PERMISSAO_SELF_DELETE_BLOCKED, {
      operation: 'removerPermissao',
      resource: 'Permissao',
      details: { motivo: 'autoexclusao' },
    });
  }

  const permissao = permissaoDoUsuario(permissoes, userEmail);
  if (!permissao) return { removida: false };

  await deletePermissao(permissao.id);
  return { removida: true };
};
