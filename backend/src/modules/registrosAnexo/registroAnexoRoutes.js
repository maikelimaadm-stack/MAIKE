import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { criar, excluirPorId, listar } from './registroAnexoService.js';

const LISTAR_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      entidade: { type: 'string', minLength: 1, maxLength: 128 },
      entidade_id: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
};

const CRIAR_SCHEMA = {
  body: { type: 'object', additionalProperties: true, minProperties: 1 },
};

const ID_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarRegistroAnexoRoutes = async (app) => {
  app.get('/registros-anexo', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.post('/registros-anexo', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.delete('/registros-anexo/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluirPorId(request.contexto, id);
    return reply.status(204).send();
  });
};
