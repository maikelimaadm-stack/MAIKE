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
  const sobra = Number(ultimoEvento.sobra_kg || 0);
  const fornecido = Number(ultimoEvento.quantidade_total_kg || 0);
  const totalDisponivel = fornecido + sobra;
  const consumoBase = Number(ultimoEvento.consumo_diario_grupo_kg || ultimoEvento.consumo_esperado_pv_kg || 0);
  const saldoEstimado = ultimoEvento.dias_periodo != null ? sobra : Math.max(0, totalDisponivel - consumoBase * diasDesdeUltimo);
  const percent = ponto.capacidade_cocho_kg > 0 ? clamp(saldoEstimado / Number(ponto.capacidade_cocho_kg || 0)) : clamp(saldoEstimado > 0 ? 1 : 0);

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