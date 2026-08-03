/**
 * Erro estável da fronteira de dados (P1.1, D-PROD-18).
 *
 * A UI trata erro por **código**, nunca por texto nem pelo formato do provider.
 * Quando a Base44 sair (P7), o provider muda e os códigos ficam.
 *
 * Segurança: `message` é sempre uma frase pública. O erro original vive em
 * `cause`, definido como **não enumerável** — não aparece em `Object.keys` nem
 * em `JSON.stringify`, mesmo quando é um objeto simples com `Authorization`,
 * `config` ou `response` dentro. Atribuir `this.cause = x` criaria propriedade
 * enumerável e vazaria tudo isso no primeiro `JSON.stringify(erro)` de um log.
 *
 * Nenhum token, chave ou payload entra na mensagem.
 */

/** Códigos estáveis. Só entram aqui os que têm uso real. */
export const API_ERROR_CODES = Object.freeze({
  OPERATION_FAILED: 'API_OPERATION_FAILED',
  INVALID_ARGUMENT: 'API_INVALID_ARGUMENT',
  PROVIDER_UNAVAILABLE: 'API_PROVIDER_UNAVAILABLE',
  EMPRESA_NAME_CONFLICT: 'EMPRESA_NAME_CONFLICT',
});

/** Mensagem pública por código. Nunca inclui dado do provider. */
const MENSAGENS = Object.freeze({
  [API_ERROR_CODES.OPERATION_FAILED]: 'Não foi possível concluir a operação.',
  [API_ERROR_CODES.INVALID_ARGUMENT]: 'Dados inválidos para a operação.',
  [API_ERROR_CODES.PROVIDER_UNAVAILABLE]: 'Serviço de dados indisponível no momento.',
  [API_ERROR_CODES.EMPRESA_NAME_CONFLICT]: 'Já existe uma empresa cadastrada com este nome.',
});

/** Falha transitória vale retentativa; erro de argumento e conflito, não. */
const RETRYABLE = Object.freeze({
  [API_ERROR_CODES.PROVIDER_UNAVAILABLE]: true,
});

export class ApiError extends Error {
  /**
   * @param {string} code um valor de {@link API_ERROR_CODES}
   * @param {{operation?: string, resource?: string, cause?: unknown, details?: object, message?: string}} [info]
   */
  constructor(code, info = {}) {
    super(info.message || MENSAGENS[code] || MENSAGENS[API_ERROR_CODES.OPERATION_FAILED]);
    this.name = 'ApiError';
    this.code = code;
    this.operation = info.operation ?? null;
    this.resource = info.resource ?? null;
    this.retryable = RETRYABLE[code] === true;
    /** Contexto seguro (ids, nomes de campo). Nunca payload inteiro. */
    this.details = info.details ?? null;
    if (info.cause !== undefined) {
      // Acessível para diagnóstico, invisível para serialização.
      Object.defineProperty(this, 'cause', {
        value: info.cause,
        enumerable: false,
        configurable: true,
        writable: false,
      });
    }
  }
}

/** É um {@link ApiError}? */
export const isApiError = (erro) => erro instanceof ApiError;

/** Última linha de defesa quando nem o fallback do chamador serve. */
const MENSAGEM_PADRAO = 'Não foi possível concluir a operação.';

/**
 * Mensagem pronta para a UI.
 *
 * **Só `ApiError` tem mensagem exibível.** Qualquer outra coisa — `Error` do
 * provider, string solta, objeto, `null` — cai no fallback público.
 *
 * A versão anterior devolvia `erro.message` de um `Error` desconhecido. Isso
 * colocava texto não normalizado direto no toast: mensagem de SDK costuma
 * carregar URL com query string, cabeçalho ou trecho de payload. Erro que não
 * passou pela normalização não tem mensagem pública — tem fallback.
 *
 * Nunca devolve `undefined`, string vazia ou só espaço (QLT-P11-04).
 *
 * @param {unknown} erro
 * @param {string} [fallback]
 * @returns {string}
 */
export const getApiErrorMessage = (erro, fallback = MENSAGEM_PADRAO) => {
  const seguro = typeof fallback === 'string' && fallback.trim() ? fallback.trim() : MENSAGEM_PADRAO;
  if (isApiError(erro) && typeof erro.message === 'string' && erro.message.trim()) {
    return erro.message;
  }
  return seguro;
};

/**
 * O erro tem este código?
 * @param {unknown} erro
 * @param {string} code
 */
export const hasApiErrorCode = (erro, code) => isApiError(erro) && erro.code === code;
