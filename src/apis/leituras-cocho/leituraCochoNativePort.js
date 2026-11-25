/**
 * Porta nativa da Leitura de cocho (D-PROD-205), `/leituras-cocho`.
 *
 * A criação passa pela fila offline (o vaqueiro lê o cocho no pasto, muitas vezes
 * sem sinal): offline, a leitura entra no cache com id `offline_…` e vai ao
 * servidor no replay. O servidor tem o corpo FECHADO; por isso o `create` envia
 * só os campos da leitura (o replay acrescenta `created_date`, `updated_date`…).
 */
import { registrarListaIncremental, ordemPorDiaDaLeitura } from '@/lib/offline/sincronizacaoIncremental';
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';
import { registrarTipoDeEnvio } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_LEITURA_COCHO } from '@/lib/offline/sincronizacao/tiposDeEnvio';

const RESOURCE = 'LeituraCocho';
const CAMINHO = '/leituras-cocho';
export const ENTIDADE_OFFLINE = 'LeituraCocho';

/** Os únicos campos que o servidor aceita no POST. */
export const CAMPOS_DA_LEITURA = Object.freeze(['empresa_id', 'ponto_suplementacao_id', 'data_leitura', 'escore', 'acesso', 'estrutura', 'observacoes']);

/** @param {Record<string, unknown>} dados */
export const corpoDaLeitura = (dados) =>
  Object.fromEntries(CAMPOS_DA_LEITURA.filter((k) => dados?.[k] !== undefined).map((k) => [k, dados[k]]));

/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

const operacoesNativas = Object.freeze({
  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? `?limit=${encodeURIComponent(String(limite))}` : '';
    return nativeRequest(`${CAMINHO}${qs}`, { autenticado: true }, ctx('listLeituraCocho'));
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: corpoDaLeitura(dados), autenticado: true }, ctx('createLeituraCocho')),

  delete: (id) =>
    nativeRequest(`${CAMINHO}/${encodeURIComponent(id)}`, { method: 'DELETE', autenticado: true }, ctx('deleteLeituraCocho')),
});

export const leituraCochoPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
      tenantScoped: true,
    })
  : operacoesNativas;

// D-PROD-294: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/leituras-cocho',
]);

// D-PROD-309: a lista inteira (sem filtros) sincroniza só o que mudou desde a última vez
// (`nativeRequest` usa `${CAMINHO}/mudancas` e junta com a cópia do aparelho).
registrarListaIncremental(CAMINHO, { mudancas: `${CAMINHO}/mudancas`, ordem: ordemPorDiaDaLeitura });

/**
 * D-PROD-296 — a leitura pelo motor de sincronização: com internet vai direto;
 * sem internet fica na fila do aparelho e sai depois, com o código único
 * (`operation_id`) que o servidor deduplica. Leituras do mesmo cocho saem na
 * ordem em que foram feitas.
 */
registrarTipoDeEnvio({
  tipo: TIPO_LEITURA_COCHO,
  versao: 1,
  offline: true,
  recursos: (p) => [`cocho:${p?.ponto_suplementacao_id ?? ''}`],
  rotulo: (p) => `Leitura de cocho (${String(p?.data_leitura ?? '').split('-').reverse().join('/')})`,
  atualiza: ['leiturasCocho'],
  enviar: (p, { operationId }) =>
    nativeRequest(
      CAMINHO,
      { method: 'POST', body: { ...corpoDaLeitura(p), operation_id: operationId }, autenticado: true },
      ctx('createLeituraCocho')
    ),
});

