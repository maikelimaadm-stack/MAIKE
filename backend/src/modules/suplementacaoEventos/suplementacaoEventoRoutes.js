/**
 * Rotas de SuplementacaoEvento (P5.5).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { querystringListagemEmpresa } from '../../shared/http/listQueryLimit.js';
import { listar, criar, atualizar, excluir } from './suplementacaoEventoService.js';
import { comandoLancamentoComLotes } from './suplementacaoEventoComandoService.js';
import { cancelarLancamentoCocho, elegibilidadeCancelamentoCocho, MOTIVO_MAX, MOTIVO_MIN } from './suplementacaoEventoCancelamentoService.js';
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
  querystring: querystringListagemEmpresa(),
};

/** D-PROD-268 — corpo fechado do cancelamento: tenant e ator só do auth_context. */
const CANCELAMENTO_SCHEMA = {
  ...ID_SCHEMA,
  body: {
    type: 'object',
    required: ['empresa_id', 'operation_id', 'motivo'],
    additionalProperties: false,
    properties: {
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      operation_id: { type: 'string', minLength: 8, maxLength: 128, pattern: '\\S' },
      motivo: { type: 'string', minLength: MOTIVO_MIN, maxLength: MOTIVO_MAX },
    },
  },
};

const ELEGIBILIDADE_SCHEMA = {
  ...ID_SCHEMA,
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: { empresa_id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};


/** @param {import('fastify').FastifyInstance} app */
export const registrarSuplementacaoEventoRoutes = async (app) => {
  app.get('/suplementacao-eventos', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.post('/suplementacao-eventos', { onRequest: [app.autenticar], preHandler: [GUARDAS.suplementacaoEvento.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.post(
    '/suplementacao-eventos/comandos/lancamento-com-lotes',
    {
      onRequest: [app.autenticar], preHandler: [GUARDAS.suplementacaoEvento.lancamento],
      schema: {
        body: {
          type: 'object',
          required: ['operation_id', 'evento'],
          additionalProperties: false,
          properties: {
            operation_id: { type: 'string', minLength: 8, maxLength: 128, pattern: '\\S' },
            evento: { type: 'object', minProperties: 1 },
            lotes: { type: 'array', items: { type: 'object' } },
            // D-PROD-268 — o último lançamento ATIVO que a tela viu (null: nenhum). Opcional.
            evento_anterior_id: { anyOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }] },
          },
        },
      },
    },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const corpo = await comandoLancamentoComLotes(
        request.contexto,
        /** @type {Record<string, unknown>} */ (request.body)
      );
      return reply.status(corpo.replay ? 200 : 201).send(corpo);
    }
  );

  // D-PROD-268 — cancelamento (estorno exato) do lançamento de cocho e o ensaio da elegibilidade.
  app.get(
    '/suplementacao-eventos/:id/elegibilidade-cancelamento',
    { onRequest: [app.autenticar], preHandler: [GUARDAS.suplementacaoEvento.cancelar], schema: ELEGIBILIDADE_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      const { empresa_id: empresaId } = /** @type {{empresa_id: string}} */ (request.query);
      return elegibilidadeCancelamentoCocho(request.contexto, id, empresaId);
    }
  );

  app.post(
    '/suplementacao-eventos/:id/cancelamento',
    { onRequest: [app.autenticar], preHandler: [GUARDAS.suplementacaoEvento.cancelar], schema: CANCELAMENTO_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      const { status, body } = await cancelarLancamentoCocho(
        request.contexto,
        id,
        /** @type {{empresa_id: string, operation_id: string, motivo: string}} */ (request.body)
      );
      return reply.status(status).send(body);
    }
  );

  app.patch('/suplementacao-eventos/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.suplementacaoEvento.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/suplementacao-eventos/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.suplementacaoEvento.excluir], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
