/**
 * Rotas de GrupoAtividade (P5.0, D-PROD-45).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './grupoAtividadeService.js';

const CAMPOS = Object.freeze({
  nome_grupo: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  ativo: { type: 'boolean' },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  cor_icone: { type: ['string', 'null'], maxLength: 64 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['nome_grupo'],
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
export const registrarGrupoAtividadeRoutes = async (app) => {
  app.get('/grupos-atividade', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.post('/grupos-atividade', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const grupo = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(grupo);
  });

  app.patch('/grupos-atividade/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/grupos-atividade/:id', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
