/**
 * D-PROD-159 (Patrimônio P1-02) — rotas dos abastecimentos de bens e do fator
 * kg/L (tela `pat-abastecimentos`):
 *
 *  - `GET  /patrimonio-abastecimentos` (ver) — lista keyset com filtros
 *  - `GET  /patrimonio-abastecimentos/:id` (ver) — detalhe
 *  - `POST /patrimonio-abastecimentos-previa` (criar) — plano sem escrita
 *  - `POST /patrimonio-abastecimentos` (criar) — confirma (201; replay 200)
 *  - `POST /patrimonio-abastecimentos/:id/cancelar` (cancelar) — estorno exato
 *  - `GET  /patrimonio-abastecimentos-consumo` (ver) — consumo do bem
 *  - `GET  /patrimonio-abastecimentos-opcoes/{bens,tanques,tipos,produtos,produtos-filtro}` (ver)
 *  - `GET  /patrimonio-abastecimentos-opcoes/locais` (criar) — locais com saldo
 *  - `GET  /patrimonio-conversoes-combustivel` (ver), `POST …` (configurar_conversao),
 *    `POST /patrimonio-conversoes-combustivel/:id/encerrar` (configurar_conversao)
 *
 * Corpo e query FECHADOS (`additionalProperties: false`; `cliente_id` → 400);
 * tenant só da sessão. Decimais chegam como TEXTO: o `preValidation` deste
 * plugin (encapsulado) recusa número em `quantidade_litros`, `medidor_leitura`
 * e `kg_por_litro` antes da coerção do AJV.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { consumoDoBem } from './abastecimentoConsumo.js';
import { opcoesBens, opcoesLocais, opcoesProdutos, opcoesProdutosFiltro, opcoesTanques, opcoesTipos } from './abastecimentoOpcoesService.js';
import { PADRAO_FATOR, PADRAO_LEITURA, PADRAO_LITROS, recusarCoercaoAbastecimento } from './abastecimentoPlano.js';
import { cancelar, confirmar, detalhar, listar, previa } from './abastecimentoService.js';
import * as conversoes from './conversaoCombustivelService.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from './patrimonioComum.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const LITROS = { type: 'string', pattern: PADRAO_LITROS.source };
const LEITURA_NULA = { type: ['string', 'null'], pattern: PADRAO_LEITURA.source };
const FATOR = { type: 'string', pattern: PADRAO_FATOR.source };
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' };
const TEXTO_NULO = (max) => ({ type: ['string', 'null'], maxLength: max });
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const LIMITE = { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO };
const CURSOR = { type: 'string', minLength: 1, maxLength: 512 };
/** @param {string[]} req @param {Record<string, unknown>} [extra] */
const OPCOES = (req, extra = {}) => ({
  querystring: {
    type: 'object',
    required: req,
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      q: { type: 'string', maxLength: 120 },
      cursor: { type: 'string', minLength: 1, maxLength: 2200 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
      ...extra,
    },
  },
});
const CORPO_BASE = {
  empresa_id: ID,
  bem_id: ID,
  tanque_id: ID,
  tipo_combustivel_id: ID,
  produto_id: ID,
  local_estoque_id: ID,
  data_operacional: DIA,
  quantidade_litros: LITROS,
  medidor_leitura: LEITURA_NULA,
  tanque_cheio: { type: 'boolean' },
  observacao: TEXTO_NULO(500),
  referencia_externa: TEXTO_NULO(64),
};
const REQUERIDOS_PREVIA = ['empresa_id', 'bem_id', 'tanque_id', 'tipo_combustivel_id', 'produto_id', 'local_estoque_id', 'data_operacional', 'quantidade_litros'];

