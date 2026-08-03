/**
 * Erro estável da fronteira de dados (P1.1, D-PROD-18).
 *
 * A UI trata erro por **código**, nunca por texto nem pelo formato do provider.
 * Quando a Base44 sair (P7), o provider muda e os códigos ficam.
 *
 * Segurança: `message` é sempre uma frase pública **do catálogo** — o
 * construtor não aceita texto do chamador (R2-B3). O erro original vive em
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

  // P1.2 — Mapa
  MAPA_DELETE_BLOCKED: 'MAPA_DELETE_BLOCKED',
  MAPA_PARTIAL_OPERATION: 'MAPA_PARTIAL_OPERATION',
});

/** Mensagem pública por código. Nunca inclui dado do provider. */
const MENSAGENS = Object.freeze({
  [API_ERROR_CODES.OPERATION_FAILED]: 'Não foi possível concluir a operação.',
  [API_ERROR_CODES.INVALID_ARGUMENT]: 'Dados inválidos para a operação.',
  [API_ERROR_CODES.PROVIDER_UNAVAILABLE]: 'Serviço de dados indisponível no momento.',
  [API_ERROR_CODES.EMPRESA_NAME_CONFLICT]: 'Já existe uma empresa cadastrada com este nome.',
  [API_ERROR_CODES.MAPA_DELETE_BLOCKED]: 'Não é possível excluir: existem registros vinculados.',
  [API_ERROR_CODES.MAPA_PARTIAL_OPERATION]: 'A operação foi concluída apenas em parte. Confira os dados antes de repetir.',
});

/** Falha transitória vale retentativa; erro de argumento e conflito, não. */
const RETRYABLE = Object.freeze({
  [API_ERROR_CODES.PROVIDER_UNAVAILABLE]: true,
});

/** Última linha de defesa quando o código não está catalogado. */
const MENSAGEM_PADRAO = 'Não foi possível concluir a operação.';

export class ApiError extends Error {
  /**
   * A mensagem pública vem **só do catálogo**, indexada pelo código.
   *
   * A versão anterior aceitava `info.message` e usava `info.message || catálogo`.
   * Isso tornava falsa a única garantia que a UI tinha: qualquer chamador podia
   * escrever `new ApiError(code, { message: erroCruDoProvider.message })` e a
   * mensagem — com URL, query string ou cabeçalho dentro — ia direto para o
   * toast, agora carimbada como confiável por ser `ApiError` (R2-B3).
   *
   * `message` recebido é **ignorado**, não recusado: lançar aqui transformaria
   * um vazamento de texto em quebra de fluxo de erro em produção, e o objetivo
   * é o contrário. O contexto do chamador continua inteiro em `cause` e
   * `details`, que a UI nunca exibe.
   *
   * Mensagem parametrizada, se um dia houver necessidade real, entra como
   * código próprio com formatador público — nunca como texto livre.
   *
   * @param {string} code um valor de {@link API_ERROR_CODES}
   * @param {{operation?: string, resource?: string, cause?: unknown, details?: object}} [info]
   */
  constructor(code, info = {}) {
    super(MENSAGENS[code] || MENSAGEM_PADRAO);
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
