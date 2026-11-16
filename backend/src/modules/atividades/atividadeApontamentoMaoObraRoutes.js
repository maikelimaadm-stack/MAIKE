/**
 * D-PROD-207 (Fatia 4 do Lançamento de Atividades) — rotas das LINHAS DE MÃO
 * DE OBRA do apontamento e do seletor de parceiros da mão de obra, tela `op-atividades`
 * (contrato `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §3, §5 e §6):
 *
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/mao-obra` (lançar) — 201
 *  - `PATCH /atividades/:id/apontamentos/:apontamentoId/mao-obra/:linhaId`
 *    (editar = cancela a linha e cria outra) — 200
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/mao-obra/:linhaId/cancelar` — 200
 *  - `GET   /atividades-opcoes/mao-obra?empresa_id=&q=&cursor=&limit=` (ver) — D-PROD-208:
 *    parceiros ativos da fazenda com o papel funcionário ou prestador de serviço
 *
 * Guardas: escritas em `GUARDAS.atividadeApontamentos` (criar, editar,
 * cancelar); o seletor, `GUARDAS.atividades.ver`. Toda escrita leva
 * `empresa_id`, a `versao` do APONTAMENTO (CAS) e o `operation_id`. Corpo e
 * query FECHADOS (`additionalProperties: false`): custo total, status, ordem,
 * autoria, `origem` (D-PROD-208: decidida pelo servidor) e `cliente_id` → 400. Decimais chegam como TEXTO: o `preValidation`
 * deste plugin (encapsulado) recusa número antes da coerção do AJV.
 *
 * Exporta `ITEM_LINHA_MAO_OBRA` (o schema de um item de `mao_obra[]` no
 * lançamento/repetição do apontamento).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { PADRAO_DECIMAL, recusarCoercao } from './atividadeComum.js';
import {
  DECIMAIS_DA_LINHA_MAO_OBRA,
  TIPOS_MEDIDA,
  cancelarLinhaMaoObra,
  editarLinhaMaoObra,
  lancarLinhaMaoObra,
} from './atividadeApontamentoMaoObraService.js';
import { opcoesMaoObra } from './atividadeOpcoesService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DECIMAL_NULO = { type: ['string', 'null'], pattern: PADRAO_DECIMAL.source };
/** Igual ao CHECK `AtividadeApontamentoMaoObra_textos_check`. */
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' };
/** Motivo sem tamanho no schema: curto/longo são 422 do serviço. */
const TEXTO_DO_SERVICO = { type: ['string', 'null'] };
const OBSERVACAO = { type: ['string', 'null'], maxLength: 500 };

/** Campos de DADO da linha de mão de obra (os mesmos no lançamento, na edição e em `mao_obra[]`). */
export const CAMPOS_DA_LINHA_MAO_OBRA = Object.freeze({
  parceiro_id: ID,
  tipo_medida: { type: 'string', enum: [...TIPOS_MEDIDA] },
  quantidade: DECIMAL_NULO,
  custo_unitario: DECIMAL_NULO,
  observacao: OBSERVACAO,
});

/** Schema de UM item de `mao_obra[]` (fechado). */
export const ITEM_LINHA_MAO_OBRA = Object.freeze({
  type: 'object',
  required: ['parceiro_id', 'tipo_medida', 'quantidade'],
  additionalProperties: false,
  properties: CAMPOS_DA_LINHA_MAO_OBRA,
});

const PARAMS_APONTAMENTO = { type: 'object', required: ['id', 'apontamentoId'], additionalProperties: false, properties: { id: ID, apontamentoId: ID } };
const PARAMS_LINHA = { type: 'object', required: ['id', 'apontamentoId', 'linhaId'], additionalProperties: false, properties: { id: ID, apontamentoId: ID, linhaId: ID } };
const ENVELOPE = Object.freeze({ empresa_id: ID, versao: VERSAO, operation_id: OPERATION_ID });

const LANCAR = {
  params: PARAMS_APONTAMENTO,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'operation_id', 'parceiro_id', 'tipo_medida', 'quantidade'],
    additionalProperties: false,
    properties: { ...ENVELOPE, ...CAMPOS_DA_LINHA_MAO_OBRA },
  },
};
const EDITAR = {
  params: PARAMS_LINHA,
  body: { type: 'object', required: ['empresa_id', 'versao', 'operation_id'], additionalProperties: false, properties: { ...ENVELOPE, ...CAMPOS_DA_LINHA_MAO_OBRA } },
};
const CANCELAR = {
  params: PARAMS_LINHA,
  body: { type: 'object', required: ['empresa_id', 'versao', 'operation_id'], additionalProperties: false, properties: { ...ENVELOPE, motivo: TEXTO_DO_SERVICO } },
};
const OPCOES = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      q: { type: 'string', maxLength: 120 },
      cursor: { type: 'string', minLength: 1, maxLength: 2200 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
    },
  },
};

/** @param {import('fastify').FastifyRequest} request */
const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
/** @param {import('fastify').FastifyRequest} request */
const params = (request) => /** @type {{ id: string, apontamentoId: string, linhaId: string }} */ (request.params);
/** @param {import('fastify').FastifyRequest} request */
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeApontamentoMaoObraRoutes = async (app) => {
  const g = GUARDAS.atividadeApontamentos;
  const ver = GUARDAS.atividades.ver;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body, DECIMAIS_DA_LINHA_MAO_OBRA);
  });

  const base = '/atividades/:id/apontamentos/:apontamentoId/mao-obra';
  app.post(base, { ...autenticado, preHandler: [g.criar], schema: LANCAR }, async (request, reply) => {
    const p = params(request);
    const r = await lancarLinhaMaoObra(ctx(request), p.id, p.apontamentoId, corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.patch(`${base}/:linhaId`, { ...autenticado, preHandler: [g.editar], schema: EDITAR }, async (request, reply) => {
    const p = params(request);
    const r = await editarLinhaMaoObra(ctx(request), p.id, p.apontamentoId, p.linhaId, corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.post(`${base}/:linhaId/cancelar`, { ...autenticado, preHandler: [g.cancelar], schema: CANCELAR }, async (request, reply) => {
    const p = params(request);
    const r = await cancelarLinhaMaoObra(ctx(request), p.id, p.apontamentoId, p.linhaId, corpo(request));
    return reply.status(r.status).send(r.body);
  });

  app.get('/atividades-opcoes/mao-obra', { ...autenticado, preHandler: [ver], schema: OPCOES }, async (request) =>
    opcoesMaoObra(ctx(request), /** @type {Record<string, any>} */ (request.query)));
};
