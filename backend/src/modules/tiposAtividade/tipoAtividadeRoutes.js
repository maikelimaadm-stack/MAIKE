/**
 * Rotas de TipoAtividade (D-PROD-181).
 *
 * Espelho das rotas de TipoTarefa, sem chaves legadas: entidade nova não tem
 * cliente antigo, então qualquer campo fora do schema vira 400
 * (`removeAdditional: false`, ver `app.js`). Leitura só exige autenticação,
 * como em `/tipos-tarefa`; escrita passa pela tela `sup-tipos-atividade`.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, obter, criar, atualizar, excluir } from './tipoAtividadeService.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';

const CAMPOS = Object.freeze({
  nome_tipo: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  grupo_atividade_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  ativo: { type: 'boolean' },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
});

const PARAMS_ID = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
};

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['nome_tipo', 'grupo_atividade_id'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const OBTER_SCHEMA = { params: PARAMS_ID };

const ATUALIZAR_SCHEMA = {
  params: PARAMS_ID,
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const EXCLUIR_SCHEMA = { params: PARAMS_ID };

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarTipoAtividadeRoutes = async (app) => {
  app.get('/tipos-atividade', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.get('/tipos-atividade/:id', { onRequest: [app.autenticar], schema: OBTER_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return obter(request.contexto, id);
  });

  app.post('/tipos-atividade', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoAtividade.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const tipo = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(tipo);
  });

  app.patch('/tipos-atividade/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoAtividade.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/tipos-atividade/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoAtividade.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
