/**
 * Service de sessão (P1.2 · ampliado em P1.4).
 *
 * A política de fallback offline vive aqui, não na API: `MapaGeral`,
 * `DetalhesLote` e o `Layout` chamavam o `auth.me()` do SDK direto e gravavam
 * `offline_current_user` no `localStorage`. O comportamento observável é o
 * mesmo; o que muda é quem conhece o quê.
 *
 * Desde a **P4.0** este service tem duas metades. A autenticação do aplicativo
 * é nativa — `entrarComSessaoNativa`, `restaurarSessaoNativaAtual` e
 * `sairDaSessaoNativa`, mais abaixo. O que sobrou do provider Base44 aqui é
 * leitura de usuário, permissões e configurações públicas: dados de cadastros
 * que ainda não migraram, não sessão.
 *
 * O logout da Base44 saiu junto com `redirectToLogin`: quem encerra a sessão do
 * aplicativo é `sairDaSessaoNativa`, e manter os dois lados daria a impressão
 * de que existe escolha entre eles.
 */

import {
  getCurrentUser as getCurrentUserApi,
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
  loginNativo,
  restaurarSessaoNativa,
  logoutNativo,
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

/**
 * Verifica a autenticação **sem** fallback offline.
 *
 * `getCurrentUser` existe para telas que precisam continuar funcionando sem
 * rede — ele engole a falha e devolve o último usuário conhecido. O
 * `AuthContext` precisa do oposto: se a chamada falhou, a sessão não está
 * autenticada, e um token expirado precisa levar à tela de login.
 *
 * A classificação vive na API (P1.4-R1). Este service **não** olha `status`,
 * `cause` nem formato de erro do provider: recebe o veredito pronto e só
 * acrescenta a política local — persistir o usuário para uso offline.
 *
 * @returns {Promise<{autenticado: boolean, usuario: object|null, precisaAutenticar: boolean}>}
 */
export const verificarAutenticacao = async () => {
  const veredito = await verificarSessao();
  if (veredito.autenticado && veredito.usuario) gravarUsuarioLocal(veredito.usuario);
  return veredito;
};

export const listarUsuarios = () => listUsuarios();
export const listarPermissoes = () => listPermissoes();

/** Capacidades de sessão do provider atual. */
export const capacidadesDeSessao = () => getCapacidadesDeSessao();

/**
 * Configurações públicas do app.
 *
 * Resultado discriminado: `{ok: true, value}` ou `{ok: false, reason}`, com
 * `reason` no vocabulário do produto. Nenhum erro de provider atravessa.
 *
 * @returns {ReturnType<typeof getAppPublicSettings>}
 */
export const carregarConfiguracoesPublicas = () => getAppPublicSettings();

/** Razões de recusa que a tela de login sabe tratar. */
export const RAZOES_DE_SESSAO_DO_PRODUTO = RAZOES_DE_SESSAO;

/* ─── Sessão nativa MAIKE (P4.0, D-PROD-24) ─────────────────────────────────
 *
 * Estas três funções são a autenticação **do aplicativo**. As de cima
 * continuam servindo o provider Base44 enquanto ele for a fonte de dados dos
 * cadastros ainda não migrados.
 *
 * Não existe ponte entre as duas. Um `catch` que tentasse a Base44 quando o
 * backend MAIKE falha seria dual-auth: mascararia o backend fora do ar como se
 * fosse sessão expirada, e ninguém descobriria que o serviço caiu. Ver
 * D-PROD-24, item G.
 */

/**
 * Autentica contra o backend nativo.
 *
 * Erro sobe como `ApiError` para a tela decidir a mensagem — em especial
 * `AUTH_INVALID_CREDENTIALS`, cujo texto público é o mesmo para cliente,
 * usuário ou senha errados, espelhando a resposta única do backend. Distinguir
 * os casos na tela desfaria a proteção contra enumeração que o `authService`
 * construiu com hash descartável e tempo constante.
 *
 * @param {{cliente: string, login: string, senha: string}} credenciais
 * @returns {Promise<{usuario: object, clienteId: string}>}
 */
export const entrarComSessaoNativa = (credenciais) => loginNativo(credenciais);

/**
 * Restaura a sessão nativa depois de um reload, validando no servidor.
 *
 * **Lança** quando a validade não pôde ser determinada (P4.0-R1). Isso é
 * deliberado: rede caída não é logout, e um veredito `{autenticado: false}`
 * nesse caso seria indistinguível de credencial recusada — que foi exatamente
 * o defeito corrigido. Token recusado é descartado pela camada de sessão;
 * indisponibilidade preserva o token. Ver `nativeSessionApi.restaurarSessao`.
 *
 * @returns {Promise<{autenticado: boolean, contexto: object|null}>}
 * @throws {ApiError} indisponibilidade — a sessão não foi validada nem negada
 */
export const restaurarSessaoNativaAtual = () => restaurarSessaoNativa();

/**
 * Encerra a sessão nativa.
 *
 * Só local: o JWT da P3 é stateless e não há sessão a invalidar no servidor.
 * Também limpa o usuário offline, que é cache de tela e não pode sobreviver a
 * uma troca de usuário na mesma máquina.
 */
export const sairDaSessaoNativa = () => {
  logoutNativo();
  try {
    localStorage.removeItem(OFFLINE_USER_KEY);
  } catch {
    // Cache local indisponível não impede o logout: o token já saiu.
  }
};

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
