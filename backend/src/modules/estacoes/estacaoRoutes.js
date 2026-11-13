/**
 * Rotas de Estações da fazenda (D-PROD-188), tabela física "CADESTACOES".
 *
 * Corpo e query fechados (`additionalProperties: false`, e o app usa
 * `removeAdditional: false`): `cliente_id` ou qualquer chave fora do schema
 * vira 400. O tenant vem só da sessão; a fazenda (`empresa_id`) é obrigatória
 * em todas as rotas e o serviço confere que ela é deste tenant. Toda rota
 * exige a ação da PRÓPRIA tela `pec-estacoes` (leitura incluída).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { listar, obter, criar, atualizar, excluir, TIPOS_ESTACAO } from './estacaoService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };

const CAMPOS = Object.freeze({
  nome: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  tipo: { type: 'string', enum: [...TIPOS_ESTACAO] },
  data_inicio: DIA,
  data_fim: DIA,
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const PARAMS_ID = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const QUERY_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const LISTAR_SCHEMA = { querystring: QUERY_EMPRESA };
const OBTER_SCHEMA = { params: PARAMS_ID, querystring: QUERY_EMPRESA };
const EXCLUIR_SCHEMA = { params: PARAMS_ID, querystring: QUERY_EMPRESA };

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo', 'data_inicio', 'data_fim'],
    additionalProperties: false,
    properties: { empresa_id: ID, ...CAMPOS },
  },
};

const ATUALIZAR_SCHEMA = {
  params: PARAMS_ID,
  body: {
    type: 'object',
    required: ['empresa_id'],
    minProperties: 2,
    additionalProperties: false,
    properties: { empresa_id: ID, ...CAMPOS },
  },
};

/** @param {unknown} valor @returns {Record<string, unknown>} */
const comoObjeto = (valor) => /** @type {Record<string, unknown>} */ (valor);

/** @param {import('fastify').FastifyInstance} app */
export const registrarEstacaoRoutes = async (app) => {
  const guarda = GUARDAS.estacao;

  app.get('/estacoes', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto, comoObjeto(request.query));
  });

  app.get('/estacoes/:id', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: OBTER_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return obter(request.contexto, id, comoObjeto(request.query));
  });

  app.post('/estacoes', { onRequest: [app.autenticar], preHandler: [guarda.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const estacao = await criar(request.contexto, comoObjeto(request.body));
    return reply.status(201).send(estacao);
  });

  app.patch('/estacoes/:id', { onRequest: [app.autenticar], preHandler: [guarda.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, comoObjeto(request.body));
  });

  app.delete('/estacoes/:id', { onRequest: [app.autenticar], preHandler: [guarda.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id, comoObjeto(request.query));
    return reply.status(204).send();
  });
};
