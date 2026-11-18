/**
 * Rotas do CABEÇALHO do Lançamento de Atividades (D-PROD-200, Fatia 2) — tela
 * `op-atividades`, guardas `GUARDAS.atividades` (contrato §4):
 *
 *  - `GET   /atividades` (ver) — lista keyset (`createdAt desc, id desc`) com
 *    filtros `status`, `tipo_atividade_id`, `area_id`, `data_de`/`data_ate`
 *    (sobre `data_inicio`) e `q` (número e nome)
 *  - `GET   /atividades/:id` (ver) — detalhe com os resumos e os `totais`
 *  - `GET   /atividades/:id/totais` (ver) — D-PROD-202: o totalizador das linhas
 *    (produtos, máquinas, custo e custo/ha)
 *  - `POST  /atividades` (criar) — abrir; 201
 *  - `POST  /atividades/:id/duplicar` (criar) — abertura nova a partir desta; 201
 *  - `PATCH /atividades/:id` (editar) — CAS por `versao`; só ABERTA
 *  - `POST  /atividades/:id/concluir` (editar) — só ABERTA
 *  - `POST  /atividades/:id/reabrir` (reabrir: ação EXTRA, separada) — só CONCLUIDA
 *  - `POST  /atividades/:id/cancelar` (cancelar = ação `excluir` da tela) — só
 *    ABERTA; cancela junto os apontamentos confirmados (sem DELETE físico)
 *  - `GET   /atividades-opcoes/{bens,operadores}` (ver) — seletores PRÓPRIOS da
 *    tela: quem só tem esta tela não leva 403 das telas de bens ou de usuários
 *
 * Os apontamentos (`/atividades/:id/apontamentos…`) são outro plugin
 * (`atividadeApontamentoRoutes.js`).
 *
 * Corpo e query FECHADOS (`additionalProperties: false`): `cliente_id` e os
 * campos herdados (setor, centros, unidade, snapshots do tipo, número, status,
 * autoria, totais) → 400; o tipo não muda no PATCH. Tenant só da sessão; a
 * empresa vem do corpo (escrita) ou da query (leitura) e é conferida no tenant
 * (no PATCH ela é opcional: ausente, vale a fazenda da própria atividade).
 * Decimais chegam como TEXTO: o `preValidation` deste plugin (encapsulado)
 * recusa número antes da coerção do AJV. O motivo só tem o teto do transporte
 * no schema: o serviço responde 422 `ATIVIDADE_MOTIVO_INVALIDO` (ausente,
 * curto ou longo).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { NATUREZAS } from '../patrimonio/patrimonioDominio.js';
import { DECIMAIS_DA_ATIVIDADE, PADRAO_DECIMAL, recusarCoercao, recusarCoercaoNasListas } from './atividadeComum.js';
import { AREAS_NA_ABERTURA_MAXIMO } from './atividadeAreaService.js';
import { opcoesBens, opcoesOperadores } from './atividadeOpcoesService.js';
import { NOME_MAXIMO, STATUS, atualizar, cancelar, concluir, criar, duplicar, listar, obter, obterTotais, reabrir } from './atividadeService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DIA_NULO = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DECIMAL_NULO = { type: ['string', 'null'], pattern: PADRAO_DECIMAL.source };
const TEXTO_NULO = (max) => ({ type: ['string', 'null'], maxLength: max });
const NOME = { type: 'string', minLength: 1, maxLength: NOME_MAXIMO };
/**
 * Motivo: o teto aqui é só o do transporte (o mesmo das rotas do apontamento).
 * Ausente, vazio, curto (< 3 úteis) e longo (> 500 úteis, depois de aparado)
 * são do serviço: 422 `ATIVIDADE_MOTIVO_INVALIDO` (§10), não o 400 do schema.
 */
const MOTIVO = { type: ['string', 'null'], maxLength: 2000 };
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const SO_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

/**
 * Dados que o formulário grava (o servidor deriva o resto: número, snapshots do
 * tipo, setor, centros, unidade, status, autoria, totais e versão).
 */
