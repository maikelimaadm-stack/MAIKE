/**
 * MAIKE-ENTREGA3 (D-PROD-275) — rotas da REFORMA DE PASTAGEM (o agrupador), tela `op-atividades`, guardas
 * `GUARDAS.planejamentos` (ver `planejamentoService.js`):
 *
 *  - `GET  /planejamentos` (ver) — as reformas da fazenda; filtros `status` e `area_id`;
 *  - `GET  /planejamentos/:id` (ver) — a reforma e o custo (total, R$/ha, por tipo e os serviços), calculado na leitura;
 *  - `POST /planejamentos` (criar = novo|salvar) — o "Planejar" da reforma; 201;
 *  - `POST /planejamentos/:id/concluir` (editar|salvar; com `trocar_capim: true`, também o editar do Mapa Cadastro);
 *  - `POST /planejamentos/:id/cancelar` (excluir) — nada é apagado.
 *
 * Corpo e query FECHADOS (`additionalProperties: false`): `cliente_id`, `nome`, `numero`, `safra_ciclo`, `status` e a
 * autoria são do servidor → 400. Tenant só da sessão; a fazenda vem do corpo (escrita) ou da query (leitura). Hectares
 * chegam como TEXTO (o `preValidation` recusa número antes da coerção do AJV); `trocar_capim` só como booleano.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { invalido } from '../gestao/gestaoComum.js';
import { PADRAO_DECIMAL, recusarCoercaoNasListas } from './atividadeComum.js';
import { AREAS_NO_PLANEJAMENTO_MAXIMO, STATUS_PLANEJAMENTO, TIPOS_PLANEJAMENTO, cancelar, concluir, criar, listar, obter } from './planejamentoService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const VERSAO = { type: 'integer', minimum: 1 };
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const SO_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, status: { type: 'string', enum: Object.values(STATUS_PLANEJAMENTO) }, area_id: ID },
  },
};
const DETALHE = { params: PARAMS, querystring: SO_EMPRESA };
const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'tipo', 'areas', 'data_inicio'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      tipo: { type: 'string', enum: [...TIPOS_PLANEJAMENTO] },
      areas: {
        type: 'array',
        minItems: 1,
        maxItems: AREAS_NO_PLANEJAMENTO_MAXIMO,
        items: {
          type: 'object',
          required: ['area_id'],
          additionalProperties: false,
          properties: { area_id: ID, hectares: { type: ['string', 'null'], pattern: PADRAO_DECIMAL.source } },
        },
      },
      cultura_alvo_id: ID_NULO,
      data_inicio: DIA,
    },
  },
};
const CONCLUIR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, data_conclusao: DIA, trocar_capim: { type: 'boolean' } },
  },
};
const CANCELAR = {
  params: PARAMS,
  body: { type: 'object', required: ['empresa_id', 'versao'], additionalProperties: false, properties: { empresa_id: ID, versao: VERSAO } },
};

/** `trocar_capim` chega como booleano, nunca "true"/1 (a coerção do AJV não decide por ninguém). @param {unknown} corpo */
const recusarCoercaoDoCapim = (corpo) => {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return;
  const v = /** @type {Record<string, unknown>} */ (corpo).trocar_capim;
  if (v !== undefined && typeof v !== 'boolean') throw invalido('trocar_capim deve ser true ou false', { field: 'trocar_capim', reason: 'formato' });
};

/** @param {import('fastify').FastifyRequest} request */
const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
/** @param {import('fastify').FastifyRequest} request */
const idDe = (request) => /** @type {{ id: string }} */ (request.params).id;
/** @param {import('fastify').FastifyRequest} request */
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);
/** @param {import('fastify').FastifyRequest} request */
const consulta = (request) => /** @type {Record<string, any>} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarPlanejamentoRoutes = async (app) => {
  const g = GUARDAS.planejamentos;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercaoNasListas(request.body, { areas: ['hectares'] });
    recusarCoercaoDoCapim(request.body);
  });

  app.get('/planejamentos', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/planejamentos/:id', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) => obter(ctx(request), idDe(request), consulta(request)));
  app.post('/planejamentos', { ...autenticado, preHandler: [g.criar], schema: CRIAR }, async (request, reply) =>
    reply.status(201).send(await criar(ctx(request), corpo(request))));
  app.post('/planejamentos/:id/concluir', { ...autenticado, preHandler: [g.concluir], schema: CONCLUIR }, async (request) =>
    concluir(ctx(request), idDe(request), corpo(request)));
  app.post('/planejamentos/:id/cancelar', { ...autenticado, preHandler: [g.cancelar], schema: CANCELAR }, async (request) =>
    cancelar(ctx(request), idDe(request), corpo(request)));
};
