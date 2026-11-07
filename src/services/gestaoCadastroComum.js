/**
 * Peças comuns dos services de Gestão Rural (D-PROD-145).
 */

import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

/** Sem empresa REAL não existe gravação: falha local, antes de qualquer rede. */
export const exigirEmpresa = (empresaId, operation, resource) => {
  if (typeof empresaId === 'string' && empresaId.trim()) return empresaId;
  throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, { operation, resource, details: { campo: 'empresa_id' } });
};

/** Valor comparável: texto aparado, vazio = null; listas ordenadas. */
const comparavel = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (Array.isArray(v)) return JSON.stringify([...v].map(String).sort());
  return v;
};

/**
 * Só os campos que mudaram em relação ao registro original (PATCH mínimo).
 * Texto vazio vai como `null` (limpa o campo no servidor).
 * @param {Record<string, any>|null|undefined} original
 * @param {Record<string, any>} novo
 * @param {readonly string[]} campos
 */
export const camposAlterados = (original, novo, campos) => {
  /** @type {Record<string, any>} */
  const saida = {};
  for (const campo of campos) {
    if (!Object.prototype.hasOwnProperty.call(novo ?? {}, campo)) continue;
    const valor = novo[campo];
    if (comparavel(valor) === comparavel(original?.[campo])) continue;
    saida[campo] = typeof valor === 'string' && valor.trim() === '' ? null : typeof valor === 'string' ? valor.trim() : valor;
  }
  return saida;
};

/** Página vazia (sem empresa a lista não é buscada). @param {number} [limit] */
export const paginaVazia = (limit = 100) => ({ items: [], next_cursor: null, has_more: false, total: 0, limit });
