/**
 * Porta nativa de LancamentoTarefa (P5.3, D-PROD-49).
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'LancamentoTarefa';
const CAMINHO = '/lancamentos-tarefa';

export const ENTIDADE_OFFLINE = 'LancamentoTarefa';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const CAMPOS_DE_CRIACAO = Object.freeze([
  'empresa_id',
  'titulo',
  'descricao',
  'tipo',
  'tipo_tarefa_id',
  'solicitante',
  'data_pedido',
  'prioridade',
  'status',
  'data_prevista',
  'data_inicio',
  'data_conclusao',
  'area_id',
  'lote_id',
  'ponto_suplementacao_id',
  'coordenadas',
  'responsavel_id',
  'responsavel',
  'responsavel_geral',
  'observacoes',
  'observacoes_conclusao',
  'fotos',
  'anexos_urls',
]);

const CAMPOS_DE_ATUALIZACAO = Object.freeze(
  CAMPOS_DE_CRIACAO.filter((campo) => campo !== 'empresa_id')
);

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
  list: () => nativeRequest(CAMINHO, { autenticado: true }, ctx('listLancamentos')),

  create: (dados) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: corpoDeEnvio(dados, CAMPOS_DE_CRIACAO), autenticado: true },
      ctx('createLancamento')
    ),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: corpoDeEnvio(dados, CAMPOS_DE_ATUALIZACAO), autenticado: true },
      ctx('updateLancamento')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteLancamento')
    ),
});

export const lancamentoTarefaPort = createOfflineEntityAdapter({
  entityName: ENTIDADE_OFFLINE,
  operations: operacoesNativas,
  enabled: offlineStorageDisponivel(),
  tenantScoped: true,
});
