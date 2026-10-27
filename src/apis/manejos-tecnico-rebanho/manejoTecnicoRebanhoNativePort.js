/**
 * Porta nativa de ManejoTecnicoRebanho (P5.5).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'ManejoTecnicoRebanho';
const CAMINHO = '/manejos-tecnico-rebanho';
export const ENTIDADE_OFFLINE = 'ManejoTecnicoRebanho';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const operacoesNativas = Object.freeze({
  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? `?limit=${encodeURIComponent(String(limite))}` : '';
    return nativeRequest(`${CAMINHO}${qs}`, { autenticado: true }, ctx('listManejoTecnicoRebanho'));
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
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createManejoTecnicoRebanho')),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updateManejoTecnicoRebanho')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteManejoTecnicoRebanho')
    ),

});

export const manejoTecnicoRebanhoPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
    })
  : operacoesNativas;
