/**
 * Rotas da importação de áreas por arquivo (D-PROD-90).
 *
 *   POST /areas-pastagem/importacao/conferir   valida contra o banco, não grava
 *   POST /areas-pastagem/importacao            grava todas ou nenhuma
 *
 * O arquivo KML/GeoJSON nunca chega aqui: o navegador extrai os contornos e
 * manda só o que o cadastro grava, item a item, com o contorno já no formato
 * persistido `[[lat, lng], ...]`. O servidor revalida a geometria e recalcula a
 * área; nada do arquivo escolhe tenant, empresa, número ou nome do setor.
 *
 * Schemas fechados (`additionalProperties: false`): campo que o servidor
 * atribui — id, número, tenant, nome do setor — vira 400 em vez de sumir.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { conferirImportacao, importarAreas, LIMITES_IMPORTACAO } from './areaImportacaoService.js';

/** ~50 mil vértices em JSON cabem em 4 MB; o limite da Vercel é 4,5 MB. */
const LIMITE_CORPO = 4 * 1024 * 1024;

const ITEM = {
  type: 'object',
  required: ['ref', 'coords'],
  additionalProperties: false,
  properties: {
    ref: { type: 'string', minLength: 1, maxLength: 64 },
    nome: { type: ['string', 'null'], maxLength: 255 },
    sigla: { type: ['string', 'null'], maxLength: 32 },
    setor_id: { type: ['string', 'null'], maxLength: 64 },
    tipo_cultura: { type: ['string', 'null'], maxLength: 32 },
    tipo_pastagem: { type: ['string', 'null'], maxLength: 128 },
    area_pastejada: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
    aproveitamento_classificacao: { type: ['string', 'null'], maxLength: 16 },
    cor: { type: ['string', 'null'], maxLength: 32 },
    coords: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITES_IMPORTACAO.maxVerticesPorArea,
      items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
    },
  },
};

const ITENS = { type: 'array', minItems: 1, maxItems: LIMITES_IMPORTACAO.maxItens, items: ITEM };
const EMPRESA = { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' };

const CONFERIR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'itens'],
    additionalProperties: false,
    properties: { empresa_id: EMPRESA, itens: ITENS },
  },
};

const IMPORTAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['operation_id', 'empresa_id', 'itens'],
    additionalProperties: false,
    properties: {
      operation_id: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
      empresa_id: EMPRESA,
      itens: ITENS,
    },
  },
};

/** @param {unknown} corpo @returns {any} corpo já validado pelo schema */
const corpoValidado = (corpo) => corpo;

/** @param {import('fastify').FastifyInstance} app */
export const registrarAreaImportacaoRoutes = async (app) => {
  app.post(
    '/areas-pastagem/importacao/conferir',
    { onRequest: [app.autenticar], bodyLimit: LIMITE_CORPO, schema: CONFERIR_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      return conferirImportacao(request.contexto, corpoValidado(request.body));
    }
  );

  app.post(
    '/areas-pastagem/importacao',
    { onRequest: [app.autenticar], bodyLimit: LIMITE_CORPO, schema: IMPORTAR_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const resultado = await importarAreas(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(resultado);
    }
  );
};