const CAMPOS = Object.freeze({
  nome: NOME,
  area_id: ID_NULO,
  bem_id: ID_NULO,
  safra_ciclo: TEXTO_NULO(32),
  data_inicio: DIA,
  data_prevista_fim: DIA_NULO,
  area_planejada: DECIMAL_NULO,
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
      status: { type: 'string', enum: [...STATUS] },
      tipo_atividade_id: ID,
      area_id: ID,
      data_de: DIA,
      data_ate: DIA,
      q: { type: 'string', maxLength: NOME_MAXIMO },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};
const DETALHE = { params: PARAMS, querystring: SO_EMPRESA };
/**
 * D-PROD-238: várias áreas na abertura (cada uma com a sua área planejada; ausente = o tamanho da área). Com `areas`, o
 * corpo não traz `area_id` nem `area_planejada` (o serviço recusa: 400 `areas_e_area_id`).
 */
const AREAS_DA_ABERTURA = Object.freeze({
  type: 'array',
  minItems: 1,
  maxItems: AREAS_NA_ABERTURA_MAXIMO,
  items: { type: 'object', required: ['area_id'], additionalProperties: false, properties: { area_id: ID, area_planejada: DECIMAL_NULO } },
});
const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo_atividade_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, tipo_atividade_id: ID, ...CAMPOS, areas: AREAS_DA_ABERTURA },
  },
};
const ATUALIZAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['versao'],
    // A versão é escopo (e a empresa, quando vem): ao menos um campo da atividade tem de vir (o serviço confere).
    minProperties: 2,
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, ...CAMPOS },
  },
};
const CONCLUIR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, data_conclusao: DIA },
  },
};
/** Reabrir e cancelar: o motivo é conferido no serviço (422). */
const COM_MOTIVO = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, motivo: MOTIVO },
  },
};
const DUPLICAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, nome: NOME, data_inicio: DIA, data_prevista_fim: DIA_NULO },
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
export const registrarAtividadeRoutes = async (app) => {
  const g = GUARDAS.atividades;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body, DECIMAIS_DA_ATIVIDADE);
    recusarCoercaoNasListas(request.body, { areas: ['area_planejada'] });
  });

  app.get('/atividades', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/atividades/:id', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) => obter(ctx(request), idDe(request), consulta(request)));
  // D-PROD-202: o totalizador (área executada/planejada, produtos, máquinas, custo e custo/ha).
  app.get('/atividades/:id/totais', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) =>
    obterTotais(ctx(request), idDe(request), consulta(request)));
  app.post('/atividades', { ...autenticado, preHandler: [g.criar], schema: CRIAR }, async (request, reply) =>
    reply.status(201).send(await criar(ctx(request), corpo(request))));
  app.post('/atividades/:id/duplicar', { ...autenticado, preHandler: [g.criar], schema: DUPLICAR }, async (request, reply) =>
    reply.status(201).send(await duplicar(ctx(request), idDe(request), corpo(request))));
  app.patch('/atividades/:id', { ...autenticado, preHandler: [g.editar], schema: ATUALIZAR }, async (request) =>
    atualizar(ctx(request), idDe(request), corpo(request)));
  app.post('/atividades/:id/concluir', { ...autenticado, preHandler: [g.editar], schema: CONCLUIR }, async (request) =>
    concluir(ctx(request), idDe(request), corpo(request)));
  app.post('/atividades/:id/reabrir', { ...autenticado, preHandler: [g.reabrir], schema: COM_MOTIVO }, async (request) =>
    reabrir(ctx(request), idDe(request), corpo(request)));
  app.post('/atividades/:id/cancelar', { ...autenticado, preHandler: [g.cancelar], schema: COM_MOTIVO }, async (request) =>
    cancelar(ctx(request), idDe(request), corpo(request)));

  app.get('/atividades-opcoes/bens', { ...autenticado, preHandler: [g.ver], schema: OPCOES_BENS }, async (request) =>
    opcoesBens(ctx(request), consulta(request)));
  // Operadores: usuários ATIVOS do tenant, só `{id, nome}` (o login é credencial).
  app.get('/atividades-opcoes/operadores', { ...autenticado, preHandler: [g.ver], schema: OPCOES() }, async (request) =>
    opcoesOperadores(ctx(request), consulta(request)));
};
