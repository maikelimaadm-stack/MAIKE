/**
 * Normalização de URL na fronteira Vercel → `api/fastify.js` (serverless).
 *
 * Rewrites com `:path*` propagam um parâmetro de query (`path` ou `__native_route`)
 * quando o destino não consome o curinga. Reconstruímos o path nativo aqui e
 * removemos metadados de plataforma antes do AJV — nunca repassamos `path` à
 * validação de negócio.
 */

import {
  NATIVE_API_PATH_PREFIX,
  reescreverUrlApiNativa,
} from './nativeApiPath.js';

/** Query param consumido pelo rewrite SSOT (`nativeApiRewriteRules.mjs`). */
export const NATIVE_ROUTE_QUERY_PARAM = '__native_route';

/** Nome legado que a Vercel injeta quando o destino não consome `:path*`. */
export const VERCEL_LEGACY_CAPTURED_PATH_QUERY = 'path';

/** @param {string} message */
export class RotaNativaIngressoInvalidoError extends Error {
  constructor(message = 'INVALID_NATIVE_ROUTE') {
    super(message);
    this.name = 'RotaNativaIngressoInvalidoError';
  }
}

/**
 * @param {string} bruto segmentos capturados pelo rewrite (sem barra inicial)
 * @returns {string} segmentos normalizados ou vazio
 */
export const validarSegmentosRotaNativa = (bruto) => {
  if (bruto == null || bruto === '') return '';
  let decoded = String(bruto);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    throw new RotaNativaIngressoInvalidoError();
  }
  if (
    decoded.includes('..') ||
    decoded.includes('//') ||
    decoded.includes('\\') ||
    /^\s|[\0\r\n]/.test(decoded)
  ) {
    throw new RotaNativaIngressoInvalidoError();
  }
  const trimmed = decoded.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed) return '';
  for (const part of trimmed.split('/')) {
    if (!part || part === '.' || part === '..') {
      throw new RotaNativaIngressoInvalidoError();
    }
  }
  return trimmed;
};

/**
 * Adaptador exclusivo da função serverless: reconstrói rota a partir do rewrite
 * e remove parâmetros internos da query.
 *
 * @param {string} url `req.url` na entrada de `/api/fastify`
 * @returns {string} path + query prontos para `rewriteUrl` do Fastify
 */
export const normalizarIngressoServerlessVercel = (url) => {
  if (typeof url !== 'string') return url;

  const queryIndex = url.indexOf('?');
  const pathname = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const search = queryIndex >= 0 ? url.slice(queryIndex + 1) : '';

  if (pathname !== '/api/fastify') {
    return reescreverUrlApiNativa(url);
  }

  const params = new URLSearchParams(search);
  const rotaCapturada =
    params.get(NATIVE_ROUTE_QUERY_PARAM) ?? params.get(VERCEL_LEGACY_CAPTURED_PATH_QUERY) ?? '';
  params.delete(NATIVE_ROUTE_QUERY_PARAM);
  params.delete(VERCEL_LEGACY_CAPTURED_PATH_QUERY);

  const segmentos = validarSegmentosRotaNativa(rotaCapturada);
  const pathNativo = segmentos
    ? `${NATIVE_API_PATH_PREFIX}/${segmentos}`
    : NATIVE_API_PATH_PREFIX;

  const queryLimpa = params.toString();
  const urlNativa = queryLimpa ? `${pathNativo}?${queryLimpa}` : pathNativo;
  return reescreverUrlApiNativa(urlNativa);
};
