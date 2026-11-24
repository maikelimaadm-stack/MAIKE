/**
 * Porta nativa da Leitura de cocho (D-PROD-205), `/leituras-cocho`.
 *
 * A criação passa pela fila offline (o vaqueiro lê o cocho no pasto, muitas vezes
 * sem sinal): offline, a leitura entra no cache com id `offline_…` e vai ao
 * servidor no replay. O servidor tem o corpo FECHADO; por isso o `create` envia
 * só os campos da leitura (o replay acrescenta `created_date`, `updated_date`…).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';
import { registrarLeiturasOffline } from '@/lib/offline/leiturasOffline';

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

// D-PROD-289: leituras que as telas deste módulo fazem ao abrir — baixadas antes
// de o app abrir pela primeira vez (o caminho fica aqui, na porta do módulo).
registrarLeiturasOffline([
  '/leituras-cocho',
]);
