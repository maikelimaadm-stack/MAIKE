/**
 * Erro estável da fronteira de dados (P1.1, D-PROD-18).
 *
 * A UI trata erro por **código**, nunca por texto nem pelo formato do provider.
 * Quando a Base44 sair (P7), o provider muda e os códigos ficam.
 *
 * Segurança: `message` é sempre uma frase pública. O erro original vive em
 * `cause`, que não é serializado por `toString()` nem por `JSON.stringify`.
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
    if (info.cause !== undefined) this.cause = info.cause;
  }
}

/** É um {@link ApiError}? */
export const isApiError = (erro) => erro instanceof ApiError;

/**
 * Mensagem pronta para a UI.
 *
 * Aceita qualquer coisa: `ApiError`, `Error` do provider, string, `null`.
 * Nunca devolve `undefined` — o fallback é determinístico (QLT-P11-04).
 *
 * @param {unknown} erro
 * @param {string} [fallback]
 * @returns {string}
 */
export const getApiErrorMessage = (erro, fallback = 'Não foi possível concluir a operação.') => {
  if (isApiError(erro)) return erro.message || fallback;
  if (erro instanceof Error && erro.message) return erro.message;
  if (typeof erro === 'string' && erro.trim()) return erro.trim();
  return fallback;
};

/**
 * O erro tem este código?
 * @param {unknown} erro
 * @param {string} code
 */
export const hasApiErrorCode = (erro, code) => isApiError(erro) && erro.code === code;
