/**
 * Entrada serverless do Fastify na Vercel (P4.0+).
 *
 * O processo longo de `backend/src/server.js` não roda na Vercel; esta função
 * reutiliza `construirApp` e delega cada requisição HTTP ao servidor interno
 * do Fastify, preservando rotas, CORS e JWT.
 */

import { semPrefixoApiNativa } from '../config/nativeApiPath.js';
import { exigirConfiguracaoCompleta } from '../backend/src/config/env.js';
import { construirApp } from '../backend/src/app.js';

/** @type {import('fastify').FastifyInstance | null} */
let app = null;

/** @type {Promise<void> | null} */
let pronto = null;

const obterApp = async () => {
  if (!app) {
    exigirConfiguracaoCompleta();
    app = await construirApp({ logger: envProducao() });
    pronto = app.ready();
  }
  await pronto;
  return app;
};

const envProducao = () => process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

export default async function handler(req, res) {
  if (typeof req.url === 'string' && req.url.startsWith('/api/native')) {
    const queryIndex = req.url.indexOf('?');
    const pathOnly = queryIndex >= 0 ? req.url.slice(0, queryIndex) : req.url;
    const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
    req.url = `${semPrefixoApiNativa(pathOnly)}${query}`;
  }
  const instancia = await obterApp();
  instancia.server.emit('request', req, res);
}
