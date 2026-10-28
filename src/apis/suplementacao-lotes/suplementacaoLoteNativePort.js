/**
 * Porta nativa de SuplementacaoLote (P5.5).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'SuplementacaoLote';
const CAMINHO = '/suplementacao-lotes';
export const ENTIDADE_OFFLINE = 'SuplementacaoLote';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const operacoesNativas = Object.freeze({
  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? `?limit=${encodeURIComponent(String(limite))}` : '';
    return nativeRequest(`${CAMINHO}${qs}`, { autenticado: true }, ctx('listSuplementacaoLote'));
  },

  filter: async (criterio, ordenacao, limite) => {
    void ordenacao;
    const lista = await operacoesNativas.list(undefined, limite);
    const arr = Array.isArray(lista) ? lista : [];
    return arr.filter((item) =>
      Object.entries(criterio || {}).every(([campo, valor]) => item?.[campo] === valor)
    );
  },

  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createSuplementacaoLote')),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updateSuplementacaoLote')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteSuplementacaoLote')
    ),

  bulkCreate: (registros) =>
    nativeRequest(
      `${CAMINHO}/bulk`,
      { method: 'POST', body: { registros }, autenticado: true },
      ctx('bulkCreateSuplementacaoLote')
    ),
});

export const suplementacaoLotePort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
      tenantScoped: true,
    })
  : operacoesNativas;
