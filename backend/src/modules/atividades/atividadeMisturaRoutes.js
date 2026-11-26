/**
 * D-PROD-322 (MAIKE-DIARIO-MAQUINA) — rotas da mistura no implemento, da aplicação no pasto, da sobra e do resumo do dia:
 *
 *  - `GET   /atividades/:id/misturas?empresa_id=` (ver) — as misturas (a ABERTA primeiro), com itens e saldo
 *  - `POST  /atividades/:id/misturas` (`lancar_apontamento`) — Passo 1 "Implemento cheio"; 201; sem baixa de estoque
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/misturas/:misturaId/aplicar` (`lancar_apontamento`) — Passo 2; 201
 *  - `POST  /atividades/:id/misturas/:misturaId/sobra` (`lancar_apontamento`) — TRANSFERENCIA | DEVOLUCAO | PERDA; 200
 *  - `GET   /atividades/:id/diario-resumo?empresa_id=&dia=YYYY-MM-DD` (ver) — por área; `custo_total` só para o
 *    administrador da fazenda
 *
 * Guardas: as da tela de apontamentos (`GUARDAS.atividadeApontamentos`). Corpo e query FECHADOS
 * (`additionalProperties: false`). Decimais chegam como TEXTO: o `preValidation` deste plugin (encapsulado, como o de
 * linha de produto) recusa número antes da coerção do AJV. Reenvio com a mesma `operation_id` → 200 `replay: true`.
 */

import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { PADRAO_OPERATION_ID, recusarCoercao } from './atividadeComum.js';
import { aplicarMistura, criarMistura, listarMisturas, registrarSobra, resumoDoDia, TIPOS_SOBRA } from './atividadeMisturaService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_OPCIONAL = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const DECIMAL = { type: 'string', pattern: '^\\d{1,10}(\\.\\d{1,4})?$' };
const DECIMAL_OPCIONAL = { type: ['string', 'null'], pattern: '^\\d{1,10}(\\.\\d{1,4})?$' };
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: PADRAO_OPERATION_ID.source };
const TEXTO_OPCIONAL = { type: ['string', 'null'], maxLength: 500 };
/** Decimais que o `preValidation` confere como texto (o AJV, sem isso, aceitaria número e o arredondaria pelo float). */
const DECIMAIS_DO_CORPO = Object.freeze(['capacidade', 'sobra', 'horimetro_saida', 'horimetro_chegada']);

const PARAMS_ATIVIDADE = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const PARAMS_MISTURA = { type: 'object', required: ['id', 'misturaId'], additionalProperties: false, properties: { id: ID, misturaId: ID } };
const PARAMS_APLICAR = {
  type: 'object',
  required: ['id', 'apontamentoId', 'misturaId'],
  additionalProperties: false,
  properties: { id: ID, apontamentoId: ID, misturaId: ID },
};

const ITEM = {
  type: 'object',
  required: ['produto_id', 'local_estoque_id', 'quantidade'],
  additionalProperties: false,
  properties: { produto_id: ID, local_estoque_id: ID, quantidade: DECIMAL },
};

const CRIAR = {
  params: PARAMS_ATIVIDADE,
  body: {
    type: 'object',
    required: ['empresa_id', 'implemento_bem_id', 'area_id', 'itens', 'operation_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      implemento_bem_id: ID,
      area_id: ID,
      itens: { type: 'array', minItems: 1, maxItems: 50, items: ITEM },
      capacidade: DECIMAL_OPCIONAL,
      unidade: { type: ['string', 'null'], enum: ['L', 'KG', null] },
      operation_id: OPERATION_ID,
    },
  },
};

const APLICAR = {
  params: PARAMS_APLICAR,
  body: {
    type: 'object',
    required: ['empresa_id', 'esvaziou', 'operation_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, esvaziou: { type: 'boolean' }, sobra: DECIMAL_OPCIONAL, operation_id: OPERATION_ID },
  },
};

const SOBRA = {
  params: PARAMS_MISTURA,
  body: {
    type: 'object',
    required: ['empresa_id', 'tipo', 'operation_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      tipo: { type: 'string', enum: [...TIPOS_SOBRA] },
      para_area_id: ID_OPCIONAL,
      apontamento_id: ID_OPCIONAL,
      motivo: TEXTO_OPCIONAL,
      horimetro_saida: DECIMAL_OPCIONAL,
      horimetro_chegada: DECIMAL_OPCIONAL,
      operation_id: OPERATION_ID,
    },
  },
};

const LISTAR = {
  params: PARAMS_ATIVIDADE,
  querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } },
};

const RESUMO = {
  params: PARAMS_ATIVIDADE,
  querystring: {
    type: 'object',
    required: ['empresa_id', 'dia'],
    additionalProperties: false,
    properties: { empresa_id: ID, dia: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  },
};

/** @param {import('fastify').FastifyRequest} request */
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);
/** @param {import('fastify').FastifyRequest} request */
const params = (request) => /** @type {{ id: string, apontamentoId?: string, misturaId?: string }} */ (request.params);
/** @param {import('fastify').FastifyRequest} request */
const consulta = (request) => /** @type {Record<string, any>} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeMisturaRoutes = async (app) => {
  const g = GUARDAS.atividadeApontamentos;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    const c = /** @type {Record<string, any>} */ (request.body);
    if (!c || typeof c !== 'object') return;
    recusarCoercao(c, DECIMAIS_DO_CORPO);
    if (Array.isArray(c.itens)) for (const item of c.itens) recusarCoercao(item, ['quantidade']);
  });

  app.get('/atividades/:id/misturas', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) =>
    listarMisturas(request.contexto, params(request).id, /** @type {any} */ (consulta(request))));

  app.post('/atividades/:id/misturas', { ...autenticado, preHandler: [g.criar], schema: CRIAR }, async (request, reply) => {
    const r = await criarMistura(request.contexto, params(request).id, corpo(request));
    return reply.status(r.status).send(r.body);
  });

  app.post('/atividades/:id/apontamentos/:apontamentoId/misturas/:misturaId/aplicar', { ...autenticado, preHandler: [g.criar], schema: APLICAR }, async (request, reply) => {
    const p = params(request);
    const r = await aplicarMistura(request.contexto, p.id, /** @type {string} */ (p.apontamentoId), /** @type {string} */ (p.misturaId), corpo(request));
    return reply.status(r.status).send(r.body);
  });

  app.post('/atividades/:id/misturas/:misturaId/sobra', { ...autenticado, preHandler: [g.criar], schema: SOBRA }, async (request, reply) => {
    const p = params(request);
    const r = await registrarSobra(request.contexto, p.id, /** @type {string} */ (p.misturaId), corpo(request));
    return reply.status(r.status).send(r.body);
  });

  app.get('/atividades/:id/diario-resumo', { ...autenticado, preHandler: [g.ver], schema: RESUMO }, async (request) =>
    resumoDoDia(request.contexto, params(request).id, /** @type {any} */ (consulta(request))));
};
