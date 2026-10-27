/**
 * Porta nativa de HistoricoLancamentoTarefa (P5.3, D-PROD-49).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'HistoricoLancamentoTarefa';
const CAMINHO = '/historicos-lancamento-tarefa';

export const ENTIDADE_OFFLINE = 'HistoricoLancamentoTarefa';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const CAMPOS_DE_CRIACAO = Object.freeze([
  'empresa_id',
  'tarefa_id',
  'titulo_tarefa',
  'evento',
  'data_evento',
  'status',
  'responsavel',
  'descricao',
]);

const valorDeEnvio = (valor) => {
  if (valor === undefined) return undefined;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  return valor;
};

/** @param {Record<string, unknown>} dados @param {readonly string[]} permitidos */
export const corpoDeEnvio = (dados, permitidos) => {
  /** @type {Record<string, unknown>} */
  const corpo = {};
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(dados ?? {}, campo)) continue;
    const valor = valorDeEnvio(/** @type {Record<string, unknown>} */ (dados)[campo]);
    if (valor !== undefined) corpo[campo] = valor;
  }
  return corpo;
};

export const operacoesNativas = Object.freeze({
  list: (limite) => {
    const query = typeof limite === 'number' && limite > 0 ? `?limite=${limite}` : '';
    return nativeRequest(`${CAMINHO}${query}`, { autenticado: true }, ctx('listHistorico'));
  },

  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createHistorico')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteHistorico')
    ),
});

export const historicoLancamentoTarefaPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
