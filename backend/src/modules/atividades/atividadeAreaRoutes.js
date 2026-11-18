/**
 * D-PROD-249 — rotas das ÁREAS da atividade (várias áreas por atividade), tela
 * `op-atividades`; mudar as áreas é EDITAR a atividade (`GUARDAS.atividades.editar`,
 * editar|salvar). Contrato `docs/engineering/MAIKE-ATIVIDADE-AREAS-CONTRATO.md`.
 *
 *  - `POST /atividades/:id/areas` — mais uma área (PLANEJADA); 201
 *  - `PATCH /atividades/:id/areas/:areaId` — a área planejada (CAS por `versao`)
 *  - `POST /atividades/:id/areas/:areaId/iniciar` — PLANEJADA → EM_ANDAMENTO (`data_inicio`)
 *  - `POST /atividades/:id/areas/:areaId/concluir` — EM_ANDAMENTO → CONCLUIDA (`data_conclusao`)
 *  - `POST /atividades/:id/areas/:areaId/reabrir` — CONCLUIDA → EM_ANDAMENTO
 *  - `POST /atividades/:id/areas/:areaId/remover` — só PLANEJADA e sem lançamento
 *
 * As áreas são lidas no detalhe da atividade (`areas[]`) e os números de cada uma
 * em `GET /atividades/:id/totais` (`por_area[]`). Corpo FECHADO
 * (`additionalProperties: false`); tenant só da sessão (R11); decimais como TEXTO.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { PADRAO_DECIMAL, recusarCoercao } from './atividadeComum.js';
import { adicionarArea, concluirArea, editarArea, iniciarArea, reabrirArea, removerArea } from './atividadeAreaService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DECIMAL_NULO = { type: ['string', 'null'], pattern: PADRAO_DECIMAL.source };
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const PARAMS_AREA = { type: 'object', required: ['id', 'areaId'], additionalProperties: false, properties: { id: ID, areaId: ID } };

const ADICIONAR = {
  params: PARAMS,
  body: { type: 'object', required: ['empresa_id', 'area_id'], additionalProperties: false, properties: { empresa_id: ID, area_id: ID, area_planejada: DECIMAL_NULO } },
};
const EDITAR = {
  params: PARAMS_AREA,
  body: { type: 'object', required: ['empresa_id', 'versao', 'area_planejada'], additionalProperties: false, properties: { empresa_id: ID, versao: VERSAO, area_planejada: DECIMAL_NULO } },
};
/** @param {string} [data] */
const COM_VERSAO = (data) => ({
  params: PARAMS_AREA,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, ...(data ? { [data]: DIA } : {}) },
  },
});

/** @param {import('fastify').FastifyRequest} request */
const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
/** @param {import('fastify').FastifyRequest} request */
const ids = (request) => /** @type {{ id: string, areaId: string }} */ (request.params);
/** @param {import('fastify').FastifyRequest} request */
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeAreaRoutes = async (app) => {
  const g = GUARDAS.atividades;
  const autenticado = { onRequest: [app.autenticar], preHandler: [g.editar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body, ['area_planejada']);
  });

  app.post('/atividades/:id/areas', { ...autenticado, schema: ADICIONAR }, async (request, reply) =>
    reply.status(201).send(await adicionarArea(ctx(request), ids(request).id, corpo(request))));
  app.patch('/atividades/:id/areas/:areaId', { ...autenticado, schema: EDITAR }, async (request) =>
    editarArea(ctx(request), ids(request).id, ids(request).areaId, corpo(request)));
  app.post('/atividades/:id/areas/:areaId/iniciar', { ...autenticado, schema: COM_VERSAO('data_inicio') }, async (request) =>
    iniciarArea(ctx(request), ids(request).id, ids(request).areaId, corpo(request)));
  app.post('/atividades/:id/areas/:areaId/concluir', { ...autenticado, schema: COM_VERSAO('data_conclusao') }, async (request) =>
    concluirArea(ctx(request), ids(request).id, ids(request).areaId, corpo(request)));
  app.post('/atividades/:id/areas/:areaId/reabrir', { ...autenticado, schema: COM_VERSAO() }, async (request) =>
    reabrirArea(ctx(request), ids(request).id, ids(request).areaId, corpo(request)));
  app.post('/atividades/:id/areas/:areaId/remover', { ...autenticado, schema: COM_VERSAO() }, async (request) =>
    removerArea(ctx(request), ids(request).id, ids(request).areaId, corpo(request)));
};
