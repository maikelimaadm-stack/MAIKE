/**
 * Service de sessão (P1.2).
 *
 * A política de fallback offline vive aqui, não na API: `MapaGeral` e
 * `DetalhesLote` chamavam `base44.auth.me()` direto e gravavam
 * `offline_current_user` no `localStorage`. O comportamento observável é o
 * mesmo; o que muda é quem conhece o quê.
 *
 * Esta slice **não** redesenha autenticação: nada de login, logout, token ou
 * `requiresAuth`.
 */

import { getCurrentUser as getCurrentUserApi, listUsuarios, listPermissoes } from '@/apis/session';

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

export const listarUsuarios = () => listUsuarios();
export const listarPermissoes = () => listPermissoes();
