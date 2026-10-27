/**
 * Rotas de LancamentoTarefa e histórico (P5.3, D-PROD-49).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  listar,
  criar,
  atualizar,
  excluir,
  listarHistorico,
  criarHistorico,
  excluirHistorico,
  enumsContrato,
} from './lancamentoTarefaService.js';

const { TIPOS_BASE, PRIORIDADES, STATUS, EVENTOS } = enumsContrato;

const CAMPOS_LANCAMENTO_CRIACAO = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  titulo: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  tipo: { type: 'string', enum: TIPOS_BASE },
  tipo_tarefa_id: { type: 'string', minLength: 1, maxLength: 64 },
  solicitante: { type: ['string', 'null'], maxLength: 255 },
  data_pedido: { type: ['string', 'null'], maxLength: 32 },
  prioridade: { type: 'string', enum: PRIORIDADES },
  status: { type: 'string', enum: STATUS },
  data_prevista: { type: ['string', 'null'], maxLength: 32 },
  data_inicio: { type: ['string', 'null'], maxLength: 64 },
  data_conclusao: { type: ['string', 'null'], maxLength: 32 },
  area_id: { type: ['string', 'null'], maxLength: 64 },
  lote_id: { type: ['string', 'null'], maxLength: 64 },
  ponto_suplementacao_id: { type: ['string', 'null'], maxLength: 64 },
  coordenadas: { type: ['object', 'null'] },
  responsavel_id: { type: ['string', 'null'], maxLength: 64 },
  responsavel: { type: ['string', 'null'], maxLength: 255 },
  responsavel_geral: { type: ['string', 'null'], maxLength: 255 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  observacoes_conclusao: { type: ['string', 'null'], maxLength: 2000 },
  fotos: { type: 'array', items: { type: 'string' } },
  anexos_urls: { type: 'array', items: { type: 'string' } },
});

const CAMPOS_LANCAMENTO_ATUALIZACAO = Object.freeze(
  Object.fromEntries(Object.entries(CAMPOS_LANCAMENTO_CRIACAO).filter(([campo]) => campo !== 'empresa_id'))
);

const CRIAR_LANCAMENTO_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'titulo', 'tipo', 'tipo_tarefa_id'],
    additionalProperties: false,
    properties: { ...CAMPOS_LANCAMENTO_CRIACAO },
  },
};

const ATUALIZAR_LANCAMENTO_SCHEMA = {
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
    properties: { ...CAMPOS_LANCAMENTO_ATUALIZACAO },
  },
};

const EXCLUIR_LANCAMENTO_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

const CAMPOS_HISTORICO = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  tarefa_id: { type: 'string', minLength: 1, maxLength: 64 },
  titulo_tarefa: { type: ['string', 'null'], maxLength: 255 },
  evento: { type: 'string', enum: EVENTOS },
  data_evento: { type: 'string', minLength: 1, maxLength: 64 },
  status: { type: ['string', 'null'], maxLength: 32 },
  responsavel: { type: ['string', 'null'], maxLength: 255 },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
});

const CRIAR_HISTORICO_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'tarefa_id', 'evento', 'data_evento'],
    additionalProperties: false,
    properties: { ...CAMPOS_HISTORICO },
  },
};

const EXCLUIR_HISTORICO_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

const LISTAR_HISTORICO_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limite: { type: 'integer', minimum: 1, maximum: 2000 },
    },
  },
};

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarLancamentoTarefaRoutes = async (app) => {
  app.get('/lancamentos-tarefa', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.post(
    '/lancamentos-tarefa',
    { onRequest: [app.autenticar], schema: CRIAR_LANCAMENTO_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const lancamento = await criar(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(lancamento);
    }
  );

  app.patch(
    '/lancamentos-tarefa/:id',
    { onRequest: [app.autenticar], schema: ATUALIZAR_LANCAMENTO_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizar(request.contexto, id, corpoValidado(request.body));
    }
  );

  app.delete(
    '/lancamentos-tarefa/:id',
    { onRequest: [app.autenticar], schema: EXCLUIR_LANCAMENTO_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      await excluir(request.contexto, id);
      return reply.status(204).send();
    }
  );

  app.get(
    '/historicos-lancamento-tarefa',
    { onRequest: [app.autenticar], schema: LISTAR_HISTORICO_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { limite } = /** @type {{limite?: number}} */ (request.query ?? {});
      return listarHistorico(request.contexto, { limite });
    }
  );

  app.post(
    '/historicos-lancamento-tarefa',
    { onRequest: [app.autenticar], schema: CRIAR_HISTORICO_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const historico = await criarHistorico(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(historico);
    }
  );

  app.delete(
    '/historicos-lancamento-tarefa/:id',
    { onRequest: [app.autenticar], schema: EXCLUIR_HISTORICO_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      await excluirHistorico(request.contexto, id);
      return reply.status(204).send();
    }
  );
};
