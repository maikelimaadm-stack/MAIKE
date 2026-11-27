/**
 * D-PROD-301 — o histórico do depósito com o que foi lançado sem internet e
 * ainda espera envio: a transferência (as duas pernas) e a baixa do lançamento
 * do cocho aparecem como movimentações, marcadas `_aguardandoEnvio`.
 *
 * Só visão, aplicada na leitura do cache do mapa (nunca gravada).
 *
 * D-PROD-318 (Etapa 4, a tela nunca "pisca"): o registro do aparelho casa com o do servidor PELO ID, e não mais
 * pelo estado da fila. Antes, o que já tinha tentado subir sumia do histórico (para não aparecer duas vezes) e o que
 * acabava de ser confirmado sumia até a lista ser relida: um buraco. Agora:
 *  - nunca tentou: aparece como "aguardando envio";
 *  - confirmado há pouco: aparece com a movimentação que o servidor devolveu (id real) até a lista do servidor
 *    trazê-la (`comMovimentacoesDoAparelho` não repete o que a lista já tem);
 *  - baixa do cocho já feita no servidor (o lançamento ainda espera): aparece com o id real da baixa;
 *  - tentou e não teve resposta: sem internet aparece (a lista guardada é de antes, não pode tê-lo); com
 *    internet não, a próxima passada confirma em segundos (e a lista do servidor pode já tê-lo, sem como casar).
 */

import { mostrarComoAguardando as mostraComoAguardando, registrosDoAparelhoDoTipo } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_LANCAMENTO_COCHO, TIPO_TRANSFERENCIA_DEPOSITO } from '@/lib/offline/sincronizacao/tiposDeEnvio';

/** D-PROD-342: no máximo uma confirmação pedida a cada tanto (o histórico é relido muitas vezes). */
const INTERVALO_DA_CONFIRMACAO_MS = 20_000;
let confirmacaoPedidaEm = 0;
/** Pede uma passada já (sob demanda: o histórico não carrega a sincronização inteira). */
const pedirConfirmacao = () => {
  const agora = Date.now();
  if (agora - confirmacaoPedidaEm < INTERVALO_DA_CONFIRMACAO_MS) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  confirmacaoPedidaEm = agora;
  import('@/lib/offline/sincronizacao/gatilhosDeSincronizacao')
    .then((m) => m.sincronizarTudo({ jaEmVoltaDaRede: true }))
    .catch(() => undefined);
};

/** Prefixo das movimentações que ainda não estão no servidor (o cache nunca as grava). */
export const PREFIXO_AGUARDANDO = 'aguardando:';

/** @param {string} tipo */
const doAparelho = async (tipo) => {
  try {
    return (await registrosDoAparelhoDoTipo(tipo)).filter((r) => r.estado !== 'atencao');
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
    doAparelho(TIPO_TRANSFERENCIA_DEPOSITO),
    doAparelho(TIPO_LANCAMENTO_COCHO),
  ]);
  const lista = [];
  for (const r of transferencias) {
    const p = /** @type {any} */ (r.payload);
    if (r.estado === 'enviado') {
      // Confirmada: as duas pernas que o servidor devolveu (ids reais).
      const res = /** @type {any} */ (r.resultado);
      for (const m of [res?.movimentacao_saida, res?.movimentacao_entrada]) if (m?.id) lista.push({ ...m, _confirmadoAgora: true });
      continue;
    }
    if (r.estado === 'atencao') continue;
    // D-PROD-342: a que tentou subir sem receber a resposta (sinal fraco), com internet, não aparece (a lista do
    // servidor pode já tê-la, sem como casar — apareceria duas vezes), mas a confirmação é pedida NA HORA: o servidor
    // deduplica pelo código da operação e devolve a que já fez, que volta ao histórico com os ids reais em segundos.
    // Antes ela ficava fora até a passada seguinte (até 1 min) e a pessoa transferia de novo.
    if (!mostraComoAguardando(r)) {
      pedirConfirmacao();
      continue;
    }
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
    if (r.estado === 'enviado') {
      // Confirmado: a baixa que o servidor devolveu (id real).
      const m = /** @type {any} */ (r.resultado)?.movimentacao;
      if (m?.id) lista.push({ ...m, _confirmadoAgora: true });
      continue;
    }
    // Sem baixa (cocho sem depósito): nada a mostrar aqui.
    if (!p?.saida) continue;
    const feita = r.progresso?.saida_feita;
    if (feita?.movimentacao_id) {
      // A baixa já está no servidor (o lançamento ainda espera): com o id real, para casar com a lista.
      lista.push({
        ...base(p.saida, r),
        id: feita.movimentacao_id,
        tipo_movimentacao: 'Saída',
        tipo_detalhado: 'suplementacao',
        local_estoque_destino: null,
        local_destino: null,
        ponto_suplementacao_id: p.saida.ponto_suplementacao_id ?? p?.evento?.ponto_suplementacao_id ?? null,
        area_vinculada_nome: p.saida.area_nome ?? null,
        origem_sistema: 'suplementacao',
        _aguardandoEnvio: false,
        _baixaFeita: true,
      });
      continue;
    }
    if (r.estado === 'atencao') continue;
    // D-PROD-342: idem para a baixa do cocho que tentou subir sem resposta.
    if (!mostraComoAguardando(r)) {
      pedirConfirmacao();
      continue;
    }
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

/**
 * D-PROD-318: a lista do servidor com o que o aparelho sabe e ela ainda não traz — sem repetir (casa pelo id).
 * @param {any[]} itens a lista do servidor (cópia do aparelho)
 * @param {string|null} [empresaId]
 */
export const comMovimentacoesDoAparelho = async (itens, empresaId = null) => {
  const doServidor = Array.isArray(itens) ? itens : [];
  const ids = new Set(doServidor.map((m) => m?.id).filter(Boolean));
  const extras = (await movimentacoesAguardandoEnvio(empresaId)).filter((m) => !ids.has(m.id));
  return [...extras, ...doServidor];
};
