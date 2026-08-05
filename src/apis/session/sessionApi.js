/**
 * API do módulo Sessão (P1.2 · ampliada em P1.4).
 *
 * Leitura do usuário atual, da lista de usuários e das permissões, mais o CRUD
 * de permissão, a atualização de nome do usuário e as operações de sessão do
 * provider (logout, ida ao login, configurações públicas do app).
 *
 * Esta slice **não** redesenha autenticação: não há login novo, token novo nem
 * mudança de `requiresAuth`. A política de fallback offline vive no service — a
 * API não conhece `localStorage`.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { sessionProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Sessao';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

/**
 * O que o provider de sessão atual sabe fazer.
 *
 * Cópia rasa e congelada: o consumidor lê, não altera, e não recebe referência
 * para dentro do provider.
 */
export const getCapacidadesDeSessao = () => Object.freeze(sessionProvider.capacidades());

/** Usuário autenticado. Erro vira `ApiError`; o service decide o fallback. */
export const getCurrentUser = async () =>
  runProviderCall(() => sessionProvider.me(), ctx('getCurrentUser'));

export const listUsuarios = async (opcoes = {}) =>
  comoLista(await runProviderCall(() => sessionProvider.listUsuarios(opcoes.order, opcoes.limit), ctx('listUsuarios')));

export const listPermissoes = async () =>
  comoLista(await runProviderCall(() => sessionProvider.listPermissoes(), ctx('listPermissoes')));

export const updateUsuario = async (id, dados) => {
  const contexto = ctx('updateUsuario');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => sessionProvider.updateUsuario(id, dados), { ...contexto, details: { id } });
};

export const createPermissao = async (dados) => {
  const contexto = ctx('createPermissao');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => sessionProvider.createPermissao(dados), contexto);
};

export const updatePermissao = async (id, dados) => {
  const contexto = ctx('updatePermissao');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => sessionProvider.updatePermissao(id, dados), { ...contexto, details: { id } });
};

export const deletePermissao = async (id) => {
  const contexto = ctx('deletePermissao');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => sessionProvider.deletePermissao(id), { ...contexto, details: { id } });
};

/**
 * Encerra a sessão.
 *
 * `urlDeRetorno` é opcional e reproduz a distinção que o `AuthContext` já
 * fazia: com URL, o provider redireciona; sem URL, só descarta o token.
 */
export const logout = async (urlDeRetorno) =>
  runProviderCall(async () => sessionProvider.logout(urlDeRetorno), ctx('logout'));

export const redirectToLogin = async (urlDeRetorno) =>
  runProviderCall(async () => sessionProvider.redirectToLogin(urlDeRetorno), ctx('redirectToLogin'));

/**
 * Configurações públicas do app.
 *
 * O erro **não** é normalizado aqui: `AuthContext` distingue `auth_required` de
 * `user_not_registered` pelo `status` e por `data.extra_data.reason` do
 * provider, e essa distinção é o contrato de estado da tela de login. Envolver
 * em `ApiError` apagaria os dois campos e transformaria "precisa autenticar" em
 * "falha genérica" — regressão de comportamento, não ganho de fronteira.
 */
export const getAppPublicSettings = async () => sessionProvider.fetchPublicSettings();
