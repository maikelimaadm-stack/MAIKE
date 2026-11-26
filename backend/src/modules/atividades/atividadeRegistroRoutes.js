/**
 * D-PROD-254 — rotas do REGISTRO DE CAMPO e das leituras por área (tela `op-atividades`):
 *
 *  - `POST /atividades/registrar` (lançar apontamento: `GUARDAS.atividadeApontamentos.registrar` — a de lançar e, com
 *    `concluir`/`nova_atividade` true, também a de editar a atividade, D-PROD-267) — entra na atividade aberta da
 *    operação na área (D-PROD-267: em qualquer mês) ou cria uma, e grava o apontamento + linhas, numa transação (ver
 *    `atividadeRegistroService.js`).
 *    201; reenvio igual da mesma `operation_id` → 200 com `replay: true`.
 *    D-PROD-332 (emenda): `bem_id` (opcional) é a máquina do serviço na abertura (o `bem_id` da atividade criada); não
 *    cria linha de uso. Com `maquinas[]`, as linhas de uso seguem como antes.
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
 *
 * D-PROD-267: `concluir` e `nova_atividade`, booleanos opcionais (texto, número ou null → 400 `formato`, sem coerção). Com
 * `concluir: true` ou `nova_atividade: true` o registro também CONCLUI (as áreas do registro, ou as da atividade parada):
 * a guarda pede, além de lançar, a permissão de editar a atividade (a mesma do "Concluir" — `GUARDAS.atividades.editar`).
 *
 * D-PROD-274 (MAIKE-ENTREGA2): os campos de cada tipo, todos opcionais no schema (a regra de cada um é do tipo, no serviço):
 * `plantio` (objeto fechado: `cultura_id`, `forma_plantio`, `semente_incrustada`, `cobertura`, `consorcio_cultura_id`),
 * `numero_receituario`, `local` (Manutenção e Outros sem área) e `unidade_producao_sigla` (KM | M | UN). Os booleanos do
 * plantio chegam como booleano ou null, sem coerção. A linha de insumo aceita `vc_percentual` (texto).
 *
 * D-PROD-276 (MAIKE-ENTREGA3): `planejamento_id` (id ou null), a reforma de que a realização faz parte ("Faz parte de");
 * a regra (fazenda, aberta, com as áreas do registro; nunca sem área) é do serviço.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { invalido } from '../gestao/gestaoComum.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { DECIMAIS_DO_APONTAMENTO, PADRAO_DECIMAL, recusarCoercao, recusarCoercaoNasListas, DECIMAIS_DA_LINHA_PRODUTO } from './atividadeComum.js';
import { recusarCoercaoDasMaquinas } from './atividadeApontamentoMaquinaRoutes.js';
import { DECIMAIS_DA_LINHA_MAO_OBRA } from './atividadeApontamentoMaoObraService.js';
import { DECIMAIS_DA_LINHA_SERVICO } from './atividadeApontamentoServicoService.js';
import { CAMPOS_DO_DIA, LINHAS_DO_LANCAMENTO, ORIGEM } from './atividadeApontamentoRoutes.js';
import { AREAS_NO_REGISTRO_MAXIMO, FORMAS_PLANTIO, UNIDADES_FEITAS, registrarCampo } from './atividadeRegistroService.js';
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

const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };

/** D-PROD-274 — os dados do Plantio de pastagem (fechado): o capim (obrigatório no objeto) e o que é opcional. */
const PLANTIO_DO_REGISTRO = {
  type: 'object',
  required: ['cultura_id'],
  additionalProperties: false,
  properties: {
    cultura_id: ID,
    forma_plantio: { type: ['string', 'null'], enum: [...FORMAS_PLANTIO, null] },
    semente_incrustada: { type: ['boolean', 'null'] },
    cobertura: { type: ['boolean', 'null'] },
    consorcio_cultura_id: ID_NULO,
  },
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
      // D-PROD-332 (emenda): a máquina do serviço NA ABERTURA (o "Iniciar serviço" da tela de campo). É o `bem_id` da
      // atividade criada; NÃO cria linha de uso (para isso, `maquinas[]`). Opcional, fora de `required`.
      bem_id: ID,
      safra_ciclo: { type: ['string', 'null'], maxLength: 32 },
      ...CAMPOS_DO_REGISTRO,
      // D-PROD-265: o último dia do serviço (Nova realização), opcional.
      data_termino: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      // D-PROD-267: "Como fica depois de salvar?" (Concluída) e a resposta ao "serviço parado".
      concluir: { type: 'boolean' },
      nova_atividade: { type: 'boolean' },
      // D-PROD-274: os campos de cada tipo (Plantio, Aplicação, Manutenção e Outros).
      plantio: { ...PLANTIO_DO_REGISTRO, type: ['object', 'null'] },
      numero_receituario: { type: ['string', 'null'], maxLength: 80 },
      local: { type: ['string', 'null'], maxLength: 240 },
      unidade_producao_sigla: { type: ['string', 'null'], enum: [...UNIDADES_FEITAS, null] },
      // D-PROD-276: a reforma do "Faz parte de", opcional.
      planejamento_id: ID_NULO,
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

/** D-PROD-267 — os booleanos do registro chegam como booleano, nunca "true"/1 (a coerção do AJV não decide por ninguém). */
const BOOLEANOS_DO_REGISTRO = Object.freeze(['concluir', 'nova_atividade']);

/** D-PROD-274 — os booleanos do plantio (true, false ou null; nunca "true"/1). */
const BOOLEANOS_DO_PLANTIO = Object.freeze(['semente_incrustada', 'cobertura']);

/** @param {unknown} corpo */
const recusarCoercaoDosBooleanos = (corpo) => {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return;
  const c = /** @type {Record<string, unknown>} */ (corpo);
  for (const chave of BOOLEANOS_DO_REGISTRO) {
    if (Object.prototype.hasOwnProperty.call(c, chave) && c[chave] !== undefined && typeof c[chave] !== 'boolean') {
      throw invalido(`${chave} deve ser true ou false`, { field: chave, reason: 'formato' });
    }
  }
  const p = c.plantio;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    for (const chave of BOOLEANOS_DO_PLANTIO) {
      const v = /** @type {Record<string, unknown>} */ (p)[chave];
      if (v !== undefined && v !== null && typeof v !== 'boolean') throw invalido(`plantio.${chave} deve ser true, false ou nulo`, { field: `plantio.${chave}`, reason: 'formato' });
    }
  }
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
    recusarCoercaoDosBooleanos(request.body);
  });

  app.post('/atividades/registrar', { ...autenticado, preHandler: [g.registrar], schema: REGISTRAR }, async (request, reply) => {
    const r = await registrarCampo(ctx(request), /** @type {Record<string, any>} */ (request.body));
    return reply.status(r.replay === true ? 200 : 201).send(r);
  });
  app.get('/atividades-por-area/:areaId/resumo', { ...autenticado, preHandler: [g.ver], schema: RESUMO }, async (request) =>
    resumoDaArea(ctx(request), /** @type {{ areaId: string }} */ (request.params).areaId, /** @type {Record<string, any>} */ (request.query)));
  app.get('/atividades-por-area/:areaId/registros', { ...autenticado, preHandler: [g.ver], schema: REGISTROS }, async (request) =>
    registrosDaArea(ctx(request), /** @type {{ areaId: string }} */ (request.params).areaId, /** @type {Record<string, any>} */ (request.query)));
};
