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
 *  PATCH /estoque/entradas/:id                  (entrada) só a observação (CAS de versão)
 *  POST  /estoque/entradas/:id/excluir          (entrada) exclusão lógica com estorno integral
 *  GET   /estoque/entradas/opcoes/{produtos,locais,fornecedores,centros-custo,centros-resultado}  (entrada) seletores
 *        (D-PROD-264: produtos, locais e centros também com `saida`, pelo formulário da saída manual)
 *
 * D-PROD-259 — cadastro de motivos de entrada (por cliente):
 *  GET   /estoque/motivos-entrada               (ver)     lista (os padrões nascem na 1ª leitura)
 *  POST  /estoque/motivos-entrada               (entrada) cria (natureza ENTRADA)
 *  PATCH /estoque/motivos-entrada/:id           (entrada) renomeia e/ou ativa/desativa
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { opcoesCentros, opcoesParceiros } from '../financeiro/operacaoFinanceiraOpcoesService.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { criar, detalhar, editar, excluir, listar, opcoesLocais, opcoesProdutos } from './entradaEstoqueService.js';
import { MAX_ITENS, NATUREZAS, PADRAO_DECIMAL, PADRAO_OPERATION_ID, recusarCoercaoEntrada } from './entradaEstoqueRegras.js';
import { NOME_MAXIMO, criarMotivo, editarMotivo, listarMotivos } from './motivoEntradaEstoqueService.js';

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
      motivo: { type: 'string', enum: [...NATUREZAS] },
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
  required: ['produto_id', 'local_estoque_id', 'unidade', 'quantidade', 'custo_unitario'],
  additionalProperties: false,
  properties: {
    produto_id: ID, local_estoque_id: ID, unidade: { type: 'string', enum: ['KG', 'SACO', 'L'] }, quantidade: DECIMAL, custo_unitario: DECIMAL, custo_zero: { type: 'boolean' },
    lote_fabricante: TEXTO_NULO(64), data_validade: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  },
};
const CRIAR = {
  body: {
    type: 'object',
    required: ['empresa_id', 'operation_id', 'motivo_id', 'data_entrada', 'itens'],
    additionalProperties: false,
    properties: {
      empresa_id: ID, operation_id: OPERATION_ID, motivo_id: ID, data_entrada: DIA,
      fornecedor_id: { anyOf: [ID, { type: 'null' }] }, documento_numero: TEXTO_NULO(64),
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
      // Declarados só para responder 422/409 estável (motivo imutável / edição física não suportada), nunca para aplicar.
      motivo_id: { type: 'string', maxLength: 64 }, data_entrada: DIA, documento_numero: TEXTO_NULO(64), itens: { type: 'array', maxItems: MAX_ITENS },
      fornecedor_id: TEXTO_NULO(64), centro_custo_id: TEXTO_NULO(64), centro_resultado_id: TEXTO_NULO(64),
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
export const registrarEntradaEstoqueRoutes = async (app) => {
  const g = GUARDAS.estoque;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercaoEntrada(request.body);
  });

  app.get('/estoque/entradas', { ...autenticado, preHandler: [g.ver], schema: LISTAR }, async (request) => listar(ctx(request), consulta(request)));
  app.get('/estoque/entradas/opcoes/produtos', { ...autenticado, preHandler: [g.formulario], schema: OPCOES(['empresa_id']) }, async (request) => opcoesProdutos(ctx(request), consulta(request)));
  app.get('/estoque/entradas/opcoes/locais', { ...autenticado, preHandler: [g.formulario], schema: OPCOES([]) }, async (request) => opcoesLocais(ctx(request), consulta(request)));
  // D-PROD-259: fornecedor (parceiro com papel de fornecedor/prestador, como na compra) e centros ativos da fazenda.
  app.get('/estoque/entradas/opcoes/fornecedores', { ...autenticado, preHandler: [g.entrada], schema: OPCOES(['empresa_id']) }, async (request) =>
    opcoesParceiros(ctx(request), { ...consulta(request), direcao: 'PAGAR' }));
  app.get('/estoque/entradas/opcoes/centros-custo', { ...autenticado, preHandler: [g.formulario], schema: OPCOES(['empresa_id']) }, async (request) =>
    opcoesCentros('custo')(ctx(request), consulta(request)));
  app.get('/estoque/entradas/opcoes/centros-resultado', { ...autenticado, preHandler: [g.formulario], schema: OPCOES(['empresa_id']) }, async (request) =>
    opcoesCentros('resultado')(ctx(request), consulta(request)));
  app.get('/estoque/motivos-entrada', { ...autenticado, preHandler: [g.ver], schema: MOTIVOS_LISTAR }, async (request) => listarMotivos(ctx(request), consulta(request)));
  app.post('/estoque/motivos-entrada', { ...autenticado, preHandler: [g.entrada], schema: MOTIVO_CRIAR }, async (request, reply) =>
    reply.status(201).send(await criarMotivo(ctx(request), corpo(request))));
  app.patch('/estoque/motivos-entrada/:id', { ...autenticado, preHandler: [g.entrada], schema: MOTIVO_EDITAR }, async (request) =>
    editarMotivo(ctx(request), idDe(request), corpo(request)));
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
