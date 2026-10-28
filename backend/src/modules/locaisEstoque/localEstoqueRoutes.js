/**
 * Rotas de LocalEstoque (P5.2, D-PROD-48).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { listar, listarPagina, criar, atualizar, excluir } from './localEstoqueService.js';

const CAMPOS = Object.freeze({
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  capacidade: { type: ['string', 'null'], maxLength: 255 },
  ativo: { type: 'boolean' },
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['nome'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const ATUALIZAR_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const LISTAR_PAGINA_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
      q: { type: 'string', maxLength: 200 },
      ativo: { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['true', 'false', '1', '0'] }] },
    },
  },
};

const EXCLUIR_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarLocalEstoqueRoutes = async (app) => {
  app.get('/locais-estoque', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.get(
    '/locais-estoque/page',
    { onRequest: [app.autenticar], schema: LISTAR_PAGINA_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      return listarPagina(request.contexto, /** @type {Record<string, unknown>} */ (request.query ?? {}));
    },
  );

  app.post('/locais-estoque', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const local = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(local);
  });

  app.patch('/locais-estoque/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/locais-estoque/:id', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
