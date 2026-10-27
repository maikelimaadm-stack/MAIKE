import { API_ERROR_CODES, hasApiErrorCode, isApiError } from '@/apis/_core/ApiError';

/**
 * Listagem de usuários negada sem derrubar a aba de permissões (comportamento P0).
 * Somente códigos conhecidos viram lista vazia; falha de rede/5xx não entram aqui.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isUsuariosListagemRestrita = (error) => {
  if (!isApiError(error)) return false;
  if (hasApiErrorCode(error, API_ERROR_CODES.INVALID_ARGUMENT)) {
    const cause = /** @type {{ code?: string } | null | undefined} */ (error.cause);
    return cause?.code === 'REQUEST_REJECTED';
  }
  return false;
};
