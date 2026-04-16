import { normalizeText } from "../suplementacao/estoqueSuplementacaoUtils";
import { formatKg } from "../suplementacao/formatters";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value || 0));
const parseDateLocal = (value) => {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [ano, mes, dia] = value.split("-").map(Number);
    return new Date(ano, mes - 1, dia);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const startOfLocalDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const diffLocalDays = (start, end = new Date()) => {
  const inicio = parseDateLocal(start);
  if (!inicio) return 0;
  const inicioDia = startOfLocalDay(inicio);
  const fimDia = startOfLocalDay(end);
  return Math.max(0, Math.floor((fimDia - inicioDia) / 86400000));
};

export function buildProgressIconUrl(baseIconUrl) {
  return baseIconUrl;
}

export function getCochoIndicator(ponto, eventos = []) {
  let ultimoEvento = null;
  for (const evento of eventos) {
    if (evento.ponto_suplementacao_id !== ponto.id) continue;
    if (!ultimoEvento || new Date(evento.data_lancamento) > new Date(ultimoEvento.data_lancamento)) {
      ultimoEvento = evento;
    }
  }

  if (!ultimoEvento) {
    return {
      percent: 0,
      badgeLabel: "Sem lançamento",
      helperLabel: "Nenhum lançamento registrado",
      latestRecord: null,
    };
  }

  const diasDesdeUltimo = diffLocalDays(ultimoEvento.data_lancamento);
  const sobra = Number(ultimoEvento.sobra_kg || 0);
  const fornecido = Number(ultimoEvento.quantidade_total_kg || 0);
  const totalDisponivel = fornecido + sobra;
  // Fonte de consumo diário: consumo_esperado_pv_kg (calculado por %PV no momento do lançamento)
  // NUNCA usar consumo_diario_grupo_kg pois é consumo do período fechado, não diário
  const consumoBase = Number(ultimoEvento.consumo_esperado_pv_kg || 0);

  let saldoEstimado;
  if (ultimoEvento.dias_periodo != null) {
    saldoEstimado = sobra;
  } else if (consumoBase > 0) {
    saldoEstimado = Math.max(0, totalDisponivel - consumoBase * diasDesdeUltimo);
  } else {
    // Sem %PV configurado: não desconta, mostra total fornecido
    saldoEstimado = totalDisponivel;
  }

  const percent = totalDisponivel > 0 ? clamp(saldoEstimado / totalDisponivel) : 0;

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
    const areaIds = Array.isArray(cocho.area_vinculada_ids) && cocho.area_vinculada_ids.length > 0
      ? cocho.area_vinculada_ids
      : (cocho.area_vinculada_id ? [cocho.area_vinculada_id] : []);
    const cabecas = lotes
      .filter((lote) => areaIds.includes(lote.area_atual_id) && lote.status === "Ativo")
      .reduce((soma, lote) => soma + (lote.quantidade_cabecas || 0), 0);
    const consumo = (cocho.consumo_ideal_por_cabeca_kg || 0) * cabecas;
    return total + consumo;
  }, 0);

  const ultimoRegistro = movimentacoes
    .filter((item) => item.local_estoque_origem === deposito.local_estoque_id || item.local_estoque_destino === deposito.local_estoque_id)
    .sort((a, b) => new Date(b.data_movimentacao) - new Date(a.data_movimentacao))[0] || null;

  const estoqueMinimo = Number(deposito.estoque_minimo_kg || 0);
  const capacidadeDeposito = Number(deposito.capacidade_cocho_kg || 0);
  const necessidadeReposicao = capacidadeDeposito > 0 ? Math.max(capacidadeDeposito - saldoAtual, 0) : 0;
  const percent = capacidadeDeposito > 0 ? clamp(saldoAtual / capacidadeDeposito) : clamp(saldoAtual > 0 ? 1 : 0);
  const isCritical = estoqueMinimo > 0 && saldoAtual <= estoqueMinimo;

  return {
    percent,
    saldoAtual,
    estoqueMinimo,
    capacidadeDeposito,
    necessidadeEstimada,
    necessidadeReposicao,
    isCritical,
    badgeLabel: `${Math.round(percent * 100)}%`,
    helperLabel: capacidadeDeposito > 0
      ? `${formatKg(saldoAtual)} de ${formatKg(capacidadeDeposito)} de capacidade`
      : `${formatKg(saldoAtual)} disponíveis`,
    latestRecord: ultimoRegistro,
  };
}