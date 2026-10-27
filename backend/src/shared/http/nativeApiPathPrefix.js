import {
  NATIVE_API_PATH_PREFIX,
  semPrefixoApiNativa,
} from '../../../../config/nativeApiPath.js';

export { NATIVE_API_PATH_PREFIX, semPrefixoApiNativa };

/**
 * Remove o prefixo `/api/native` do path da requisição (query preservada).
 *
 * @param {import('fastify').FastifyRequest} request
 */
export const aplicarStripPrefixoApiNativa = (request) => {
  const bruto = request.raw.url ?? request.url;
  if (typeof bruto !== 'string' || !bruto.startsWith(NATIVE_API_PATH_PREFIX)) return;
  const normalizado = semPrefixoApiNativa(bruto.split('?')[0]);
  const query = bruto.includes('?') ? bruto.slice(bruto.indexOf('?')) : '';
  request.raw.url = `${normalizado}${query}`;
};
