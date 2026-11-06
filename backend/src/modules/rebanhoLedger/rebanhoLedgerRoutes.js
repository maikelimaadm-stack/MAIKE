/**
 * Rotas do ledger do rebanho por posição — R2E-P1 (D-PROD-107).
 * Corpo estrito: saldo, posição de destino, tenant, autor e efeitos são do
 * servidor; qualquer outro campo é 400.
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { ativarLedger, listarPosicoes, MAX_ITENS_TRANSFERENCIA, MODOS_ATIVACAO, saldosNaData, transferir, verificarLedger } from './rebanhoLedgerService.js';
import { porMapa } from '../../shared/auth/autorizacaoTela.js';
import { editarInformacaoPosicao } from './rebanhoLedgerInformacao.js';

const ID = { type: 'string', minLength: 1, maxLength: 64 };
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 160, pattern: '^[A-Za-z0-9_.:-]+$' };

const TRANSFERENCIA_SCHEMA = {
  body: {
    type: 'object',
    required: ['operation_id', 'empresa_id', 'area_destino_id', 'data_movimentacao', 'itens'],
    additionalProperties: false,
    properties: {
      operation_id: OPERATION_ID,
      empresa_id: ID,
      area_destino_id: ID,
      data_movimentacao: { type: 'string', minLength: 10, maxLength: 40 },
      observacoes: { type: 'string', maxLength: 4000 },
      itens: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_ITENS_TRANSFERENCIA,
        items: {
          type: 'object',
          required: ['posicao_id', 'quantidade'],
          additionalProperties: false,
          properties: { posicao_id: ID, quantidade: { type: 'integer', minimum: 1, maximum: 1000000 } },
        },
      },
    },
  },
};
const ATIVACAO_SCHEMA = {
  body: {
    type: 'object',
    required: ['operation_id', 'empresa_id'],
    additionalProperties: false,
    properties: { operation_id: OPERATION_ID, empresa_id: ID, modo: { type: 'string', enum: [...MODOS_ATIVACAO] }, data_corte: { type: 'string', minLength: 10, maxLength: 10 } },
  },
};
/**
 * D-PROD-139: Editar Informação da posição. Só os campos descritivos; qualquer
 * outro (quantidade, área, peso, categoria, sexo, manejo, identidade, linhagem,
 * entrada, tenant) → 400 pelo schema fechado. Pelo menos um campo além da empresa.
 */
const TEXTO_OPCIONAL = (max) => ({ type: ['string', 'null'], maxLength: max });
const INFORMACAO_POSICAO_SCHEMA = {
  params: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: ID } },
  body: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    minProperties: 2,
    properties: {
      empresa_id: ID,
      nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
      identificador_nome: TEXTO_OPCIONAL(255),
      identificador_sigla: TEXTO_OPCIONAL(32),
      identificador_cor: TEXTO_OPCIONAL(32),
    },
  },
};
const EMPRESA_QUERY = (extra = {}, required = []) => ({
  querystring: { type: 'object', required: ['empresa_id', ...required], additionalProperties: false, properties: { empresa_id: ID, ...extra } },
});

/** @param {import('fastify').FastifyInstance} app */
export const registrarRebanhoLedgerRoutes = async (app) => {
  app.get('/rebanho/posicoes', { onRequest: [app.autenticar], schema: EMPRESA_QUERY({ incluir_vazias: { type: 'string', enum: ['true', 'false'] } }) }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarPosicoes(request.contexto, /** @type {any} */ (request.query));
  });
  app.get('/rebanho/saldos', { onRequest: [app.autenticar], schema: EMPRESA_QUERY({ data: { type: 'string', minLength: 10, maxLength: 10 }, area_id: ID }, ['data']) }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return saldosNaData(request.contexto, /** @type {any} */ (request.query));
  });
  app.get('/rebanho/verificacao', { onRequest: [app.autenticar], schema: EMPRESA_QUERY() }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return verificarLedger(request.contexto, /** @type {any} */ (request.query));
  });
  app.post('/rebanho/ativacao', { onRequest: [app.autenticar], schema: ATIVACAO_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { status, body } = await ativarLedger(request.contexto, /** @type {any} */ (request.body));
    return reply.status(status).send(body);
  });
  app.patch('/rebanho/posicoes/:id/informacoes', { onRequest: [app.autenticar], preHandler: [porMapa('renomear_lotes')], schema: INFORMACAO_POSICAO_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{ id: string }} */ (request.params);
    return editarInformacaoPosicao(request.contexto, id, /** @type {any} */ (request.body));
  });
  app.post('/rebanho/comandos/transferencia', { onRequest: [app.autenticar], preHandler: [porMapa('mover_lotes')], schema: TRANSFERENCIA_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { status, body } = await transferir(request.contexto, /** @type {any} */ (request.body));
    return reply.status(status).send(body);
  });
};
