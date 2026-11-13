/**
 * Rotas de ApontamentoAtividade (D-PROD-184, Fatia C) — tela `op-apontamentos-atividade`:
 *
 *  - `GET   /apontamentos-atividade` (ver) — lista keyset com filtros
 *  - `GET   /apontamentos-atividade/:id` (ver) — detalhe
 *  - `POST  /apontamentos-atividade` (criar) — 201
 *  - `PATCH /apontamentos-atividade/:id` (editar) — CAS por `versao`
 *  - `POST  /apontamentos-atividade/:id/cancelar` (cancelar = ação `excluir`
 *    da tela) — sem DELETE físico
 *  - `GET   /apontamentos-atividade-opcoes/{bens,operadores,centros-custo,centros-resultado}`
 *    (ver) — seletores PRÓPRIOS da tela: quem só tem esta tela não leva 403
 *    das telas de bens ou de centros. Tipos de atividade (`/tipos-atividade`),
 *    áreas (`/areas-pastagem`) e tarefas (`/lancamentos-tarefa`) já são lidos
 *    só com autenticação e são reaproveitados.
 *
 * Corpo e query FECHADOS (`additionalProperties: false`; `cliente_id` → 400;
 * as flags de exigência do antigo Tipo de Tarefa → 400, nunca voltam); tenant
 * só da sessão; a empresa vem do corpo/query e é conferida no tenant. Decimais
 * chegam como TEXTO: o `preValidation` deste plugin (encapsulado) recusa
 * número antes da coerção do AJV.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { opcoesCentros } from '../financeiro/operacaoFinanceiraOpcoesService.js';
import { opcoesResponsaveis } from '../patrimonio/bemPatrimonialOpcoesService.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { NATUREZAS } from '../patrimonio/patrimonioDominio.js';
import {
  PADRAO_DECIMAL,
  PADRAO_INSTANTE,
  STATUS,
  UNIDADES_PRODUCAO,
  atualizar,
  cancelar,
  criar,
  listar,
  obter,
  opcoesBens,
  recusarCoercaoApontamento,
} from './apontamentoAtividadeService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const INSTANTE_NULO = { type: ['string', 'null'], maxLength: 40, pattern: PADRAO_INSTANTE.source };
const DECIMAL_NULO = { type: ['string', 'null'], pattern: PADRAO_DECIMAL.source };
const TEXTO_NULO = (max) => ({ type: ['string', 'null'], maxLength: max });
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const SO_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

/** Colunas que o formulário grava (o servidor deriva o resto: número, snapshots, status, autoria, versão). */
const CAMPOS = Object.freeze({
  tipo_atividade_id: ID,
  data_operacional: DIA,
  hora_inicio: INSTANTE_NULO,
  hora_fim: INSTANTE_NULO,
  bem_id: ID_NULO,
  implemento_bem_id: ID_NULO,
  operador_usuario_id: ID_NULO,
  area_id: ID_NULO,
  centro_custo_id: ID_NULO,
  centro_resultado_id: ID_NULO,
  safra_ciclo: TEXTO_NULO(32),
  quantidade_produzida: DECIMAL_NULO,
  unidade_producao: { type: ['string', 'null'], enum: [...UNIDADES_PRODUCAO, null] },
  horas_trabalhadas: DECIMAL_NULO,
  lancamento_tarefa_id: ID_NULO,
  observacao: TEXTO_NULO(2000),
});

const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      data_de: DIA,
      data_ate: DIA,
      bem_id: ID,
      implemento_bem_id: ID,
      tipo_atividade_id: ID,
      area_id: ID,
      lancamento_tarefa_id: ID,
      status: { type: 'string', enum: [...STATUS] },
      q: { type: 'string', maxLength: 32 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};
const DETALHE = { params: PARAMS, querystring: SO_EMPRESA };
const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'tipo_atividade_id', 'data_operacional'],
    additionalProperties: false,
    properties: { empresa_id: ID, ...CAMPOS },
  },
};
const ATUALIZAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao'],
    // empresa e versão são escopo; ao menos um campo do apontamento tem de vir.
    minProperties: 3,
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, ...CAMPOS },
  },
};
const CANCELAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'motivo'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, motivo: { type: 'string', minLength: 1, maxLength: 500 } },
  },
};
/** @param {Record<string, unknown>} [extra] */
const OPCOES = (extra = {}) => ({
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      q: { type: 'string', maxLength: 120 },
      cursor: { type: 'string', minLength: 1, maxLength: 2200 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
      ...extra,
    },
  },
});
const OPCOES_BENS = OPCOES({ natureza: { type: 'array', minItems: 1, maxItems: NATUREZAS.length, uniqueItems: true, items: { type: 'string', enum: [...NATUREZAS] } } });

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {{id: string}} */ (request.params).id;
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);
const consulta = (request) => /** @type {Record<string, any>} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarApontamentoAtividadeRoutes = async (app) => {
  const g = GUARDAS.apontamentoAtividade;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercaoApontamento(request.body);
  });

  app.get('/apontamentos-atividade', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/apontamentos-atividade/:id', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) =>
    obter(ctx(request), idDe(request), consulta(request)));
  app.post('/apontamentos-atividade', { ...autenticado, preHandler: [g.criar], schema: CRIAR }, async (request, reply) =>
    reply.status(201).send(await criar(ctx(request), corpo(request))));
  app.patch('/apontamentos-atividade/:id', { ...autenticado, preHandler: [g.editar], schema: ATUALIZAR }, async (request) =>
    atualizar(ctx(request), idDe(request), corpo(request)));
  app.post('/apontamentos-atividade/:id/cancelar', { ...autenticado, preHandler: [g.cancelar], schema: CANCELAR }, async (request) =>
    cancelar(ctx(request), idDe(request), corpo(request)));

  app.get('/apontamentos-atividade-opcoes/bens', { ...autenticado, preHandler: [g.ver], schema: OPCOES_BENS }, async (request) =>
    opcoesBens(ctx(request), consulta(request)));
  // Operadores: usuários ATIVOS do tenant, só `{id, nome}` (o login é credencial).
  app.get('/apontamentos-atividade-opcoes/operadores', { ...autenticado, preHandler: [g.ver], schema: OPCOES() }, async (request) =>
    opcoesResponsaveis(ctx(request), consulta(request)));
  app.get('/apontamentos-atividade-opcoes/centros-custo', { ...autenticado, preHandler: [g.ver], schema: OPCOES() }, async (request) =>
    opcoesCentros('custo')(ctx(request), consulta(request)));
  app.get('/apontamentos-atividade-opcoes/centros-resultado', { ...autenticado, preHandler: [g.ver], schema: OPCOES() }, async (request) =>
    opcoesCentros('resultado')(ctx(request), consulta(request)));
};
