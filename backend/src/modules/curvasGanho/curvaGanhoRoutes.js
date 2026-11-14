/**
 * Rotas de Curvas de Ganho de Peso da fazenda (D-PROD-189; 12 GMD mensais
 * desde a D-PROD-190), tabela física
 * "CADCURVAGANHO".
 *
 * Corpo e query fechados (`additionalProperties: false`, e o app usa
 * `removeAdditional: false`): `cliente_id` ou qualquer chave fora do schema
 * vira 400. O tenant vem só da sessão; a fazenda (`empresa_id`) é obrigatória
 * em todas as rotas e o serviço confere que ela é deste tenant. Toda rota
 * exige a ação da PRÓPRIA tela `pec-curvas-ganho` (leitura incluída).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { invalido } from '../gestao/gestaoComum.js';
import { listar, obter, criar, atualizar, excluir, GMD_MINIMO, GMD_MAXIMO, CAMPOS_GMD } from './curvaGanhoService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const GMD = { type: 'number', minimum: GMD_MINIMO, maximum: GMD_MAXIMO };

const CAMPOS = Object.freeze({
  nome: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  ...Object.fromEntries(CAMPOS_GMD.map((campo) => [campo, GMD])),
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
    required: ['empresa_id', 'nome', ...CAMPOS_GMD],
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

/**
 * O AJV do app usa a coerção padrão do Fastify (`coerceTypes`): `null` vira 0 e
 * `true` vira 1 num campo `number`. Para GMD isso gravaria um ganho que ninguém
 * digitou. Antes da validação, o corpo BRUTO precisa trazer número de verdade.
 * @param {import('fastify').FastifyRequest} request
 */
const gmdSemCoercao = async (request) => {
  const corpo = /** @type {Record<string, unknown>|null} */ (request.body);
  if (!corpo || typeof corpo !== 'object') return;
  for (const campo of CAMPOS_GMD) {
    if (Object.prototype.hasOwnProperty.call(corpo, campo) && typeof corpo[campo] !== 'number') {
      throw invalido(`${campo} deve ser um número (kg/dia)`, { field: campo, reason: 'gmd_invalido' });
    }
  }
};

/** @param {unknown} valor @returns {Record<string, unknown>} */
const comoObjeto = (valor) => /** @type {Record<string, unknown>} */ (valor);

/** @param {import('fastify').FastifyInstance} app */
export const registrarCurvaGanhoRoutes = async (app) => {
  const guarda = GUARDAS.curvaGanho;

  app.get('/curvas-ganho', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto, comoObjeto(request.query));
  });

  app.get('/curvas-ganho/:id', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: OBTER_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return obter(request.contexto, id, comoObjeto(request.query));
  });

  app.post('/curvas-ganho', { onRequest: [app.autenticar], preValidation: [gmdSemCoercao], preHandler: [guarda.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const curva = await criar(request.contexto, comoObjeto(request.body));
    return reply.status(201).send(curva);
  });

  app.patch('/curvas-ganho/:id', { onRequest: [app.autenticar], preValidation: [gmdSemCoercao], preHandler: [guarda.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, comoObjeto(request.body));
  });

  app.delete('/curvas-ganho/:id', { onRequest: [app.autenticar], preHandler: [guarda.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id, comoObjeto(request.query));
    return reply.status(204).send();
  });
};
