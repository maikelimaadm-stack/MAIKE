/**
 * Fronteira HTTP do backend nativo MAIKE (P4.0, D-PROD-24).
 *
 * Este é o **único** arquivo de `src/` autorizado a chamar `fetch` contra o
 * backend próprio. A P1 provou o valor dessa disciplina com a fronteira da
 * Base44: enquanto 68 arquivos falavam com o SDK, trocar de provider era
 * impossível; com uma porta só, virou uma edição.
 *
 * O que entra e o que sai:
 *
 *   entrada  caminho relativo + corpo simples
 *   saída    valor já desserializado, ou `ApiError`
 *
 * Nunca sai daqui um `Response`, um erro cru, um status HTTP solto ou o token.
 *
 * ─── A regra que mais importa: a mensagem do servidor é descartada ─────────
 *
 * O backend responde `{code, message, request_id}`. Nós usamos `code` e
 * **jogamos `message` fora**. Não é desconfiança do nosso próprio backend: é
 * que mensagem de servidor carrega caminho, id interno, fragmento de query e,
 * num dia ruim, eco de entrada do atacante. Exibi-la seria dar aparência
 * confiável a texto não controlado — exatamente o defeito que a P1.1-R2
 * corrigiu no `ApiError` (R2-B3).
 *
 * O texto exibível vem do catálogo local, indexado pelo `code`.
 */

import { getNativeApiUrl } from '@/config/runtimeConfig';
import { ApiError, API_ERROR_CODES } from './ApiError.js';
import { getNativeToken } from '@/lib/auth/nativeTokenStorage';

/** Requisição sem resposta em 20 s é tratada como indisponibilidade. */
const TIMEOUT_MS = 20000;

/**
 * Códigos do backend que o frontend entende **como eles são**.
 *
 * São os oito do contrato ModeloBase1 mais o de credencial. Cada um tem
 * mensagem pública própria em `ApiError`, então o código atravessa com o mesmo
 * nome — a UI pode tratar `TENANT_SCOPE_VIOLATION` diferente de
 * `CONCURRENCY_CONFLICT` sem inspecionar texto.
 */
const CODIGOS_PRESERVADOS = Object.freeze({
  TENANT_CONTEXT_REQUIRED: API_ERROR_CODES.TENANT_CONTEXT_REQUIRED,
  TENANT_SCOPE_VIOLATION: API_ERROR_CODES.TENANT_SCOPE_VIOLATION,
  SEQUENCE_SCOPE_INVALID: API_ERROR_CODES.SEQUENCE_SCOPE_INVALID,
  SEQUENCE_CONFLICT: API_ERROR_CODES.SEQUENCE_CONFLICT,
  ATTACHMENT_INVALID: API_ERROR_CODES.ATTACHMENT_INVALID,
  ATTACHMENT_OWNER_INVALID: API_ERROR_CODES.ATTACHMENT_OWNER_INVALID,
  AUDIT_WRITE_FAILED: API_ERROR_CODES.AUDIT_WRITE_FAILED,
  CONCURRENCY_CONFLICT: API_ERROR_CODES.CONCURRENCY_CONFLICT,
  AUTH_INVALID_CREDENTIALS: API_ERROR_CODES.AUTH_INVALID_CREDENTIALS,
  // P4.1: 404 de Setor. Preservado porque a tela age sobre ele — recarregar a
  // lista resolve — e isso não é a mesma coisa que "a operação falhou".
  SETOR_NOT_FOUND: API_ERROR_CODES.SETOR_NOT_FOUND,
});

/**
 * Códigos que só existem no backend e não viram vocabulário de tela.
 *
 * `REQUEST_VALIDATION_FAILED` e `REQUEST_REJECTED` são "a requisição estava
 * errada" — para o usuário isso é argumento inválido. `INTERNAL_ERROR` é "o
 * servidor falhou", que já é a falha genérica.
 */
const TRADUCAO_BACKEND_ONLY = Object.freeze({
  REQUEST_VALIDATION_FAILED: API_ERROR_CODES.INVALID_ARGUMENT,
  REQUEST_REJECTED: API_ERROR_CODES.INVALID_ARGUMENT,
  INTERNAL_ERROR: API_ERROR_CODES.OPERATION_FAILED,
});

const ehObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

/** `request_id` é o único campo da resposta de erro que vale guardar. */
const detalhesSeguros = (corpo, details) => {
  const requestId = typeof corpo?.request_id === 'string' ? corpo.request_id : null;
  if (!requestId && !details) return null;
  return { ...(details ?? {}), ...(requestId ? { requestId } : {}) };
};

/**
 * Traduz o código do backend para o vocabulário do frontend.
 *
 * Código desconhecido — backend mais novo que o bundle, proxy no meio, resposta
 * de outra coisa — vira falha genérica. Nunca atravessa cru: um código não
 * catalogado chegaria à UI sem mensagem pública e cairia no texto padrão de
 * qualquer jeito, mas carimbado como se fosse contrato.
 */
