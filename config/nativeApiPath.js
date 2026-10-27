/**
 * Prefixo HTTP inequívoco da API nativa MAIKE (R4, D-PROD-36).
 *
 * Rotas REST deixam de competir com deep links SPA (`/produtos`, `/marcas`, …).
 * O cliente sempre chama `/api/native/...`; o adaptador Vercel/Fastify remove
 * o prefixo antes de rotear para os handlers existentes.
 */
export const NATIVE_API_PATH_PREFIX = '/api/native';

/** @param {string} caminho ex.: `/produtos` ou `/auth/login` */
export const comPrefixoApiNativa = (caminho) => {
  const relativo = caminho.startsWith('/') ? caminho : `/${caminho}`;
  if (relativo.startsWith(NATIVE_API_PATH_PREFIX)) return relativo;
  return `${NATIVE_API_PATH_PREFIX}${relativo}`;
};

/**
 * @param {string} url path + query, ex. `/api/native/produtos?x=1`
 * @returns {string}
 */
export const semPrefixoApiNativa = (url) => {
  if (typeof url !== 'string' || !url.startsWith(NATIVE_API_PATH_PREFIX)) return url;
  const resto = url.slice(NATIVE_API_PATH_PREFIX.length);
  // Fronteira exata: `/api/native` ou `/api/native/...` — não `/api/nativefake`.
  if (resto !== '' && !resto.startsWith('/')) return url;
  if (!resto || resto === '/') return '/';
  return resto;
};

/**
 * Normaliza path + query antes do roteamento Fastify (`rewriteUrl`).
 *
 * @param {string} url
 * @returns {string}
 */
export const reescreverUrlApiNativa = (url) => {
  if (typeof url !== 'string') return url;
  const queryIndex = url.indexOf('?');
  const pathOnly = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const query = queryIndex >= 0 ? url.slice(queryIndex) : '';
  return `${semPrefixoApiNativa(pathOnly)}${query}`;
};
