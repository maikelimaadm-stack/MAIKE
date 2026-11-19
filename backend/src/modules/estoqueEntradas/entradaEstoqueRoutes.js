/**
 * D-PROD-257 (Estoque → Entradas) — rotas da entrada manual documentada e do saldo de implantação.
 * Guardadas pela tela `sup-estoque` (`GUARDAS.estoque`): LER a lista e o detalhe = `visualizar`;
 * criar, editar a observação e excluir = ação extra `entrada` (nenhum perfil a recebe por padrão;
 * administrador e `is_admin` têm tudo). O tenant vem SÓ do `auth_context`; corpo e query FECHADOS
 * (`additionalProperties: false`); decimais chegam como TEXTO (número no JSON é 400).
 *
 *  GET   /estoque/entradas                      (ver)     lista keyset
 *  GET   /estoque/entradas/:id                  (ver)     detalhe com histórico
 *  POST  /estoque/entradas                      (entrada) cria e confirma (201; replay 200)
 *  PATCH /estoque/entradas/:id                  (entrada) só observação e justificativa (CAS de versão)
 *  POST  /estoque/entradas/:id/excluir          (entrada) exclusão lógica com estorno integral
 *  GET   /estoque/entradas/opcoes/{produtos,locais}  (entrada) seletores do formulário
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { criar, detalhar, editar, excluir, listar, opcoesLocais, opcoesProdutos } from './entradaEstoqueService.js';
import { MAX_ITENS, MOTIVOS, PADRAO_DECIMAL, PADRAO_OPERATION_ID, recusarCoercaoEntrada } from './entradaEstoqueRegras.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const TEXTO_NULO = (max) => ({ type: ['string', 'null'], maxLength: max });
const DECIMAL = { type: 'string', pattern: PADRAO_DECIMAL.source };
const OPERATION_ID = { type: 'string', pattern: PADRAO_OPERATION_ID.source };
const PARAMS = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const LISTAR = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      status: { type: 'string', enum: ['CONFIRMADA', 'EXCLUIDA'] },
      motivo: { type: 'string', enum: [...MOTIVOS] },
      produto_id: ID,
      data_de: DIA,
      data_ate: DIA,
      q: { type: 'string', maxLength: 64 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};
const DETALHE = { params: PARAMS, querystring: EMPRESA };
const ITEM = {
  type: 'object',
  required: ['produto_id', 'local_estoque_id', 'unidade', 'quantidade', 'custo_unitario'],
  additionalProperties: false,
  properties: { produto_id: ID, local_estoque_id: ID, unidade: { type: 'string', enum: ['KG', 'SACO', 'L'] }, quantidade: DECIMAL, custo_unitario: DECIMAL, custo_zero: { type: 'boolean' } },
};
const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'operation_id', 'motivo', 'data_entrada', 'itens'],
    additionalProperties: false,
    properties: {
      empresa_id: ID, operation_id: OPERATION_ID, motivo: { type: 'string', enum: [...MOTIVOS] }, data_entrada: DIA,
      documento_numero: TEXTO_NULO(64), observacao: TEXTO_NULO(500), justificativa: TEXTO_NULO(500),
      itens: { type: 'array', minItems: 1, maxItems: MAX_ITENS, items: ITEM },
    },
  },
};
const EDITAR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'motivo_edicao'],
    additionalProperties: false,
    properties: {
      empresa_id: ID, versao: { type: 'integer', minimum: 1 }, motivo_edicao: { type: 'string', minLength: 1, maxLength: 500 },
      observacao: TEXTO_NULO(500), justificativa: TEXTO_NULO(500),
      // Declarados só para responder 422/409 estável (motivo imutável / edição física não suportada), nunca para aplicar.
      motivo: { type: 'string', maxLength: 32 }, data_entrada: DIA, documento_numero: TEXTO_NULO(64), itens: { type: 'array', maxItems: MAX_ITENS },
    },
  },
};
const EXCLUIR = {
  params: PARAMS,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'motivo', 'operation_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: { type: 'integer', minimum: 1 }, motivo: { type: 'string', minLength: 1, maxLength: 500 }, operation_id: OPERATION_ID },
  },
};
const OPCOES = (req) => ({
  querystring: {
    type: 'object',
    required: req,
    additionalProperties: false,
    properties: {
      empresa_id: ID, q: { type: 'string', maxLength: 120 }, cursor: { type: 'string', minLength: 1, maxLength: 2200 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
    },
  },
});

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {any} */ (request.params).id;
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarEntradaEstoqueRoutes = async (app) => {
  const g = GUARDAS.estoque;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercaoEntrada(request.body);
  });

  app.get('/estoque/entradas', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/estoque/entradas/opcoes/produtos', { ...autenticado, preHandler: [g.entrada], schema: OPCOES(['empresa_id']) }, async (request) => opcoesProdutos(ctx(request), consulta(request)));
  app.get('/estoque/entradas/opcoes/locais', { ...autenticado, preHandler: [g.entrada], schema: OPCOES([]) }, async (request) => opcoesLocais(ctx(request), consulta(request)));
  app.get('/estoque/entradas/:id', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) => detalhar(ctx(request), idDe(request), consulta(request)));
  app.post('/estoque/entradas', { ...autenticado, preHandler: [g.entrada], schema: CRIAR }, async (request, reply) => {
    const r = await criar(ctx(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.patch('/estoque/entradas/:id', { ...autenticado, preHandler: [g.entrada], schema: EDITAR }, async (request) => editar(ctx(request), idDe(request), corpo(request)));
  app.post('/estoque/entradas/:id/excluir', { ...autenticado, preHandler: [g.entrada], schema: EXCLUIR }, async (request, reply) => {
    const r = await excluir(ctx(request), idDe(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
};
