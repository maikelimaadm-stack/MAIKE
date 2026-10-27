/**
 * Rotas de Produto (P5.2, D-PROD-48).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './produtoService.js';

const CAMPOS = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome_produto: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  tipo_uso: { type: ['string', 'null'], maxLength: 64 },
  codigo_interno: { type: ['string', 'null'], maxLength: 64 },
  codigo_barras: { type: ['string', 'null'], maxLength: 64 },
  categoria: { type: ['string', 'null'], maxLength: 255 },
  marca: { type: ['string', 'null'], maxLength: 255 },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  unidade_medida: { type: ['string', 'null'], maxLength: 32 },
  preco_custo: { type: ['number', 'null'] },
  preco_venda: { type: ['number', 'null'] },
  estoque_atual: { type: 'number' },
  estoque_minimo: { type: 'number' },
  local_estoque: { type: ['string', 'null'], maxLength: 255 },
  tipo_consumo: { type: ['string', 'null'], maxLength: 32 },
  percentual_consumo_pv: { type: ['number', 'null'] },
  consumo_minimo_pv: { type: ['number', 'null'] },
  consumo_maximo_pv: { type: ['number', 'null'] },
  unidade_principal_estoque: { type: 'string', maxLength: 16 },
  peso_por_saco_kg: { type: ['number', 'null'] },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome_produto'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const CAMPOS_EDITAVEIS = Object.fromEntries(
  Object.entries(CAMPOS).filter(([campo]) => campo !== 'empresa_id')
);

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
    properties: { ...CAMPOS_EDITAVEIS, empresa_id: CAMPOS.empresa_id },
  },
};

const EXCLUIR_SCHEMA = {
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
    properties: {
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
      ativo: { type: 'boolean' },
    },
  },
};

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarProdutoRoutes = async (app) => {
  app.get('/produtos', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {{empresa_id?: string, ativo?: boolean}} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.post('/produtos', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const produto = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(produto);
  });

  app.patch('/produtos/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/produtos/:id', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
