/**
 * D-PROD-202 (Fatia 3 do Lançamento de Atividades) — rotas da LINHA DE PRODUTO
 * do apontamento e dos seletores dela, tela `op-atividades` (contrato
 * `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md` §4):
 *
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/produtos` (lançar:
 *    `lancar_apontamento`) — 201; reenvio igual → 200 `replay: true`
 *  - `PATCH /atividades/:id/apontamentos/:apontamentoId/produtos/:linhaId`
 *    (`editar_apontamento`) — estorno exato + linha nova; 200
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/produtos/:linhaId/cancelar`
 *    (`cancelar_apontamento`) — estorno exato; 200
 *  - `GET   /atividades-opcoes/produtos?empresa_id=&atividade_id=&q=` (ver) —
 *    os já usados na atividade primeiro (`favorito: true`), sem combustível
 *  - `GET   /atividades-opcoes/locais?empresa_id=&produto_id=` (ver) — locais
 *    ativos com saldo do produto na fazenda
 *
 * Guardas: as da tela (`GUARDAS.atividadeApontamentos` para as linhas,
 * `GUARDAS.atividades.ver` para os seletores) — quem só tem esta tela não leva
 * 403 das telas de produtos ou de estoque. Corpo e query FECHADOS
 * (`additionalProperties: false`): unidade, custo, dose, ordem, status,
 * movimento, autoria e `cliente_id` → 400 (são do servidor ou da sessão).
 * Tenant só da sessão; a empresa vem do corpo (escrita) ou da query (leitura)
 * e é conferida no tenant. Decimais chegam como TEXTO: o `preValidation` deste
 * plugin (encapsulado) recusa número antes da coerção do AJV.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { LOTES_ESCOLHIDOS } from '../estoqueFisico/loteEscolhaSchema.js';
import { DECIMAIS_DA_LINHA_PRODUTO, PADRAO_DECIMAL, PADRAO_OPERATION_ID, recusarCoercao } from './atividadeComum.js';
import { opcoesLocaisDoProduto, opcoesProdutos } from './atividadeOpcoesService.js';
import { cancelarLinhaProduto, editarLinhaProduto, lancarLinhaProduto } from './atividadeApontamentoProdutoService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DECIMAL = { type: 'string', pattern: PADRAO_DECIMAL.source };
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: PADRAO_OPERATION_ID.source };
const OBSERVACAO = { type: ['string', 'null'], maxLength: 500 };
/** Motivo sem tamanho no schema (só o teto do transporte): curto/longo são 422 do serviço, como no apontamento. */
const MOTIVO = { type: ['string', 'null'], maxLength: 2000 };

const PARAMS_APONTAMENTO = {
  type: 'object',
  required: ['id', 'apontamentoId'],
  additionalProperties: false,
  properties: { id: ID, apontamentoId: ID },
};
const PARAMS_LINHA = {
  type: 'object',
  required: ['id', 'apontamentoId', 'linhaId'],
  additionalProperties: false,
  properties: { id: ID, apontamentoId: ID, linhaId: ID },
};

/**
 * Item de `produtos[]` no `POST …/apontamentos` e no `…/duplicar` (o plugin do
 * apontamento usa este schema): os dados de uma linha nova, sem chave própria
 * (a do lançamento vale para tudo) e sem versão (o apontamento nasce junto).
 */
/** D-PROD-283/292: o número do jato no dia (texto; o serviço confere "1".."999"). */
const JATO = { type: ['string', 'null'], maxLength: 3 };
export const ESQUEMA_ITEM_PRODUTO = Object.freeze({
  type: 'object',
  required: ['produto_id', 'local_estoque_id', 'quantidade'],
  additionalProperties: false,
  // D-PROD-293: o número do jato (texto "1".."999") também na linha avulsa (lançar e editar).
  // D-PROD-294: `lotes` (a escolha manual de produto que controla lote; sem ela, FEFO) em toda linha de produto —
  // lançar, editar e os `produtos[]` do lançamento, do registro e dos "Jatos de hoje".
  properties: { produto_id: ID, local_estoque_id: ID, quantidade: DECIMAL, observacao: OBSERVACAO, jato: JATO, lotes: LOTES_ESCOLHIDOS },
});

