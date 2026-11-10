/**
 * D-PROD-157 / D-PROD-161 — rotas dos catálogos do Patrimônio e Frota (do
 * TENANT, sem `empresa_id`): famílias, tipos e a instalação do catálogo padrão.
 * Perfis de medição e combustíveis saíram (D-PROD-161: as rotas respondem 404).
 *
 * Corpo e query FECHADOS (`additionalProperties: false`); tenant só da sessão
 * (`cliente_id` no corpo → 400 na barreira global). Famílias e tipos vivem no
 * cadastro de Bens: as guardas são da tela `pat-bens-patrimoniais`
 * (`GUARDAS.patrimonioFamilias/Tipos`): ver = Bens visualizar, criar = Bens
 * novo|salvar|editar ("+ Nova família"/"+ Novo tipo" de quem cadastra OU edita
 * bem), editar = Bens editar|salvar e, quando o corpo traz `ativo`, a ação extra
 * `inativar`. `codigo` é opcional no POST (o servidor gera do nome, P-05).
 * Campos imutáveis (`codigo`, `natureza`, `familia_id`) ficam fora do schema do
 * PATCH → 400; `perfis` no corpo do tipo → 400. Sem DELETE: inativação por PATCH.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import * as familias from './familiaPatrimonialService.js';
import * as tipos from './tipoPatrimonialService.js';
import { instalarCatalogoPadrao } from './patrimonioCatalogoPadrao.js';
import { NATUREZAS } from './patrimonioDominio.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const CODIGO = { type: 'string', minLength: 2, maxLength: 32, pattern: '^[A-Za-z0-9_]{2,32}$' };
const NOME = { type: 'string', minLength: 1, maxLength: 120 };
const TEXTO = (max) => ({ type: ['string', 'null'], maxLength: max });
const INTEIRO_NULO = (minimo, maximo) => ({ type: ['integer', 'null'], minimum: minimo, maximum: maximo });
const ENUM = (lista) => ({ type: 'string', enum: [...lista] });
const VERSAO = { type: 'integer', minimum: 1 };
const VIDA_UTIL = INTEIRO_NULO(1, 1200);
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };

const listar = (filtros = {}) => ({
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', maxLength: 120 },
      ativo: { type: 'string', enum: ['true', 'false'] },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
      ...filtros,
    },
  },
});
const DETALHE = { params: PARAMS };
const criarCom = (required, properties) => ({ body: { type: 'object', required, additionalProperties: false, properties } });
const atualizarCom = (properties) => ({
  params: PARAMS,
  body: { type: 'object', required: ['versao'], minProperties: 2, additionalProperties: false, properties: { versao: VERSAO, ...properties, ativo: { type: 'boolean' } } },
});

const FAMILIA_LISTAR = listar({ natureza: ENUM(NATUREZAS) });
const FAMILIA_CRIAR = criarCom(['nome', 'natureza'], {
  codigo: CODIGO, nome: NOME, natureza: ENUM(NATUREZAS), descricao: TEXTO(500), ordem: INTEIRO_NULO(0, 9999), vida_util_meses_padrao: VIDA_UTIL,
});
const FAMILIA_ATUALIZAR = atualizarCom({ nome: NOME, descricao: TEXTO(500), ordem: INTEIRO_NULO(0, 9999), vida_util_meses_padrao: VIDA_UTIL });

const TIPO_LISTAR = listar({ familia_id: ID });
const TIPO_CRIAR = criarCom(['familia_id', 'nome'], {
  familia_id: ID, codigo: CODIGO, nome: NOME, descricao: TEXTO(500), vida_util_meses_sugerida: VIDA_UTIL,
});
const TIPO_ATUALIZAR = atualizarCom({ nome: NOME, descricao: TEXTO(500), vida_util_meses_sugerida: VIDA_UTIL });

const CATALOGO_PADRAO = { body: { type: ['object', 'null'], additionalProperties: false, properties: {} } };

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {any} */ (request.params).id;
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);

/**
 * Um recurso de catálogo: lista keyset, detalhe, POST (201) e PATCH (CAS).
 * @param {import('fastify').FastifyInstance} app
 * @param {string} base
 * @param {{ ver: any, criar: any, editar: any }} g
 * @param {{ listar: Function, detalhar: Function, criar: Function, atualizar: Function }} servico
 * @param {{ listar: any, criar: any, atualizar: any }} schemas
 */
const registrarRecurso = (app, base, g, servico, schemas) => {
  app.get(base, { onRequest: [app.autenticar], preHandler: [g.ver], schema: schemas.listar }, async (request) => servico.listar(ctx(request), consulta(request)));
  app.get(`${base}/:id`, { onRequest: [app.autenticar], preHandler: [g.ver], schema: DETALHE }, async (request) => servico.detalhar(ctx(request), idDe(request)));
  app.post(base, { onRequest: [app.autenticar], preHandler: [g.criar], schema: schemas.criar }, async (request, reply) =>
    reply.status(201).send(await servico.criar(ctx(request), corpo(request))));
  app.patch(`${base}/:id`, { onRequest: [app.autenticar], preHandler: [g.editar], schema: schemas.atualizar }, async (request) =>
    servico.atualizar(ctx(request), idDe(request), corpo(request)));
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarPatrimonioCatalogoRoutes = async (app) => {
  registrarRecurso(app, '/patrimonio-familias', GUARDAS.patrimonioFamilias, familias, { listar: FAMILIA_LISTAR, criar: FAMILIA_CRIAR, atualizar: FAMILIA_ATUALIZAR });
  registrarRecurso(app, '/patrimonio-tipos', GUARDAS.patrimonioTipos, tipos, { listar: TIPO_LISTAR, criar: TIPO_CRIAR, atualizar: TIPO_ATUALIZAR });
  // Idempotente (cria só o que falta): 200 com o resumo, também quando nada é criado.
  app.post('/patrimonio-catalogo-padrao', { onRequest: [app.autenticar], preHandler: [GUARDAS.patrimonioCatalogoPadrao], schema: CATALOGO_PADRAO }, async (request) =>
    instalarCatalogoPadrao(ctx(request)));
};
