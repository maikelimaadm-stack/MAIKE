/**
 * D-PROD-204 (Fatia 4 do Lançamento de Atividades) — rotas das LINHAS DE
 * SERVIÇO do apontamento e dos seletores dela, tela `op-atividades` (contrato
 * `docs/engineering/MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §4, §5 e §6):
 *
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/servicos` (lançar) — 201
 *  - `PATCH /atividades/:id/apontamentos/:apontamentoId/servicos/:linhaId`
 *    (editar = cancela a linha e cria outra) — 200
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/servicos/:linhaId/cancelar` — 200
 *  - `GET   /atividades-opcoes/servicos?empresa_id=&q=&cursor=&limit=` (ver)
 *  - `GET   /atividades-opcoes/parceiros-servico?empresa_id=&q=&cursor=&limit=` (ver)
 *
 * Guardas: escritas em `GUARDAS.atividadeApontamentos` (criar, editar,
 * cancelar); os seletores, `GUARDAS.atividades.ver`. Toda escrita leva
 * `empresa_id`, a `versao` do APONTAMENTO (CAS) e o `operation_id`. Corpo e
 * query FECHADOS: unidade (snapshot do serviço), valor total, status, ordem,
 * autoria e `cliente_id` → 400. Decimais chegam como TEXTO (`preValidation`).
 *
 * Exporta `ITEM_LINHA_SERVICO` (o schema de um item de `servicos[]`).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { PADRAO_DECIMAL, recusarCoercao } from './atividadeComum.js';
import {
  DECIMAIS_DA_LINHA_SERVICO,
  DOCUMENTO_REFERENCIA_MAXIMO,
  cancelarLinhaServico,
  editarLinhaServico,
  lancarLinhaServico,
} from './atividadeApontamentoServicoService.js';
import { opcoesParceirosServico, opcoesServicos } from './atividadeOpcoesService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DECIMAL_NULO = { type: ['string', 'null'], pattern: PADRAO_DECIMAL.source };
/** Igual ao CHECK `AtividadeApontamentoServico_textos_check`. */
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' };
/** Motivo sem tamanho no schema: curto/longo são 422 do serviço. */
const TEXTO_DO_SERVICO = { type: ['string', 'null'] };
const OBSERVACAO = { type: ['string', 'null'], maxLength: 500 };

/** Campos de DADO da linha de serviço (os mesmos no lançamento, na edição e em `servicos[]`). */
export const CAMPOS_DA_LINHA_SERVICO = Object.freeze({
  servico_id: ID,
  fornecedor_parceiro_id: ID_NULO,
  quantidade: DECIMAL_NULO,
  valor_unitario: DECIMAL_NULO,
  documento_referencia: { type: ['string', 'null'], maxLength: DOCUMENTO_REFERENCIA_MAXIMO },
  observacao: OBSERVACAO,
});

/** Schema de UM item de `servicos[]` (fechado). */
export const ITEM_LINHA_SERVICO = Object.freeze({
  type: 'object',
  required: ['servico_id', 'quantidade', 'valor_unitario'],
  additionalProperties: false,
  properties: CAMPOS_DA_LINHA_SERVICO,
});

const PARAMS_APONTAMENTO = { type: 'object', required: ['id', 'apontamentoId'], additionalProperties: false, properties: { id: ID, apontamentoId: ID } };
const PARAMS_LINHA = { type: 'object', required: ['id', 'apontamentoId', 'linhaId'], additionalProperties: false, properties: { id: ID, apontamentoId: ID, linhaId: ID } };
const ENVELOPE = Object.freeze({ empresa_id: ID, versao: VERSAO, operation_id: OPERATION_ID });

const LANCAR = {
  params: PARAMS_APONTAMENTO,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'operation_id', 'servico_id', 'quantidade', 'valor_unitario'],
    additionalProperties: false,
    properties: { ...ENVELOPE, ...CAMPOS_DA_LINHA_SERVICO },
  },
};
const EDITAR = {
  params: PARAMS_LINHA,
  body: { type: 'object', required: ['empresa_id', 'versao', 'operation_id'], additionalProperties: false, properties: { ...ENVELOPE, ...CAMPOS_DA_LINHA_SERVICO } },
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
/** @param {import('fastify').FastifyRequest} request */
const consulta = (request) => /** @type {Record<string, any>} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeApontamentoServicoRoutes = async (app) => {
  const g = GUARDAS.atividadeApontamentos;
  const ver = GUARDAS.atividades.ver;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body, DECIMAIS_DA_LINHA_SERVICO);
  });

  const base = '/atividades/:id/apontamentos/:apontamentoId/servicos';
  app.post(base, { ...autenticado, preHandler: [g.criar], schema: LANCAR }, async (request, reply) => {
    const p = params(request);
    const r = await lancarLinhaServico(ctx(request), p.id, p.apontamentoId, corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.patch(`${base}/:linhaId`, { ...autenticado, preHandler: [g.editar], schema: EDITAR }, async (request, reply) => {
    const p = params(request);
    const r = await editarLinhaServico(ctx(request), p.id, p.apontamentoId, p.linhaId, corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.post(`${base}/:linhaId/cancelar`, { ...autenticado, preHandler: [g.cancelar], schema: CANCELAR }, async (request, reply) => {
    const p = params(request);
    const r = await cancelarLinhaServico(ctx(request), p.id, p.apontamentoId, p.linhaId, corpo(request));
    return reply.status(r.status).send(r.body);
  });

  app.get('/atividades-opcoes/servicos', { ...autenticado, preHandler: [ver], schema: OPCOES }, async (request) => opcoesServicos(ctx(request), consulta(request)));
  app.get('/atividades-opcoes/parceiros-servico', { ...autenticado, preHandler: [ver], schema: OPCOES }, async (request) =>
    opcoesParceirosServico(ctx(request), consulta(request)));
};
