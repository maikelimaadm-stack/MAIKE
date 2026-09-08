/**
 * Erro de aplicação com código estável do contrato.
 *
 * A mensagem pública nunca carrega o erro original: a causa fica em `cause`,
 * para log, e o cliente recebe `{ code, message }`. É a mesma disciplina que a
 * P1 aplicou no frontend — a UI identifica pelo código, não pelo texto.
 */

import { ehCodigoConhecido, statusHttpDe } from './errorCodes.js';

export class AppError extends Error {
  /**
   * @param {string} code código do contrato
   * @param {string} [message] mensagem pública; sem segredo, sem SQL, sem stack
   * @param {{cause?: unknown, details?: Record<string, unknown>}} [options]
   */
  constructor(code, message, options = {}) {
    super(message || code, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = statusHttpDe(code);
    this.details = options.details;

    // Código desconhecido é defeito de programação, não condição de runtime:
    // ele vira 500 pelo fallback de `statusHttpDe`, e a marca abaixo permite
    // que teste e log distingam "erro interno de verdade" de "código que
    // alguém esqueceu de declarar".
    if (!ehCodigoConhecido(code)) {
      this.codigoDesconhecido = true;
    }
  }
}

/** @param {unknown} erro */
export const ehAppError = (erro) => erro instanceof AppError;

export const tenantContextRequired = (message, options) =>
  new AppError('TENANT_CONTEXT_REQUIRED', message || 'contexto de tenant ausente', options);

export const tenantScopeViolation = (message, options) =>
  new AppError('TENANT_SCOPE_VIOLATION', message || 'recurso pertence a outro cliente', options);

export const sequenceScopeInvalid = (message, details) =>
  new AppError('SEQUENCE_SCOPE_INVALID', message || 'escopo de sequência inválido', { details });

export const sequenceConflict = (message, options) =>
  new AppError('SEQUENCE_CONFLICT', message || 'não foi possível reservar o número', options);

export const attachmentInvalid = (message, details) =>
  new AppError('ATTACHMENT_INVALID', message || 'anexo inválido', { details });

export const attachmentOwnerInvalid = (message) =>
  new AppError('ATTACHMENT_OWNER_INVALID', message || 'proprietário do anexo não encontrado');

export const auditWriteFailed = (message, options) =>
  new AppError('AUDIT_WRITE_FAILED', message || 'falha ao registrar auditoria', options);

export const concurrencyConflict = (message, options) =>
  new AppError('CONCURRENCY_CONFLICT', message || 'conflito de concorrência', options);
