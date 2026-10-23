/**
 * Rotas de autenticação.
 *
 * A rota é fina de propósito: contrato HTTP, validação de forma, chamada do
 * service, conversão do resultado. Nenhuma query Prisma, nenhuma regra.
 *
 * O schema aceita só `login` e `senha` — e `additionalProperties: false`.
 * Rejeita na porta `cliente`, `cliente_id` e qualquer outro campo: o tenant vem
 * do usuário autenticado, não do formulário (D-PROD-33).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { autenticar, montarPayloadDeSessao, ttlDaSessao } from './authService.js';

const LOGIN_SCHEMA = {
  body: {
    type: 'object',
    required: ['login', 'senha'],
    additionalProperties: false,
    properties: {
      login: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
      senha: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarAuthRoutes = async (app) => {
  app.post('/auth/login', { schema: LOGIN_SCHEMA }, async (request, reply) => {
    const identidade = await autenticar(request.body);

    const token = await reply.jwtSign(montarPayloadDeSessao(identidade), {
      expiresIn: ttlDaSessao(),
    });

    return reply.status(200).send({
      token,
      usuario: {
        id: identidade.usuarioId,
        login: identidade.login,
        nome: identidade.nome,
      },
      cliente_id: identidade.clienteId,
    });
  });

  // Devolve o contexto derivado do token. Serve de prova viva de que o tenant
  // vem da sessão: nada no corpo ou na query influencia esta resposta.
  app.get('/auth/contexto', { onRequest: [app.autenticar] }, async (request) => {
    const auth = exigirAuthContext(request.contexto.auth);
    return {
      cliente_id: auth.clienteId,
      usuario_id: auth.usuarioId,
      login: auth.login,
      request_id: request.contexto.requestId,
    };
  });
};
