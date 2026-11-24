/**
 * Rotas de MovimentacaoEstoque (P5.4).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { PROPRIEDADE_LIMIT_LISTAGEM } from '../../shared/http/listQueryLimit.js';
import { listar, criar, atualizar, excluir } from './movimentacaoEstoqueService.js';
import {
  comandoSaidaSuplementacao,
  comandoTransferenciaEntreLocais,
} from './movimentacaoEstoqueComandoService.js';
import { cancelarTransferencia, elegibilidadeCancelamentoTransferencia } from './transferenciaEstornoService.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LOTES_ESCOLHIDOS } from '../estoqueFisico/loteEscolhaSchema.js';

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
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      produto_id: { type: 'string', minLength: 1, maxLength: 64 },
      limit: PROPRIEDADE_LIMIT_LISTAGEM,
    },
  },
};

const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: '\\S' };

const COMANDO_SAIDA_SCHEMA = {
  body: {
    type: 'object',
    required: ['operation_id', 'empresa_id', 'produto_id', 'local_origem_id', 'quantidade'],
    additionalProperties: false,
    properties: {
      operation_id: OPERATION_ID,
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      produto_id: { type: 'string', minLength: 1, maxLength: 64 },
      local_origem_id: { type: 'string', minLength: 1, maxLength: 64 },
      local_origem_nome: { type: ['string', 'null'], maxLength: 255 },
      quantidade: { type: 'number', exclusiveMinimum: 0 },
      lotes: LOTES_ESCOLHIDOS, // D-PROD-281: só produto com lote; sem a lista, FEFO
      area_id: { type: ['string', 'null'], maxLength: 64 },
      area_nome: { type: ['string', 'null'], maxLength: 255 },
      deposito_id: { type: ['string', 'null'], maxLength: 64 },
      ponto_suplementacao_id: { type: ['string', 'null'], maxLength: 64 },
      data_movimentacao: { type: ['string', 'null'], maxLength: 32 },
      observacoes: { type: ['string', 'null'], maxLength: 2000 },
    },
  },
};

const COMANDO_TRANSFERENCIA_SCHEMA = {
  body: {
    type: 'object',
    required: [
      'operation_id',
      'empresa_id',
      'produto_id',
      'local_origem_id',
      'local_destino_id',
      'quantidade',
    ],
    additionalProperties: false,
    properties: {
      operation_id: OPERATION_ID,
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      produto_id: { type: 'string', minLength: 1, maxLength: 64 },
      local_origem_id: { type: 'string', minLength: 1, maxLength: 64 },
      local_origem_nome: { type: ['string', 'null'], maxLength: 255 },
      local_destino_id: { type: 'string', minLength: 1, maxLength: 64 },
      local_destino_nome: { type: ['string', 'null'], maxLength: 255 },
      quantidade: { type: 'number', exclusiveMinimum: 0 },
      lotes: LOTES_ESCOLHIDOS, // D-PROD-281: só produto com lote; sem a lista, FEFO
      data_movimentacao: { type: ['string', 'null'], maxLength: 32 },
      observacoes: { type: ['string', 'null'], maxLength: 2000 },
    },
  },
};

const EMPRESA_ID = { type: 'string', minLength: 1, maxLength: 64 };

/**
 * D-PROD-268 — cancelar transferência entre depósitos. Só alvo no path (qualquer perna do par);
 * do corpo, só empresa, motivo e chave: quantidade, custo, local, data e tenant nunca vêm do cliente.
 */
const CANCELAR_TRANSFERENCIA_SCHEMA = {
  ...ID_SCHEMA,
  body: {
    type: 'object',
    required: ['empresa_id', 'motivo', 'operation_id'],
    additionalProperties: false,
    properties: {
      empresa_id: EMPRESA_ID,
      motivo: { type: 'string', minLength: 3, maxLength: 500, pattern: '\\S' },
      operation_id: OPERATION_ID,
    },
  },
};

const ELEGIBILIDADE_CANCELAR_TRANSFERENCIA_SCHEMA = {
  ...ID_SCHEMA,
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: { empresa_id: EMPRESA_ID },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarMovimentacaoEstoqueRoutes = async (app) => {
  app.get('/movimentacoes-estoque', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.post(
    '/movimentacoes-estoque/comandos/saida-suplementacao',
    { onRequest: [app.autenticar], preHandler: [GUARDAS.movimentacaoEstoque.saidaSuplementacao], schema: COMANDO_SAIDA_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const corpo = await comandoSaidaSuplementacao(
        request.contexto,
        /** @type {Record<string, unknown>} */ (request.body)
      );
      return reply.status(corpo.replay ? 200 : 201).send(corpo);
    }
  );

  app.post(
    '/movimentacoes-estoque/comandos/transferencia-locais',
    { onRequest: [app.autenticar], preHandler: [GUARDAS.movimentacaoEstoque.transferenciaLocais], schema: COMANDO_TRANSFERENCIA_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const corpo = await comandoTransferenciaEntreLocais(
        request.contexto,
        /** @type {Record<string, unknown>} */ (request.body)
      );
      return reply.status(corpo.replay ? 200 : 201).send(corpo);
    }
  );

  // D-PROD-268 — estorno exato da transferência entre depósitos (o segmento estático não colide com /:id).
  app.post(
    '/movimentacoes-estoque/:id/cancelar-transferencia',
    { onRequest: [app.autenticar], preHandler: [GUARDAS.movimentacaoEstoque.cancelarTransferencia], schema: CANCELAR_TRANSFERENCIA_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      const r = await cancelarTransferencia(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
      return reply.status(r.status).send(r.body);
    }
  );

  app.get(
    '/movimentacoes-estoque/:id/elegibilidade-cancelamento-transferencia',
    { onRequest: [app.autenticar], preHandler: [GUARDAS.movimentacaoEstoque.cancelarTransferencia], schema: ELEGIBILIDADE_CANCELAR_TRANSFERENCIA_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      const { empresa_id: empresaId } = /** @type {{empresa_id: string}} */ (request.query);
      return elegibilidadeCancelamentoTransferencia(request.contexto, id, empresaId);
    }
  );

  app.post('/movimentacoes-estoque', { onRequest: [app.autenticar], preHandler: [GUARDAS.movimentacaoEstoque.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('/movimentacoes-estoque/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.movimentacaoEstoque.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/movimentacoes-estoque/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.movimentacaoEstoque.excluir], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
