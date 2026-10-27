/**
 * Porta nativa de EstoqueLoteNota (P5.4).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'EstoqueLoteNota';
const CAMINHO = '/estoque-lotes-nota';
export const ENTIDADE_OFFLINE = 'EstoqueLoteNota';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const queryDeFiltro = (criterio) => {
  if (!criterio || typeof criterio !== 'object') return '';
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(criterio)) {
    if (valor === undefined || valor === null || valor === '') continue;
    params.set(chave, String(valor));
  }
  const texto = params.toString();
  return texto ? `?${texto}` : '';
};

const operacoesNativas = Object.freeze({
  list: (ordenacao) => {
    void ordenacao;
    return nativeRequest(CAMINHO, { autenticado: true }, ctx('listEstoqueLoteNota'));
  },
  filter: (criterio) =>
    nativeRequest(`${CAMINHO}${queryDeFiltro(criterio)}`, { autenticado: true }, ctx('filterEstoqueLoteNota')),
  create: (dados) =>
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createEstoqueLoteNota')),
  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updateEstoqueLoteNota')
    ),
  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteEstoqueLoteNota')
    ),
});

export const estoqueLoteNotaPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
    })
  : operacoesNativas;
