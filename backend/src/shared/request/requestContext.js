/**
 * Contexto de requisição: correlation id + `auth_context`.
 *
 * O `request_id` é obrigatório no `AuditLog` (contrato: campo `request_id`,
 * required). Ele é gerado aqui, no início da requisição, e atravessa service e
 * repository sem passar pelo corpo da requisição.
 *
 * Um `x-request-id` recebido do cliente é aceito apenas como **rótulo de
 * correlação**, sanitizado e truncado. Ele nunca influencia tenancy nem
 * autorização — é só para casar log de cliente com log de servidor.
 */

import { randomUUID } from 'node:crypto';

const REQUEST_ID_MAXIMO = 64;
const CARACTERES_VALIDOS = /^[A-Za-z0-9._:-]+$/;

/**
 * @param {unknown} bruto
 * @returns {string}
 */
export const normalizarRequestId = (bruto) => {
  if (typeof bruto !== 'string') return randomUUID();
  const limpo = bruto.trim().slice(0, REQUEST_ID_MAXIMO);
  if (!limpo || !CARACTERES_VALIDOS.test(limpo)) return randomUUID();
  return limpo;
};

/**
 * @param {{requestId?: unknown, auth?: import('../auth/authContext.js').AuthContext | null}} entrada
 */
export const criarRequestContext = ({ requestId, auth = null } = {}) => ({
  requestId: normalizarRequestId(requestId),
  auth,
});

/**
 * Plugin de ciclo de vida: instala `request.contexto` em toda requisição.
 * @param {import('fastify').FastifyInstance} app
 */
export const registrarRequestContext = (app) => {
  app.decorateRequest('contexto', null);

  app.addHook('onRequest', async (request, reply) => {
    request.contexto = criarRequestContext({
      requestId: request.headers['x-request-id'],
    });
    reply.header('x-request-id', request.contexto.requestId);
  });
};
