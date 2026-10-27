/**
 * Rotas de Marca (P4.4-Marcas, D-PROD-42 + D-PROD-54 escala).
 *
 * CRUD completo: exclusão física permitida — `Produto` ainda referencia marca
 * por string na Base44, sem FK verificável no backend nativo nesta fatia.
 *
 * GET /marcas é paginado por keyset (`limit`, `cursor`, `empresa_id`, `q`, `ativo`).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { listar, criar, atualizar, excluir } from './marcaService.js';

const CAMPOS = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const LISTAR_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      q: { type: 'string', maxLength: 200 },
      // Fastify querystring: aceita boolean ou string "true"/"false"
      ativo: { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['true', 'false', '1', '0'] }] },
    },
  },
};

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const CAMPOS_EDITAVEIS = Object.freeze(
  Object.fromEntries(Object.entries(CAMPOS).filter(([campo]) => campo !== 'empresa_id'))
);

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
    properties: { ...CAMPOS_EDITAVEIS },
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
export const registrarMarcaRoutes = async (app) => {
  app.get('/marcas', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto, /** @type {Record<string, unknown>} */ (request.query ?? {}));
  });

  app.post('/marcas', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const marca = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(marca);
  });

  app.patch('/marcas/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/marcas/:id', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
