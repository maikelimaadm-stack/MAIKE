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
 * Razões de recusa que a tela de login sabe tratar.
 *
 * Vocabulário do **produto**, não do provider: `auth_required` e
 * `user_not_registered` continuam com o mesmo nome porque é assim que a tela os
 * chama desde antes da P1, mas quem os produz é esta API — não o formato de
 * erro da Base44.
 */
export const RAZOES_DE_SESSAO = Object.freeze({
  AUTH_REQUIRED: 'auth_required',
  USER_NOT_REGISTERED: 'user_not_registered',
  UNKNOWN: 'unknown',
});

const RAZOES_RECONHECIDAS = new Set([RAZOES_DE_SESSAO.AUTH_REQUIRED, RAZOES_DE_SESSAO.USER_NOT_REGISTERED]);

/**
 * Classificação do erro cru do provider — **o único lugar** onde o formato dele
 * é lido (P1.4-R1).
 *
 * A P1.4 deixava esse conhecimento vazar: `sessionApi` devolvia o erro cru de
 * propósito, e `AuthContext` inspecionava `status`, `data.extra_data.reason` e
 * `message`, enquanto `sessionService` procurava o status em quatro lugares
 * diferentes de `cause`. Trocar o provider exigiria mexer nos três — que é
 * exatamente o que a fronteira existe para impedir.
 */
const statusDoProvider = (erro) => {
  const bruto = erro?.status ?? erro?.statusCode ?? erro?.response?.status;
  return Number.isInteger(bruto) ? bruto : null;
};

const razaoDoProvider = (erro) => erro?.data?.extra_data?.reason ?? null;

/**
 * Resultado discriminado das configurações públicas.
 *
 * Os campos ausentes são declarados como `undefined` no outro ramo de propósito:
 * é o que permite ao consumidor estreitar por `ok` **e** ler `reason` sem que o
 * verificador reclame de propriedade inexistente.
 *
 * @typedef {{ok: true, value: object, reason?: undefined}} ConfiguracoesPublicasOk
 * @typedef {{ok: false, reason: string, value?: undefined}} ConfiguracoesPublicasRecusa
 * @typedef {ConfiguracoesPublicasOk | ConfiguracoesPublicasRecusa} ResultadoDeConfiguracoesPublicas
 */

/**
 * Configurações públicas do app, com resultado **discriminado**.
 *
 * Nunca lança e nunca devolve erro de provider: ou entrega o valor, ou uma
 * razão do catálogo acima.
 *
 * @returns {Promise<ResultadoDeConfiguracoesPublicas>}
 */
export const getAppPublicSettings = async () => {
  try {
    return { ok: true, value: await sessionProvider.fetchPublicSettings(), reason: undefined };
  } catch (erro) {
    const razao = razaoDoProvider(erro);
    if (statusDoProvider(erro) === 403 && RAZOES_RECONHECIDAS.has(razao)) {
      return { ok: false, reason: razao, value: undefined };
    }
    return { ok: false, reason: RAZOES_DE_SESSAO.UNKNOWN, value: undefined };
  }
};

/**
 * Veredito de autenticação, **sem** fallback e sem erro cru.
 *
 * Falha com 401 ou 403 significa "precisa autenticar"; qualquer outra falha
 * significa "não autenticado", sem pedir login — a diferença é a que a tela
 * usa para decidir entre redirecionar e mostrar estado de erro.
 *
 * @returns {Promise<{autenticado: boolean, usuario: object|null, precisaAutenticar: boolean}>}
 */
export const verificarSessao = async () => {
  try {
    const usuario = await sessionProvider.me();
    return { autenticado: true, usuario: usuario ?? null, precisaAutenticar: false };
  } catch (erro) {
    const status = statusDoProvider(erro);
    return { autenticado: false, usuario: null, precisaAutenticar: status === 401 || status === 403 };
  }
};
