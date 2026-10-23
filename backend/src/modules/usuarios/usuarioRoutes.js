/**
 * Rotas de administração de Usuario (P6.0, D-PROD-34).
 *
 * GET/POST/PATCH autenticados. Sem DELETE — desativar com `ativo: false`.
 * `senha_hash` nunca entra nem sai; criação usa `senha`, edição usa `nova_senha`.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar } from './usuarioService.js';

const CAMPOS_CRIAR = Object.freeze({
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  login: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  senha: { type: 'string', minLength: 8, maxLength: 512 },
});

const CAMPOS_ATUALIZAR = Object.freeze({
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  ativo: { type: 'boolean' },
  nova_senha: { type: 'string', minLength: 8, maxLength: 512 },
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['nome', 'login', 'senha'],
    additionalProperties: false,
    properties: { ...CAMPOS_CRIAR },
  },
};

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

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
    properties: { ...CAMPOS_ATUALIZAR },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarUsuarioRoutes = async (app) => {
  app.get('/usuarios', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.post('/usuarios', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const usuario = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(usuario);
  });

  app.patch('/usuarios/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });
};