const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      bem_id: ID,
      tanque_id: ID,
      produto_id: ID,
      status: { type: 'string', enum: ['CONFIRMADO', 'CANCELADO'] },
      data_de: DIA,
      data_ate: DIA,
      operation_id: OPERATION_ID,
      q: { type: 'string', maxLength: 64 },
      limit: LIMITE,
      cursor: CURSOR,
    },
  },
};
const DETALHE = { params: PARAMS, querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } } };
const PREVIA = { body: { type: 'object', required: REQUERIDOS_PREVIA, additionalProperties: false, properties: CORPO_BASE } };
const CONFIRMAR = {
  body: {
    type: 'object',
    required: [...REQUERIDOS_PREVIA, 'tanque_cheio', 'operation_id', 'conversao_id', 'conversao_versao'],
    additionalProperties: false,
    properties: { ...CORPO_BASE, operation_id: OPERATION_ID, conversao_id: ID, conversao_versao: VERSAO },
  },
};
const CANCELAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'motivo', 'operation_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, motivo: { type: 'string', minLength: 1, maxLength: 500 }, operation_id: OPERATION_ID },
  },
};
const CONSUMO = {
  querystring: {
    type: 'object',
    required: ['empresa_id', 'bem_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, bem_id: ID, tanque_id: ID, limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
  },
};
const OPCOES_BENS = OPCOES(['empresa_id'], { uso: { type: 'string', enum: ['formulario', 'filtro'], default: 'formulario' } });
const OPCOES_TANQUES = { querystring: { type: 'object', required: ['empresa_id', 'bem_id'], additionalProperties: false, properties: { empresa_id: ID, bem_id: ID } } };
const OPCOES_TIPOS = OPCOES([]);
const OPCOES_PRODUTOS = OPCOES(['empresa_id', 'tipo_combustivel_id'], { tipo_combustivel_id: ID });
const OPCOES_PRODUTOS_FILTRO = OPCOES(['empresa_id']);
const OPCOES_LOCAIS = { querystring: { type: 'object', required: ['empresa_id', 'produto_id'], additionalProperties: false, properties: { empresa_id: ID, produto_id: ID } } };
const LISTAR_CONVERSOES = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      tipo_combustivel_id: ID,
      produto_id: ID,
      situacao: { type: 'string', enum: ['VIGENTES', 'TODAS'], default: 'TODAS' },
      limit: LIMITE,
      cursor: CURSOR,
    },
  },
};
const CRIAR_CONVERSAO = {
  body: {
    type: 'object',
    required: ['empresa_id', 'tipo_combustivel_id', 'produto_id', 'kg_por_litro', 'declara_estoque_em_kg', 'conversao_vigente_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      tipo_combustivel_id: ID,
      produto_id: ID,
      kg_por_litro: FATOR,
      declara_estoque_em_kg: { type: 'boolean' },
      conversao_vigente_id: ID_NULO,
    },
  },
};
const ENCERRAR_CONVERSAO = {
  params: PARAMS,
  body: { type: 'object', required: ['empresa_id', 'versao'], additionalProperties: false, properties: { empresa_id: ID, versao: VERSAO } },
};

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {any} */ (request.params).id;
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAbastecimentoRoutes = async (app) => {
  const g = GUARDAS.patrimonioAbastecimentos;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercaoAbastecimento(request.body);
  });

  app.get('/patrimonio-abastecimentos', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/patrimonio-abastecimentos/:id', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) =>
    detalhar(ctx(request), idDe(request), consulta(request)));
  app.post('/patrimonio-abastecimentos-previa', { ...autenticado, preHandler: [g.criar], schema: PREVIA }, async (request) => previa(ctx(request), corpo(request)));
  app.post('/patrimonio-abastecimentos', { ...autenticado, preHandler: [g.criar], schema: CONFIRMAR }, async (request, reply) => {
    const r = await confirmar(ctx(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.post('/patrimonio-abastecimentos/:id/cancelar', { ...autenticado, preHandler: [g.cancelar], schema: CANCELAR }, async (request) =>
    cancelar(ctx(request), idDe(request), corpo(request)));
  app.get('/patrimonio-abastecimentos-consumo', { ...autenticado, preHandler: [g.ver], schema: CONSUMO }, async (request) => consumoDoBem(ctx(request), consulta(request)));

  app.get('/patrimonio-abastecimentos-opcoes/bens', { ...autenticado, preHandler: [g.ver], schema: OPCOES_BENS }, async (request) => opcoesBens(ctx(request), consulta(request)));
  app.get('/patrimonio-abastecimentos-opcoes/tanques', { ...autenticado, preHandler: [g.ver], schema: OPCOES_TANQUES }, async (request) =>
    opcoesTanques(ctx(request), consulta(request)));
  app.get('/patrimonio-abastecimentos-opcoes/tipos', { ...autenticado, preHandler: [g.ver], schema: OPCOES_TIPOS }, async (request) => opcoesTipos(ctx(request), consulta(request)));
  app.get('/patrimonio-abastecimentos-opcoes/produtos', { ...autenticado, preHandler: [g.ver], schema: OPCOES_PRODUTOS }, async (request) =>
    opcoesProdutos(ctx(request), consulta(request)));
  app.get('/patrimonio-abastecimentos-opcoes/produtos-filtro', { ...autenticado, preHandler: [g.ver], schema: OPCOES_PRODUTOS_FILTRO }, async (request) =>
    opcoesProdutosFiltro(ctx(request), consulta(request)));
  app.get('/patrimonio-abastecimentos-opcoes/locais', { ...autenticado, preHandler: [g.criar], schema: OPCOES_LOCAIS }, async (request) =>
    opcoesLocais(ctx(request), consulta(request)));

  app.get('/patrimonio-conversoes-combustivel', { ...autenticado, preHandler: [g.ver], schema: LISTAR_CONVERSOES }, async (request) =>
    conversoes.listar(ctx(request), consulta(request)));
  app.post('/patrimonio-conversoes-combustivel', { ...autenticado, preHandler: [g.configurarConversao], schema: CRIAR_CONVERSAO }, async (request, reply) =>
    reply.status(201).send(await conversoes.criar(ctx(request), corpo(request))));
  app.post('/patrimonio-conversoes-combustivel/:id/encerrar', { ...autenticado, preHandler: [g.configurarConversao], schema: ENCERRAR_CONVERSAO }, async (request) =>
    conversoes.encerrar(ctx(request), idDe(request), corpo(request)));
};
