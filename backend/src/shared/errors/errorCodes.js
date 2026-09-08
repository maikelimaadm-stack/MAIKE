/**
 * Vocabulário de erro do contrato ModeloBase1 Pecuário.
 *
 * Os oito códigos e o mapeamento HTTP vêm de
 * `config/modelobase1-pecuario.json` → `errorCodes`. Este arquivo é a
 * materialização backend desse contrato, prevista em
 * `errorNamespace.backend = "backend/src/shared/errors/"`.
 *
 * Eles NÃO foram adicionados a `src/apis/_core/ApiError.js` nesta missão: a P3
 * não altera `src/` (P3-G0.3). A sincronização com o catálogo do frontend fica
 * declaradamente adiada para a primeira missão que autorizar tocar em `src/`.
 * O campo `errorNamespace.addedToFrontendCatalogInPhase = "P3"` do contrato,
 * portanto, **não** foi cumprido — e o contrato não foi alterado para esconder
 * isso.
 */

/** @type {Readonly<Record<string, {http: number, meaning: string}>>} */
export const ERROR_CODES = Object.freeze({
  TENANT_CONTEXT_REQUIRED: {
    http: 401,
    meaning: 'requisição sem contexto de tenant autenticado',
  },
  TENANT_SCOPE_VIOLATION: {
    http: 403,
    meaning: 'recurso pertence a outro cliente_id',
  },
  SEQUENCE_SCOPE_INVALID: {
    http: 400,
    meaning: 'escopo de sequência não declarado pela capacidade',
  },
  SEQUENCE_CONFLICT: {
    http: 409,
    meaning: 'reserva de número não pôde ser concluída',
  },
  ATTACHMENT_INVALID: {
    http: 400,
    meaning: 'mime, tamanho ou nome de anexo reprovado',
  },
  ATTACHMENT_OWNER_INVALID: {
    http: 404,
    meaning: 'entidade + entidade_id não identificam registro do tenant',
  },
  AUDIT_WRITE_FAILED: {
    http: 500,
    meaning: 'falha crítica de auditoria; observável, nunca silenciosa',
  },
  CONCURRENCY_CONFLICT: {
    http: 409,
    meaning: 'unique constraint barrou escrita concorrente',
  },
});

/** Códigos do contrato, em ordem estável. */
export const CODIGOS_DO_CONTRATO = Object.freeze(Object.keys(ERROR_CODES));

/**
 * Códigos próprios do backend, **além** do mínimo do contrato.
 *
 * O contrato chama os oito acima de "vocabulário futuro mínimo" — mínimo, não
 * exaustivo. O backend precisa de dois códigos que ele não previu:
 *
 *  - `AUTH_INVALID_CREDENTIALS`: falha de login. Não é
 *    `TENANT_CONTEXT_REQUIRED`, que descreve requisição sem contexto, e forçar
 *    um no outro tornaria os dois imprecisos;
 *  - `INTERNAL_ERROR`: erro não previsto, sempre 500 com corpo genérico.
 *
 * Esta lista fica separada de propósito: `ERROR_CODES` continua sendo
 * exatamente o conjunto do contrato, verificável por teste, sem diluição.
 */
export const BACKEND_ONLY_CODES = Object.freeze({
  AUTH_INVALID_CREDENTIALS: { http: 401, meaning: 'credenciais inválidas' },
  REQUEST_VALIDATION_FAILED: { http: 400, meaning: 'corpo ou parâmetro fora do schema' },
  REQUEST_REJECTED: { http: 400, meaning: 'requisição recusada pelo framework' },
  INTERNAL_ERROR: { http: 500, meaning: 'erro não previsto' },
});

/**
 * Status HTTP de um código conhecido.
 * @param {string} codigo
 * @returns {number} 500 para código desconhecido
 */
export const statusHttpDe = (codigo) =>
  ERROR_CODES[codigo]?.http ?? BACKEND_ONLY_CODES[codigo]?.http ?? 500;

/** Verdadeiro só para os oito códigos do contrato. */
export const ehCodigoDoContrato = (codigo) =>
  Object.prototype.hasOwnProperty.call(ERROR_CODES, codigo);

/** Verdadeiro para qualquer código que o backend saiba traduzir em HTTP. */
export const ehCodigoConhecido = (codigo) =>
  ehCodigoDoContrato(codigo) || Object.prototype.hasOwnProperty.call(BACKEND_ONLY_CODES, codigo);
