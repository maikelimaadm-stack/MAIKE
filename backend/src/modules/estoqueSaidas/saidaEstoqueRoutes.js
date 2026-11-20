/**
 * D-PROD-264 (Estoque → Novo movimento → Saída) — rotas da saída manual documentada.
 * Guardadas pela tela `sup-estoque` (`GUARDAS.estoque`): LER a lista, o detalhe e os motivos = `visualizar`;
 * criar, editar a observação, excluir e manter os motivos = ação extra `saida` (nenhum perfil a recebe por
 * padrão; administrador e `is_admin` têm tudo). O tenant vem SÓ do `auth_context`; corpo e query FECHADOS
 * (`additionalProperties: false`); a quantidade chega como TEXTO (número no JSON é 400).
 *
 *  GET   /estoque/saidas                   (ver)    lista keyset
 *  GET   /estoque/saidas/:id               (ver)    detalhe com histórico
 *  POST  /estoque/saidas                   (saida)  cria e confirma (201; replay 200)
 *  PATCH /estoque/saidas/:id               (saida)  só a observação (CAS de versão)
 *  POST  /estoque/saidas/:id/excluir       (saida)  exclusão lógica com estorno integral (sem movimento depois)
 *  GET   /estoque/motivos-saida            (ver)    lista (os padrões nascem na 1ª leitura)
 *  POST  /estoque/motivos-saida            (saida)  cria
 *  PATCH /estoque/motivos-saida/:id        (saida)  renomeia e/ou ativa/desativa
 *
 * Os seletores do formulário (produtos, depósitos, centros) são os mesmos da entrada
 * (`/estoque/entradas/opcoes/*`) e passam a aceitar também a ação `saida` (`GUARDAS.estoque.formulario`).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { NOME_MAXIMO, criarMotivoSaida, editarMotivoSaida, listarMotivosSaida } from './motivoSaidaEstoqueService.js';
import { MAX_ITENS, PADRAO_DECIMAL, PADRAO_OPERATION_ID, recusarCoercaoSaida } from './saidaEstoqueRegras.js';
import { criar, detalhar, editar, excluir, listar } from './saidaEstoqueService.js';

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
      motivo_id: ID,
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
  required: ['produto_id', 'local_estoque_id', 'unidade', 'quantidade'],
  additionalProperties: false,
  properties: { produto_id: ID, local_estoque_id: ID, unidade: { type: 'string', enum: ['KG', 'SACO', 'L'] }, quantidade: DECIMAL },
};
const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'operation_id', 'motivo_id', 'data_saida', 'itens'],
    additionalProperties: false,
    properties: {
      empresa_id: ID, operation_id: OPERATION_ID, motivo_id: ID, data_saida: DIA,
      centro_custo_id: { anyOf: [ID, { type: 'null' }] }, centro_resultado_id: { anyOf: [ID, { type: 'null' }] }, observacao: TEXTO_NULO(500),
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
      observacao: TEXTO_NULO(500),
      // Declarados só para responder 409 estável (edição física não suportada), nunca para aplicar.
      motivo_id: { type: 'string', maxLength: 64 }, data_saida: DIA, itens: { type: 'array', maxItems: MAX_ITENS },
      centro_custo_id: TEXTO_NULO(64), centro_resultado_id: TEXTO_NULO(64),
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
const MOTIVOS_LISTAR = { querystring: { type: 'object', additionalProperties: false, properties: { ativos: { type: 'boolean' } } } };
const NOME_MOTIVO = { type: 'string', minLength: 1, maxLength: NOME_MAXIMO + 40 };
const MOTIVO_CRIAR = { body: { type: 'object', required: ['nome'], additionalProperties: false, properties: { nome: NOME_MOTIVO } } };
const MOTIVO_EDITAR = { params: PARAMS, body: { type: 'object', minProperties: 1, additionalProperties: false, properties: { nome: NOME_MOTIVO, ativo: { type: 'boolean' } } } };

const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
const idDe = (request) => /** @type {any} */ (request.params).id;
const corpo = (request) => /** @type {any} */ (request.body);
const consulta = (request) => /** @type {any} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarSaidaEstoqueRoutes = async (app) => {
  const g = GUARDAS.estoque;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercaoSaida(request.body);
  });

  app.get('/estoque/saidas', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/estoque/motivos-saida', { ...autenticado, preHandler: [g.ver], schema: MOTIVOS_LISTAR }, async (request) => listarMotivosSaida(ctx(request), consulta(request)));
  app.post('/estoque/motivos-saida', { ...autenticado, preHandler: [g.saida], schema: MOTIVO_CRIAR }, async (request, reply) =>
    reply.status(201).send(await criarMotivoSaida(ctx(request), corpo(request))));
  app.patch('/estoque/motivos-saida/:id', { ...autenticado, preHandler: [g.saida], schema: MOTIVO_EDITAR }, async (request) =>
    editarMotivoSaida(ctx(request), idDe(request), corpo(request)));
  app.get('/estoque/saidas/:id', { ...autenticado, preHandler: [g.ver], schema: DETALHE }, async (request) => detalhar(ctx(request), idDe(request), consulta(request)));
  app.post('/estoque/saidas', { ...autenticado, preHandler: [g.saida], schema: CRIAR }, async (request, reply) => {
    const r = await criar(ctx(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.patch('/estoque/saidas/:id', { ...autenticado, preHandler: [g.saida], schema: EDITAR }, async (request) => editar(ctx(request), idDe(request), corpo(request)));
  app.post('/estoque/saidas/:id/excluir', { ...autenticado, preHandler: [g.saida], schema: EXCLUIR }, async (request, reply) => {
    const r = await excluir(ctx(request), idDe(request), corpo(request));
    return reply.status(r.status).send(r.body);
  });
};
