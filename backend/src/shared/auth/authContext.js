/**
 * `auth_context` — a ÚNICA autoridade de tenancy do backend.
 *
 * O contrato ModeloBase1 Pecuário é literal quanto a isto:
 *
 *   tenancy.tenantSource            = "auth_context"
 *   tenancy.forbiddenTenantSources  = body, query, params, headers, cookie
 *   audit.actorSource               = "auth_context"
 *   audit.forbiddenActorSources     = body, query, params, headers
 *
 * As duas listas são diferentes de propósito — o tenant fecha as cinco portas
 * de entrada, o ator fecha as quatro que o SSOT declara. Foi exatamente a
 * confusão entre elas que a auditoria P2-R1 encontrou no gate.
 *
 * Consequência de desenho: nenhuma função deste arquivo aceita `request` como
 * parâmetro. O contexto é construído a partir do **payload verificado do
 * token**, e mais nada. Um `cliente_id` que chegue no corpo é dado de entrada
 * comum — nunca autoridade.
 */

import { tenantContextRequired, tenantScopeViolation } from '../errors/AppError.js';

/**
 * @typedef {object} AuthContext
 * @property {string} clienteId tenant autenticado
 * @property {string} usuarioId ator autenticado
 * @property {string} login
 */

/**
 * Constrói o contexto a partir do payload já verificado do token.
 *
 * @param {{cliente_id?: unknown, usuario_id?: unknown, login?: unknown}} payload
 * @returns {AuthContext}
 */
export const construirAuthContext = (payload) => {
  const clienteId = typeof payload?.cliente_id === 'string' ? payload.cliente_id.trim() : '';
  const usuarioId = typeof payload?.usuario_id === 'string' ? payload.usuario_id.trim() : '';
  const login = typeof payload?.login === 'string' ? payload.login.trim() : '';

  if (!clienteId || !usuarioId) {
    throw tenantContextRequired('token sem cliente_id ou usuario_id');
  }

  return Object.freeze({ clienteId, usuarioId, login });
};

/**
 * Exige contexto autenticado.
 * @param {AuthContext | null | undefined} contexto
 * @returns {AuthContext}
 */
export const exigirAuthContext = (contexto) => {
  if (!contexto?.clienteId || !contexto?.usuarioId) {
    throw tenantContextRequired();
  }
  return contexto;
};

/**
 * Barreira de escopo: o recurso carregado pertence mesmo ao tenant do contexto?
 *
 * Repositório já filtra por `cliente_id`, então em caminho normal isto nunca
 * dispara. Ele existe para o caminho anormal — id vindo de fora, junção nova,
 * consulta escrita à mão — em que o filtro pode ter sido esquecido. Barreira
 * redundante que nunca dispara é barata; a que falta custa vazamento entre
 * clientes.
 *
 * @param {AuthContext} contexto
 * @param {{cliente_id?: string} | null | undefined} recurso
 */
export const exigirMesmoTenant = (contexto, recurso) => {
  exigirAuthContext(contexto);
  if (!recurso || recurso.cliente_id !== contexto.clienteId) {
    throw tenantScopeViolation();
  }
  return recurso;
};
