/**
 * Rota do Assistente só de leitura (D-PROD-230).
 *
 * Corpo fechado (`additionalProperties: false`): `cliente_id` ou qualquer chave fora
 * do schema vira 400. O tenant vem só da sessão; a fazenda é a aberta no mapa e o
 * serviço confere que ela é deste tenant. É POST porque leva a pergunta e o histórico,
 * mas não grava nada.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { perguntar } from './assistenteService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };

export const MAX_HISTORICO = 10;

const PERGUNTAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'pergunta'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      pergunta: { type: 'string', minLength: 1, maxLength: 1000, pattern: '\\S' },
      // Só uma dica de contexto (a tela aberta). Nunca escolhe tenant nem fazenda.
      tela: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' },
      historico: {
        type: 'array',
        maxItems: MAX_HISTORICO,
        items: {
          type: 'object',
          required: ['papel', 'texto'],
          additionalProperties: false,
          properties: {
            papel: { type: 'string', enum: ['usuario', 'assistente'] },
            texto: { type: 'string', minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarAssistenteRoutes = async (app) => {
  app.post('/assistente/perguntar', { onRequest: [app.autenticar], schema: PERGUNTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return perguntar(request.contexto, /** @type {any} */ (request.body));
  });
};
