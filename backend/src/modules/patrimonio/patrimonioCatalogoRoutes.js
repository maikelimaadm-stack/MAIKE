/**
 * D-PROD-156 — rotas dos catálogos do Patrimônio e Frota (do TENANT, sem
 * `empresa_id`): famílias, tipos, perfis de medição, combustíveis e a
 * instalação do catálogo padrão.
 *
 * Corpo e query FECHADOS (`additionalProperties: false`); tenant só da sessão
 * (`cliente_id` no corpo → 400 na barreira global); cada rota exige a ação da
 * PRÓPRIA tela (`GUARDAS.patrimonio*`): ver = visualizar, criar = novo|salvar,
 * editar = editar|salvar e, quando o corpo traz `ativo`, a ação extra
 * `inativar`. Campos imutáveis (`codigo`, `natureza`, `familia_id`,
 * `dimensao`, `finalidade`, `unidade`) ficam fora do schema do PATCH → 400.
 * Sem DELETE: inativação por PATCH.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import * as familias from './familiaPatrimonialService.js';
import * as tipos from './tipoPatrimonialService.js';
import * as perfis from './perfilMedicaoService.js';
import * as combustiveis from './tipoCombustivelService.js';
import { instalarCatalogoPadrao } from './patrimonioCatalogoPadrao.js';
import { FINALIDADES_PERFIL, NATUREZAS, NOMES_DIMENSOES, UNIDADES_COMBUSTIVEL } from './patrimonioDominio.js';

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

/** Perfis sugeridos do tipo: o teto real (10) é regra de negócio (422); o schema só barra abuso. */
const PERFIS_DO_TIPO = {
  type: 'array',
  maxItems: 50,
  items: { type: 'object', required: ['perfil_id'], additionalProperties: false, properties: { perfil_id: ID, principal: { type: ['boolean', 'null'] } } },
};
/** Unidades: o domínio por dimensão é regra de negócio (422 `PERFIL_UNIDADES_INVALIDAS`). */
const UNIDADES = { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 8 } };

const FAMILIA_LISTAR = listar({ natureza: ENUM(NATUREZAS) });
const FAMILIA_CRIAR = criarCom(['codigo', 'nome', 'natureza'], {
  codigo: CODIGO, nome: NOME, natureza: ENUM(NATUREZAS), descricao: TEXTO(500), ordem: INTEIRO_NULO(0, 9999), vida_util_meses_padrao: VIDA_UTIL,
});
const FAMILIA_ATUALIZAR = atualizarCom({ nome: NOME, descricao: TEXTO(500), ordem: INTEIRO_NULO(0, 9999), vida_util_meses_padrao: VIDA_UTIL });

const TIPO_LISTAR = listar({ familia_id: ID });
const TIPO_CRIAR = criarCom(['familia_id', 'codigo', 'nome'], {
  familia_id: ID, codigo: CODIGO, nome: NOME, descricao: TEXTO(500), vida_util_meses_sugerida: VIDA_UTIL, perfis: PERFIS_DO_TIPO,
});
const TIPO_ATUALIZAR = atualizarCom({ nome: NOME, descricao: TEXTO(500), vida_util_meses_sugerida: VIDA_UTIL, perfis: PERFIS_DO_TIPO });

const PERFIL_LISTAR = listar();
const PERFIL_CRIAR = criarCom(['codigo', 'nome', 'dimensao', 'finalidade', 'unidades_permitidas'], {
  codigo: CODIGO, nome: NOME, dimensao: ENUM(NOMES_DIMENSOES), finalidade: ENUM(FINALIDADES_PERFIL), unidades_permitidas: UNIDADES, descricao: TEXTO(500),
});
const PERFIL_ATUALIZAR = atualizarCom({ nome: NOME, unidades_permitidas: UNIDADES, descricao: TEXTO(500) });

const COMBUSTIVEL_LISTAR = listar();
const COMBUSTIVEL_CRIAR = criarCom(['codigo', 'nome'], { codigo: CODIGO, nome: NOME, unidade: ENUM(UNIDADES_COMBUSTIVEL), descricao: TEXTO(500) });
const COMBUSTIVEL_ATUALIZAR = atualizarCom({ nome: NOME, descricao: TEXTO(500) });

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
  registrarRecurso(app, '/patrimonio-perfis-medicao', GUARDAS.patrimonioPerfisMedicao, perfis, { listar: PERFIL_LISTAR, criar: PERFIL_CRIAR, atualizar: PERFIL_ATUALIZAR });
  registrarRecurso(app, '/patrimonio-combustiveis', GUARDAS.patrimonioCombustiveis, combustiveis, {
    listar: COMBUSTIVEL_LISTAR, criar: COMBUSTIVEL_CRIAR, atualizar: COMBUSTIVEL_ATUALIZAR,
  });
  // Idempotente (cria só o que falta): 200 com o resumo, também quando nada é criado.
  app.post('/patrimonio-catalogo-padrao', { onRequest: [app.autenticar], preHandler: [GUARDAS.patrimonioCatalogoPadrao], schema: CATALOGO_PADRAO }, async (request) =>
    instalarCatalogoPadrao(ctx(request)));
};
