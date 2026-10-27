/**
 * Rotas de ManejoTecnicoRebanho (P5.5).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { querystringListagemEmpresa } from '../../shared/http/listQueryLimit.js';
import { listar, criar, atualizar, excluir } from './manejoTecnicoRebanhoService.js';

const ID_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

const CRIAR_SCHEMA = {
  body: { type: 'object', additionalProperties: true, minProperties: 1 },
};

const ATUALIZAR_SCHEMA = {
  ...ID_SCHEMA,
  body: { type: 'object', additionalProperties: true, minProperties: 1 },
};

const LISTAR_SCHEMA = {
  querystring: querystringListagemEmpresa(),
};


/** @param {import('fastify').FastifyInstance} app */
export const registrarManejoTecnicoRebanhoRoutes = async (app) => {
  app.get('/manejos-tecnico-rebanho', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.post('/manejos-tecnico-rebanho', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('/manejos-tecnico-rebanho/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/manejos-tecnico-rebanho/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
