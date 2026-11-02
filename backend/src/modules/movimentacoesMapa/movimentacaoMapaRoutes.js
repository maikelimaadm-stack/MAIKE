/**
 * Rotas de MovimentacaoMapa (P5.5).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { querystringListagemEmpresa } from '../../shared/http/listQueryLimit.js';
import { listar, listarHistorico, criar, atualizar, excluir, HISTORICO_LIMITE_MAXIMO } from './movimentacaoMapaService.js';
import { cancelar, elegibilidade } from './movimentacaoMapaCancelamentoService.js';
import { executarManejoLote } from './manejoMapaComandoService.js';
import { executarJuncaoLotes } from './manejoJuncaoComandoService.js';
import { MAX_ORIGENS_JUNCAO } from './juncaoConstantes.js';
import { executarManejoRebanho, MAX_LINHAS, MODOS_PESAGEM, PESO_MAXIMO_KG, SEXOS, TIPOS_DO_COMANDO_REBANHO } from './manejoRebanhoComandoService.js';

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

/**
 * Histórico paginado (D-PROD-94): só leitura, tenant do token, empresa como
 * escopo. `additionalProperties: false` — `cliente_id` na query vira 400.
 */
const HISTORICO_SCHEMA = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      area_id: { type: 'string', minLength: 1, maxLength: 64 },
      lote_ids: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 64 } },
      lote_nomes: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 255 } },
      limit: { type: 'integer', minimum: 1, maximum: HISTORICO_LIMITE_MAXIMO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};

/**
 * Cancelamento (R2A, D-PROD-99): o corpo só traz a chave idempotente e o motivo;
 * movimento, lotes, empresa e quantidades são lidos do servidor.
 */
const CANCELAMENTO_SCHEMA = {
  ...ID_SCHEMA,
  body: {
    type: 'object',
    required: ['operation_id', 'motivo'],
    additionalProperties: false,
    properties: {
      operation_id: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' },
      motivo: { type: 'string', minLength: 3, maxLength: 500, pattern: '\\S' },
    },
  },
};

/**
 * Comando atômico de manejo (R2A-R1, D-PROD-99a): Morte, Abate e Transferência
 * numa transação, com o efeito calculado e gravado pelo servidor.
 */
const MANEJO_SCHEMA = {
  body: {
    type: 'object',
    required: ['operation_id', 'tipo', 'empresa_id', 'lote_id', 'quantidade_animais', 'data_movimentacao'],
    additionalProperties: false,
    properties: {
      operation_id: { type: 'string', minLength: 8, maxLength: 160, pattern: '^[A-Za-z0-9_.:-]+$' },
      tipo: { type: 'string', enum: ['Morte', 'Abate', 'Transferência de Área'] },
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      lote_id: { type: 'string', minLength: 1, maxLength: 64 },
      quantidade_animais: { type: 'integer', minimum: 1, maximum: 1000000 },
      data_movimentacao: { type: 'string', minLength: 10, maxLength: 40 },
      area_destino_id: { type: 'string', minLength: 1, maxLength: 64 },
      lote_destino_id: { type: 'string', minLength: 1, maxLength: 64 },
      observacoes: { type: 'string', maxLength: 4000 },
      categoria_animal: { type: 'string', maxLength: 128 },
      usuario_responsavel: { type: 'string', maxLength: 255 },
    },
  },
};

/**
 * Comando atômico do rebanho (R2B-P1, D-PROD-101): Nascimento, Pesagem e
 * Mudança de Categoria com várias linhas numa transação. Schema estrito: campo
 * desconhecido (inclusive `efeito_servidor`, `situacao`, `cancelamento`,
 * `usuario_responsavel`) é 400. O serviço revalida a forma por tipo.
 */
