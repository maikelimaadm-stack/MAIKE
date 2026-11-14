/**
 * D-PROD-202 (Fatia 3 do Lançamento de Atividades) — rotas das LINHAS DE
 * MÁQUINA do apontamento e dos seletores dela, tela `op-atividades` (contrato
 * `docs/engineering/MAIKE-ATIVIDADE-LINHAS-CONTRATO.md` §3 e §4):
 *
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/maquinas` (lançar) — 201
 *  - `PATCH /atividades/:id/apontamentos/:apontamentoId/maquinas/:linhaId`
 *    (editar = cancela a linha e cria outra) — 200
 *  - `POST  /atividades/:id/apontamentos/:apontamentoId/maquinas/:linhaId/cancelar`
 *    (cancelar, com motivo) — 200
 *  - `GET   /atividades-opcoes/implementos?empresa_id=&q=&cursor=&limit=` (ver)
 *  - `GET   /atividades-opcoes/medidor?empresa_id=&bem_id=&data=` (ver)
 *
 * Guardas: as escritas são as de `GUARDAS.atividadeApontamentos` (criar =
 * `lancar_apontamento`, editar = `editar_apontamento`, cancelar =
 * `cancelar_apontamento`); os seletores, `GUARDAS.atividades.ver`.
 *
 * Toda escrita leva `empresa_id`, a `versao` do APONTAMENTO (CAS) e o
 * `operation_id` (idempotência). Corpo e query FECHADOS
 * (`additionalProperties: false`): tipo e unidade do medidor, custo, status,
 * ordem, autoria e `cliente_id` → 400 (são do bem, do servidor ou da sessão).
 * Decimais chegam como TEXTO: o `preValidation` deste plugin (encapsulado)
 * recusa número antes da coerção do AJV. O plugin é registrado em `app.js`.
 *
 * Para o serviço/rotas do apontamento (lançar e repetir com `maquinas[]`), este
 * módulo exporta `ITEM_LINHA_MAQUINA` (o schema de um item) e
 * `recusarCoercaoDasMaquinas` (a guarda anti-coerção de `maquinas[i]`).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_OPCOES_MAXIMO, LIMITE_OPCOES_PADRAO } from '../patrimonio/patrimonioComum.js';
import { PADRAO_DECIMAL, recusarCoercao } from './atividadeComum.js';
import {
  DECIMAIS_DA_LINHA_MAQUINA,
  cancelarLinhaMaquina,
  editarLinhaMaquina,
  lancarLinhaMaquina,
  opcoesImplementos,
  opcoesMedidor,
} from './atividadeApontamentoMaquinaService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const VERSAO = { type: 'integer', minimum: 1 };
const DIA = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const DECIMAL_NULO = { type: ['string', 'null'], pattern: PADRAO_DECIMAL.source };
/** Igual ao CHECK `AtividadeApontamentoMaquina_textos_check` (e ao do abastecimento). */
const OPERATION_ID = { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_.:-]+$' };
/** Motivo e justificativa sem tamanho no schema: curto/longo são 422 do serviço, nunca o 400 do schema. */
const TEXTO_DO_SERVICO = { type: ['string', 'null'] };
const OBSERVACAO = { type: ['string', 'null'], maxLength: 500 };

/** Campos de DADO da linha de máquina (os mesmos no lançamento, na edição e em `maquinas[]`). */
export const CAMPOS_DA_LINHA_MAQUINA = Object.freeze({
  bem_id: ID,
  implemento_bem_id: ID_NULO,
  sem_medidor: { type: ['boolean', 'null'] },
  leitura_inicial: DECIMAL_NULO,
  leitura_final: DECIMAL_NULO,
  quantidade_uso: DECIMAL_NULO,
  justificativa_salto: TEXTO_DO_SERVICO,
  observacao: OBSERVACAO,
});

/** Schema de UM item de `maquinas[]` no lançamento/repetição do apontamento (fechado; `bem_id` obrigatório). */
export const ITEM_LINHA_MAQUINA = Object.freeze({
  type: 'object',
  required: ['bem_id'],
  additionalProperties: false,
  properties: CAMPOS_DA_LINHA_MAQUINA,
});

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
const ENVELOPE = Object.freeze({ empresa_id: ID, versao: VERSAO, operation_id: OPERATION_ID });

