/**
 * Normaliza pathname para o shell SPA (minúsculas, sem barra final redundante).
 * Query e hash ficam fora — o chamador remonta a URL completa.
 *
 * @param {string} pathname
 * @returns {string}
 */
export const normalizeAppPathname = (pathname) => {
  if (typeof pathname !== 'string' || !pathname) return '/';
  let p = pathname.toLowerCase();
  if (p.length > 1 && p.endsWith('/')) {
    p = p.slice(0, -1);
  }
  return p;
};
