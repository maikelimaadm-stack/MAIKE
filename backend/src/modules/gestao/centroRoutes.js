/**
 * D-PROD-145 — rotas de Centros de Custo, Centros de Resultado e do vínculo N:N.
 * Corpo e query fechados (`additionalProperties: false`); tenant só da sessão;
 * cada rota exige a ação da PRÓPRIA tela (nunca `semTela` nem só autenticação).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { MAX_VINCULOS, definirVinculos, listarVinculos, servicoDeCentro } from './centroService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const TEXTO = (max) => ({ type: ['string', 'null'], maxLength: max });
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const QUERY_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
      q: { type: 'string', maxLength: 120 },
      ativo: { type: 'string', enum: ['true', 'false'] },
    },
  },
};
const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome'],
    additionalProperties: false,
    properties: { empresa_id: ID, nome: { type: 'string', minLength: 1, maxLength: 120 }, descricao: TEXTO(500), pai_id: { anyOf: [ID, { type: 'null' }] } },
  },
};
const ATUALIZAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id'],
    minProperties: 2,
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      nome: { type: 'string', minLength: 1, maxLength: 120 },
      descricao: TEXTO(500),
      pai_id: { anyOf: [ID, { type: 'null' }] },
      ativo: { type: 'boolean' },
    },
  },
};
const VINCULOS = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'centro_resultado_ids'],
    additionalProperties: false,
    properties: { empresa_id: ID, centro_resultado_ids: { type: 'array', maxItems: MAX_VINCULOS, items: ID } },
  },
};

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarCentroRoutes = async (app) => {
  /** @type {Array<[string, 'custo'|'resultado', any]>} */
  const CADASTROS = [['/centros-custo', 'custo', GUARDAS.centroCusto], ['/centros-resultado', 'resultado', GUARDAS.centroResultado]];
  for (const [base, chave, guarda] of CADASTROS) {
    const svc = servicoDeCentro(/** @type {'custo'|'resultado'} */ (chave));
    app.get(base, { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: LISTAR }, async (request) =>
      svc.listar(ctx(request), /** @type {any} */ (request.query)));
    app.get(`${base}/:id`, { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: { params: PARAMS, querystring: QUERY_EMPRESA } }, async (request) =>
      svc.detalhar(ctx(request), /** @type {any} */ (request.params).id, /** @type {any} */ (request.query)));
    app.post(base, { onRequest: [app.autenticar], preHandler: [guarda.criar], schema: CRIAR }, async (request, reply) =>
      reply.status(201).send(await svc.criar(ctx(request), /** @type {any} */ (request.body))));
    app.patch(`${base}/:id`, { onRequest: [app.autenticar], preHandler: [guarda.editar], schema: ATUALIZAR }, async (request) =>
      svc.atualizar(ctx(request), /** @type {any} */ (request.params).id, /** @type {any} */ (request.body)));
  }

  // Vínculos: leitura dos dois lados; escrita só pelo centro de custo (editar/salvar).
  app.get('/centros-custo/:id/centros-resultado', { onRequest: [app.autenticar], preHandler: [GUARDAS.centroCusto.ver], schema: { params: PARAMS, querystring: QUERY_EMPRESA } }, async (request) =>
    listarVinculos(ctx(request), 'custo', /** @type {any} */ (request.params).id, /** @type {any} */ (request.query)));
  app.get('/centros-resultado/:id/centros-custo', { onRequest: [app.autenticar], preHandler: [GUARDAS.centroResultado.ver], schema: { params: PARAMS, querystring: QUERY_EMPRESA } }, async (request) =>
    listarVinculos(ctx(request), 'resultado', /** @type {any} */ (request.params).id, /** @type {any} */ (request.query)));
  app.put('/centros-custo/:id/centros-resultado', { onRequest: [app.autenticar], preHandler: [GUARDAS.centroCusto.editar], schema: VINCULOS }, async (request) =>
    definirVinculos(ctx(request), /** @type {any} */ (request.params).id, /** @type {any} */ (request.body)));
  // Opções do seletor de vínculo (só id, número e nome dos centros de resultado
  // ATIVOS): quem edita o centro de custo precisa escolher sem ter a outra tela.
  const resultado = servicoDeCentro('resultado');
  app.get('/centros-custo-opcoes/centros-resultado', { onRequest: [app.autenticar], preHandler: [GUARDAS.centroCusto.editar], schema: { querystring: QUERY_EMPRESA } }, async (request) =>
    resultado.opcoesAtivas(ctx(request), /** @type {any} */ (request.query)));
  // Opções de pai (mesmo tipo, ativos) para o formulário de cada tela.
  /** @type {Array<[string, 'custo'|'resultado', any]>} */
  const OPCOES_PAI = [['/centros-custo-opcoes/pais', 'custo', GUARDAS.centroCusto], ['/centros-resultado-opcoes/pais', 'resultado', GUARDAS.centroResultado]];
  for (const [base, chave, guarda] of OPCOES_PAI) {
    const svc = servicoDeCentro(/** @type {'custo'|'resultado'} */ (chave));
    app.get(base, { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: { querystring: QUERY_EMPRESA } }, async (request) =>
      svc.opcoesAtivas(ctx(request), /** @type {any} */ (request.query)));
  }
};
