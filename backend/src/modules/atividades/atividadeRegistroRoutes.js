/**
 * D-PROD-254 — rotas do REGISTRO DE CAMPO e das leituras por área (tela `op-atividades`):
 *
 *  - `POST /atividades/registrar` (lançar apontamento: `GUARDAS.atividadeApontamentos.criar`) — entra na atividade aberta
 *    do tipo/área/mês ou cria uma, e grava o apontamento + linhas, numa transação (ver `atividadeRegistroService.js`).
 *    201; reenvio igual da mesma `operation_id` → 200 com `replay: true`.
 *  - `GET  /atividades-por-area/:areaId/resumo` (ver) — atividades da área e custos do mês.
 *  - `GET  /atividades-por-area/:areaId/registros` (ver) — histórico de registros de campo da área (keyset).
 *
 * Corpo e query FECHADOS; os campos do dia e as linhas são os MESMOS do `POST /atividades/:id/apontamentos`
 * (`CAMPOS_DO_DIA` sem `atividade_area_id`, que o servidor deriva; `LINHAS_DO_LANCAMENTO`). Tenant só da sessão.
 *
 * D-PROD-263: a área vem em `area_id` (uma, como sempre) OU em `areas: [{ area_id, hectares }]` (1..20, várias áreas
 * num registro só: um apontamento por área, as linhas repartidas pelos hectares). Os dois juntos, nenhum dos dois ou
 * `areas[]` com `area_executada_dia` → 400 (o serviço explica qual). `hectares` chega como TEXTO, como os decimais do dia.
 *
 * D-PROD-265: `data_termino` opcional (`AAAA-MM-DD` ou null), só nesta rota (o `POST …/apontamentos` não a recebe): o último
 * dia do serviço, igual em todas as áreas. Antes de `data_operacional` → 400; no futuro da fazenda → 422, como o dia.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { DECIMAIS_DO_APONTAMENTO, PADRAO_DECIMAL, recusarCoercao, recusarCoercaoNasListas, DECIMAIS_DA_LINHA_PRODUTO } from './atividadeComum.js';
import { recusarCoercaoDasMaquinas } from './atividadeApontamentoMaquinaRoutes.js';
import { DECIMAIS_DA_LINHA_MAO_OBRA } from './atividadeApontamentoMaoObraService.js';
import { DECIMAIS_DA_LINHA_SERVICO } from './atividadeApontamentoServicoService.js';
import { CAMPOS_DO_DIA, LINHAS_DO_LANCAMENTO, ORIGEM } from './atividadeApontamentoRoutes.js';
import { AREAS_NO_REGISTRO_MAXIMO, registrarCampo } from './atividadeRegistroService.js';
import { LIMITE_REGISTROS_MAXIMO, LIMITE_REGISTROS_PADRAO, registrosDaArea, resumoDaArea } from './atividadePorAreaService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
// `atividade_area_id` é derivada pelo servidor (a área do registro): fora do corpo.
const CAMPOS_DO_REGISTRO = Object.fromEntries(Object.entries(CAMPOS_DO_DIA).filter(([k]) => k !== 'atividade_area_id'));

/** D-PROD-263 — uma área do registro de várias áreas (fechado): a área do mapa e os hectares feitos nela. */
const AREA_DO_REGISTRO = {
  type: 'object',
  required: ['area_id', 'hectares'],
  additionalProperties: false,
  properties: { area_id: ID, hectares: { type: 'string', pattern: PADRAO_DECIMAL.source } },
};

const REGISTRAR = {
  body: {
    type: 'object',
    // `area_id` OU `areas` (D-PROD-263): a escolha entre os dois é conferida no serviço, com a mensagem certa.
    required: ['empresa_id', 'tipo_atividade_id', 'data_operacional', 'operation_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      area_id: ID,
      areas: { type: 'array', minItems: 1, maxItems: AREAS_NO_REGISTRO_MAXIMO, items: AREA_DO_REGISTRO },
      tipo_atividade_id: ID,
      safra_ciclo: { type: ['string', 'null'], maxLength: 32 },
      ...CAMPOS_DO_REGISTRO,
      // D-PROD-265: o último dia do serviço (Nova realização), opcional.
      data_termino: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      origem: ORIGEM,
      ...LINHAS_DO_LANCAMENTO,
    },
  },
};
const POR_AREA = { type: 'object', required: ['areaId'], additionalProperties: false, properties: { areaId: ID } };
const RESUMO = { params: POR_AREA, querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } } };
const REGISTROS = {
  params: POR_AREA,
  querystring: {
    type: 'object',
    required: ['empresa_id'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      tipo_atividade_id: ID,
      limit: { type: 'integer', minimum: 1, maximum: LIMITE_REGISTROS_MAXIMO, default: LIMITE_REGISTROS_PADRAO },
      cursor: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
};

/** @param {import('fastify').FastifyRequest} request */
const ctx = (request) => {
  exigirAuthContext(request.contexto.auth);
  return request.contexto;
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarAtividadeRegistroRoutes = async (app) => {
  const g = GUARDAS.atividadeApontamentos;
  const autenticado = { onRequest: [app.autenticar] };
  app.addHook('preValidation', async (request) => {
    recusarCoercao(request.body, DECIMAIS_DO_APONTAMENTO);
    recusarCoercaoNasListas(request.body, { produtos: DECIMAIS_DA_LINHA_PRODUTO, mao_obra: DECIMAIS_DA_LINHA_MAO_OBRA, servicos: DECIMAIS_DA_LINHA_SERVICO, areas: ['hectares'] });
    recusarCoercaoDasMaquinas(request.body);
  });

  app.post('/atividades/registrar', { ...autenticado, preHandler: [g.criar], schema: REGISTRAR }, async (request, reply) => {
    const r = await registrarCampo(ctx(request), /** @type {Record<string, any>} */ (request.body));
    return reply.status(r.replay === true ? 200 : 201).send(r);
  });
  app.get('/atividades-por-area/:areaId/resumo', { ...autenticado, preHandler: [g.ver], schema: RESUMO }, async (request) =>
    resumoDaArea(ctx(request), /** @type {{ areaId: string }} */ (request.params).areaId, /** @type {Record<string, any>} */ (request.query)));
  app.get('/atividades-por-area/:areaId/registros', { ...autenticado, preHandler: [g.ver], schema: REGISTROS }, async (request) =>
    registrosDaArea(ctx(request), /** @type {{ areaId: string }} */ (request.params).areaId, /** @type {Record<string, any>} */ (request.query)));
};
