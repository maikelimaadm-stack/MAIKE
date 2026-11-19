/**
 * Rotas de TipoAtividade (D-PROD-182).
 *
 * Espelho das rotas de TipoTarefa, sem chaves legadas: entidade nova não tem
 * cliente antigo, então qualquer campo fora do schema vira 400
 * (`removeAdditional: false`, ver `app.js`). Leitura só exige autenticação,
 * como em `/tipos-tarefa`; escrita passa pela tela `sup-tipos-atividade`.
 *
 * D-PROD-197 (contrato `docs/engineering/MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md`):
 *  - corpo (POST e PATCH) com os padrões e as 8 flags, todos opcionais;
 *    `exige_area` passa a ser campo válido; `pode_ter_produto`,
 *    `pode_ter_maquina` e `pode_ter_implemento` (e qualquer chave fora do
 *    schema) seguem 400;
 *  - flags e coeficiente SEM coerção do AJV: o `preValidation` recusa, no corpo
 *    BRUTO, flag que não seja booleano de verdade e coeficiente que não seja
 *    texto ou null (400);
 *  - `GET /tipos-atividade/opcoes/centros-custo` e `/centros-resultado`
 *    (`?empresa_id=`): centros ATIVOS da fazenda para o formulário, para quem
 *    pode CRIAR ou EDITAR tipo (não dependem das telas de centros).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { invalido } from '../gestao/gestaoComum.js';
import { listar, obter, criar, atualizar, excluir, opcoesCentrosPadrao } from './tipoAtividadeService.js';
import { CATEGORIAS_TIPO_FIXO, FLAGS_TIPO_ATIVIDADE, PADRAO_COEFICIENTE } from './tipoAtividadePadroes.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };
const ID_NULO = { type: ['string', 'null'], minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };

const CAMPOS = Object.freeze({
  nome_tipo: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  grupo_atividade_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  ativo: { type: 'boolean' },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  // D-PROD-197 — padrões (null = sem padrão) e flags.
  // D-PROD-257 — o tipo fixo: obrigatório no POST, nunca null, só os 7 valores.
  categoria: { type: 'string', enum: [...CATEGORIAS_TIPO_FIXO] },
  centro_custo_padrao_id: ID_NULO,
  centro_resultado_padrao_id: ID_NULO,
  unidade_producao_id: ID_NULO,
  coeficiente_padrao: { type: ['string', 'null'], pattern: PADRAO_COEFICIENTE.source },
  ...Object.fromEntries(FLAGS_TIPO_ATIVIDADE.map((flag) => [flag, { type: 'boolean' }])),
});

const PARAMS_ID = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
};

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['nome_tipo', 'categoria'],
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const OBTER_SCHEMA = { params: PARAMS_ID };

const ATUALIZAR_SCHEMA = {
  params: PARAMS_ID,
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS },
  },
};

const EXCLUIR_SCHEMA = { params: PARAMS_ID };

/** D-PROD-197 — opções de centro padrão: só a fazenda (o tenant vem da sessão). */
const OPCOES_SCHEMA = {
  querystring: { type: 'object', required: ['empresa_id'], additionalProperties: false, properties: { empresa_id: ID } },
};

/**
 * D-PROD-197 — o AJV do app usa a coerção padrão do Fastify (`coerceTypes`):
 * num campo `boolean`, `"true"` e `1` viram `true` e `null` vira `false`; num
 * campo string, o número vira texto (já arredondado pelo float). Para as flags
 * isso gravaria uma regra que ninguém marcou; para o coeficiente, um decimal
 * que ninguém digitou. Antes da validação, o corpo BRUTO precisa trazer
 * booleano de verdade nas flags e texto (ou null) no coeficiente — como o
 * `preValidation` da curva de ganho faz com número.
 * @param {import('fastify').FastifyRequest} request
 */
const padroesSemCoercao = async (request) => {
  const corpo = /** @type {Record<string, unknown>|null} */ (request.body);
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return;
  for (const flag of FLAGS_TIPO_ATIVIDADE) {
    if (Object.prototype.hasOwnProperty.call(corpo, flag) && typeof corpo[flag] !== 'boolean') {
      throw invalido(`${flag} deve ser true ou false`, { field: flag, reason: 'valor_deve_ser_booleano' });
    }
  }
  if (
    Object.prototype.hasOwnProperty.call(corpo, 'coeficiente_padrao') &&
    corpo.coeficiente_padrao !== null &&
    typeof corpo.coeficiente_padrao !== 'string'
  ) {
    throw invalido('coeficiente_padrao deve ser texto decimal (ex.: "1.5"), nunca número', {
      field: 'coeficiente_padrao',
      reason: 'valor_deve_ser_texto',
    });
  }
};

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarTipoAtividadeRoutes = async (app) => {
  app.get('/tipos-atividade', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.get('/tipos-atividade/:id', { onRequest: [app.autenticar], schema: OBTER_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return obter(request.contexto, id);
  });

  app.post('/tipos-atividade', { onRequest: [app.autenticar], preValidation: [padroesSemCoercao], preHandler: [GUARDAS.tipoAtividade.criar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const tipo = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(tipo);
  });

  app.patch('/tipos-atividade/:id', { onRequest: [app.autenticar], preValidation: [padroesSemCoercao], preHandler: [GUARDAS.tipoAtividade.editar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/tipos-atividade/:id', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoAtividade.excluir], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });

  // D-PROD-197 — opções do formulário (Apropriação): quem cria OU edita tipo.
  app.get('/tipos-atividade/opcoes/centros-custo', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoAtividade.opcoes], schema: OPCOES_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return opcoesCentrosPadrao('custo')(request.contexto, corpoValidado(request.query));
  });

  app.get('/tipos-atividade/opcoes/centros-resultado', { onRequest: [app.autenticar], preHandler: [GUARDAS.tipoAtividade.opcoes], schema: OPCOES_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return opcoesCentrosPadrao('resultado')(request.contexto, corpoValidado(request.query));
  });
};