const traduzirCodigo = (codigo) => {
  if (typeof codigo !== 'string' || !codigo) return API_ERROR_CODES.OPERATION_FAILED;
  // Mapa em vez de `Set`: devolver a chave encontrada no mapa preserva o tipo
  // literal do código. Com `Set.has(x) ? x : ...` o retorno vira `string` solto,
  // e o contrato de `ApiError` — que aceita só códigos catalogados — deixaria de
  // ser verificável.
  return (
    CODIGOS_PRESERVADOS[codigo] ?? TRADUCAO_BACKEND_ONLY[codigo] ?? API_ERROR_CODES.OPERATION_FAILED
  );
};

/**
 * Monta a URL final.
 *
 * O caminho é sempre relativo e literal, definido pelo código — nunca vem de
 * entrada do usuário. Concatenar aqui uma URL arbitrária permitiria apontar o
 * `Authorization` para outro servidor.
 */
const montarUrl = (base, caminho) => `${base}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;

const erroDeIndisponibilidade = (contexto, cause) =>
  new ApiError(API_ERROR_CODES.PROVIDER_UNAVAILABLE, {
    operation: contexto.operation,
    resource: contexto.resource,
    details: contexto.details ?? null,
    cause,
  });

/**
 * Lê o corpo como JSON quando houver corpo.
 *
 * 204 e corpo vazio são normais: `logout` e `DELETE` respondem assim. JSON
 * inválido não derruba — vira `null` e o status decide o resultado.
 */
const lerCorpo = async (resposta) => {
  if (resposta.status === 204) return null;
  const texto = await resposta.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
};

/**
 * Executa uma requisição contra o backend nativo.
 *
 * @param {string} caminho caminho literal, ex.: `/auth/login`
 * @param {{method?: 'GET'|'POST'|'PATCH'|'DELETE', body?: object|null, autenticado?: boolean}} opcoes
 * @param {{operation: string, resource: string, details?: object}} contexto
 * @returns {Promise<unknown>}
 */
export const nativeRequest = async (caminho, opcoes, contexto) => {
  const { method = 'GET', body = null, autenticado = false } = opcoes;
  const base = getNativeApiUrl();

  // Sem URL configurada não existe "tentar assim mesmo": chamar caminho
  // relativo bateria no host do frontend e devolveria o `index.html`, que
  // falharia como JSON inválido e viraria um erro sem sentido.
  if (!base) {
    throw erroDeIndisponibilidade(contexto, new Error('VITE_MAIKE_API_URL ausente'));
  }

  /** @type {Record<string, string>} */
  const headers = { Accept: 'application/json' };
  if (body !== null) headers['Content-Type'] = 'application/json';

  if (autenticado) {
    const token = getNativeToken();
    if (!token) {
      // Sem token, a requisição autenticada não sai. Mandá-la assim renderia
      // um 401 do servidor com o mesmo significado e uma ida à rede a mais.
      throw new ApiError(API_ERROR_CODES.TENANT_CONTEXT_REQUIRED, {
        operation: contexto.operation,
        resource: contexto.resource,
        details: contexto.details ?? null,
      });
    }
    headers.Authorization = `Bearer ${token}`;
  }

  // `AbortController` em vez de `AbortSignal.timeout`: o segundo só existe no
  // Node 17.3+/navegadores recentes, e o `clearTimeout` evita segurar o
  // processo vivo em teste.
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  let resposta;
  try {
    resposta = await fetch(montarUrl(base, caminho), {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      signal: controlador.signal,
      // Bearer, não cookie. `credentials: 'omit'` é explícito de propósito: o
      // CORS do backend não habilita credenciais, e mandar cookie de terceira
      // origem só criaria superfície de CSRF sem nenhum ganho.
      credentials: 'omit',
    });
  } catch (erro) {
    // Rede caída, DNS, CORS recusado e abort caem todos aqui, e todos
    // significam a mesma coisa para quem está na tela: o serviço não respondeu.
    throw erroDeIndisponibilidade(contexto, erro);
  } finally {
    clearTimeout(timer);
  }

  const corpo = await lerCorpo(resposta);

  if (resposta.ok) return corpo;

  // 502/503/504 são indisponibilidade de infraestrutura, não erro de contrato:
  // o corpo pode nem ser do nosso backend (proxy, load balancer).
  if (resposta.status === 502 || resposta.status === 503 || resposta.status === 504) {
    throw erroDeIndisponibilidade(contexto, new Error(`HTTP ${resposta.status}`));
  }

  const codigo = traduzirCodigo(ehObjeto(corpo) ? corpo.code : null);

  throw new ApiError(codigo, {
    operation: contexto.operation,
    resource: contexto.resource,
    details: detalhesSeguros(corpo, contexto.details),
    // O corpo inteiro fica em `cause`, que o `ApiError` define como não
    // enumerável — some de `JSON.stringify`, inclusive a `message` do servidor.
    cause: corpo,
  });
};
