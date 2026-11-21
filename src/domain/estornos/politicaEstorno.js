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
 *
 * D-PROD-267 — o cancelamento do lançamento do COCHO passa a existir no servidor
 * (POST /suplementacao-eventos/:id/cancelamento: estorno exato pelo motor, rateio
 * cancelado e período anterior reaberto, numa transação idempotente). A flag do
 * cocho liga SÓ esse caminho novo (`CancelarLancamentoCocho`, só online, para
 * quem tem a permissão `cancelar_lancamentos_estoque`); a reversão antiga pelo
 * navegador continua morta.
 *
 * D-PROD-267 — a TRANSFERÊNCIA entre depósitos também ganha estorno no servidor
 * (POST /movimentacoes-estoque/:id/cancelar-transferencia, `CancelarTransferenciaDeposito`).
 * A flag do depósito continua `false`: ela guarda só a porta antiga do navegador.
 */

export const MENSAGEM_ESTORNO_SUSPENSO =
  'Cancelamentos temporariamente indisponíveis até a implementação de estorno seguro.';

/** Cancelamento de lançamento do cocho (evento de suplementação) — D-PROD-267: só o comando do servidor. */
export const CANCELAMENTO_COCHO_HABILITADO = true;

/** Cancelamento de transferência entre depósitos. */
export const CANCELAMENTO_TRANSFERENCIA_DEPOSITO_HABILITADO = false;
