/**
 * D-PROD-255 (Estoque E1 + E2, P1-04) — consultas SOMENTE LEITURA do estoque.
 *
 * Todas guardadas pela tela `sup-estoque` (`GUARDAS.estoque.ver`, ação
 * `visualizar`). Os GETs antigos (`/movimentacoes-estoque`, `/estoque-lotes-nota`)
 * continuam como estão: o Mapa depende deles. Querystring fechada
 * (`additionalProperties: false`): `cliente_id` ou qualquer chave extra é 400;
 * o tenant vem do `auth_context`. `empresa_id` é obrigatória.
 *
 *  GET /estoque/saldo               produto × depósito (camadas disponíveis)
 *  GET /estoque/movimentos          kardex paginado (keyset + cursor assinado; sem os excluídos, salvo
 *                                   `incluir_excluidos=true`, D-PROD-273)
 *  GET /estoque/movimentos/:id      detalhe de um movimento
 *  GET /estoque/opcoes/produtos     filtro de produto (por nome, keyset)
 *  GET /estoque/opcoes/locais       filtro de depósito (por nome, keyset)
 *
 * Entrada/ajuste (escrita) NÃO existem aqui: a chave futura é uma ação extra da
 * mesma tela (`entrada`/`ajuste`, D-PROD-255), separada de `visualizar`.
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { TAMANHO_MAXIMO_CURSOR } from './estoqueConsultaCursor.js';
import { lotesDisponiveis, movimento, movimentos, opcoesLocais, opcoesProdutos, saldo } from './estoqueConsultaService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const LIMITE = { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO };
const CURSOR = { type: 'string', minLength: 1, maxLength: TAMANHO_MAXIMO_CURSOR };
const BUSCA = { type: 'string', maxLength: 64 };

const SALDO = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      produto_id: ID,
      local_estoque_id: ID,
      q: BUSCA,
      somente_com_saldo: { type: 'boolean', default: true },
      limit: LIMITE,
      cursor: CURSOR,
    },
  },
};

const MOVIMENTOS = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      produto_id: ID,
      local_estoque_id: ID,
      origem_sistema: { type: 'string', maxLength: 32 },
      tipo_movimentacao: { type: 'string', enum: ['Entrada', 'Saída'] },
      data_de: DIA,
      data_ate: DIA,
      q: BUSCA,
      // D-PROD-273 (fatia 2): o par excluído (original 'Estornada' + estorno) só aparece com true, marcado `excluido`.
      incluir_excluidos: { type: 'boolean', default: false },
      limit: LIMITE,
      cursor: CURSOR,
    },
  },
};

const DETALHE = {
  params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } },
  querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } },
};

/** D-PROD-279: lotes disponíveis de um produto num depósito (FEFO). */
const LOTES = {
  querystring: {
    type: 'object', required: ['empresa_id', 'produto_id', 'local_estoque_id'], additionalProperties: false,
    properties: { empresa_id: ID, produto_id: ID, local_estoque_id: ID },
  },
};

const OPCOES_BASE = {
  q: { type: 'string', maxLength: 120 },
  cursor: { type: 'string', minLength: 1, maxLength: 2200 },
  limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
};
const OPCOES_PRODUTOS = { querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID, ...OPCOES_BASE } } };
const OPCOES_LOCAIS = { querystring: { type: 'object', additionalProperties: false, properties: OPCOES_BASE } };

/** @param {import('fastify').FastifyInstance} app */
export const registrarEstoqueConsultaRoutes = async (app) => {
  const guarda = { onRequest: [app.autenticar], preHandler: [GUARDAS.estoque.ver] };

  app.get('/estoque/saldo', { ...guarda, schema: SALDO }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return saldo(request.contexto, /** @type {any} */ (request.query));
  });

  app.get('/estoque/lotes-disponiveis', { ...guarda, schema: LOTES }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return lotesDisponiveis(request.contexto, /** @type {any} */ (request.query));
  });

  app.get('/estoque/movimentos', { ...guarda, schema: MOVIMENTOS }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return movimentos(request.contexto, /** @type {any} */ (request.query));
  });

  app.get('/estoque/movimentos/:id', { ...guarda, schema: DETALHE }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{ id: string }} */ (request.params);
    return movimento(request.contexto, id, /** @type {any} */ (request.query));
  });

  app.get('/estoque/opcoes/produtos', { ...guarda, schema: OPCOES_PRODUTOS }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return opcoesProdutos(request.contexto, /** @type {any} */ (request.query));
  });

  app.get('/estoque/opcoes/locais', { ...guarda, schema: OPCOES_LOCAIS }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return opcoesLocais(request.contexto, /** @type {any} */ (request.query));
  });
};
