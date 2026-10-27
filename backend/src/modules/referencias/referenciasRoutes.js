import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { sincronizarReferencias } from './syncEntityReferencesService.js';

const SCHEMA = {
  body: { type: 'object', additionalProperties: true },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarReferenciasRoutes = async (app) => {
  app.post('/referencias/sincronizar', { onRequest: [app.autenticar], schema: SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return sincronizarReferencias(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
  });
};
