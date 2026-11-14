/**
 * Rotas de CategoriaManejo (P5.4).
 *
 * D-PROD-195 — `GET /categorias-manejo-opcoes/curvas-ganho?empresa_id=` lista
 * as curvas de ganho da fazenda (`{ id, nome, ativo }`, ordem de nome) para o
 * seletor obrigatório da categoria. Guarda: quem cria OU edita categoria
 * (`GUARDAS.categoriaManejo.opcoesCurvas`, cadastro rápido do lote incluído).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir, opcoesCurvasGanho } from './categoriaManejoService.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';

const ID_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

const CRIAR_SCHEMA = {
  body: { type: 'object', additionalProperties: true, minProperties: 1 },
};

const ATUALIZAR_SCHEMA = {
  ...ID_SCHEMA,
  body: { type: 'object', additionalProperties: true, minProperties: 1 },
};

const LISTAR_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 }
    },
  },
};

const OPCOES_CURVAS_SCHEMA = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: { empresa_id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarCategoriaManejoRoutes = async (app) => {
  app.get('/categorias-manejo', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    let registros = await listar(request.contexto, query);

    return registros;
  });

  app.post('/categorias-manejo', { onRequest: [app.autenticar], preHandler: [GUARDAS.categoriaManejo.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('/categorias-manejo/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.categoriaManejo.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/categorias-manejo/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.categoriaManejo.excluir], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });

  app.get('/categorias-manejo-opcoes/curvas-ganho', { onRequest: [app.autenticar], preHandler: [GUARDAS.categoriaManejo.opcoesCurvas], schema: OPCOES_CURVAS_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return opcoesCurvasGanho(request.contexto, /** @type {Record<string, string>} */ (request.query ?? {}));
  });
};
