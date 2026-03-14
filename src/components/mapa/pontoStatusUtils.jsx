import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value || 0));

const polarToCartesian = (cx, cy, radius, angleInDegrees) => {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: cx + (radius * Math.cos(angleInRadians)),
    y: cy + (radius * Math.sin(angleInRadians)),
  };
};

const describeArc = (cx, cy, radius, startAngle, endAngle) => {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return ["M", start.x, start.y, "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(" ");
};

export function buildProgressIconUrl(baseIconUrl, percent = 0, size = 64) {
  const progress = clamp(percent);
  const startAngle = 0;
  const endAngle = Math.max(3.6, progress * 360);
  const arcPath = describeArc(32, 32, 12, startAngle, endAngle);
  const color = progress > 0.66 ? "#10b981" : progress > 0.33 ? "#f59e0b" : "#ef4444";
  const percentageText = `${Math.round(progress * 100)}`;

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
      <image href="${baseIconUrl}" x="0" y="0" width="64" height="64" preserveAspectRatio="xMidYMid meet" />
      <circle cx="32" cy="32" r="13" fill="rgba(255,255,255,0.92)" />
      <circle cx="32" cy="32" r="11" fill="none" stroke="rgba(15,23,42,0.16)" stroke-width="4" />
      <path d="${arcPath}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" />
      <text x="32" y="35" text-anchor="middle" font-size="9" font-weight="700" fill="#0f172a">${percentageText}</text>
    </svg>
  `;

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

  const percent = necessidadeEstimada > 0 ? clamp(saldoAtual / necessidadeEstimada) : clamp(saldoAtual > 0 ? 1 : 0);

  return {
    percent,
    saldoAtual,
    necessidadeEstimada,
    badgeLabel: `${Math.round(percent * 100)}%`,
    helperLabel: necessidadeEstimada > 0
      ? `${saldoAtual.toFixed(1)} kg de ${necessidadeEstimada.toFixed(1)} kg estimados`
      : `${saldoAtual.toFixed(1)} kg disponíveis`,
    latestRecord: ultimoRegistro,
  };
}