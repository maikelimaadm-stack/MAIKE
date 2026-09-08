/**
 * Rota de health. Sem autenticação, por definição.
 *
 * A rota só traduz HTTP: chama o service e converte o resultado em status.
 * Nenhuma query aqui.
 */

import { verificarSaude } from './healthService.js';

/** @param {import('fastify').FastifyInstance} app */
export const registrarHealthRoutes = async (app) => {
  app.get('/health', async (_request, reply) => {
    const saude = await verificarSaude();
    return reply.status(saude.status === 'ok' ? 200 : 503).send(saude);
  });
};
