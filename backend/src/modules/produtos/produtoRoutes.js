/**
 * Rotas de Produto (P5.2, D-PROD-48).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { listar, listarPagina, criar, atualizar, excluir } from './produtoService.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { AppError } from '../../shared/errors/AppError.js';

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
  // D-PROD-161: continua no schema só para o cliente antigo que manda 0 não
  // receber 400 (additionalProperties:false). É cache do motor físico: o service
  // aceita 0/ausente no POST e o valor atual no PATCH (sem efeito); o resto → 422.
  estoque_atual: { type: 'number' },
  estoque_minimo: { type: 'number' },
  local_estoque: { type: ['string', 'null'], maxLength: 255 },
  tipo_consumo: { type: ['string', 'null'], maxLength: 32 },
  percentual_consumo_pv: { type: ['number', 'null'] },
  consumo_minimo_pv: { type: ['number', 'null'] },
  consumo_maximo_pv: { type: ['number', 'null'] },
  unidade_principal_estoque: { type: 'string', maxLength: 16 },
  peso_por_saco_kg: { type: ['number', 'null'] },
  // D-PROD-319: quantidade padrão por implemento cheio (texto decimal; a unidade L ou KG). Opcionais: sem elas, nada muda.
  quantidade_padrao: { type: ['string', 'null'], pattern: '^\\d{1,10}(\\.\\d{1,4})?$' },
  quantidade_padrao_unidade: { type: ['string', 'null'], enum: ['L', 'KG', null] },
  // MAIKE-ENTREGA2 (D-PROD-274): carência da bula, em dias (0..365 no serviço; null limpa).
  carencia_dias: { type: ['integer', 'null'] },
  // D-PROD-282: controle de lote e de validade (Sim/Não; validade só com lote; trocar só com saldo zero).
  controla_lote: { type: 'boolean' },
  controla_validade: { type: 'boolean' },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
  // D-PROD-288: unidades de conversão (a lista substitui a vigente; o serviço confere sigla, operação e fator).
  unidades_conversao: {
    type: 'array',
    maxItems: 30,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['sigla', 'operacao', 'fator'],
      properties: {
        id: { type: ['string', 'null'], maxLength: 64 },
        sigla: { type: 'string', minLength: 1, maxLength: 16 },
        operacao: { type: 'string', enum: ['MULTIPLICA', 'DIVIDE'] },
        fator: { type: ['number', 'string'] },
        uso_compra: { type: 'boolean' },
        uso_venda: { type: 'boolean' },
        codigo_barras: { type: ['string', 'null'], maxLength: 64 },
        ativa: { type: 'boolean' },
        ordem: { type: 'integer', minimum: 0 },
      },
    },
  },
});

/**
 * D-PROD-319: a quantidade padrão é TEXTO decimal. O AJV coagiria um número antes do serviço (e o float já viria
 * torto): número → 400, antes da coerção, como nas linhas de atividade.
 */
const recusarNumeroNaQuantidadePadrao = async (request) => {
  const c = request.body;
  if (c && typeof c === 'object' && c.quantidade_padrao !== undefined && c.quantidade_padrao !== null && typeof c.quantidade_padrao !== 'string') {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'quantidade_padrao deve ser texto decimal (ex.: "4"), nunca número', {
      details: { field: 'quantidade_padrao', reason: 'valor_deve_ser_texto' },
    });
  }
};

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

const LISTAR_PAGINA_SCHEMA = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
      q: { type: 'string', maxLength: 200 },
      ativo: { anyOf: [{ type: 'boolean' }, { type: 'string', enum: ['true', 'false', '1', '0'] }] },
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

  app.get(
    '/produtos/page',
    { onRequest: [app.autenticar], schema: LISTAR_PAGINA_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      return listarPagina(request.contexto, /** @type {Record<string, unknown>} */ (request.query ?? {}));
    },
  );

  app.post('/produtos', { onRequest: [app.autenticar], preHandler: [GUARDAS.produto.criar], preValidation: recusarNumeroNaQuantidadePadrao, schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const produto = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(produto);
  });

  app.patch('/produtos/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.produto.editar], preValidation: recusarNumeroNaQuantidadePadrao, schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/produtos/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.produto.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
