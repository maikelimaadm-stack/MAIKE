/**
 * Rotas de autenticação.
 *
 * A rota é fina de propósito: contrato HTTP, validação de forma, chamada do
 * service, conversão do resultado. Nenhuma query Prisma, nenhuma regra.
 *
 * O schema de entrada aceita `cliente`, `login` e `senha` — e
 * `additionalProperties: false`. Isso não é estética: é o que faz um
 * `cliente_id` enviado no corpo ser **rejeitado na porta**, em vez de ficar
 * circulando como campo ignorado que alguém um dia lê por engano.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { autenticar, montarPayloadDeSessao, ttlDaSessao } from './authService.js';

const LOGIN_SCHEMA = {
  body: {
    type: 'object',
    required: ['cliente', 'login', 'senha'],
    additionalProperties: false,
    properties: {
      cliente: { type: 'string', minLength: 1, maxLength: 64 },
      login: { type: 'string', minLength: 1, maxLength: 120 },
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
