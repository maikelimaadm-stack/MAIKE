/**
 * D-PROD-200 (Fatia 2 do Lançamento de Atividades) — rotas dos APONTAMENTOS
 * da atividade, tela `op-atividades` (contrato
 * `docs/engineering/MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md` §4 e §10):
 *
 *  - `GET   /atividades/:id/apontamentos` (ver) — `{ items }`, sem paginação:
 *    dia desc, turno (manhã, tarde, noite, sem turno), sequência
 *  - `GET   /atividades/:id/apontamentos/:apontamentoId` (ver)
 *  - `POST  /atividades/:id/apontamentos` (lançar) — 201
 *  - `PATCH /atividades/:id/apontamentos/:apontamentoId` (editar) — CAS por `versao`
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/cancelar` (cancelar) —
 *    sem DELETE físico
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/duplicar` (lançar:
 *    "repetir último lançamento") — 201
 *
 * Guardas `GUARDAS.atividadeApontamentos`: ver = visualizar da tela; lançar,
 * editar e cancelar são as ações extras `lancar_apontamento`,
 * `editar_apontamento` e `cancelar_apontamento` da mesma linha. As escritas
 * devolvem `{ apontamento, atividade, alertas }`.
 *
 * Corpo e query FECHADOS (`additionalProperties: false`): área, setor, safra,
 * centros, unidade, máquina, sequência, status, autoria e `cliente_id` → 400
 * (são do cabeçalho, do servidor ou da sessão). Tenant só da sessão; a empresa
 * vem do corpo (escrita) ou da query (leitura) e é conferida no tenant (no
 * PATCH ela é opcional, como no do cabeçalho: ausente, vale a fazenda da
 * atividade da URL).
 * Decimais chegam como TEXTO: o `preValidation` deste plugin (encapsulado)
 * recusa número antes da coerção do AJV. O plugin é registrado em `app.js`
 * pelo módulo do cabeçalho.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { DECIMAIS_DO_APONTAMENTO, ORIGENS, PADRAO_DECIMAL, TURNOS, recusarCoercao } from './atividadeComum.js';
import {
  cancelarApontamento,
  duplicarApontamento,
  editarApontamento,
  lancarApontamento,
  listarApontamentos,
  obterApontamento,
} from './atividadeApontamentoService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DECIMAL_NULO = { type: ['string', 'null'], pattern: PADRAO_DECIMAL.source };
const TURNO_NULO = { type: ['string', 'null'], enum: [...TURNOS, null] };
const ORIGEM = { type: 'string', enum: [...ORIGENS] };
const OBSERVACAO = { type: ['string', 'null'], maxLength: 2000 };
/**
 * Motivo sem tamanho no schema, como no cabeçalho: ausente, vazio, curto
 * (< 3 úteis) e longo (> 500 úteis, depois de aparado) são do serviço, 422
 * `ATIVIDADE_MOTIVO_INVALIDO` (§10), nunca o 400 do schema. O `bodyLimit` do
 * Fastify já limita o corpo.
 */
const MOTIVO = { type: ['string', 'null'] };

const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const PARAMS_APONTAMENTO = {
  type: 'object',
  required: ['id', 'apontamentoId'],
  additionalProperties: false,
  properties: { id: ID, apontamentoId: ID },
};
const SO_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

/** Campos de DADO do dia (o formulário do §6), os mesmos no lançamento e na edição. */
const CAMPOS_DO_DIA = Object.freeze({
  data_operacional: DIA,
  turno: TURNO_NULO,
  operador_usuario_id: ID_NULO,
  area_executada_dia: DECIMAL_NULO,
  quantidade_produzida_dia: DECIMAL_NULO,
  observacao: OBSERVACAO,
});

const LISTAR = { params: PARAMS, querystring: SO_EMPRESA };
const DETALHE = { params: PARAMS_APONTAMENTO, querystring: SO_EMPRESA };
const LANCAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'data_operacional'],
    additionalProperties: false,
    // A origem é gravada no lançamento (WEB padrão, ou APP) e não muda na edição.
    properties: { empresa_id: ID, ...CAMPOS_DO_DIA, origem: ORIGEM },
  },
};
const EDITAR = {
  params: PARAMS_APONTAMENTO,
  body: {
    type: 'object',
    // Como no PATCH do cabeçalho: a versão é obrigatória e a empresa, opcional (ausente, vale a fazenda da
    // atividade da URL). Ao menos um campo de dado tem de vir (o serviço confere: 400 `sem_alteracao`).
    required: ['versao'],
    minProperties: 2,
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, ...CAMPOS_DO_DIA },
  },
};
const CANCELAR = {
  params: PARAMS_APONTAMENTO,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, motivo: MOTIVO },
  },
};
const DUPLICAR = {
  params: PARAMS_APONTAMENTO,
  body: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, data_operacional: DIA },
  },
};

/** @param {import('fastify').FastifyRequest} request */
const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
/** @param {import('fastify').FastifyRequest} request */
const atividadeIdDe = (request) => /** @type {{ id: string }} */ (request.params).id;
/** @param {import('fastify').FastifyRequest} request */
const apontamentoIdDe = (request) => /** @type {{ apontamentoId: string }} */ (request.params).apontamentoId;
/** @param {import('fastify').FastifyRequest} request */
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);
/** @param {import('fastify').FastifyRequest} request */
const consulta = (request) => /** @type {Record<string, any>} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeApontamentoRoutes = async (app) => {
  const g = GUARDAS.atividadeApontamentos;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body, DECIMAIS_DO_APONTAMENTO);
  });

  app.get('/atividades/:id/apontamentos', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) =>
    listarApontamentos(ctx(request), atividadeIdDe(request), consulta(request)));
  app.get('/atividades/:id/apontamentos/:apontamentoId', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) =>
    obterApontamento(ctx(request), atividadeIdDe(request), apontamentoIdDe(request), consulta(request)));
  app.post('/atividades/:id/apontamentos', { ...autenticado, preHandler: [g.criar], schema: LANCAR }, async (request, reply) =>
    reply.status(201).send(await lancarApontamento(ctx(request), atividadeIdDe(request), corpo(request))));
  app.patch('/atividades/:id/apontamentos/:apontamentoId', { ...autenticado, preHandler: [g.editar], schema: EDITAR }, async (request) =>
    editarApontamento(ctx(request), atividadeIdDe(request), apontamentoIdDe(request), corpo(request)));
  app.post('/atividades/:id/apontamentos/:apontamentoId/cancelar', { ...autenticado, preHandler: [g.cancelar], schema: CANCELAR }, async (request) =>
    cancelarApontamento(ctx(request), atividadeIdDe(request), apontamentoIdDe(request), corpo(request)));
  // "Repetir último lançamento": é um lançamento novo, com a guarda de lançar.
  app.post('/atividades/:id/apontamentos/:apontamentoId/duplicar', { ...autenticado, preHandler: [g.criar], schema: DUPLICAR }, async (request, reply) =>
    reply.status(201).send(await duplicarApontamento(ctx(request), atividadeIdDe(request), apontamentoIdDe(request), corpo(request))));
};
