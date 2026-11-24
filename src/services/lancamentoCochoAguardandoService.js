/**
 * D-PROD-296 — os lançamentos do cocho que ainda esperam envio, como as telas
 * os mostram: no formato do evento do servidor, com a marca `_aguardandoEnvio`
 * (e o período anterior já fechado localmente). Só leitura da fila do motor;
 * nada daqui vai ao servidor.
 */

import { registrosAguardandoDoTipo, operacaoDaReferencia } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_LANCAMENTO_COCHO } from '@/lib/offline/sincronizacao/tiposDeEnvio';

/**
 * Como o lançamento que ainda não subiu aparece nas telas.
 * @param {any} p payload
 * @param {string} operationId
 * @param {string} criadoEm
 */
export const lancamentoAguardandoComoEvento = (p, operationId, criadoEm) => ({
  ...p.evento,
  id: `aguardando:${operationId}`,
  movimentacao_estoque_id: null,
  dias_periodo: null,
  situacao: 'ativo',
  createdAt: criadoEm,
  created_date: criadoEm,
  _aguardandoEnvio: true,
  _operationId: operationId,
});

/**
 * Eventos do servidor + os lançamentos desta fazenda que esperam envio. O
 * lançamento que espera envio já mostra fechado (localmente) o período que ele
 * vai fechar. Falha ao ler a fila nunca derruba a lista do servidor.
 * @param {any[]} eventos
 * @param {string|null} empresaId
 * @param {string} [pontoId] só os deste cocho (a lista recebida já é só dele)
 */
export const comLancamentosAguardandoEnvio = async (eventos, empresaId, pontoId) => {
  let aguardando = [];
  try {
    aguardando = (await registrosAguardandoDoTipo(TIPO_LANCAMENTO_COCHO)).filter((r) => {
      const ev = /** @type {any} */ (r.payload)?.evento;
      return ev?.empresa_id === empresaId && (pontoId === undefined || ev?.ponto_suplementacao_id === pontoId);
    });
  } catch {
    return eventos;
  }
  if (!aguardando.length) return eventos;
  const fechadosLocalmente = new Map();
  for (const r of aguardando) {
    const p = /** @type {any} */ (r.payload);
    if (!p?.fechamento || !p.evento_anterior_id) continue;
    const ref = operacaoDaReferencia(p.evento_anterior_id);
    fechadosLocalmente.set(ref ? `aguardando:${ref}` : p.evento_anterior_id, p.fechamento.diasPeriodo);
  }
  const fechar = (/** @type {any} */ e) =>
    fechadosLocalmente.has(e.id) && (e.dias_periodo === null || e.dias_periodo === undefined)
      ? { ...e, dias_periodo: fechadosLocalmente.get(e.id), _fechamentoAguardando: true }
      : e;
  const novos = aguardando.map((r) => lancamentoAguardandoComoEvento(r.payload, r.operationId, r.criado_em));
  const todos = [...novos, ...eventos].map(fechar);
  return todos.sort((a, b) => {
    const da = String(a?.data_lancamento ?? '').slice(0, 10);
    const db = String(b?.data_lancamento ?? '').slice(0, 10);
    if (da !== db) return da < db ? 1 : -1;
    const ca = String(a?.createdAt ?? a?.created_date ?? '');
    const cb = String(b?.createdAt ?? b?.created_date ?? '');
    return ca < cb ? 1 : ca > cb ? -1 : 0;
  });
};
