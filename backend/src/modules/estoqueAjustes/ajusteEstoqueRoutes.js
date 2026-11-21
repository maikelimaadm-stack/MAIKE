/**
 * D-PROD-272 (Estoque → Novo movimento → Ajuste) — rotas do ajuste de inventário documentado.
 * Guardadas pela tela `sup-estoque` (`GUARDAS.estoque`): LER a lista e o detalhe = `visualizar`; o saldo do
 * depósito, criar, editar a observação e excluir = ação extra `ajuste` (nenhum perfil a recebe por padrão;
 * administrador e `is_admin` têm tudo). O tenant vem SÓ do `auth_context`; corpo e query FECHADOS; decimais
 * como TEXTO (número no JSON é 400). Sem data no corpo: o ajuste é do dia de hoje da fazenda.
 *
 *  GET   /estoque/ajustes                 (ver)     lista keyset
 *  GET   /estoque/ajustes/saldo           (ajuste)  saldo e custo médio do produto no depósito
 *  GET   /estoque/ajustes/:id             (ver)     detalhe com histórico
 *  POST  /estoque/ajustes                 (ajuste)  cria e confirma (201; replay 200)
 *  PATCH /estoque/ajustes/:id             (ajuste)  só a observação (CAS de versão)
 *  POST  /estoque/ajustes/:id/excluir     (ajuste)  estorno integral (sem movimento depois)
 *
 * Os seletores do formulário (produtos, depósitos, centros) são os da entrada (`/estoque/entradas/opcoes/*`) e
 * aceitam também a ação `ajuste` (`GUARDAS.estoque.formulario`).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { MAX_ITENS, PADRAO_DECIMAL, PADRAO_OPERATION_ID, recusarCoercaoAjuste } from './ajusteEstoqueRegras.js';
import { criar, detalhar, editar, excluir, listar, saldoDoDeposito } from './ajusteEstoqueService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const TEXTO_NULO = (max) => ({ type: ['string', 'null'], maxLength: max });
const DECIMAL = { type: 'string', pattern: PADRAO_DECIMAL.source };
const OPERATION_ID = { type: 'string', pattern: PADRAO_OPERATION_ID.source };
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const LISTAR = {
  querystring: {
    type: 'object', required: ['empresa_id'], additionalProperties: false,
    properties: {
      empresa_id: ID, status: { type: 'string', enum: ['CONFIRMADA', 'EXCLUIDA'] }, produto_id: ID, data_de: DIA, data_ate: DIA,
      q: { type: 'string', maxLength: 64 }, limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};
const SALDO = {
  querystring: { type: 'object', required: ['empresa_id', 'produto_id', 'local_estoque_id'], additionalProperties: false, properties: { empresa_id: ID, produto_id: ID, local_estoque_id: ID } },
};
const DETALHE = { params: PARAMS, querystring: EMPRESA };
const ITEM = {
  type: 'object', required: ['produto_id', 'local_estoque_id', 'unidade', 'quantidade_contada'], additionalProperties: false,
  properties: {
    produto_id: ID, local_estoque_id: ID, unidade: { type: 'string', enum: ['KG', 'SACO', 'L'] }, quantidade_contada: DECIMAL,
    custo_unitario: { anyOf: [DECIMAL, { type: 'null' }] },
  },
};
const CRIAR = {
  body: {
    type: 'object', required: ['empresa_id', 'operation_id', 'itens'], additionalProperties: false,
    properties: {
      empresa_id: ID, operation_id: OPERATION_ID,
      centro_custo_id: { anyOf: [ID, { type: 'null' }] }, centro_resultado_id: { anyOf: [ID, { type: 'null' }] }, observacao: TEXTO_NULO(500),
      itens: { type: 'array', minItems: 1, maxItems: MAX_ITENS, items: ITEM },
    },
  },
};
const EDITAR = {
  params: PARAMS,
  body: {
    type: 'object', required: ['empresa_id', 'versao', 'motivo_edicao'], additionalProperties: false,
    properties: {
      empresa_id: ID, versao: { type: 'integer', minimum: 1 }, motivo_edicao: { type: 'string', minLength: 1, maxLength: 500 }, observacao: TEXTO_NULO(500),
      // Declarados só para responder 409 estável (edição física não suportada), nunca para aplicar.
      itens: { type: 'array', maxItems: MAX_ITENS }, centro_custo_id: TEXTO_NULO(64), centro_resultado_id: TEXTO_NULO(64),
    },
  },
};
const EXCLUIR = {
  params: PARAMS,
  body: {
    type: 'object', required: ['empresa_id', 'versao', 'motivo', 'operation_id'], additionalProperties: false,
    properties: { empresa_id: ID, versao: { type: 'integer', minimum: 1 }, motivo: { type: 'string', minLength: 1, maxLength: 500 }, operation_id: OPERATION_ID },
  },
};

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {any} */ (request.params).id;
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAjusteEstoqueRoutes = async (app) => {
  const g = GUARDAS.estoque;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercaoAjuste(request.body);
  });

  app.get('/estoque/ajustes', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/estoque/ajustes/saldo', { ...autenticado, preHandler: [g.ajuste], schema: SALDO }, async (request) => saldoDoDeposito(ctx(request), consulta(request)));
  app.get('/estoque/ajustes/:id', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) => detalhar(ctx(request), idDe(request), consulta(request)));
  app.post('/estoque/ajustes', { ...autenticado, preHandler: [g.ajuste], schema: CRIAR }, async (request, reply) => {
    const r = await criar(ctx(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.patch('/estoque/ajustes/:id', { ...autenticado, preHandler: [g.ajuste], schema: EDITAR }, async (request) => editar(ctx(request), idDe(request), corpo(request)));
  app.post('/estoque/ajustes/:id/excluir', { ...autenticado, preHandler: [g.ajuste], schema: EXCLUIR }, async (request, reply) => {
    const r = await excluir(ctx(request), idDe(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
};
