/**
 * D-PROD-161 (Estoque P0, fatia F4 + R1 + R2) — rotas do estoque físico.
 *
 * GET /estoque-fisico/reconciliacao — diagnóstico SOMENTE LEITURA dos
 * invariantes do motor físico (SPEC §5). Só o administrador real do tenant
 * (`GUARDAS.estoqueFisico.reconciliar`); o tenant vem do `auth_context`, a
 * querystring é fechada (`additionalProperties: false`: um `cliente_id` ou
 * qualquer chave extra é 400, nunca ignorado). A varredura é limitada por
 * chamada: `cursor` é o `cobertura.proximo_cursor` da resposta anterior,
 * ASSINADO pelo servidor (HMAC-SHA256 com chave derivada do AUTH_SECRET) e
 * amarrado ao tenant, à empresa, ao produto, ao local e ao limite; qualquer
 * desvio é o mesmo 400 `REQUEST_VALIDATION_FAILED {field:'cursor'}` (o serviço
 * confere antes de qualquer ida ao banco). O contrato da cobertura (fim do
 * escopo, continuação, cumulativa e conclusão global) está em
 * `reconciliacaoEstoque.js`.
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
      cursor: { type: 'string', minLength: 1, maxLength: 1024, pattern: '^[A-Za-z0-9_-]+$' },
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
      const query = /** @type {{ empresa_id?: string, produto_id?: string, local_estoque_id?: string, limite?: number, cursor?: string }} */ (request.query ?? {});
      return reconciliarEstoque(request.contexto, {
        empresaId: query.empresa_id,
        produtoId: query.produto_id,
        localId: query.local_estoque_id,
        limite: query.limite,
        cursor: query.cursor,
      });
    },
  );
};
