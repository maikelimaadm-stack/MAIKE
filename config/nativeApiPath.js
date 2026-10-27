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
  const cortado = url.slice(NATIVE_API_PATH_PREFIX.length);
  if (!cortado || cortado === '/') return '/';
  return cortado.startsWith('/') ? cortado : `/${cortado}`;
};
