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
