/**
 * Porta nativa de MovimentacaoMapa (P5.5).
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';
import {
  createOfflineEntityAdapter,
  offlineStorageDisponivel,
} from '@/lib/offline/offlineEntityRuntime';

const RESOURCE = 'MovimentacaoMapa';
const CAMINHO = '/movimentacoes-mapa';
export const ENTIDADE_OFFLINE = 'MovimentacaoMapa';

const ctx = (operation) => ({ operation, resource: RESOURCE });

const operacoesNativas = Object.freeze({
  list: (ordenacao, limite) => {
    void ordenacao;
    const qs = limite ? `?limit=${encodeURIComponent(String(limite))}` : '';
    return nativeRequest(`${CAMINHO}${qs}`, { autenticado: true }, ctx('listMovimentacaoMapa'));
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
    nativeRequest(CAMINHO, { method: 'POST', body: dados, autenticado: true }, ctx('createMovimentacaoMapa')),

  update: (id, dados) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: dados, autenticado: true },
      ctx('updateMovimentacaoMapa')
    ),

  delete: (id) =>
    nativeRequest(
      `${CAMINHO}/${encodeURIComponent(id)}`,
      { method: 'DELETE', autenticado: true },
      ctx('deleteMovimentacaoMapa')
    ),

});

/**
 * Histórico paginado (só leitura, D-PROD-94) — `GET /movimentacoes-mapa/historico`.
 * Resposta `{ items, next_cursor, has_more, total, limit }`. Fica FORA do
 * adaptador offline de propósito: é consulta online; o modo offline do
 * histórico lê o cache do mapa e diz que é cache.
 *
 * @param {{ empresaId: string, areaId?: string|null, loteIds?: string[], loteNomes?: string[],
 *   cursor?: string|null, limit?: number }} filtros
 */
export const listarHistoricoMovimentacoesMapaPagina = (filtros) => {
  const params = new URLSearchParams();
  params.set('empresa_id', filtros.empresaId);
  if (filtros.areaId) params.set('area_id', filtros.areaId);
  for (const id of filtros.loteIds ?? []) if (id) params.append('lote_ids', id);
  for (const nome of filtros.loteNomes ?? []) if (nome) params.append('lote_nomes', nome);
  if (Number.isInteger(filtros.limit) && filtros.limit > 0) params.set('limit', String(filtros.limit));
  if (typeof filtros.cursor === 'string' && filtros.cursor) params.set('cursor', filtros.cursor);
  return nativeRequest(`${CAMINHO}/historico?${params}`, { autenticado: true }, ctx('listarHistoricoMovimentacaoMapa'));
};

/**
 * Cancelamento e elegibilidade (R2A, D-PROD-95) — só online, fora da fila
 * offline: um cancelamento nunca é enfileirado para replay.
 */
export const cancelarMovimentacaoMapaNativa = (id, corpo) =>
  nativeRequest(
    `${CAMINHO}/${encodeURIComponent(id)}/cancelamento`,
    { method: 'POST', body: corpo, autenticado: true },
    ctx('cancelarMovimentacaoMapa')
  );

/** Comando atômico de manejo (R2A-R1): só online, fora da fila offline. */
export const executarManejoLoteNativo = (corpo) =>
  nativeRequest(`${CAMINHO}/comandos/manejo-lote`, { method: 'POST', body: corpo, autenticado: true }, ctx('executarManejoLote'));

export const elegibilidadeCancelamentoMovimentacaoMapaNativa = (id) =>
  nativeRequest(`${CAMINHO}/${encodeURIComponent(id)}/elegibilidade-cancelamento`, { autenticado: true }, ctx('elegibilidadeCancelamentoMovimentacaoMapa'));

export const movimentacaoMapaPort = offlineStorageDisponivel()
  ? createOfflineEntityAdapter({
      entityName: ENTIDADE_OFFLINE,
      operations: operacoesNativas,
      enabled: true,
      tenantScoped: true,
    })
  : operacoesNativas;
