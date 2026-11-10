/**
 * D-PROD-161 (Estoque P0, fatia F4) — rotas do estoque físico.
 *
 * GET /estoque-fisico/reconciliacao — diagnóstico SOMENTE LEITURA dos
 * invariantes do motor físico (SPEC §5). Só o administrador real do tenant
 * (`GUARDAS.estoqueFisico.reconciliar`); o tenant vem do `auth_context`, a
 * querystring é fechada (`additionalProperties: false`: um `cliente_id` ou
 * qualquer chave extra é 400, nunca ignorado).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { GUARDAS } from '../../shared/auth/guardasRotas.js';
import { LIMITE_MAXIMO, reconciliarEstoque } from './reconciliacaoEstoque.js';

const ID = { type: 'string', minLength: 1, maxLength: 64 };

const RECONCILIACAO_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      produto_id: ID,
      local_estoque_id: ID,
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarEstoqueFisicoRoutes = async (app) => {
  app.get(
    '/estoque-fisico/reconciliacao',
    { onRequest: [app.autenticar], preHandler: [GUARDAS.estoqueFisico.reconciliar], schema: RECONCILIACAO_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const query = /** @type {{ empresa_id?: string, produto_id?: string, local_estoque_id?: string, limite?: number }} */ (request.query ?? {});
      return reconciliarEstoque(request.contexto, {
        empresaId: query.empresa_id,
        produtoId: query.produto_id,
        localId: query.local_estoque_id,
        limite: query.limite,
      });
    },
  );
};
