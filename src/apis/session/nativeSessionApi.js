/**
 * Sessão nativa MAIKE (P4.0, D-PROD-24).
 *
 * Fala com o backend criado na P3: `POST /auth/login` e `GET /auth/contexto`.
 * É a fronteira onde o token nasce, é guardado e é descartado — nenhuma tela,
 * hook ou service manipula o JWT.
 *
 * ─── O contrato de login, e o campo que ele NÃO tem ────────────────────────
 *
 * O corpo é exatamente `{cliente, login, senha}`. `cliente` é o **código
 * operacional** do tenant, digitado por quem entra; `cliente_id` é o que o
 * backend **devolve** depois de autenticar.
 *
 * Essa inversão é a regra de tenancy inteira em uma linha: se o cliente HTTP
 * pudesse enviar `cliente_id`, o tenant viria do payload, e a P3 gastou um gate
 * (`P3-TEN-SOURCE`) e cinco provas negativas para garantir que não vem. O
 * backend recusa `cliente_id` no corpo com 400 — `additionalProperties: false`
 * mais `removeAdditional: false` —, mas não é por isso que não mandamos: não
 * mandamos porque não é nosso.
 *
 * ─── Logout ────────────────────────────────────────────────────────────────
 *
 * Não existe chamada ao servidor. O JWT da P3 é **stateless**: assinado, com
 * expiração, sem registro de sessão. Não há o que invalidar do lado de lá —
 * descartar o token no navegador é o logout completo que esta arquitetura
 * permite. Revogação de verdade exige lista de invalidação ou refresh token
 * com rotação, e isso é da fase de segurança (P8), não desta fatia.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import { ApiError, API_ERROR_CODES, isApiError, hasApiErrorCode } from '../_core/ApiError.js';
import { hasNativeToken, setNativeToken, clearNativeToken } from '@/lib/auth/nativeTokenStorage';

const RESOURCE = 'SessaoNativa';
const ctx = (operation) => ({ operation, resource: RESOURCE });

const texto = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : '');
/**
 * Type guard, não só predicado booleano.
 *
 * O transporte devolve `unknown` de propósito. Sem o predicado declarado, as
 * checagens abaixo continuariam corretas em runtime mas o compilador seguiria
 * vendo `unknown`, e ler qualquer campo exigiria um `any` — que é trocar
 * verificação por silêncio.
 *
 * @param {unknown} valor
 * @returns {valor is Record<string, unknown>}
 */
const ehObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

/**
 * @typedef {{token: string, usuario: {id: string, login?: string, nome?: string}, cliente_id: string}} RespostaDeLogin
 * @typedef {{cliente_id: string, usuario_id: string, login: string, request_id?: string}} ContextoDeSessao
 */

/**
 * A resposta de login precisa trazer token, usuário e tenant.
 *
 * Validada em vez de assumida: resposta 200 com corpo diferente do contrato
 * — proxy que reescreve, backend de outra versão, HTML de erro com status 200 —
 * deixaria a sessão "autenticada" sem token utilizável.
 *
 * Declarada como **type guard**: o transporte devolve `unknown` de propósito, e
 * esta é a função que decide que o corpo cumpre o contrato. Sem o predicado, o
 * conhecimento existiria em runtime e não no tipo, e cada leitura de campo
 * adiante precisaria de um `any` para compilar — trocando verificação por
 * silêncio.
 *
 * @param {unknown} corpo
 * @returns {corpo is RespostaDeLogin}
 */
const respostaDeLoginValida = (corpo) =>
  ehObjeto(corpo) &&
  texto(corpo.token) !== '' &&
  ehObjeto(corpo.usuario) &&
  texto(corpo.usuario.id) !== '' &&
  texto(corpo.cliente_id) !== '';

/**
 * O contexto precisa identificar tenant e usuário.
 *
 * @param {unknown} corpo
 * @returns {corpo is ContextoDeSessao}
 */
const contextoValido = (corpo) =>
  ehObjeto(corpo) && texto(corpo.cliente_id) !== '' && texto(corpo.usuario_id) !== '';

/**
 * Autentica e ativa a sessão.
 *
 * Sequência deliberada: autentica, guarda o token, e só considera a sessão
 * válida depois de `/auth/contexto` responder. Confiar no 200 do login e pular
 * a confirmação deixaria passar um token que o próprio backend não aceita
 * — relógio fora de hora, segredo trocado entre instâncias, TTL zerado.
 *
 * Falha em qualquer ponto limpa o token: sessão pela metade é pior que sessão
 * ausente, porque a tela acha que está dentro.
 *
 * @param {{cliente: string, login: string, senha: string}} credenciais
 * @returns {Promise<{usuario: object, clienteId: string}>}
 */
