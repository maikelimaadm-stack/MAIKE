/**
 * D-PROD-157 / D-PROD-162 / D-PROD-169 — rotas dos catálogos do Patrimônio e
 * Frota (do TENANT, sem `empresa_id`): tipos e a instalação explícita do
 * catálogo padrão. Perfis de medição e combustíveis saíram (D-PROD-162: as
 * rotas respondem 404).
 *
 * D-PROD-169 (SIMPLIFICA-02): o cadastro de família saiu da tela e NENHUMA
 * rota de família existe mais (POST/PATCH e também GET → 404): nenhuma tela lê
 * família — ela aparece só dentro do tipo (`familia`, `natureza`). O
 * tipo é criado por "Tipo de bem" (`natureza`, sem `familia_id`: o servidor
 * resolve a família padrão; `familia_id` continua aceito por compatibilidade
 * e é conferido), listado com filtro `natureza`, renomeado (PATCH com CAS) e
 * EXCLUÍDO (`DELETE /patrimonio-tipos/:id?versao=N` → 204; em uso → 409
 * `PATRIMONIO_TIPO_EM_USO`). O catálogo padrão é garantido pelo serviço; o
 * `POST /patrimonio-catalogo-padrao` (idempotente) fica para o administrador,
 * mas a tela não o chama mais.
 *
 * Corpo e query FECHADOS (`additionalProperties: false`); tenant só da sessão
 * (`cliente_id` no corpo → 400 na barreira global). Tipos vivem no cadastro
 * de Bens: as guardas são da tela `pat-bens-patrimoniais`
 * (`GUARDAS.patrimonioTipos`): ver = Bens visualizar, criar = Bens
 * novo|salvar|editar ("+ Novo tipo" de quem cadastra OU edita bem), editar =
 * Bens editar|salvar e, quando o corpo traz `ativo`, a ação extra `inativar`;
 * excluir = Bens editar|salvar (a mesma de renomear, no "Gerenciar tipos").
 * `codigo` é opcional no POST (o servidor gera do nome, P-05). Campos
 * imutáveis (`codigo`, `natureza`, `familia_id`) ficam fora do schema do PATCH
 * → 400; `perfis` no corpo do tipo → 400.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { AppError } from '../../shared/errors/AppError.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import * as tipos from './tipoPatrimonialService.js';
import { PADRAO_MEDIDA } from './bemPatrimonialRegras.js';
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
/** D-PROD-201: teto do salto do medidor, texto decimal ≥ 0 (até 10 dígitos e 4 casas), ou null. */
const SALTO_MAXIMO = { type: ['string', 'null'], pattern: PADRAO_MEDIDA.source };
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

const TIPO_LISTAR = listar({ familia_id: ID, natureza: ENUM(NATUREZAS) });
/** D-PROD-169: `natureza` (o "Tipo de bem") OU `familia_id` (compatibilidade); a falta dos dois é 400 no service. */
const TIPO_CRIAR = {
  body: {
    type: 'object',
    required: ['nome'],
    additionalProperties: false,
    properties: {
      natureza: ENUM(NATUREZAS), familia_id: ID, codigo: CODIGO, nome: NOME, descricao: TEXTO(500), vida_util_meses_sugerida: VIDA_UTIL, salto_maximo_medidor: SALTO_MAXIMO,
    },
  },
};
const TIPO_ATUALIZAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['versao'],
    minProperties: 2,
    additionalProperties: false,
    properties: {
      versao: VERSAO, nome: NOME, descricao: TEXTO(500), vida_util_meses_sugerida: VIDA_UTIL, salto_maximo_medidor: SALTO_MAXIMO, ativo: { type: 'boolean' },
    },
  },
};
/** DELETE: a versão lida vai na query (CAS), como o descarte de rascunho da Gestão P3. */
const TIPO_EXCLUIR = {
  params: PARAMS,
  querystring: { type: 'object', required: ['versao'], additionalProperties: false, properties: { versao: VERSAO } },
};

const CATALOGO_PADRAO = { body: { type: ['object', 'null'], additionalProperties: false, properties: {} } };

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {any} */ (request.params).id;
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarPatrimonioCatalogoRoutes = async (app) => {
  const autenticado = { onRequest: [app.autenticar] };
  // D-PROD-201: o teto do salto é decimal em TEXTO; número → 400 antes da coerção do AJV (o float corromperia o valor).
  app.addHook('preValidation', async (request) => {
    const c = /** @type {any} */ (request.body);
    if (!c || typeof c !== 'object' || Array.isArray(c) || !Object.prototype.hasOwnProperty.call(c, 'salto_maximo_medidor')) return;
    const v = c.salto_maximo_medidor;
    if (v !== null && v !== undefined && typeof v !== 'string') {
      throw new AppError('REQUEST_VALIDATION_FAILED', 'salto_maximo_medidor deve ser texto decimal (ex.: "24"), nunca número', {
        details: { field: 'salto_maximo_medidor', reason: 'valor_deve_ser_texto', campo: 'salto_maximo_medidor' },
      });
    }
  });

  // Famílias: sem rota (D-PROD-169). A família só aparece dentro do tipo.

  // Tipos: lista keyset, detalhe, POST (201), PATCH (CAS) e DELETE (CAS, 204).
  const gt = GUARDAS.patrimonioTipos;
  app.get('/patrimonio-tipos', { ...autenticado, preHandler: [gt.ver], schema: TIPO_LISTAR }, async (request) => tipos.listar(ctx(request), consulta(request)));
  app.get('/patrimonio-tipos/:id', { ...autenticado, preHandler: [gt.ver], schema: DETALHE }, async (request) => tipos.detalhar(ctx(request), idDe(request)));
  app.post('/patrimonio-tipos', { ...autenticado, preHandler: [gt.criar], schema: TIPO_CRIAR }, async (request, reply) =>
    reply.status(201).send(await tipos.criar(ctx(request), corpo(request))));
  app.patch('/patrimonio-tipos/:id', { ...autenticado, preHandler: [gt.editar], schema: TIPO_ATUALIZAR }, async (request) =>
    tipos.atualizar(ctx(request), idDe(request), corpo(request)));
  app.delete('/patrimonio-tipos/:id', { ...autenticado, preHandler: [gt.excluir], schema: TIPO_EXCLUIR }, async (request, reply) => {
    await tipos.excluir(ctx(request), idDe(request), consulta(request));
    return reply.status(204).send();
  });

  // Idempotente (cria só o que falta): 200 com o resumo, também quando nada é criado.
  app.post('/patrimonio-catalogo-padrao', { ...autenticado, preHandler: [GUARDAS.patrimonioCatalogoPadrao], schema: CATALOGO_PADRAO }, async (request) =>
    instalarCatalogoPadrao(ctx(request)));
};
