import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { formatKg } from "../suplementacao/formatters";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value || 0));

export function buildProgressIconUrl(percent = 0, color = "#10b981") {
  const nivel = Math.max(0, Math.min(100, Math.round((percent || 0) * 100)));
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="6" y="6" width="52" height="52" rx="14" fill="#ffffff" stroke="#cbd5e1" stroke-width="2" />
      <rect x="12" y="${58 - (nivel * 0.4)}" width="40" height="${Math.max(8, nivel * 0.4)}" rx="10" fill="${color}" opacity="0.28" />
      <text x="32" y="37" text-anchor="middle" font-size="15" font-weight="700" fill="#0f172a">${nivel}%</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
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
    indicatorColor: percent <= 0.33 ? "#ef4444" : percent <= 0.66 ? "#f59e0b" : "#10b981",
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

  const capacidade = deposito.capacidade_kg || deposito.capacidade_cocho_kg || necessidadeEstimada || 0;
  const estoqueMinimo = deposito.estoque_minimo_kg || 0;
  const percent = capacidade > 0 ? clamp(saldoAtual / capacidade) : clamp(saldoAtual > 0 ? 1 : 0);
  const indicadorCritico = estoqueMinimo > 0 && saldoAtual <= estoqueMinimo;
  const indicadorAtencao = !indicadorCritico && estoqueMinimo > 0 && saldoAtual <= (estoqueMinimo * 1.3);

  return {
    percent,
    indicatorColor: indicadorCritico ? "#ef4444" : indicadorAtencao ? "#f59e0b" : "#10b981",
    saldoAtual,
    necessidadeEstimada,
    capacidade,
    estoqueMinimo,
    badgeLabel: `${Math.round(percent * 100)}%`,
    helperLabel: necessidadeEstimada > 0
      ? `${formatKg(saldoAtual)} de ${formatKg(necessidadeEstimada)} estimados`
      : `${formatKg(saldoAtual)} disponíveis`,
    latestRecord: ultimoRegistro,
  };
}