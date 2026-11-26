/**
 * D-PROD-324 (MAIKE-DIARIO-GPS, fase 1) — rotas do trajeto da máquina no Diário:
 *
 *  - `POST  /atividades/:id/trajetos` (`lancar_apontamento`) — abre; 201; mesma `operation_id` → 200 `replay: true`
 *  - `POST  /atividades/:id/trajetos/:trajetoId/pontos` (`lancar_apontamento`) — lote 1..200; 200 `{ recebidos, novos }`
 *  - `POST  /atividades/:id/trajetos/:trajetoId/encerrar` (`lancar_apontamento`) — fecha; 200; de novo → `replay: true`
 *  - `GET   /atividades/:id/trajetos?empresa_id=&dia=YYYY-MM-DD` (`ver`) — trajetos do dia, distância e linha simplificada
 *
 * Guardas: as da tela de apontamentos (`GUARDAS.atividadeApontamentos`). Corpo e query FECHADOS
 * (`additionalProperties: false`). As coordenadas são números JSON (validadas no schema e no serviço).
 */

import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { PADRAO_OPERATION_ID } from './atividadeComum.js';
import { abrirTrajeto, enviarPontos, encerrarTrajeto, listarTrajetosDoDia, LOTE_MAXIMO } from './atividadeTrajetoService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_OPCIONAL = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: PADRAO_OPERATION_ID.source };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

const PARAMS_ATIVIDADE = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const PARAMS_TRAJETO = { type: 'object', required: ['id', 'trajetoId'], additionalProperties: false, properties: { id: ID, trajetoId: ID } };

const PONTO = {
  type: 'object',
  required: ['seq', 'lat', 'lng', 'capturado_em'],
  additionalProperties: false,
  properties: {
    seq: { type: 'integer', minimum: 0, maximum: 2147483647 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    precisao_m: { type: ['number', 'null'], minimum: 0, maximum: 100000 },
    velocidade_ms: { type: ['number', 'null'], minimum: 0, maximum: 200 },
    capturado_em: { type: 'string', minLength: 10, maxLength: 40 },
  },
};

const ABRIR = {
  params: PARAMS_ATIVIDADE,
  body: {
    type: 'object',
    required: ['empresa_id', 'bem_id', 'data_operacional', 'operation_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      bem_id: ID,
      implemento_bem_id: ID_OPCIONAL,
      apontamento_id: ID_OPCIONAL,
      data_operacional: DIA,
      operation_id: OPERATION_ID,
    },
  },
};

const PONTOS = {
  params: PARAMS_TRAJETO,
  body: {
    type: 'object',
    required: ['empresa_id', 'pontos'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      pontos: { type: 'array', minItems: 1, maxItems: LOTE_MAXIMO, items: PONTO },
    },
  },
};

const ENCERRAR = {
  params: PARAMS_TRAJETO,
  body: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: { empresa_id: ID },
  },
};

const LISTAR = {
  params: PARAMS_ATIVIDADE,
  querystring: {
    type: 'object',
    required: ['empresa_id', 'dia'],
    additionalProperties: false,
    properties: { empresa_id: ID, dia: DIA },
  },
};

/** @param {import('fastify').FastifyRequest} request */
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);
/** @param {import('fastify').FastifyRequest} request */
const params = (request) => /** @type {{ id: string, trajetoId?: string }} */ (request.params);
/** @param {import('fastify').FastifyRequest} request */
const consulta = (request) => /** @type {{ empresa_id: string, dia: string }} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeTrajetoRoutes = async (app) => {
  const g = GUARDAS.atividadeApontamentos;
  const autenticado = { onRequest: [app.autenticar] };

  app.get('/atividades/:id/trajetos', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) =>
    listarTrajetosDoDia(request.contexto, params(request).id, consulta(request)));

  app.post('/atividades/:id/trajetos', { ...autenticado, preHandler: [g.criar], schema: ABRIR }, async (request, reply) => {
    const r = await abrirTrajeto(request.contexto, params(request).id, corpo(request));
    return reply.status(r.status).send(r.body);
  });

  app.post('/atividades/:id/trajetos/:trajetoId/pontos', { ...autenticado, preHandler: [g.criar], schema: PONTOS }, async (request, reply) => {
    const p = params(request);
    const r = await enviarPontos(request.contexto, p.id, /** @type {string} */ (p.trajetoId), corpo(request));
    return reply.status(200).send(r);
  });

  app.post('/atividades/:id/trajetos/:trajetoId/encerrar', { ...autenticado, preHandler: [g.criar], schema: ENCERRAR }, async (request, reply) => {
    const p = params(request);
    const r = await encerrarTrajeto(request.contexto, p.id, /** @type {string} */ (p.trajetoId), corpo(request));
    return reply.status(r.status).send(r.body);
  });
};