const PESO_SCHEMA = { type: ['number', 'null'], exclusiveMinimum: 0, maximum: PESO_MAXIMO_KG };
const QUANTIDADE_SCHEMA = { type: 'integer', minimum: 1, maximum: 1000000 };
const TEXTO_CURTO = { type: 'string', minLength: 1, maxLength: 128 };
const MANEJO_REBANHO_SCHEMA = {
  body: {
    type: 'object',
    required: ['operation_id', 'tipo', 'empresa_id', 'area_id', 'data_movimentacao', 'linhas'],
    additionalProperties: false,
    properties: {
      operation_id: { type: 'string', minLength: 8, maxLength: 160, pattern: '^[A-Za-z0-9_.:-]+$' },
      tipo: { type: 'string', enum: [...TIPOS_DO_COMANDO_REBANHO] },
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      area_id: { type: 'string', minLength: 1, maxLength: 64 },
      data_movimentacao: { type: 'string', minLength: 10, maxLength: 40 },
      observacoes: { type: 'string', maxLength: 4000 },
      modo_pesagem: { type: 'string', enum: [...MODOS_PESAGEM] },
      linhas: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_LINHAS,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            // Nascimento
            sexo: { type: 'string', enum: [...SEXOS] },
            categoria_mae: TEXTO_CURTO,
            // Pesagem
            lote_id: { type: 'string', minLength: 1, maxLength: 64 },
            categoria: TEXTO_CURTO,
            // Mudança de Categoria
            categoria_atual: TEXTO_CURTO,
            categoria_nova: TEXTO_CURTO,
            categoria_manejo_id_novo: { type: 'string', minLength: 1, maxLength: 64 },
            // Comuns
            quantidade: QUANTIDADE_SCHEMA,
            peso_medio_kg: PESO_SCHEMA,
          },
        },
      },
    },
  },
};

/**
 * Junção de Lotes (R2C-P1, D-PROD-102): só ids, data e observação. Saldo,
 * peso, área de destino, categoria, tenant, autor e efeitos são do servidor;
 * qualquer outro campo é 400.
 */
const ID_LOTE = { type: 'string', minLength: 1, maxLength: 64 };
const JUNCAO_SCHEMA = {
  body: {
    type: 'object',
    required: ['operation_id', 'empresa_id', 'area_id', 'lote_principal_id', 'lote_origem_ids', 'data_movimentacao'],
    additionalProperties: false,
    properties: {
      operation_id: { type: 'string', minLength: 8, maxLength: 160, pattern: '^[A-Za-z0-9_.:-]+$' },
      empresa_id: ID_LOTE,
      area_id: ID_LOTE,
      lote_principal_id: ID_LOTE,
      lote_origem_ids: { type: 'array', minItems: 1, maxItems: MAX_ORIGENS_JUNCAO, uniqueItems: true, items: ID_LOTE },
      data_movimentacao: { type: 'string', minLength: 10, maxLength: 40 },
      observacoes: { type: 'string', maxLength: 4000 },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarMovimentacaoMapaRoutes = async (app) => {
  app.get('/movimentacoes-mapa', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.get('/movimentacoes-mapa/historico', { onRequest: [app.autenticar], schema: HISTORICO_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarHistorico(request.contexto, /** @type {Record<string, unknown>} */ (request.query ?? {}));
  });

  app.post('/movimentacoes-mapa/comandos/manejo-lote', { onRequest: [app.autenticar], schema: MANEJO_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { status, body } = await executarManejoLote(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(status).send(body);
  });

  app.post('/movimentacoes-mapa/comandos/manejo-rebanho', { onRequest: [app.autenticar], schema: MANEJO_REBANHO_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { status, body } = await executarManejoRebanho(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(status).send(body);
  });

  app.post('/movimentacoes-mapa/comandos/juncao-lotes', { onRequest: [app.autenticar], schema: JUNCAO_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { status, body } = await executarJuncaoLotes(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(status).send(body);
  });

  app.get('/movimentacoes-mapa/:id/elegibilidade-cancelamento', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return elegibilidade(request.contexto, id);
  });

  app.post('/movimentacoes-mapa/:id/cancelamento', { onRequest: [app.autenticar], schema: CANCELAMENTO_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    const { status, body } = await cancelar(request.contexto, id, /** @type {{operation_id: string, motivo: string}} */ (request.body));
    return reply.status(status).send(body);
  });

  app.post('/movimentacoes-mapa', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('/movimentacoes-mapa/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('/movimentacoes-mapa/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