const LANCAR = {
  params: PARAMS_APONTAMENTO,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'operation_id', 'bem_id'],
    additionalProperties: false,
    properties: { ...ENVELOPE, ...CAMPOS_DA_LINHA_MAQUINA },
  },
};
const EDITAR = {
  params: PARAMS_LINHA,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'operation_id'],
    additionalProperties: false,
    properties: { ...ENVELOPE, ...CAMPOS_DA_LINHA_MAQUINA },
  },
};
const CANCELAR = {
  params: PARAMS_LINHA,
  body: {
    type: 'object',
    required: ['empresa_id', 'versao', 'operation_id'],
    additionalProperties: false,
    properties: { ...ENVELOPE, motivo: TEXTO_DO_SERVICO },
  },
};
const OPCOES_IMPLEMENTOS = {
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      q: { type: 'string', maxLength: 120 },
      cursor: { type: 'string', minLength: 1, maxLength: 2200 },
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_OPCOES_MAXIMO, default: LIMITE_OPCOES_PADRAO },
    },
  },
};
const OPCOES_MEDIDOR = {
  querystring: {
    type: 'object',
    required: ['empresa_id', 'bem_id'],
    additionalProperties: false,
    properties: { empresa_id: ID, bem_id: ID, data: DIA },
  },
};

/**
 * Guarda anti-coerção dos decimais de cada item de `maquinas[]` (o corpo do
 * lançamento do apontamento): número → 400 `valor_deve_ser_texto`, com
 * `details.campo = maquinas[i].<campo>`.
 * @param {unknown} corpo
 */
export const recusarCoercaoDasMaquinas = (corpo) => {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return;
  const lista = /** @type {Record<string, unknown>} */ (corpo).maquinas;
  if (!Array.isArray(lista)) return;
  lista.forEach((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    try {
      recusarCoercao(item, DECIMAIS_DA_LINHA_MAQUINA);
    } catch (erro) {
      const e = /** @type {any} */ (erro);
      if (e?.details?.campo) {
        const caminho = `maquinas[${i}].${e.details.campo}`;
        e.details = { ...e.details, field: caminho, campo: caminho };
      }
      throw e;
    }
  });
};

/** @param {import('fastify').FastifyRequest} request */
const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};
/** @param {import('fastify').FastifyRequest} request */
const params = (request) => /** @type {{ id: string, apontamentoId: string, linhaId: string }} */ (request.params);
/** @param {import('fastify').FastifyRequest} request */
const corpo = (request) => /** @type {Record<string, any>} */ (request.body);
/** @param {import('fastify').FastifyRequest} request */
const consulta = (request) => /** @type {Record<string, any>} */ (request.query);

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeApontamentoMaquinaRoutes = async (app) => {
  const g = GUARDAS.atividadeApontamentos;
  const ver = GUARDAS.atividades.ver;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body, DECIMAIS_DA_LINHA_MAQUINA);
  });

  const base = '/atividades/:id/apontamentos/:apontamentoId/maquinas';
  app.post(base, { ...autenticado, preHandler: [g.criar], schema: LANCAR }, async (request, reply) => {
    const p = params(request);
    const r = await lancarLinhaMaquina(ctx(request), p.id, p.apontamentoId, corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.patch(`${base}/:linhaId`, { ...autenticado, preHandler: [g.editar], schema: EDITAR }, async (request, reply) => {
    const p = params(request);
    const r = await editarLinhaMaquina(ctx(request), p.id, p.apontamentoId, p.linhaId, corpo(request));
    return reply.status(r.status).send(r.body);
  });
  app.post(`${base}/:linhaId/cancelar`, { ...autenticado, preHandler: [g.cancelar], schema: CANCELAR }, async (request, reply) => {
    const p = params(request);
    const r = await cancelarLinhaMaquina(ctx(request), p.id, p.apontamentoId, p.linhaId, corpo(request));
    return reply.status(r.status).send(r.body);
  });

  app.get('/atividades-opcoes/implementos', { ...autenticado, preHandler: [ver], schema: OPCOES_IMPLEMENTOS }, async (request) =>
    opcoesImplementos(ctx(request), consulta(request)));
  app.get('/atividades-opcoes/medidor', { ...autenticado, preHandler: [ver], schema: OPCOES_MEDIDOR }, async (request) =>
    opcoesMedidor(ctx(request), consulta(request)));
};
