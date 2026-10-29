/**
 * Erros de domínio do ledger pecuário (L1).
 *
 * Classe própria — e não `AppError` — de propósito: `AppError` só aceita
 * códigos registrados em `shared/errors/errorCodes.js`, arquivo compartilhado
 * com outra frente em paralelo (PR #145). O L1 não toca nele; a integração
 * no mapa global de erros (status HTTP, mensagem pública) é passo do L2,
 * depois do rebase supervisionado. Os códigos abaixo são estáveis e já estão
 * documentados em `docs/engineering/MAIKE-ESTOQUE-PECUARIO-LEDGER-L1-CONTRATO.md`.
 */

export const CODIGOS_LEDGER_PECUARIO = Object.freeze({
  QUANTIDADE_INVALIDA: 'LEDGER_PECUARIO_QUANTIDADE_INVALIDA',
  CATEGORIA_INVALIDA: 'LEDGER_PECUARIO_CATEGORIA_INVALIDA',
  ORIGEM_INVALIDA: 'LEDGER_PECUARIO_ORIGEM_INVALIDA',
  DESTINO_INVALIDO: 'LEDGER_PECUARIO_DESTINO_INVALIDO',
  ORIGEM_IGUAL_DESTINO: 'LEDGER_PECUARIO_ORIGEM_IGUAL_DESTINO',
  EMPRESA_INVALIDA: 'LEDGER_PECUARIO_EMPRESA_INVALIDA',
  LOTE_REFERENCIA_INVALIDO: 'LEDGER_PECUARIO_LOTE_REFERENCIA_INVALIDO',
  SALDO_INSUFICIENTE: 'LEDGER_PECUARIO_SALDO_INSUFICIENTE',
  OPERACAO_INVALIDA: 'LEDGER_PECUARIO_OPERACAO_INVALIDA',
  DATA_INVALIDA: 'LEDGER_PECUARIO_DATA_INVALIDA',
  EVENTO_NAO_ENCONTRADO: 'LEDGER_PECUARIO_EVENTO_NAO_ENCONTRADO',
  ESTORNO_INVALIDO: 'LEDGER_PECUARIO_ESTORNO_INVALIDO',
  ESTORNO_DUPLICADO: 'LEDGER_PECUARIO_ESTORNO_DUPLICADO',
  IDEMPOTENCIA_CONFLITO: 'LEDGER_PECUARIO_IDEMPOTENCIA_CONFLITO',
  IDEMPOTENCIA_EM_PROCESSAMENTO: 'LEDGER_PECUARIO_IDEMPOTENCIA_EM_PROCESSAMENTO',
  CONCORRENCIA_ESGOTADA: 'LEDGER_PECUARIO_CONCORRENCIA_ESGOTADA',
  CONTEXTO_OBRIGATORIO: 'LEDGER_PECUARIO_CONTEXTO_OBRIGATORIO',
  ESQUEMA_INVALIDO: 'LEDGER_PECUARIO_ESQUEMA_INVALIDO',
});

const CODIGOS = new Set(/** @type {string[]} */ (Object.values(CODIGOS_LEDGER_PECUARIO)));

export class LedgerPecuarioError extends Error {
  /**
   * @param {string} code um de CODIGOS_LEDGER_PECUARIO
   * @param {string} message
   * @param {{ details?: Record<string, unknown>, cause?: unknown }} [opcoes]
   */
  constructor(code, message, opcoes = {}) {
    super(message || code, opcoes.cause !== undefined ? { cause: opcoes.cause } : undefined);
    if (!CODIGOS.has(code)) {
      throw new TypeError(`código de erro do ledger desconhecido: ${code}`);
    }
    this.name = 'LedgerPecuarioError';
    this.code = code;
    this.details = opcoes.details ?? {};
  }
}

/**
 * @param {unknown} erro
 * @param {string} [code]
 * @returns {erro is LedgerPecuarioError}
 */
export const ehErroLedger = (erro, code) =>
  erro instanceof LedgerPecuarioError && (code === undefined || erro.code === code);
