/**
 * Rotas do Cadastro de Culturas (D-PROD-215), tabela física "CADCULTURAS".
 *
 * Corpo e query fechados (`additionalProperties: false`, e o app usa
 * `removeAdditional: false`): `cliente_id` ou qualquer chave fora do schema
 * vira 400. O tenant vem só da sessão; a fazenda (`empresa_id`) é obrigatória
 * em todas as rotas e o serviço confere que ela é deste tenant. Toda rota
 * exige a ação da PRÓPRIA tela `pec-culturas` (leitura incluída); incluir a
 * lista de referência cria registros e exige criar.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { invalido } from '../gestao/gestaoComum.js';
import { listar, obter, criar, atualizar, excluir, incluirListaReferencia, TIPOS_CULTURA } from './culturaService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
/**
 * Altura: número, texto pt-BR ("25,5") ou null (sem altura). Com vários tipos o
 * AJV só coage quando o valor não é de nenhum deles; o booleano, que ele
 * coagiria para 1, é barrado antes por `alturasSemCoercao`.
 */
const ALTURA = { type: ['number', 'string', 'null'], maxLength: 16 };
const CAMPOS_ALTURA = Object.freeze(['altura_entrada_cm', 'altura_saida_cm']);

/**
 * O AJV do app usa a coerção padrão do Fastify (`coerceTypes: 'array'`): `true`
 * viraria 1 cm e um objeto solto viraria lista. Antes da validação, o corpo
 * BRUTO precisa trazer número, texto ou null de verdade.
 * @param {import('fastify').FastifyRequest} request
 */
const alturasSemCoercao = async (request) => {
  const corpo = /** @type {Record<string, unknown>|null} */ (request.body);
  if (!corpo || typeof corpo !== 'object') return;
  for (const campo of CAMPOS_ALTURA) {
    if (!Object.prototype.hasOwnProperty.call(corpo, campo)) continue;
    const v = corpo[campo];
    if (v !== null && typeof v !== 'number' && typeof v !== 'string') {
      throw invalido(`${campo} deve ser um número em cm`, { field: campo, reason: 'altura_invalida' });
    }
  }
};
const TEXTO_OPCIONAL = { type: ['string', 'null'], maxLength: 120 };

const CAMPOS = Object.freeze({
  codigo: { type: ['string', 'null'], maxLength: 16 },
  tipo: { type: 'string', enum: [...TIPOS_CULTURA] },
  nome: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  especie: TEXTO_OPCIONAL,
  cultivar: TEXTO_OPCIONAL,
  altura_entrada_cm: ALTURA,
  altura_saida_cm: ALTURA,
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const PARAMS_ID = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const QUERY_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };
const CORPO_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const LISTAR_SCHEMA = { querystring: QUERY_EMPRESA };
const OBTER_SCHEMA = { params: PARAMS_ID, querystring: QUERY_EMPRESA };
const EXCLUIR_SCHEMA = { params: PARAMS_ID, querystring: QUERY_EMPRESA };
const LISTA_REFERENCIA_SCHEMA = { body: CORPO_EMPRESA };

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo'],
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
export const registrarCulturaRoutes = async (app) => {
  const guarda = GUARDAS.cultura;

  app.get('/culturas', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto, comoObjeto(request.query));
  });

  app.get('/culturas/:id', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: OBTER_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return obter(request.contexto, id, comoObjeto(request.query));
  });

  app.post(
    '/culturas',
    { onRequest: [app.autenticar], preValidation: [alturasSemCoercao], preHandler: [guarda.criar], schema: CRIAR_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const cultura = await criar(request.contexto, comoObjeto(request.body));
      return reply.status(201).send(cultura);
    }
  );

  app.post(
    '/culturas/comandos/lista-referencia',
    { onRequest: [app.autenticar], preHandler: [guarda.criar], schema: LISTA_REFERENCIA_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      return incluirListaReferencia(request.contexto, comoObjeto(request.body));
    }
  );

  app.patch(
    '/culturas/:id',
    { onRequest: [app.autenticar], preValidation: [alturasSemCoercao], preHandler: [guarda.editar], schema: ATUALIZAR_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizar(request.contexto, id, comoObjeto(request.body));
    }
  );

  app.delete('/culturas/:id', { onRequest: [app.autenticar], preHandler: [guarda.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id, comoObjeto(request.query));
    return reply.status(204).send();
  });
};
