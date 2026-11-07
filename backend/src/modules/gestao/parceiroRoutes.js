/**
 * D-PROD-145 — rotas de Parceiros (sobre o model Fornecedor). Schemas fechados;
 * guardas da tela Parceiros; sem DELETE (a tela inativa). As rotas antigas de
 * `/fornecedores` (seletor do Cadastro de Lotes) não mudam.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { PAPEIS, TIPOS_PESSOA, atualizar, criar, detalhar, listar } from './parceiroService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const TEXTO = (max) => ({ type: ['string', 'null'], maxLength: max });
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };

const CAMPOS = Object.freeze({
  tipo_pessoa: { type: 'string', enum: [...TIPOS_PESSOA] },
  nome: { type: 'string', minLength: 1, maxLength: 255 },
  razao_social: TEXTO(255),
  cpf: TEXTO(32),
  cnpj: TEXTO(32),
  rg: TEXTO(32),
  data_nascimento: TEXTO(10),
  inscricao_estadual: TEXTO(64),
  nome_responsavel: TEXTO(255),
  telefone: TEXTO(64),
  email: TEXTO(255),
  endereco: TEXTO(255),
  cidade: TEXTO(128),
  codigo_ibge: TEXTO(16),
  estado: TEXTO(8),
  cep: TEXTO(16),
  observacoes: TEXTO(2000),
  papeis: { type: 'array', maxItems: PAPEIS.length, uniqueItems: true, items: { type: 'string', enum: [...PAPEIS] } },
  ativo: { type: 'boolean' },
});

const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
      q: { type: 'string', maxLength: 120 },
      ativo: { type: 'string', enum: ['true', 'false'] },
      papel: { type: 'string', enum: [...PAPEIS] },
    },
  },
};
const CRIAR = { body: { type: 'object', required: ['empresa_id', 'tipo_pessoa', 'nome'], additionalProperties: false, properties: { empresa_id: ID, ...CAMPOS } } };
const ATUALIZAR = { params: PARAMS, body: { type: 'object', required: ['empresa_id'], minProperties: 2, additionalProperties: false, properties: { empresa_id: ID, ...CAMPOS } } };
const DETALHE = { params: PARAMS, querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } } };

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarParceiroRoutes = async (app) => {
  const g = GUARDAS.parceiro;
  app.get('/parceiros', { onRequest: [app.autenticar], preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), /** @type {any} */ (request.query)));
  app.get('/parceiros/:id', { onRequest: [app.autenticar], preHandler: [g.ver], schema: DETALHE }, async (request) =>
    detalhar(ctx(request), /** @type {any} */ (request.params).id, /** @type {any} */ (request.query)));
  app.post('/parceiros', { onRequest: [app.autenticar], preHandler: [g.criar], schema: CRIAR }, async (request, reply) =>
    reply.status(201).send(await criar(ctx(request), /** @type {any} */ (request.body))));
  app.patch('/parceiros/:id', { onRequest: [app.autenticar], preHandler: [g.editar], schema: ATUALIZAR }, async (request) =>
    atualizar(ctx(request), /** @type {any} */ (request.params).id, /** @type {any} */ (request.body)));
};
