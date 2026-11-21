/**
 * Comando transacional de lançamento de suplementação (ESTAB-P0-01).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';

const ctx = (operation) => ({ operation, resource: 'SuplementacaoEventoComando' });

/**
 * @param {{ operation_id: string, evento: object, lotes?: object[] }} body
 * @returns {Promise<{ committed?: boolean; evento?: object; operation_id?: string; replay?: boolean }>}
 */
export const comandoLancamentoComLotes = (body) =>
  nativeRequest('/suplementacao-eventos/comandos/lancamento-com-lotes', {
    method: 'POST',
    body,
    autenticado: true,
  }, ctx('comandoLancamentoSuplementacaoComLotes'));

/**
 * D-PROD-267 — cancela o lançamento de cocho no servidor (estorno exato da baixa, rateio
 * cancelado, período anterior reaberto quando provado). Só online, nunca pela fila offline;
 * idempotente por `operation_id`.
 * @param {string} id
 * @param {{ empresa_id: string, operation_id: string, motivo: string }} body
 * @returns {Promise<any>} `{ committed, operation_id, replay, evento, lotes_cancelados, estorno|null, periodo_reaberto|null }`
 */
export const cancelarLancamentoCochoNativo = (id, body) =>
  nativeRequest(`/suplementacao-eventos/${encodeURIComponent(id)}/cancelamento`, {
    method: 'POST',
    body,
    autenticado: true,
  }, ctx('cancelarLancamentoCocho'));

/**
 * D-PROD-267 — elegibilidade do cancelamento (ensaio no servidor, nada gravado).
 * @param {string} id
 * @param {string} empresaId
 * @param {{ signal?: AbortSignal }} [opcoes]
 * @returns {Promise<any>} `{ elegivel, pode_cancelar_permissao, codigo|null, reason|null, mensagem|null, detalhes, efeitos: { estorno, periodo_reaberto, lotes_a_cancelar } }`
 */
export const elegibilidadeCancelamentoCochoNativo = (id, empresaId, opcoes = {}) =>
  nativeRequest(`/suplementacao-eventos/${encodeURIComponent(id)}/elegibilidade-cancelamento?empresa_id=${encodeURIComponent(empresaId)}`, {
    autenticado: true,
    ...(opcoes.signal ? { signal: opcoes.signal } : {}),
  }, ctx('elegibilidadeCancelamentoCocho'));
