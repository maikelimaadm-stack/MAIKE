/**
 * Política de cancelamento de lançamentos históricos (MAIKE-MAPA-HISTORICO-
 * MOVIMENTACOES-R1.1, D-PROD-94a).
 *
 * Cancelar um lançamento do cocho ou uma transferência do depósito hoje é uma
 * sequência de chamadas independentes feitas pelo navegador (apagar lotes de
 * suplementação, reabrir período, devolver estoque, apagar movimentos, apagar o
 * evento). Uma falha no meio deixa estado parcial. Até existir estorno
 * transacional e idempotente no servidor (R2), esses cancelamentos ficam
 * SUSPENSOS na interface — fail-closed: o botão não aparece e o handler recusa
 * antes de qualquer chamada.
 *
 * Desde a D-PROD-161 (MAIKE-ESTOQUE-P0-01) o backend também fecha esse
 * caminho: POST genérico de movimento e de lote, PATCH de coluna operacional e
 * DELETE de lote respondem 409 `ESTOQUE_ESCRITA_DIRETA_RECUSADA` (ou
 * `REGISTRO_OPERACIONAL_IMUTAVEL` quando o lote está vinculado), e
 * `suplementacaoHistoricoService` falha fechada sem I/O. O estorno de verdade
 * (no motor físico, transacional) continua para a P1.
 */

export const MENSAGEM_ESTORNO_SUSPENSO =
  'Cancelamentos temporariamente indisponíveis até a implementação de estorno seguro.';

/** Cancelamento de lançamento do cocho (evento de suplementação). */
export const CANCELAMENTO_COCHO_HABILITADO = false;

/** Cancelamento de transferência entre depósitos. */
export const CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO = false;
