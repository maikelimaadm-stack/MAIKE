/**
 * Rotas de TipoTarefa (P5.0, D-PROD-45).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './tipoTarefaService.js';

const CAMPOS = Object.freeze({
  nome_tipo: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  grupo_atividade_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  ativo: { type: 'boolean' },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  exige_area: { type: 'boolean' },
  pode_ter_produto: { type: 'boolean' },
  pode_ter_maquina: { type: 'boolean' },
  pode_ter_implemento: { type: 'boolean' },
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['nome_tipo', 'grupo_atividade_id'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const CAMPOS_EDITAVEIS = Object.freeze({ ...CAMPOS });

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
export const registrarTipoTarefaRoutes = async (app) => {
  app.get('/tipos-tarefa', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.post('/tipos-tarefa', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const tipo = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(tipo);
  });

  app.patch('/tipos-tarefa/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/tipos-tarefa/:id', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
