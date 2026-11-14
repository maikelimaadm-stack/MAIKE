/**
 * Rotas de Formulações de suplemento da fazenda (D-PROD-202), tabelas físicas
 * "CADFORMULACAO", "CADFORMULACAOINGREDIENTE" e "CADFORMULACAOREGRA".
 *
 * Corpo e query fechados (`additionalProperties: false`, e o app usa
 * `removeAdditional: false`): `cliente_id` ou qualquer chave fora do schema
 * vira 400. O tenant vem só da sessão; a fazenda (`empresa_id`) é obrigatória
 * em todas as rotas e o serviço confere que ela é deste tenant. O cadastro
 * (leitura incluída) exige a ação da PRÓPRIA tela `pec-formulacoes`; as opções
 * do lançamento de suplementação (`GET /formulacoes/opcoes-lancamento`, só as
 * ativas) aceitam também a chave do mapa `lancar_suplementacao`.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { invalido } from '../gestao/gestaoComum.js';
import { listar, opcoesLancamento, obter, criar, atualizar, excluir, TIPOS } from './formulacaoService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
/** Decimal: número, ou texto com vírgula/ponto ("0,15"); o serviço confere faixa e casas. */
const DECIMAL = { type: ['number', 'string'], maxLength: 32 };
const DECIMAL_OU_NULO = { type: ['number', 'string', 'null'], maxLength: 32 };

const INGREDIENTE = {
  type: 'object',
  required: ['produto_id', 'quantidade_kg'],
  additionalProperties: false,
  properties: { produto_id: ID, quantidade_kg: DECIMAL },
};

const REGRA = {
  type: 'object',
  required: ['categoria_manejo_id', 'consome'],
  additionalProperties: false,
  properties: { categoria_manejo_id: ID, consome: { type: 'boolean' }, percentual_pv: DECIMAL_OU_NULO },
};

const CAMPOS = Object.freeze({
  nome: { type: 'string', minLength: 1, maxLength: 120, pattern: '\\S' },
  tipo: { type: 'string', enum: [...TIPOS] },
  produto_id: ID,
  percentual_pv_padrao: DECIMAL,
  consumo_objetivo_g_cab_dia: DECIMAL_OU_NULO,
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
  ingredientes: { type: 'array', maxItems: 50, items: INGREDIENTE },
  regras: { type: 'array', maxItems: 100, items: REGRA },
});

const PARAMS_ID = { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } };
const QUERY_EMPRESA = { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } };

const LISTAR_SCHEMA = { querystring: QUERY_EMPRESA };
const OBTER_SCHEMA = { params: PARAMS_ID, querystring: QUERY_EMPRESA };
const EXCLUIR_SCHEMA = { params: PARAMS_ID, querystring: QUERY_EMPRESA };

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo', 'produto_id', 'percentual_pv_padrao'],
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

/** @param {unknown} v */
const ehDecimalBruto = (v) => typeof v === 'number' || typeof v === 'string';

/**
 * O AJV do app usa a coerção padrão do Fastify (`coerceTypes: 'array'`): `null`
 * vira 0 num campo numérico, `"true"` vira `true` num booleano e um objeto solto
 * vira lista de um item. Para %PV, kg e "consome" isso gravaria o que ninguém
 * digitou. Antes da validação, o corpo BRUTO precisa trazer o tipo de verdade.
 * @param {import('fastify').FastifyRequest} request
 */
const corpoSemCoercao = async (request) => {
  const corpo = /** @type {Record<string, unknown>|null} */ (request.body);
  if (!corpo || typeof corpo !== 'object') return;
  const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (tem(corpo, 'percentual_pv_padrao') && !ehDecimalBruto(corpo.percentual_pv_padrao)) {
    throw invalido('percentual_pv_padrao deve ser um número (% do peso vivo)', { field: 'percentual_pv_padrao', reason: 'percentual_pv_invalido' });
  }
  if (tem(corpo, 'consumo_objetivo_g_cab_dia') && corpo.consumo_objetivo_g_cab_dia !== null && !ehDecimalBruto(corpo.consumo_objetivo_g_cab_dia)) {
    throw invalido('consumo_objetivo_g_cab_dia deve ser um número (g/cab/dia)', { field: 'consumo_objetivo_g_cab_dia', reason: 'consumo_objetivo_invalido' });
  }
  for (const lista of ['ingredientes', 'regras']) {
    if (tem(corpo, lista) && !Array.isArray(corpo[lista])) throw invalido(`${lista} deve ser uma lista`, { field: lista, reason: 'lista_invalida' });
  }
  const ingredientes = /** @type {Array<any>} */ (Array.isArray(corpo.ingredientes) ? corpo.ingredientes : []);
  ingredientes.forEach((item, i) => {
    if (item && typeof item === 'object' && tem(item, 'quantidade_kg') && !ehDecimalBruto(item.quantidade_kg)) {
      throw invalido(`ingredientes[${i}].quantidade_kg deve ser um número (kg por batida)`, { field: `ingredientes[${i}].quantidade_kg`, reason: 'quantidade_invalido' });
    }
  });
  const regras = /** @type {Array<any>} */ (Array.isArray(corpo.regras) ? corpo.regras : []);
  regras.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    if (tem(item, 'consome') && typeof item.consome !== 'boolean') {
      throw invalido(`regras[${i}].consome deve ser verdadeiro ou falso`, { field: `regras[${i}].consome`, reason: 'consome_invalido' });
    }
    if (tem(item, 'percentual_pv') && item.percentual_pv !== null && !ehDecimalBruto(item.percentual_pv)) {
      throw invalido(`regras[${i}].percentual_pv deve ser um número (% do peso vivo)`, { field: `regras[${i}].percentual_pv`, reason: 'percentual_pv_invalido' });
    }
  });
};

/** @param {unknown} valor @returns {Record<string, unknown>} */
const comoObjeto = (valor) => /** @type {Record<string, unknown>} */ (valor);

/** @param {import('fastify').FastifyInstance} app */
export const registrarFormulacaoRoutes = async (app) => {
  const guarda = GUARDAS.formulacao;

  app.get('/formulacoes', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto, comoObjeto(request.query));
  });

  // Rota estática: tem precedência sobre `/formulacoes/:id` no roteador do Fastify.
  app.get('/formulacoes/opcoes-lancamento', { onRequest: [app.autenticar], preHandler: [guarda.opcoesLancamento], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return opcoesLancamento(request.contexto, comoObjeto(request.query));
  });

  app.get('/formulacoes/:id', { onRequest: [app.autenticar], preHandler: [guarda.ver], schema: OBTER_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return obter(request.contexto, id, comoObjeto(request.query));
  });

  app.post('/formulacoes', { onRequest: [app.autenticar], preValidation: [corpoSemCoercao], preHandler: [guarda.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const formulacao = await criar(request.contexto, comoObjeto(request.body));
    return reply.status(201).send(formulacao);
  });

  app.patch('/formulacoes/:id', { onRequest: [app.autenticar], preValidation: [corpoSemCoercao], preHandler: [guarda.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, comoObjeto(request.body));
  });

  app.delete('/formulacoes/:id', { onRequest: [app.autenticar], preHandler: [guarda.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id, comoObjeto(request.query));
    return reply.status(204).send();
  });
};
