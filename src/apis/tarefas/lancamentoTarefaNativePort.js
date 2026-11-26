/**
 * Porta nativa de LancamentoTarefa (P5.3, D-PROD-49).
 *
 * D-PROD-319 (Etapa 5a): o id da tarefa nova é gerado no aparelho (UUID) e é definitivo; repetir a criação
 * (resposta perdida, app fechado no meio) devolve a mesma tarefa em vez de criar outra.
 */

import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';
import { eIdDoAparelho } from '@/lib/offline/idDoAparelho';

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

/**
 * D-PROD-319: o evento do histórico que a tela do mapa manda junto (Criação, Conclusão, Mudança de Status,
 * Registro…). O servidor grava o histórico na mesma transação; antes estes campos eram descartados aqui e o
 * histórico da tarefa feito pelo mapa nunca era gravado (o "Registro" mandava um corpo vazio e era recusado).
 */
const CAMPOS_DO_HISTORICO = Object.freeze(['historico_evento', 'historico_descricao', 'historico_data_evento']);

const CAMPOS_DE_ATUALIZACAO = Object.freeze([
  ...CAMPOS_DE_CRIACAO.filter((campo) => campo !== 'empresa_id'),
  ...CAMPOS_DO_HISTORICO,
  // D-PROD-335: as fotos que sobem depois (tiradas sem internet) são SOMADAS no servidor às que a tarefa já tem.
  'fotos_adicionar',
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
  list: () => nativeRequest(CAMINHO, { autenticado: true }, ctx('listLancamentos')),

  create: (dados) =>
    nativeRequest(
      CAMINHO,
      {
        method: 'POST',
        body: {
          ...corpoDeEnvio(dados, [...CAMPOS_DE_CRIACAO, ...CAMPOS_DO_HISTORICO]),
          ...(eIdDoAparelho(/** @type {any} */ (dados)?.id) ? { id: /** @type {any} */ (dados).id } : {}),
        },
        autenticado: true,
      },
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
  idDoAparelho: true,
});

// D-PROD-294: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/lancamentos-tarefa',
]);
