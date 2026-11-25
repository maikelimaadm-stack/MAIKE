/**
 * Rotas da Leitura de cocho (D-PROD-205), tabela física "LEITURACOCHO".
 *
 * Corpo fechado (`additionalProperties: false`): `cliente_id`,
 * `registrado_por_nome` ou qualquer chave fora do schema vira 400. O tenant vem
 * só da sessão; o serviço confere a fazenda e o cocho. Leitura autenticada (o
 * mapa desenha o farol com ela, como os eventos de suplementação); criar e
 * excluir com a chave do mapa `lancar_suplementacao` (quem lança no cocho também lê).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { querystringListagemEmpresa } from '../../shared/http/listQueryLimit.js';
import { listar, criar, excluir, ESCORES, ACESSOS, ESTRUTURAS, mudancas } from './leituraCochoService.js';
import { schemaMudancas } from '../../shared/sincronizacao/mudancasIncrementais.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };

const LISTAR_SCHEMA = {
  querystring: querystringListagemEmpresa({ ponto_suplementacao_id: ID }),
};

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'ponto_suplementacao_id', 'data_leitura', 'escore'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      ponto_suplementacao_id: ID,
      data_leitura: { type: 'string', minLength: 10, maxLength: 10 },
      escore: { type: 'string', enum: [...ESCORES] },
      acesso: { type: ['string', 'null'], enum: [...ACESSOS, null] },
      estrutura: { type: ['string', 'null'], enum: [...ESTRUTURAS, null] },
      observacoes: { type: ['string', 'null'], maxLength: 2000 },
      // D-PROD-296: código único do app (reenvio sem internet não duplica). Opcional.
      operation_id: { type: 'string', minLength: 8, maxLength: 128 },
    },
  },
};

const EXCLUIR_SCHEMA = {
  params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } },
};

/** @param {unknown} valor @returns {Record<string, any>} */
const comoObjeto = (valor) => /** @type {Record<string, any>} */ (valor ?? {});

/** @param {import('fastify').FastifyInstance} app */
export const registrarLeituraCochoRoutes = async (app) => {
  const guarda = GUARDAS.leituraCocho;

  app.get('/leituras-cocho', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto, comoObjeto(request.query));
  });

  // D-PROD-309: o que mudou desde a última sincronização (mesma permissão da listagem).
  app.get('/leituras-cocho/mudancas', { onRequest: [app.autenticar], schema: schemaMudancas() }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return mudancas(request.contexto, /** @type {any} */ (request.query ?? {}));
  });

  app.post('/leituras-cocho', { onRequest: [app.autenticar], preHandler: [guarda.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const leitura = await criar(request.contexto, comoObjeto(request.body));
    return reply.status(201).send(leitura);
  });

  app.delete('/leituras-cocho/:id', { onRequest: [app.autenticar], preHandler: [guarda.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
