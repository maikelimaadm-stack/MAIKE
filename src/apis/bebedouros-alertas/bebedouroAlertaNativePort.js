/**
 * Porta nativa de BebedouroAlerta (P5.5).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'BebedouroAlerta';
const CAMINHO = '/bebedouros-alertas';


const ctx = (operation) => ({ operation, resource: RESOURCE });

const operacoesNativas = Object.freeze({
  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? `?limit=${encodeURIComponent(String(limite))}` : '';
    return nativeRequest(`${CAMINHO}${qs}`, { autenticado: true }, ctx('listBebedouroAlerta'));
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
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createBebedouroAlerta')),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updateBebedouroAlerta')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteBebedouroAlerta')
    ),

});

export const bebedouroAlertaPort = operacoesNativas;
