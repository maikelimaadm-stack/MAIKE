/**
 * Rotas de TipoTarefa (P5.0, D-PROD-45).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './tipoTarefaService.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';

const CAMPOS = Object.freeze({
  nome_tipo: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  grupo_atividade_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  ativo: { type: 'boolean' },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
});

/**
 * D-PROD-180 — chaves que SAÍRAM do cadastro de Tipo de Tarefa. O app usa
 * `removeAdditional: false` (ver `app.js`), então campo fora do schema vira 400.
 * Para não quebrar cliente antigo (aba aberta, fila offline), estas chaves são
 * ACEITAS no corpo e IGNORADAS: o service não as lê e nada é gravado. Aceitar
 * qualquer valor (inclusive null) é deliberado: a chave não tem mais efeito.
 */
const CHAVES_LEGADAS_IGNORADAS = Object.freeze({
  exige_area: {},
  pode_ter_produto: {},
  pode_ter_maquina: {},
  pode_ter_implemento: {},
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['nome_tipo', 'grupo_atividade_id'],
    additionalProperties: false,
    properties: { ...CAMPOS, ...CHAVES_LEGADAS_IGNORADAS },
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
    properties: { ...CAMPOS_EDITAVEIS, ...CHAVES_LEGADAS_IGNORADAS },
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

  app.post('/tipos-tarefa', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoTarefa.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const tipo = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(tipo);
  });

  app.patch('/tipos-tarefa/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoTarefa.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/tipos-tarefa/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoTarefa.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
