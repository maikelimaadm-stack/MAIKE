/**
 * D-PROD-301 — o histórico do depósito com o que foi lançado sem internet e
 * ainda espera envio: a transferência (as duas pernas) e a baixa do lançamento
 * do cocho aparecem como movimentações, marcadas `_aguardandoEnvio`.
 *
 * Só visão, aplicada na leitura do cache do mapa (nunca gravada). Entra só o
 * que NUNCA tentou subir: o que já tentou pode estar no servidor, e a lista do
 * servidor já mostraria (aparecer duas vezes seria pior). Quando o registro
 * chega, a movimentação de verdade toma o lugar desta.
 */

import { registrosAguardandoDoTipo } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_LANCAMENTO_COCHO, TIPO_TRANSFERENCIA_DEPOSITO } from '@/lib/offline/sincronizacao/tiposDeEnvio';

/** Prefixo das movimentações que ainda não estão no servidor (o cache nunca as grava). */
export const PREFIXO_AGUARDANDO = 'aguardando:';

/** @param {string} tipo */
const nuncaTentados = async (tipo) => {
  try {
    return (await registrosAguardandoDoTipo(tipo)).filter((r) => !r.tentado);
  } catch {
    return [];
  }
};

/** As observações sem o rateio FIFO que o envio acrescenta. @param {unknown} obs */
const semRateio = (obs) =>
  String(obs ?? '').split('\n[RATEIO_FIFO]')[0].replace(/^\[RATEIO_FIFO\].*$/s, '').trim();

/** @param {any} p @param {{ operationId: string, criado_em: string, estado: string }} r */
const base = (p, r) => ({
  empresa_id: p?.empresa_id ?? null,
  produto_id: p?.produto_id ?? null,
  produto_nome: p?.produto_nome ?? null,
  quantidade: Number(p?.quantidade) || 0,
  unidade_medida: 'KG',
  // D-PROD-313: a unidade em que foi digitada (D-PROD-310) aparece também no que espera envio (o fator só o servidor grava).
  unidade_lancamento: typeof p?.unidade_lancamento === 'string' ? p.unidade_lancamento : null,
  quantidade_lancamento: typeof p?.quantidade_lancamento === 'string' ? p.quantidade_lancamento : null,
  local_estoque_origem: p?.local_origem_id ?? null,
  local_origem: p?.local_origem_nome ?? null,
  data_movimentacao: p?.data_movimentacao || String(r.criado_em || '').slice(0, 10) || null,
  created_date: r.criado_em,
  observacoes: semRateio(p?.observacoes),
  status: 'Ativa',
  origem_sistema: 'aguardando_envio',
  _aguardandoEnvio: true,
  _operationId: r.operationId,
});

/**
 * Movimentações desta sessão que esperam envio, como o histórico do depósito lê.
 * @param {string|null} [empresaId]
 * @returns {Promise<any[]>}
 */
export const movimentacoesAguardandoEnvio = async (empresaId = null) => {
  const [transferencias, lancamentos] = await Promise.all([
    nuncaTentados(TIPO_TRANSFERENCIA_DEPOSITO),
    nuncaTentados(TIPO_LANCAMENTO_COCHO),
  ]);
  const lista = [];
  for (const r of transferencias) {
    const p = /** @type {any} */ (r.payload);
    const comum = {
      ...base(p, r),
      local_estoque_destino: p?.local_destino_id ?? null,
      local_destino: p?.local_destino_nome ?? null,
      movimentacao_grupo_id: `${PREFIXO_AGUARDANDO}${r.operationId}`,
    };
    lista.push(
      { ...comum, id: `${PREFIXO_AGUARDANDO}${r.operationId}:saida`, tipo_movimentacao: 'Saída', tipo_detalhado: 'transferencia_enviada' },
      { ...comum, id: `${PREFIXO_AGUARDANDO}${r.operationId}:entrada`, tipo_movimentacao: 'Entrada', tipo_detalhado: 'transferencia_recebida' }
    );
  }
  for (const r of lancamentos) {
    const p = /** @type {any} */ (r.payload);
    // Sem baixa (cocho sem depósito) ou baixa já feita no servidor: nada a mostrar aqui.
    if (!p?.saida || r.progresso?.saida_feita) continue;
    lista.push({
      ...base(p.saida, r),
      id: `${PREFIXO_AGUARDANDO}${r.operationId}:baixa`,
      tipo_movimentacao: 'Saída',
      tipo_detalhado: 'suplementacao',
      local_estoque_destino: null,
      local_destino: null,
      ponto_suplementacao_id: p.saida.ponto_suplementacao_id ?? p?.evento?.ponto_suplementacao_id ?? null,
      area_vinculada_nome: p.saida.area_nome ?? null,
    });
  }
  return lista
    .filter((m) => !empresaId || m.empresa_id === empresaId)
    .sort((a, b) => String(b.created_date ?? '').localeCompare(String(a.created_date ?? '')));
};
