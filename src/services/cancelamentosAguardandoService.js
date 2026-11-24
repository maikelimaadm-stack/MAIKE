/**
 * D-PROD-298 — cancelamentos feitos sem internet que ainda não subiram: como as
 * telas devem mostrar enquanto isso. O lançamento do cocho cancelado some (e o
 * período que ele fechou volta a ficar aberto); a transferência cancelada some
 * do histórico do depósito (as duas pernas). Só visão: o servidor decide quando
 * o cancelamento chega (e pode recusar → "precisa de atenção").
 */

import { registrosAguardandoDoTipo } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_CANCELAMENTO_LANCAMENTO_COCHO, TIPO_CANCELAMENTO_TRANSFERENCIA } from '@/lib/offline/sincronizacao/tiposDeEnvio';

/** @param {string} tipo */
const payloadsAguardando = async (tipo) => {
  try {
    return (await registrosAguardandoDoTipo(tipo)).map((r) => /** @type {any} */ (r.payload));
  } catch {
    return [];
  }
};

/**
 * Tira os lançamentos com cancelamento esperando envio e reabre o período que
 * eles tinham fechado.
 * @param {any[]} eventos
 */
export const semLancamentosCanceladosAguardando = async (eventos) => {
  const ids = new Set((await payloadsAguardando(TIPO_CANCELAMENTO_LANCAMENTO_COCHO)).map((p) => p?.evento_id).filter(Boolean));
  if (!ids.size) return eventos;
  return eventos
    .filter((e) => !ids.has(e?.id))
    .map((e) => (e?.fechado_por_evento_id && ids.has(e.fechado_por_evento_id) ? { ...e, dias_periodo: null, _reabertoAguardando: true } : e));
};

/**
 * Marca como estornadas (somem do histórico do depósito) as duas pernas das
 * transferências com cancelamento esperando envio.
 * @param {any[]} movimentos
 */
export const comTransferenciasCanceladasAguardando = async (movimentos) => {
  const ids = new Set((await payloadsAguardando(TIPO_CANCELAMENTO_TRANSFERENCIA)).map((p) => p?.movimentacao_id).filter(Boolean));
  if (!ids.size) return movimentos;
  const lista = Array.isArray(movimentos) ? movimentos : [];
  const grupos = new Set(lista.filter((m) => ids.has(m?.id) && m?.movimentacao_grupo_id).map((m) => m.movimentacao_grupo_id));
  const cancelado = (/** @type {any} */ m) =>
    ids.has(m?.id) || ids.has(m?.movimento_pai_id) || ids.has(m?.movimento_filho_id) || (m?.movimentacao_grupo_id && grupos.has(m.movimentacao_grupo_id));
  return lista.map((m) => (cancelado(m) ? { ...m, status: 'Estornada', _cancelamentoAguardando: true } : m));
};
