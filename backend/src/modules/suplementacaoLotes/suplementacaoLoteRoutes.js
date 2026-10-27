/**
 * Rotas de SuplementacaoLote (P5.5).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir, criarEmLote } from './suplementacaoLoteService.js';

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
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
};

const BULK_SCHEMA = {
  body: {
    type: 'object',
    required: ['registros'],
    additionalProperties: false,
    properties: {
      registros: { type: 'array', items: { type: 'object' }, minItems: 1 },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarSuplementacaoLoteRoutes = async (app) => {
  app.get('/suplementacao-lotes', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.post('/suplementacao-lotes', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('/suplementacao-lotes/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/suplementacao-lotes/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
  app.post('/suplementacao-lotes/bulk', { onRequest: [app.autenticar], schema: BULK_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const body = /** @type {{registros: object[]}} */ (request.body);
    const lista = await criarEmLote(request.contexto, body.registros);
    return reply.status(201).send(lista);
  });
};
