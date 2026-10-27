/**
 * Rotas de LocalEstoque (P5.2, D-PROD-48).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './localEstoqueService.js';

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