export const login = async (credenciais) => {
  const cliente = texto(credenciais?.cliente);
  const usuarioLogin = texto(credenciais?.login);
  const senha = typeof credenciais?.senha === 'string' ? credenciais.senha : '';

  if (!cliente || !usuarioLogin || !senha) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      ...ctx('login'),
      details: { campos: ['cliente', 'login', 'senha'] },
    });
  }

  // Exatamente três campos. Nunca `cliente_id`, nunca `usuario_id`.
  const corpo = await nativeRequest(
    '/auth/login',
    { method: 'POST', body: { cliente, login: usuarioLogin, senha } },
    ctx('login')
  );

  if (!respostaDeLoginValida(corpo)) {
    clearNativeToken();
    throw new ApiError(API_ERROR_CODES.OPERATION_FAILED, ctx('login'));
  }

  setNativeToken(corpo.token);

  try {
    await obterContexto();
  } catch (erro) {
    clearNativeToken();
    throw isApiError(erro) ? erro : new ApiError(API_ERROR_CODES.OPERATION_FAILED, ctx('login'));
  }

  return {
    usuario: {
      id: corpo.usuario.id,
      login: texto(corpo.usuario.login),
      nome: texto(corpo.usuario.nome),
    },
    clienteId: corpo.cliente_id,
  };
};

/**
 * Contexto derivado do token, direto do backend.
 *
 * É a prova viva de que o tenant vem da sessão: a resposta não depende de nada
 * que o navegador tenha enviado além do `Authorization`.
 *
 * @returns {Promise<ContextoDeSessao>}
 */
export const obterContexto = async () => {
  const corpo = await nativeRequest('/auth/contexto', { autenticado: true }, ctx('obterContexto'));
  if (!contextoValido(corpo)) {
    throw new ApiError(API_ERROR_CODES.OPERATION_FAILED, ctx('obterContexto'));
  }
  return corpo;
};

/**
 * Restaura a sessão de um reload, **validando** contra o servidor.
 *
 * A presença do token no `sessionStorage` não é evidência de sessão válida: ele
 * pode estar expirado, ter sido assinado por um segredo antigo ou pertencer a
 * outro ambiente. Quem decide é o backend.
 *
 * ─── Falha de autenticação ≠ falha de disponibilidade (P4.0-R1) ────────────
 *
 * A primeira versão desta função limpava o token para **qualquer** erro, e eu
 * havia escrito um comentário justificando isso — o que tornou a decisão errada
 * ainda mais difícil de enxergar, porque parecia deliberada.
 *
 * O defeito: rede caída, timeout, CORS recusado e 500 do servidor viravam
 * `{autenticado: false}`, indistinguível de "sua credencial foi recusada". Na
 * prática, um backend fora do ar por trinta segundos destruía a sessão de quem
 * estava trabalhando e exigia senha de novo — punindo o usuário por uma falha
 * de infraestrutura, e apagando a única credencial que ele tinha.
 *
 * As duas classes agora têm saídas diferentes:
 *
 *   TENANT_CONTEXT_REQUIRED → o servidor **decidiu**: a credencial não vale.
 *                             Limpa o token e devolve veredito.
 *
 *   qualquer outra falha    → o servidor **não respondeu** nada sobre a
 *                             credencial. Preserva o token e **lança**, para
 *                             que a camada de cima distinga "não consegui
 *                             validar" de "validei e foi recusada".
 *
 * Devolver `{autenticado: false}` na segunda classe seria continuar mentindo,
 * só que sem apagar o token — o chamador ainda leria como logout.
 *
 * Isto **não** é confiar no token guardado: a sessão só é considerada válida
 * com confirmação do servidor. O aplicativo continua fechado enquanto não
 * houver resposta. É fail-closed sem destruir a credencial.
 *
 * @returns {Promise<{autenticado: boolean, contexto: ContextoDeSessao|null}>}
 * @throws {ApiError} quando a validade não pôde ser determinada
 */
export const restaurarSessao = async () => {
  if (!hasNativeToken()) return { autenticado: false, contexto: null };

  try {
    return { autenticado: true, contexto: await obterContexto() };
  } catch (erro) {
    // O único caso em que o servidor se pronunciou sobre a credencial. Deixar
    // um token recusado guardado só produz um 401 por requisição até alguém
    // perceber.
    if (hasApiErrorCode(erro, API_ERROR_CODES.TENANT_CONTEXT_REQUIRED)) {
      clearNativeToken();
      return { autenticado: false, contexto: null };
    }

    // Indisponibilidade: o token continua onde está. Ele pode estar
    // perfeitamente válido — ninguém perguntou ao servidor ainda.
    throw isApiError(erro) ? erro : new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, ctx('restaurarSessao'));
  }
};

/**
 * Encerra a sessão local.
 *
 * Sem ida ao servidor, pelo motivo explicado no cabeçalho. Síncrono de
 * propósito: não há nada para esperar, e uma promessa aqui sugeriria que existe.
 */
export const logout = () => {
  clearNativeToken();
};

/**
 * Existe token guardado? Não afirma que ele é válido — só que existe.
 *
 * Presença, nunca valor. Esta API decide **se** vale perguntar ao servidor; ela
 * não monta requisição, e por isso não tem motivo para ver o token. Quem lê o
 * valor é só o cliente HTTP, e `gate:native-api` verifica isso
 * (`P4-NATIVE-HTTP-BOUNDARY`).
 */
export const temSessaoLocal = () => hasNativeToken();
