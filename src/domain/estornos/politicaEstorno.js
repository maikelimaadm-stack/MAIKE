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
 * Isto NÃO protege o backend: `DELETE`/`PATCH` genéricos continuam expostos e
 * são escopo da R2.
 */

export const MENSAGEM_ESTORNO_SUSPENSO =
  'Cancelamentos temporariamente indisponíveis até a implementação de estorno seguro.';

/** Cancelamento de lançamento do cocho (evento de suplementação). */
export const CANCELAMENTO_COCHO_HABILITADO = false;

/** Cancelamento de transferência entre depósitos. */
export const CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO = false;
