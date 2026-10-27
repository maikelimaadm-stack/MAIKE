/**
 * Regras de rewrite Vercel: API nativa same-origin (D-PROD-36) + deep links SPA.
 *
 * R4: a API expõe-se só em `/api/native/*` (SSOT: `config/nativeApiPath.js`).
 * Deep links SPA (`/produtos`, `/marcas`, …) vão sempre para `/index.html` sem
 * competir com rotas REST no mesmo path.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NATIVE_API_PATH_PREFIX } from '../../config/nativeApiPath.js';

/** @typedef {{ source: string, destination: string, has?: object[], missing?: object[] }} VercelRewrite */

/** Entrada única da API nativa na Vercel — sem guard de Accept. */
const REWRITES_API_NATIVA = [
  { source: NATIVE_API_PATH_PREFIX, destination: '/api/fastify' },
  {
    source: `${NATIVE_API_PATH_PREFIX}/:path*`,
    // Consome `:path*` no destino para não propagar `path` à query (PR #105).
    destination: '/api/fastify?__native_route=:path*',
  },
];

/** @param {string} pageName */
const pagePathFromName = (pageName) => `/${pageName.toLowerCase()}`;

/** Paths de páginas SPA (SSOT: config/mapa-manejo-scope.json). */
const buildSpaPageRewrites = () => {
  const scopePath = join(process.cwd(), 'config/mapa-manejo-scope.json');
  const scope = JSON.parse(readFileSync(scopePath, 'utf8'));
  /** @type {string[]} */
  const paths = [];
  for (const pageName of scope.allowedPages) {
    const lower = pagePathFromName(pageName);
    paths.push(lower);
    paths.push(`${lower}/`);
    paths.push(`/${pageName}`);
    paths.push(`/${pageName}/`);
  }
  const unique = [...new Set(paths)].sort((a, b) => b.length - a.length);
  return unique.map((source) => ({
    source,
    destination: '/index.html',
  }));
};

/** @returns {VercelRewrite[]} */
export const buildNativeApiRewrites = () => [
  ...REWRITES_API_NATIVA,
  ...buildSpaPageRewrites(),
];

/** @deprecated R4 — colisões SPA/API eliminadas via `/api/native`; mantido para testes legados. */
export const VERCEL_SPA_DOCUMENT_ACCEPT_GUARD = Object.freeze({
  missing: [{ type: 'header', key: 'accept', value: '(?i)text/html' }],
});