/**
 * MAIKE-ENTREGA2 (D-PROD-274) — o item de `produtos[]` do LANÇAMENTO (`POST …/apontamentos`, `…/duplicar` e
 * `POST /atividades/registrar`): o de sempre, o VC (%) opcional da semente e o número do `jato` (D-PROD-283), em texto (o
 * serviço confere a faixa). As rotas
 * de UMA linha (lançar e editar a linha) continuam com o corpo de antes.
 */
export const ESQUEMA_ITEM_PRODUTO_DO_LANCAMENTO = Object.freeze({
  ...ESQUEMA_ITEM_PRODUTO,
  properties: { ...ESQUEMA_ITEM_PRODUTO.properties, vc_percentual: { type: ['string', 'null'], maxLength: 8 } },
});

const LANCAR = {
  params: PARAMS_APONTAMENTO,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'operation_id', 'produto_id', 'local_estoque_id', 'quantidade'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, operation_id: OPERATION_ID, ...ESQUEMA_ITEM_PRODUTO.properties },
  },
};
const EDITAR = {
  params: PARAMS_LINHA,
  body: {
    type: 'object',
    // Ao menos um campo da linha além do escopo (o serviço confere: 400 `sem_alteracao`).
    required: ['empresa_id', 'versao', 'operation_id'],
    minProperties: 4,
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, operation_id: OPERATION_ID, ...ESQUEMA_ITEM_PRODUTO.properties },
  },
};
const CANCELAR = {
  params: PARAMS_LINHA,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'operation_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, versao: VERSAO, operation_id: OPERATION_ID, motivo: MOTIVO },
  },
};
const OPCOES_PRODUTOS = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      atividade_id: ID,
      q: { type: 'string', maxLength: 120 },
      cursor: { type: 'string', minLength: 1, maxLength: 2200 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
    },
  },
};
const OPCOES_LOCAIS = {
  querystring: { type: 'object', required: ['empresa_id', 'produto_id'], additionalProperties: false, properties: { empresa_id: ID, produto_id: ID } },
};

/** @param {import('fastify').FastifyRequest} request */
const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
/** @param {import('fastify').FastifyRequest} request */
const params = (request) => /** @type {{ id: string, apontamentoId: string, linhaId?: string }} */ (request.params);
/** @param {import('fastify').FastifyRequest} request */
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);
/** @param {import('fastify').FastifyRequest} request */
const consulta = (request) => /** @type {Record<string, any>} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeApontamentoProdutoRoutes = async (app) => {
  const g = GUARDAS.atividadeApontamentos;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body, DECIMAIS_DA_LINHA_PRODUTO);
  });

  const base = '/atividades/:id/apontamentos/:apontamentoId/produtos';
  app.post(base, { ...autenticado, preHandler: [g.criar], schema: LANCAR }, async (request, reply) => {
    const p = params(request);
    const r = await lancarLinhaProduto(ctx(request), p.id, p.apontamentoId, corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.patch(`${base}/:linhaId`, { ...autenticado, preHandler: [g.editar], schema: EDITAR }, async (request, reply) => {
    const p = params(request);
    const r = await editarLinhaProduto(ctx(request), p.id, p.apontamentoId, /** @type {string} */ (p.linhaId), corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.post(`${base}/:linhaId/cancelar`, { ...autenticado, preHandler: [g.cancelar], schema: CANCELAR }, async (request, reply) => {
    const p = params(request);
    const r = await cancelarLinhaProduto(ctx(request), p.id, p.apontamentoId, /** @type {string} */ (p.linhaId), corpo(request));
    return reply.status(r.status).send(r.body);
  });

  const ver = GUARDAS.atividades.ver;
  app.get('/atividades-opcoes/produtos', { ...autenticado, preHandler: [ver], schema: OPCOES_PRODUTOS }, async (request) =>
    opcoesProdutos(ctx(request), consulta(request)));
  app.get('/atividades-opcoes/locais', { ...autenticado, preHandler: [ver], schema: OPCOES_LOCAIS }, async (request) =>
    opcoesLocaisDoProduto(ctx(request), consulta(request)));
};
