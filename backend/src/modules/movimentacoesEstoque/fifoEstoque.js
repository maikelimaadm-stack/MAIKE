/**
 * Rateio FIFO puro — espelho de `estoqueSuplementacaoUtils` no servidor (ESTAB-P0-01).
 */

/** @param {unknown} valor */
export const parseNumero = (valor) => {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
};

/** @param {Record<string, unknown>} lote */
const dataFifo = (lote) => {
  const bruto = lote.data_documento ?? lote.createdAt ?? lote.created_date;
  const d = bruto instanceof Date ? bruto : new Date(String(bruto));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * @param {{ lotesNota: Array<Record<string, unknown>>; produtoId: string; localEstoqueId: string; quantidade: unknown }} params
 */
export const calcularRateioFifo = (params) => {
  const { lotesNota, produtoId, localEstoqueId, quantidade } = params;
  const quantidadeSolicitada = parseNumero(quantidade);
  const lotesElegiveis = (lotesNota || []).filter(
    (lote) =>
      lote.produto_id === produtoId &&
      lote.local_estoque_id === localEstoqueId &&
      parseNumero(lote.quantidade_disponivel) > 0
  );

  if (lotesElegiveis.some((lote) => !dataFifo(lote))) {
    return {
      sucesso: false,
      erro: 'Existem lotes de estoque sem data válida para aplicar o FIFO com segurança.',
      rateio: [],
      custoMedioPonderado: 0,
      valorTotal: 0,
    };
  }

  const lotesOrdenados = [...lotesElegiveis].sort((a, b) => {
    const dateA = dataFifo(a);
    const dateB = dataFifo(b);
    if (!dateA || !dateB) return 0;
    if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
    return String(a.id).localeCompare(String(b.id));
  });

  const saldoTotal = lotesOrdenados.reduce((total, lote) => total + parseNumero(lote.quantidade_disponivel), 0);

  if (quantidadeSolicitada <= 0) {
    return { sucesso: false, erro: 'Informe uma quantidade válida.', rateio: [], custoMedioPonderado: 0, valorTotal: 0 };
  }

  if (quantidadeSolicitada > saldoTotal) {
    return {
      sucesso: false,
      erro: `Saldo insuficiente neste local. Disponível: ${saldoTotal.toFixed(2)}.`,
      rateio: [],
      custoMedioPonderado: 0,
      valorTotal: 0,
    };
  }

  /** @type {Array<Record<string, unknown>>} */
  const rateio = [];
  let restante = quantidadeSolicitada;
  let valorTotal = 0;

  for (const lote of lotesOrdenados) {
    if (restante <= 0) break;
    const disponivel = parseNumero(lote.quantidade_disponivel);
    const quantidadeConsumida = Math.min(restante, disponivel);
    const custoUnitario = parseNumero(lote.custo_unitario);
    rateio.push({
      lote_id: lote.id,
      numero_documento: lote.numero_documento || 'S/N',
      serie_documento: lote.serie_documento || '',
      data_documento: lote.data_documento ?? null,
      fornecedor_id: lote.fornecedor_id ?? null,
      fornecedor_nome: lote.fornecedor_nome ?? null,
      quantidade_consumida: quantidadeConsumida,
      custo_unitario: custoUnitario,
      valor_total: quantidadeConsumida * custoUnitario,
    });
    valorTotal += quantidadeConsumida * custoUnitario;
    restante -= quantidadeConsumida;
  }

  return {
    sucesso: true,
    erro: null,
    rateio,
    custoMedioPonderado: quantidadeSolicitada > 0 ? valorTotal / quantidadeSolicitada : 0,
    valorTotal,
  };
};

export const buildRateioObservacao = (rateio) =>
  (rateio || [])
    .map((item) => `${item.numero_documento || 'S/N'}: ${parseNumero(item.quantidade_consumida).toFixed(3)} kg`)
    .join(' | ');
