/**
 * Comandos transacionais de movimentação (ESTAB-P0-01).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';

const BASE = '/movimentacoes-estoque/comandos';

const ctx = (operation) => ({ operation, resource: 'MovimentacaoEstoqueComando' });

/**
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ committed?: boolean; movimentacao?: object; rateio?: object[]; operation_id?: string; replay?: boolean; avisos?: object[] }>}
 */
export const comandoSaidaSuplementacao = (body) =>
  nativeRequest(`${BASE}/saida-suplementacao`, { method: 'POST', body, autenticado: true }, ctx('comandoSaidaSuplementacao'));

/**
 * @param {Record<string, unknown>} body
 * @returns {Promise<{ committed?: boolean; movimentacao_saida?: object; movimentacao_entrada?: object; rateio?: object[]; operation_id?: string; replay?: boolean }>}
 */
export const comandoTransferenciaEntreLocais = (body) =>
  nativeRequest(
    `${BASE}/transferencia-locais`,
    { method: 'POST', body, autenticado: true },
    ctx('comandoTransferenciaEntreLocais')
  );

/**
 * D-PROD-268 — tempo do cancelamento da transferência: o servidor espera até 30 s pelas
 * travas (TRANSACAO_LONGA) e o diálogo reenvia a MESMA `operation_id`; cortar aos 20 s
 * padrão só criaria "resultado desconhecido" sem motivo.
 */
const TIMEOUT_CANCELAR_TRANSFERENCIA_MS = 60000;

/**
 * D-PROD-268 — cancela (estorno exato) a transferência entre depósitos pelo id de
 * qualquer perna (Saída `transferencia_enviada` ou Entrada `transferencia_recebida`).
 * Só online: o comando não existe na fila offline.
 * @param {string} movimentacaoId
 * @param {{ empresa_id: string, motivo: string, operation_id: string }} body
 * @returns {Promise<{ committed?: boolean; replay?: boolean; operation_id?: string; movimentacao_saida?: object; movimentacao_entrada?: object; estorno_destino?: object; estorno_origem?: object; devolvido?: object[] }>}
 */
export const cancelarTransferenciaEntreLocais = (movimentacaoId, body) =>
  nativeRequest(
    `/movimentacoes-estoque/${encodeURIComponent(movimentacaoId)}/cancelar-transferencia`,
    { method: 'POST', body, autenticado: true, timeoutMs: TIMEOUT_CANCELAR_TRANSFERENCIA_MS },
    ctx('cancelarTransferenciaEntreLocais')
  );

/**
 * D-PROD-268 — elegibilidade (ensaio do servidor, sem gravar) do cancelamento da transferência.
 * @param {string} movimentacaoId
 * @param {string} empresaId
 * @param {{ signal?: AbortSignal }} [opcoes]
 * @returns {Promise<{ elegivel?: boolean; pode_cancelar?: boolean; codigo?: string|null; motivo?: string|null; detalhes?: any; efeitos?: any }>}
 */
export const elegibilidadeCancelamentoTransferencia = (movimentacaoId, empresaId, opcoes = {}) =>
  nativeRequest(
    `/movimentacoes-estoque/${encodeURIComponent(movimentacaoId)}/elegibilidade-cancelamento-transferencia?empresa_id=${encodeURIComponent(empresaId)}`,
    { autenticado: true, signal: opcoes?.signal },
    ctx('elegibilidadeCancelamentoTransferencia')
  );
