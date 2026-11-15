/**
 * Rotas de Funcionários da fazenda (D-PROD-203, Fatia 4 do Lançamento de
 * Atividades; contrato `MAIKE-ATIVIDADE-MAO-OBRA-CONTRATO.md` §2).
 *
 * Corpo e query fechados (`additionalProperties: false`, e o app usa
 * `removeAdditional: false`): `cliente_id`, `numero`, `ativo` ou qualquer chave
 * fora do schema vira 400. O tenant vem só da sessão; a fazenda (`empresa_id`)
 * é obrigatória em todas as rotas e o serviço confere que ela é deste tenant.
 * Toda rota exige a ação da PRÓPRIA tela `sup-funcionarios` (leitura incluída).
 *
 * Decimais são STRING. O Fastify COERGE tipos: um número JSON num campo decimal
 * viraria texto já corrompido pelo float. O `preValidation` deste plugin
 * (encapsulado: só estas rotas) recusa decimal não-texto (400
 * `REQUEST_VALIDATION_FAILED`, reason `valor_deve_ser_texto`).
 *
 * SEM DELETE: cadastro com custo nunca é apagado (inativar/reativar).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, LIMITE_PADRAO } from '../../shared/pagination/keysetCursor.js';
import { invalido } from '../gestao/gestaoComum.js';
import { DECIMAIS_FUNCIONARIO, TIPOS_FUNCIONARIO, alterarSituacao, atualizar, criar, listar, obter } from './funcionarioService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const DECIMAL_NULO = { type: ['string', 'null'], pattern: '^\\d{1,10}(\\.\\d{1,4})?$' };

const CAMPOS = Object.freeze({
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  cargo: { type: ['string', 'null'], maxLength: 120 },
  tipo: { type: 'string', enum: [...TIPOS_FUNCIONARIO] },
  custo_hora: DECIMAL_NULO,
  custo_diaria: DECIMAL_NULO,
});

const PARAMS_ID = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const QUERY_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };
const CORPO_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const LISTAR_SCHEMA = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO, default: LIMITE_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
      q: { type: 'string', maxLength: 120 },
      ativo: { type: 'string', enum: ['true', 'false'] },
    },
  },
};
const OBTER_SCHEMA = { params: PARAMS_ID, querystring: QUERY_EMPRESA };
const SITUACAO_SCHEMA = { params: PARAMS_ID, body: CORPO_EMPRESA };

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

/** Decimal presente, não nulo e não texto → 400 (antes do AJV, que coergiria). */
const recusarCoercao = (corpo) => {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return;
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const chave of DECIMAIS_FUNCIONARIO) {
    if (!Object.prototype.hasOwnProperty.call(c, chave)) continue;
    const v = c[chave];
    if (v !== null && v !== undefined && typeof v !== 'string') {
      throw invalido(`${chave} deve ser texto decimal (ex.: "12.5"), nunca número`, { field: chave, reason: 'valor_deve_ser_texto', campo: chave });
    }
  }
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarFuncionarioRoutes = async (app) => {
  const guarda = GUARDAS.funcionario;
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body);
  });

  app.get('/funcionarios', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto, comoObjeto(request.query));
  });

  app.get('/funcionarios/:id', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: OBTER_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return obter(request.contexto, id, comoObjeto(request.query));
  });

  app.post('/funcionarios', { onRequest: [app.autenticar], preHandler: [guarda.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    return reply.status(201).send(await criar(request.contexto, comoObjeto(request.body)));
  });

  app.patch('/funcionarios/:id', { onRequest: [app.autenticar], preHandler: [guarda.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, comoObjeto(request.body));
  });

  app.post('/funcionarios/:id/inativar', { onRequest: [app.autenticar], preHandler: [guarda.editar], schema: SITUACAO_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return alterarSituacao(request.contexto, id, comoObjeto(request.body), false);
  });

  app.post('/funcionarios/:id/reativar', { onRequest: [app.autenticar], preHandler: [guarda.editar], schema: SITUACAO_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return alterarSituacao(request.contexto, id, comoObjeto(request.body), true);
  });
};
