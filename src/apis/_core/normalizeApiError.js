/**
 * Normalização de erro do provider (P1.1).
 *
 * Tudo que sai da fronteira de dados é `ApiError`. O erro cru do provider —
 * com formato próprio, campos próprios e, potencialmente, dado sensível em
 * `response`/`config` — fica preso em `cause`, fora da mensagem pública.
 */

import { ApiError, API_ERROR_CODES, isApiError } from './ApiError.js';

/** Marcas de indisponibilidade que valem retentativa. */
const INDISPONIVEL = /\b(network|fetch failed|timeout|timed out|econnrefused|enotfound|service unavailable|bad gateway|gateway timeout)\b/i;

/** Status HTTP que o provider pode expor em campos variados. */
const extrairStatus = (erro) => {
  const bruto = erro?.status ?? erro?.statusCode ?? erro?.response?.status;
  return Number.isInteger(bruto) ? bruto : null;
};

const pareceIndisponivel = (erro) => {
  const status = extrairStatus(erro);
  if (status === 502 || status === 503 || status === 504) return true;
  const texto = typeof erro?.message === 'string' ? erro.message : '';
  return INDISPONIVEL.test(texto);
};

/**
 * Converte qualquer falha em `ApiError`.
 *
 * `ApiError` já normalizado passa intacto — o service pode lançar
 * `EMPRESA_NAME_CONFLICT` sem que a API o reclassifique como falha genérica.
 *
 * @param {unknown} erro
 * @param {{operation: string, resource: string, details?: object}} contexto
 * @returns {ApiError}
 */
export const normalizeApiError = (erro, contexto) => {
  if (isApiError(erro)) return erro;

  const code = pareceIndisponivel(erro)
    ? API_ERROR_CODES.PROVIDER_UNAVAILABLE
    : API_ERROR_CODES.OPERATION_FAILED;

  return new ApiError(code, {
    operation: contexto.operation,
    resource: contexto.resource,
    details: contexto.details ?? null,
    cause: erro,
  });
};

/**
 * Executa uma chamada ao provider já normalizando a falha.
 *
 * @template T
 * @param {() => Promise<T>} executar
 * @param {{operation: string, resource: string, details?: object}} contexto
 * @returns {Promise<T>}
 */
export const runProviderCall = async (executar, contexto) => {
  try {
    return await executar();
  } catch (erro) {
    throw normalizeApiError(erro, contexto);
  }
};

/**
 * Valida um argumento obrigatório, lançando `API_INVALID_ARGUMENT`.
 *
 * @param {boolean} condicao
 * @param {string} campo
 * @param {{operation: string, resource: string}} contexto
 */
export const assertArgument = (condicao, campo, contexto) => {
  if (condicao) return;
  throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
    operation: contexto.operation,
    resource: contexto.resource,
    details: { campo },
  });
};
