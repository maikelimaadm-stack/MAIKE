/**
 * Rotas de MovimentacaoEstoque (P5.4).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './movimentacaoEstoqueService.js';

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
      produto_id: { type: 'string', minLength: 1, maxLength: 64 },
      limit: { type: 'integer', minimum: 1, maximum: 5000 }
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarMovimentacaoEstoqueRoutes = async (app) => {
  app.get('/movimentacoes-estoque', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    let registros = await listar(request.contexto, query);
    const limite = Number(query.limit);
    if (Number.isFinite(limite) && limite > 0) registros = registros.slice(0, limite);
    return registros;
  });

  app.post('/movimentacoes-estoque', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('/movimentacoes-estoque/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/movimentacoes-estoque/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
