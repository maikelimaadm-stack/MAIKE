/**
 * D-PROD-159 (Patrimônio P1-02), revisto pela D-PROD-162 (SIMPLIFICA-01) —
 * rotas dos abastecimentos de bens (tela `pat-abastecimentos`, 11 rotas):
 *
 *  - `GET  /patrimonio-abastecimentos` (ver) — lista keyset com filtros
 *  - `GET  /patrimonio-abastecimentos/:id` (ver) — detalhe
 *  - `POST /patrimonio-abastecimentos-previa` (criar) — plano sem escrita
 *  - `POST /patrimonio-abastecimentos` (criar) — confirma (201; replay 200)
 *  - `POST /patrimonio-abastecimentos/:id/cancelar` (cancelar) — estorno exato
 *  - `GET  /patrimonio-abastecimentos-consumo` (ver) — consumo do bem
 *  - `GET  /patrimonio-abastecimentos-opcoes/{bens,tanques,produtos-filtro}` (ver)
 *  - `GET  /patrimonio-abastecimentos-opcoes/produtos-do-bem` (ver) — os Produtos
 *    aceitos pelos tanques ativos do bem, com os tanques de cada um, mais o
 *    `resumo` do conjunto inteiro (só leitura)
 *  - `GET  /patrimonio-abastecimentos-opcoes/locais` (criar) — locais com saldo
 *
 * D-PROD-162: saem as opções de tipos e de produtos por tipo e as 3 rotas do
 * fator kg/L (`/patrimonio-conversoes-combustivel*`): respondem 404 (rota
 * inexistente). A quantidade é a do Produto (`L` ou `KG`), sem conversão.
 *
 * Corpo e query FECHADOS (`additionalProperties: false`; `cliente_id` → 400;
 * campo antigo `quantidade_litros`, `tipo_combustivel_id`, `conversao_*` → 400,
 * nunca falso sucesso); tenant só da sessão. Decimais chegam como TEXTO: o
 * `preValidation` deste plugin (encapsulado) recusa número em `quantidade` e
 * `medidor_leitura` antes da coerção do AJV.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { consumoDoBem } from './abastecimentoConsumo.js';
import { opcoesBens, opcoesLocais, opcoesProdutosDoBem, opcoesProdutosFiltro, opcoesTanques } from './abastecimentoOpcoesService.js';
import { PADRAO_LEITURA, PADRAO_QUANTIDADE, recusarCoercaoAbastecimento } from './abastecimentoPlano.js';
import { cancelar, confirmar, detalhar, listar, previa } from './abastecimentoService.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from './patrimonioComum.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const QUANTIDADE = { type: 'string', pattern: PADRAO_QUANTIDADE.source };
const LEITURA_NULA = { type: ['string', 'null'], pattern: PADRAO_LEITURA.source };
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
  produto_id: ID,
  local_estoque_id: ID,
  data_operacional: DIA,
  quantidade: QUANTIDADE,
  medidor_leitura: LEITURA_NULA,
  tanque_cheio: { type: 'boolean' },
  observacao: TEXTO_NULO(500),
  referencia_externa: TEXTO_NULO(64),
};
const REQUERIDOS_PREVIA = ['empresa_id', 'bem_id', 'tanque_id', 'produto_id', 'local_estoque_id', 'data_operacional', 'quantidade'];

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
    required: [...REQUERIDOS_PREVIA, 'tanque_cheio', 'operation_id'],
    additionalProperties: false,
    properties: { ...CORPO_BASE, operation_id: OPERATION_ID },
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
const OPCOES_PRODUTOS_FILTRO = OPCOES(['empresa_id']);
const OPCOES_PRODUTOS_DO_BEM = OPCOES(['empresa_id', 'bem_id'], { bem_id: ID });
const OPCOES_LOCAIS = { querystring: { type: 'object', required: ['empresa_id', 'produto_id'], additionalProperties: false, properties: { empresa_id: ID, produto_id: ID } } };

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
  app.get('/patrimonio-abastecimentos-opcoes/produtos-filtro', { ...autenticado, preHandler: [g.ver], schema: OPCOES_PRODUTOS_FILTRO }, async (request) =>
    opcoesProdutosFiltro(ctx(request), consulta(request)));
  app.get('/patrimonio-abastecimentos-opcoes/produtos-do-bem', { ...autenticado, preHandler: [g.ver], schema: OPCOES_PRODUTOS_DO_BEM }, async (request) =>
    opcoesProdutosDoBem(ctx(request), consulta(request)));
  app.get('/patrimonio-abastecimentos-opcoes/locais', { ...autenticado, preHandler: [g.criar], schema: OPCOES_LOCAIS }, async (request) =>
    opcoesLocais(ctx(request), consulta(request)));
};
