/**
 * Cancelamento do lançamento de cocho — D-PROD-268.
 *
 * O cancelamento é UM comando do servidor (estorno exato da baixa do depósito pelo motor,
 * rateio cancelado, período anterior reaberto quando provado), numa transação idempotente por
 * `operation_id`. Aqui só há o transporte: nada é desfeito no navegador. Só online: offline
 * recusa ANTES de qualquer I/O (nunca vai para a fila offline).
 *
 * A reversão antiga pelo navegador (`suplementacaoHistoricoService`) continua fail-closed.
 */
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { cancelarLancamentoCochoNativo, elegibilidadeCancelamentoCochoNativo } from '@/apis/suplementacao-eventos';

/** @param {string} operation */
const exigirConexao = (operation) => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      operation,
      resource: 'SuplementacaoCancelamento',
      details: { motivo: 'offline_comando_composto', mensagem: 'O cancelamento do lançamento só é feito com conexão.' },
    });
  }
};

/**
 * Elegibilidade do cancelamento (ensaio no servidor; nada é gravado). Informativa: o POST revalida.
 * @param {{ evento: { id: string, empresa_id: string }, signal?: AbortSignal }} p
 */
export const consultarElegibilidadeCancelamentoCocho = async ({ evento, signal }) => {
  exigirConexao('consultarElegibilidadeCancelamentoCocho');
  return elegibilidadeCancelamentoCochoNativo(evento.id, evento.empresa_id, signal ? { signal } : {});
};

/**
 * Cancela o lançamento. `operationId` é gerado ao abrir o diálogo e reusado no "tentar de novo":
 * repetir com a mesma chave nunca estorna duas vezes.
 * @param {{ evento: { id: string, empresa_id: string }, motivo: string, operationId: string }} p
 */
export const cancelarLancamentoCocho = async ({ evento, motivo, operationId }) => {
  exigirConexao('cancelarLancamentoCocho');
  return cancelarLancamentoCochoNativo(evento.id, { empresa_id: evento.empresa_id, operation_id: operationId, motivo: String(motivo ?? '').trim() });
};
