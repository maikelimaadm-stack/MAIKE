/**
 * Rotas de Empresa (P5.4).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './empresaService.js';

const CAMPOS = Object.freeze({
  apelido: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  tipo_pessoa: { type: 'string', minLength: 1, maxLength: 32 },
  cpf: { type: ['string', 'null'], maxLength: 32 },
  rg: { type: ['string', 'null'], maxLength: 32 },
  cnpj: { type: ['string', 'null'], maxLength: 32 },
  inscricao_estadual: { type: ['string', 'null'], maxLength: 64 },
  telefone: { type: ['string', 'null'], maxLength: 64 },
  email: { type: ['string', 'null'], maxLength: 255 },
  endereco: { type: ['string', 'null'], maxLength: 255 },
  cidade: { type: ['string', 'null'], maxLength: 128 },
  estado: { type: ['string', 'null'], maxLength: 8 },
  cep: { type: ['string', 'null'], maxLength: 16 },
  logotipo_url: { type: ['string', 'null'], maxLength: 2000 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['apelido', 'nome', 'tipo_pessoa'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const ATUALIZAR_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const ID_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

const LISTAR_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarEmpresaRoutes = async (app) => {
  app.get('/empresas', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    let registros = await listar(request.contexto, query);

    return registros;
  });

  app.post('/empresas', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('/empresas/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/empresas/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
