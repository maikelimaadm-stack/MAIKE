/**
 * Montagem da aplicação Fastify.
 *
 * Separado de `server.js` de propósito: o teste monta o app e injeta
 * requisições sem abrir porta, e o servidor só acrescenta o `listen`.
 *
 * O decorator `autenticar` é o único ponto onde um token vira `auth_context`.
 * Ele lê o payload verificado do JWT e constrói o contexto; não olha body,
 * query, params, header de tenant nem cookie. Essa é a materialização da regra
 * `tenancy.tenantSource = "auth_context"`.
 */

import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';

import { env } from './config/env.js';
import { errorHandler } from './shared/errors/errorHandler.js';
import { registrarRequestContext } from './shared/request/requestContext.js';
import { construirAuthContext } from './shared/auth/authContext.js';
import { tenantContextRequired } from './shared/errors/AppError.js';
import { registrarHealthRoutes } from './modules/health/healthRoutes.js';
import { registrarAuthRoutes } from './modules/auth/authRoutes.js';

/**
 * @param {{logger?: boolean|object}} [opcoes]
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export const construirApp = async (opcoes = {}) => {
  const app = Fastify({
    logger: opcoes.logger ?? (env.nodeEnv !== 'test'),
    // O `x-request-id` da requisição já é normalizado pelo requestContext; o
    // id interno do Fastify não é usado como correlation id de auditoria.
    disableRequestLogging: env.nodeEnv === 'test',
    ajv: {
      customOptions: {
        // O padrão do Fastify é `removeAdditional: true`: com
        // `additionalProperties: false`, o AJV **apaga** o campo desconhecido e
        // deixa a requisição passar. Numa superfície de tenancy isso é a pior
        // combinação possível — um `cliente_id` enviado no corpo sumiria em
        // silêncio, e ninguém saberia que alguém tentou.
        //
        // Com `removeAdditional: false`, campo fora do schema vira 400. O
        // cliente descobre que está errado em vez de achar que funcionou.
        removeAdditional: false,
      },
    },
  });

  app.setErrorHandler(errorHandler);

  if (!env.authSecret) {
    throw new Error('AUTH_SECRET ausente: o backend não emite sessão sem segredo configurado.');
  }

  await app.register(fastifyJwt, { secret: env.authSecret });

  registrarRequestContext(app);

  /**
   * Verifica o token e instala o `auth_context`.
   * Falha vira `TENANT_CONTEXT_REQUIRED` — 401 do contrato.
   */
  app.decorate('autenticar', async (request) => {
    try {
      await request.jwtVerify();
    } catch (erro) {
      throw tenantContextRequired('sessão ausente ou inválida', { cause: erro });
    }
    request.contexto.auth = construirAuthContext(request.user);
  });

  await app.register(registrarHealthRoutes);
  await app.register(registrarAuthRoutes);

  return app;
};
