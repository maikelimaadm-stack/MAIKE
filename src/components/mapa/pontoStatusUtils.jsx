import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { formatKg } from "../suplementacao/formatters";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value || 0));

export function buildProgressIconUrl(baseIconUrl) {
  return baseIconUrl;
}

export function getCochoIndicator(ponto, eventos = []) {
  const ultimoEvento = eventos
    .filter((evento) => evento.ponto_suplementacao_id === ponto.id)
    .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0] || null;

  if (!ultimoEvento) {
    return {
      percent: 0,
      badgeLabel: "Sem lançamento",
      helperLabel: "Nenhum lançamento registrado",
      latestRecord: null,
    };
  }

  const diasDesdeUltimo = Math.max(0, Math.floor((Date.now() - new Date(ultimoEvento.data_lancamento).getTime()) / 86400000));
  const frequencia = ponto.frequencia_esperada_dias || 7;
  const percent = clamp(1 - (diasDesdeUltimo / Math.max(1, frequencia)));

  return {
    percent,
    badgeLabel: `${Math.round(percent * 100)}%`,
    helperLabel: `${diasDesdeUltimo} dia(s) desde o último lançamento`,
    latestRecord: ultimoEvento,
  };
}

export function getDepositoIndicator(deposito, cochos = [], lotes = [], estoqueLotes = [], movimentacoes = []) {
  const cochosRelacionados = cochos.filter((ponto) => normalizeText(ponto.categoria_ponto || "COCHO") === "COCHO" && ponto.deposito_origem_id === deposito.id);
  const saldoAtual = estoqueLotes
    .filter((lote) => lote.local_estoque_id === deposito.local_estoque_id && (lote.quantidade_disponivel || 0) > 0)
    .reduce((total, lote) => total + (lote.quantidade_disponivel || 0), 0);

  const necessidadeEstimada = cochosRelacionados.reduce((total, cocho) => {
    const cabecas = lotes
      .filter((lote) => lote.area_atual_id === cocho.area_vinculada_id && lote.status === "Ativo")
      .reduce((soma, lote) => soma + (lote.quantidade_cabecas || 0), 0);
    const consumo = (cocho.consumo_ideal_por_cabeca_kg || 0) * cabecas * (cocho.frequencia_esperada_dias || 1);
    return total + consumo;
  }, 0);

  const ultimoRegistro = movimentacoes
    .filter((item) => item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id)
    .sort((a, b) => new Date(b.data_movimentacao) - new Date(a.data_movimentacao))[0] || null;

  const estoqueMinimo = Number(deposito.estoque_minimo_kg || 0);
  const necessidadeReposicao = estoqueMinimo > 0 ? Math.max(estoqueMinimo - saldoAtual, 0) : 0;
  const percent = estoqueMinimo > 0 ? clamp(saldoAtual / estoqueMinimo) : clamp(saldoAtual > 0 ? 1 : 0);
  const isCritical = estoqueMinimo > 0 && saldoAtual <= estoqueMinimo;

  return {
    percent,
    saldoAtual,
    estoqueMinimo,
    necessidadeEstimada,
    necessidadeReposicao,
    isCritical,
    badgeLabel: `${Math.round(percent * 100)}%`,
    helperLabel: estoqueMinimo > 0
      ? `${formatKg(saldoAtual)} de ${formatKg(estoqueMinimo)} mínimos`
      : `${formatKg(saldoAtual)} disponíveis`,
    latestRecord: ultimoRegistro,
  };
}