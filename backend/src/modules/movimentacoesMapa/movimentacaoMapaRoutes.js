/**
 * Rotas de MovimentacaoMapa (P5.5).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { querystringListagemEmpresa } from '../../shared/http/listQueryLimit.js';
import { listar, listarHistorico, criar, atualizar, excluir, HISTORICO_LIMITE_MAXIMO } from './movimentacaoMapaService.js';

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

/**
 * Histórico paginado (D-PROD-94): só leitura, tenant do token, empresa como
 * escopo. `additionalProperties: false` — `cliente_id` na query vira 400.
 */
const HISTORICO_SCHEMA = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      area_id: { type: 'string', minLength: 1, maxLength: 64 },
      lote_ids: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 64 } },
      lote_nomes: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 255 } },
      limit: { type: 'integer', minimum: 1, maximum: HISTORICO_LIMITE_MAXIMO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarMovimentacaoMapaRoutes = async (app) => {
  app.get('/movimentacoes-mapa', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.get('/movimentacoes-mapa/historico', { onRequest: [app.autenticar], schema: HISTORICO_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarHistorico(request.contexto, /** @type {Record<string, unknown>} */ (request.query ?? {}));
  });

  app.post('/movimentacoes-mapa', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('/movimentacoes-mapa/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/movimentacoes-mapa/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
