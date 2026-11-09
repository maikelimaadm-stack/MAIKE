/**
 * D-PROD-157 (R2) — rotas do vínculo combustível × produto por empresa (tela
 * `pat-combustiveis`).
 *
 *  - `GET  /patrimonio-combustiveis/:id/produtos?empresa_id&ativo&limit&cursor` (ver)
 *  - `POST /patrimonio-combustiveis/:id/produtos` `{empresa_id, produto_id}` → 201 (criar)
 *  - `PATCH /patrimonio-combustivel-produtos/:id` `{empresa_id, versao, ativo}` (editar;
 *    pela presença de `ativo`, exige a ação extra `inativar`)
 *  - `GET  /patrimonio-combustiveis-opcoes/produtos?empresa_id&q&cursor&limit`
 *    (criar OU editar da tela; produtos ATIVOS da fazenda)
 *
 * Corpo e query FECHADOS (`additionalProperties: false`): tenant só da sessão
 * (`cliente_id` → 400), tipo/produto/empresa do vínculo imutáveis (fora do
 * schema do PATCH → 400). Sem DELETE: inativação com CAS por `versao`. Os
 * produtos elegíveis de um bem ficam nas rotas dos bens.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { alterarSituacao, listarDoTipo, opcoesProdutos, vincular } from './combustivelProdutoService.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from './patrimonioComum.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };

const LISTAR = {
  params: PARAMS,
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      ativo: { type: 'string', enum: ['true', 'false'] },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};
const VINCULAR = {
  params: PARAMS,
  body: { type: 'object', required: ['empresa_id', 'produto_id'], additionalProperties: false, properties: { empresa_id: ID, produto_id: ID } },
};
const ALTERAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'ativo'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: { type: 'integer', minimum: 1 }, ativo: { type: 'boolean' } },
  },
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

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {any} */ (request.params).id;
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarCombustivelProdutoRoutes = async (app) => {
  const g = GUARDAS.patrimonioCombustiveis;
  const autenticado = { onRequest: [app.autenticar] };
  app.get('/patrimonio-combustiveis/:id/produtos', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) =>
    listarDoTipo(ctx(request), idDe(request), consulta(request)));
  app.post('/patrimonio-combustiveis/:id/produtos', { ...autenticado, preHandler: [g.criar], schema: VINCULAR }, async (request, reply) =>
    reply.status(201).send(await vincular(ctx(request), idDe(request), corpo(request))));
  app.patch('/patrimonio-combustivel-produtos/:id', { ...autenticado, preHandler: [g.editar], schema: ALTERAR }, async (request) =>
    alterarSituacao(ctx(request), idDe(request), corpo(request)));
  app.get('/patrimonio-combustiveis-opcoes/produtos', { ...autenticado, preHandler: [g.opcoesProdutos], schema: OPCOES }, async (request) =>
    opcoesProdutos(ctx(request), consulta(request)));
};
