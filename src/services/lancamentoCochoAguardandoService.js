/**
 * D-PROD-296 — os lançamentos do cocho que ainda esperam envio, como as telas
 * os mostram: no formato do evento do servidor, com a marca `_aguardandoEnvio`
 * (e o período anterior já fechado localmente). Só leitura da fila do motor;
 * nada daqui vai ao servidor.
 */

import { mostrarComoAguardando, registrosDoAparelhoDoTipo, operacaoDaReferencia } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_LANCAMENTO_COCHO } from '@/lib/offline/sincronizacao/tiposDeEnvio';
import { semLancamentosCanceladosAguardando } from '@/services/cancelamentosAguardandoService';

/**
 * O id, como as telas o mostram, do lançamento anterior que um payload cita:
 * o do servidor, ou `aguardando:<código>` quando cita um que ainda não subiu.
 * @param {unknown} eventoAnteriorId
 * @returns {string|null}
 */
export const idDoAnteriorCitado = (eventoAnteriorId) => {
  if (!eventoAnteriorId) return null;
  const ref = operacaoDaReferencia(eventoAnteriorId);
  return ref ? `aguardando:${ref}` : String(eventoAnteriorId);
};

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
export const comLancamentosAguardandoEnvio = async (eventos, empresaId, pontoId) =>
  // D-PROD-298: e sem os lançamentos com cancelamento esperando envio.
  semLancamentosCanceladosAguardando(await comLancamentosNovosAguardando(eventos, empresaId, pontoId));

/**
 * @param {any[]} eventos
 * @param {string|null} empresaId
 * @param {string} [pontoId]
 */
const comLancamentosNovosAguardando = async (eventos, empresaId, pontoId) => {
  let doAparelho = [];
  try {
    doAparelho = (await registrosDoAparelhoDoTipo(TIPO_LANCAMENTO_COCHO)).filter((r) => {
      const ev = /** @type {any} */ (r.payload)?.evento;
      return ev?.empresa_id === empresaId && (pontoId === undefined || ev?.ponto_suplementacao_id === pontoId);
    });
  } catch {
    return eventos;
  }
  if (!doAparelho.length) return eventos;
  // D-PROD-318: o lançamento confirmado há pouco aparece com o evento que o servidor devolveu (id real) até a lista do
  // servidor na tela trazê-lo — sem isso ele sumia entre a confirmação e a próxima leitura da lista.
  const noServidor = new Set((Array.isArray(eventos) ? eventos : []).map((e) => e?.id).filter(Boolean));
  const confirmados = doAparelho
    .filter((r) => r.estado === 'enviado')
    .map((r) => /** @type {any} */ (r.resultado)?.evento)
    .filter((ev) => ev?.id && !noServidor.has(ev.id) && ev.situacao !== 'cancelado')
    .map((ev) => ({ ...ev, _confirmadoAgora: true }));
  // O recusado ("precisa de atenção") continua na lista do cocho, como antes (para corrigir ou excluir).
  // D-PROD-335: o que tentou subir sem receber a resposta (sinal fraco) continua na lista até o servidor mostrar que o
  // tem — pelo código da operação, que o servidor grava no lançamento. Antes ele sumia sempre que o celular dizia ter
  // internet, e a pessoa, sem ver o lançamento, lançava de novo (dois no servidor).
  const codigosNoServidor = new Set((Array.isArray(eventos) ? eventos : []).map((e) => e?.operation_id).filter(Boolean));
  const aguardando = doAparelho.filter(
    (r) =>
      r.estado === 'atencao' ||
      mostrarComoAguardando(r) ||
      (r.estado !== 'enviado' && r.tentado && !codigosNoServidor.has(r.operationId))
  );
  if (!aguardando.length && !confirmados.length) return eventos;
  const fechadosLocalmente = new Map();
  for (const r of aguardando) {
    const p = /** @type {any} */ (r.payload);
    if (!p?.fechamento || !p.evento_anterior_id) continue;
    const ref = operacaoDaReferencia(p.evento_anterior_id);
    fechadosLocalmente.set(ref ? `aguardando:${ref}` : p.evento_anterior_id, { dias: p.fechamento.diasPeriodo, por: r.operationId });
  }
  const fechar = (/** @type {any} */ e) =>
    fechadosLocalmente.has(e.id) && (e.dias_periodo === null || e.dias_periodo === undefined)
      ? { ...e, dias_periodo: fechadosLocalmente.get(e.id).dias, _fechamentoAguardando: true, _fechadoPorAguardando: fechadosLocalmente.get(e.id).por }
      : e;
  const novos = aguardando.map((r) => lancamentoAguardandoComoEvento(r.payload, r.operationId, r.criado_em));
  const todos = [...novos, ...confirmados, ...eventos].map(fechar);
  return todos.sort((a, b) => {
    const da = String(a?.data_lancamento ?? '').slice(0, 10);
    const db = String(b?.data_lancamento ?? '').slice(0, 10);
    if (da !== db) return da < db ? 1 : -1;
    const ca = String(a?.createdAt ?? a?.created_date ?? '');
    const cb = String(b?.createdAt ?? b?.created_date ?? '');
    return ca < cb ? 1 : ca > cb ? -1 : 0;
  });
};
