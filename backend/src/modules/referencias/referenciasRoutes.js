import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { sincronizarReferencias } from './syncEntityReferencesService.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';

/**
 * O corpo só identifica a origem (D-PROD-137): `event.entity_name` + `data.id`.
 * O resto (`data.*`, `old_data`, `changed_fields`) ainda chega do front e é
 * aceito por compatibilidade, mas o service não lê — os valores vêm do banco.
 * A entidade NÃO é enumerada aqui: entidade sem tela tem de cair na guarda
 * (403 para quem não tem acesso total) antes de virar 400.
 */
const SCHEMA = {
  body: {
    type: 'object',
    required: ['event', 'data'],
    additionalProperties: true,
    properties: {
      event: {
        type: 'object',
        required: ['type', 'entity_name'],
        additionalProperties: true,
        properties: {
          type: { type: 'string', maxLength: 32 },
          entity_name: { type: 'string', minLength: 1, maxLength: 64 },
        },
      },
      data: {
        type: 'object',
        required: ['id'],
        additionalProperties: true,
        properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
      },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarReferenciasRoutes = async (app) => {
  app.post('/referencias/sincronizar', { onRequest: [app.autenticar], preHandler: [GUARDAS.referencias], schema: SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return sincronizarReferencias(request.contexto, request.body);
  });
};
