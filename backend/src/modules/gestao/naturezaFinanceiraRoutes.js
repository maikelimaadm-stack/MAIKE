/**
 * D-PROD-152 — rotas das Naturezas Financeiras gerenciais (Gestão P2).
 * Corpo e query fechados (`additionalProperties: false`); tenant só da sessão;
 * cada rota exige a ação da PRÓPRIA tela (nunca `semTela` nem só autenticação).
 * `tipo` só na criação; `empresa_id` é escopo (não muda o registro).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { TIPOS_NATUREZA, atualizar, criar, detalhar, listar, opcoesPais } from './naturezaFinanceiraService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const TIPO = { type: 'string', enum: [...TIPOS_NATUREZA] };
const TEXTO = (max) => ({ type: ['string', 'null'], maxLength: max });
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const LIMITE = { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO };

const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      tipo: TIPO,
      ativo: { type: 'string', enum: ['true', 'false'] },
      pai_id: ID,
      q: { type: 'string', maxLength: 120 },
      limit: LIMITE,
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};
const DETALHE = { params: PARAMS, querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } } };
const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'tipo', 'nome'],
    additionalProperties: false,
    properties: { empresa_id: ID, tipo: TIPO, nome: { type: 'string', minLength: 1, maxLength: 120 }, descricao: TEXTO(500), pai_id: { anyOf: [ID, { type: 'null' }] } },
  },
};
const ATUALIZAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id'],
    minProperties: 2,
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      descricao: TEXTO(500),
      pai_id: { anyOf: [ID, { type: 'null' }] },
      ativo: { type: 'boolean' },
    },
  },
};
const OPCOES = {
  querystring: {
    type: 'object',
    required: ['empresa_id', 'tipo'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      tipo: TIPO,
      q: { type: 'string', maxLength: 120 },
      excluir_id: ID,
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarNaturezaFinanceiraRoutes = async (app) => {
  const g = GUARDAS.naturezaFinanceira;
  app.get('/naturezas-financeiras', { onRequest: [app.autenticar], preHandler: [g.ver], schema: LISTAR }, async (request) =>
    listar(ctx(request), /** @type {any} */ (request.query)));
  app.get('/naturezas-financeiras/:id', { onRequest: [app.autenticar], preHandler: [g.ver], schema: DETALHE }, async (request) =>
    detalhar(ctx(request), /** @type {any} */ (request.params).id, /** @type {any} */ (request.query)));
  app.post('/naturezas-financeiras', { onRequest: [app.autenticar], preHandler: [g.criar], schema: CRIAR }, async (request, reply) =>
    reply.status(201).send(await criar(ctx(request), /** @type {any} */ (request.body))));
  app.patch('/naturezas-financeiras/:id', { onRequest: [app.autenticar], preHandler: [g.editar], schema: ATUALIZAR }, async (request) =>
    atualizar(ctx(request), /** @type {any} */ (request.params).id, /** @type {any} */ (request.body)));
  // Opções de pai do formulário (quem vê a tela escolhe o pai ao criar/editar).
  app.get('/naturezas-financeiras-opcoes/pais', { onRequest: [app.autenticar], preHandler: [g.ver], schema: OPCOES }, async (request) =>
    opcoesPais(ctx(request), /** @type {any} */ (request.query)));
};
