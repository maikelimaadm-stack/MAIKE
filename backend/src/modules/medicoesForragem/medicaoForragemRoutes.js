/**
 * Rotas da Medição de Forragem (D-PROD-219), tabela física "MEDICAOFORRAGEM".
 *
 * Corpo fechado (`additionalProperties: false`): `cliente_id`, `cultura_id`, a
 * média, a situação da régua, a matéria verde/seca ou qualquer chave fora do schema
 * vira 400 — os derivados são calculados no serviço. O tenant vem só da sessão.
 * Leitura autenticada (o mapa mostra as últimas medições do pasto); criar e excluir
 * com a chave do mapa `medir_forragem` (ação gravadora: operador só com a chave
 * gravada `true`; administrador sempre).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { querystringListagemEmpresa } from '../../shared/http/listQueryLimit.js';
import { listar, criar, excluir, METODOS, SITUACOES } from './medicaoForragemService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const NUMERO = { type: ['number', 'string', 'null'], maxLength: 32 };

const LISTAR_SCHEMA = {
  querystring: querystringListagemEmpresa({ area_id: ID }),
};

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'area_id', 'data_medicao', 'metodo'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      area_id: ID,
      data_medicao: { type: 'string', minLength: 10, maxLength: 10 },
      metodo: { type: 'string', enum: [...METODOS] },
      leituras_cm: {
        anyOf: [
          { type: 'string', maxLength: 4000 },
          { type: 'array', maxItems: 500, items: { type: ['number', 'string'], maxLength: 16 } },
          { type: 'null' },
        ],
      },
      situacao: { type: ['string', 'null'], enum: [...SITUACOES, null] },
      quadro_m2: NUMERO,
      qtd_amostras: { type: ['integer', 'null'] },
      peso_verde_g: NUMERO,
      peso_seco_g: NUMERO,
      materia_seca_pct: NUMERO,
      observacoes: { type: ['string', 'null'], maxLength: 2000 },
    },
  },
};

const EXCLUIR_SCHEMA = {
  params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } },
};

/** @param {unknown} valor @returns {Record<string, any>} */
const comoObjeto = (valor) => /** @type {Record<string, any>} */ (valor ?? {});

/** @param {import('fastify').FastifyInstance} app */
export const registrarMedicaoForragemRoutes = async (app) => {
  const guarda = GUARDAS.medicaoForragem;

  app.get('/medicoes-forragem', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto, comoObjeto(request.query));
  });

  app.post('/medicoes-forragem', { onRequest: [app.autenticar], preHandler: [guarda.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const medicao = await criar(request.contexto, comoObjeto(request.body));
    return reply.status(201).send(medicao);
  });

  app.delete('/medicoes-forragem/:id', { onRequest: [app.autenticar], preHandler: [guarda.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
