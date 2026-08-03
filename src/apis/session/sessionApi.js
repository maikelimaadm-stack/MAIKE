/**
 * API do módulo Sessão (P1.2).
 *
 * Só leitura do usuário atual, da lista de usuários e das permissões. Esta
 * slice **não** redesenha autenticação: não há login, logout, token nem
 * `requiresAuth` aqui. A política de fallback offline vive no service — a API
 * não conhece `localStorage` (seção 10 da missão).
 */

import { runProviderCall } from '../_core/normalizeApiError.js';
import { sessionProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Sessao';
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

/** Usuário autenticado. Erro vira `ApiError`; o service decide o fallback. */
export const getCurrentUser = async () =>
  runProviderCall(() => sessionProvider.me(), ctx('getCurrentUser'));

export const listUsuarios = async (opcoes = {}) =>
  comoLista(await runProviderCall(() => sessionProvider.listUsuarios(opcoes.order, opcoes.limit), ctx('listUsuarios')));

export const listPermissoes = async () =>
  comoLista(await runProviderCall(() => sessionProvider.listPermissoes(), ctx('listPermissoes')));
