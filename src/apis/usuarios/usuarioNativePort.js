/**
 * Porta nativa de Usuario — administração de contas (P6.0, D-PROD-34).
 *
 * Toda chamada é autenticada (PR145-R4): sem `autenticado: true` o JWT não ia
 * e a tela Usuários recebia 401 ("sessão expirou") para qualquer usuário.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';

const RESOURCE = 'Usuario';
const CAMINHO = '/usuarios';
const CAMINHO_PAGINA = '/usuarios/page';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const CAMPOS_CRIACAO = Object.freeze(['nome', 'login', 'senha']);
const CAMPOS_ATUALIZACAO = Object.freeze(['nome', 'ativo', 'nova_senha', 'senha_atual']);

const corpoDe = (dados, campos) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const campo of campos) {
    if (Object.prototype.hasOwnProperty.call(dados, campo)) saida[campo] = dados[campo];
  }
  return saida;
};

export const listUsuariosNativos = async () => {
  const resposta = await nativeRequest(CAMINHO, { method: 'GET', autenticado: true }, ctx('listUsuarios'));
  return Array.isArray(resposta) ? resposta : [];
};

/** @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean }} [filtros] */
const montarQueryPagina = (filtros = {}) => {
  const params = new URLSearchParams();
  if (filtros.limit != null) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  if (typeof filtros.q === 'string' && filtros.q.trim()) params.set('q', filtros.q.trim());
  if (filtros.ativo === true || filtros.ativo === false) params.set('ativo', String(filtros.ativo));
  const qs = params.toString();
  return qs ? `${CAMINHO_PAGINA}?${qs}` : CAMINHO_PAGINA;
};

/** Página keyset (SCALE-01) — a tela Usuários não baixa mais o tenant inteiro. */
export const listUsuariosPaginaNativo = (filtros = {}) =>
  nativeRequest(montarQueryPagina(filtros), { method: 'GET', autenticado: true }, ctx('listUsuariosPage'));

export const createUsuarioNativo = async (dados) => {
  const corpo = corpoDe(dados, CAMPOS_CRIACAO);
  return nativeRequest(CAMINHO, { method: 'POST', body: corpo, autenticado: true }, ctx('createUsuario'));
};

export const updateUsuarioNativo = async (id, dados) => {
  const corpo = corpoDe(dados, CAMPOS_ATUALIZACAO);
  return nativeRequest(`${CAMINHO}/${id}`, { method: 'PATCH', body: corpo, autenticado: true }, ctx('updateUsuario'));
};

/** Compatibilidade com telas que ainda usam `email` (Permissao Base44). */
export const comoUsuarioLegado = (usuario) => ({
  id: usuario.id,
  email: usuario.login,
  login: usuario.login,
  nome: usuario.nome,
  full_name: usuario.nome,
  ativo: usuario.ativo !== false,
});
