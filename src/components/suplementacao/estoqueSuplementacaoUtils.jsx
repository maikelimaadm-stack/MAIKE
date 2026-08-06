/**
 * Regras puras de estoque da suplementação.
 *
 * Até a P1.3 este arquivo fazia I/O: importava `base44` e escrevia em
 * `MovimentacaoEstoque`, `EstoqueLoteNota` e `Produto`. Um arquivo chamado
 * `…Utils` que grava no banco é uma armadilha — quem importa um utilitário não
 * espera efeito colateral persistente.
 *
 * A partir da P1.4 aqui só há função pura: saldo, divergência, rateio FIFO e a
 * validação da baixa. A persistência vive em
 * `src/services/suplementacaoEstoqueService.js`.
 *
 * Sem React, sem provider, sem `window`.
 */

import { normalizeText, parseNumber } from "../utils/pecuariaUtils";

// Re-exportar para manter compatibilidade com imports existentes
export { normalizeText, parseNumber };

export const obterSaldoProdutoLocal = (lotesNota, produtoId, localEstoqueId) => {
  return lotesNota
    .filter((lote) => lote.produto_id === produtoId && lote.local_estoque_id === localEstoqueId && (lote.quantidade_disponivel || 0) > 0)
    .reduce((total, lote) => total + (lote.quantidade_disponivel || 0), 0);
};

export const obterSaldoTransferivelProduto = ({ produto, lotesNota, localEstoqueId, localEstoqueNome }) => {
  const saldoLocal = obterSaldoProdutoLocal(lotesNota, produto.id, localEstoqueId);
  if (saldoLocal > 0) return saldoLocal;
  if (normalizeText(produto?.local_estoque) === normalizeText(localEstoqueNome) && Number(produto?.estoque_atual || 0) > 0) {
    return Number(produto.estoque_atual || 0);
  }
  return 0;
};

/**
 * Próximo número de movimentação a partir de uma lista **já carregada**.
 *
 * A versão anterior chamava `MovimentacaoEstoque.list("-created_date", 200)`
 * aqui dentro. A leitura passou para o service; a regra — maior número + 1 —
 * continua sendo esta.
 */
export const proximoNumeroDeMovimentacao = (movimentacoes) => {
  const maior = (Array.isArray(movimentacoes) ? movimentacoes : []).reduce((max, movimentacao) => {
    const n = parseInt(movimentacao.numero_movimentacao, 10);
    return !isNaN(n) && n > max ? n : max;
  }, 0);
  return maior + 1;
};

function getValidFifoDate(lote) {
  const rawDate = lote.data_documento || lote.created_date;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function buildRateioObservacao(rateio) {
  return rateio
    .map((item) => `${item.numero_documento || "S/N"}: ${item.quantidade_consumida.toFixed(3)} kg`)
    .join(" | ");
}

export function conferirDivergenciaEstoque({ lotesNota, produtoId, localEstoqueId, saldoProduto }) {
  const saldoLotes = obterSaldoProdutoLocal(lotesNota, produtoId, localEstoqueId);
  const saldoCadastro = Number(saldoProduto || 0);
  const divergencia = Math.abs(saldoLotes - saldoCadastro);
  return {
    saldoLotes,
    saldoCadastro,
    divergencia,
    inconsistente: divergencia > 0.001,
  };
}

export function calcularRateioFIFO({ lotesNota, produtoId, localEstoqueId, quantidade }) {
  const quantidadeSolicitada = parseNumber(quantidade);
  const lotesElegiveis = lotesNota.filter((lote) => lote.produto_id === produtoId && lote.local_estoque_id === localEstoqueId && (lote.quantidade_disponivel || 0) > 0);
  const lotesSemDataValida = lotesElegiveis.filter((lote) => !getValidFifoDate(lote));

  if (lotesSemDataValida.length > 0) {
    return {
      sucesso: false,
      erro: "Existem lotes de estoque sem data válida para aplicar o FIFO com segurança.",
      rateio: [],
      custoMedioPonderado: 0,
    };
  }

  const lotesOrdenados = lotesElegiveis.sort((a, b) => {
    const dateA = getValidFifoDate(a);
    const dateB = getValidFifoDate(b);
    if (dateA.getTime() !== dateB.getTime()) return dateA - dateB;
    return String(a.id).localeCompare(String(b.id));
  });

  const saldoTotal = lotesOrdenados.reduce((total, lote) => total + (lote.quantidade_disponivel || 0), 0);

  if (quantidadeSolicitada <= 0) {
    return { sucesso: false, erro: "Informe uma quantidade válida.", rateio: [], custoMedioPonderado: 0 };
  }

  if (quantidadeSolicitada > saldoTotal) {
    return {
      sucesso: false,
      erro: `Saldo insuficiente neste local. Disponível: ${saldoTotal.toFixed(2)}.`,
      rateio: [],
      custoMedioPonderado: 0,
    };
  }

  const rateio = [];
  let restante = quantidadeSolicitada;
  let valorTotal = 0;

  for (const lote of lotesOrdenados) {
    if (restante <= 0) break;

    const quantidadeConsumida = Math.min(restante, lote.quantidade_disponivel || 0);
    const custoUnitario = lote.custo_unitario || 0;

    rateio.push({
      lote_id: lote.id,
      numero_documento: lote.numero_documento || "S/N",
      serie_documento: lote.serie_documento || "",
      data_documento: lote.data_documento || null,
      fornecedor_id: lote.fornecedor_id || null,
      fornecedor_nome: lote.fornecedor_nome || null,
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
}

/**
 * Valida a baixa antes de qualquer escrita.
 *
 * Reúne as três recusas que estavam espalhadas dentro de
 * `registrarSaidaSuplementacao`: rateio inviável, divergência entre lotes e
 * cadastro, e saldo que ficaria negativo. Retorna motivo **e** mensagem: o
 * motivo é para o código decidir, a mensagem é texto de domínio — calculado
 * aqui, nunca vindo do provider.
 *
 * @returns {{ok: boolean, motivo?: string, mensagem?: string, rateio?: Array<object>,
 *            custoMedioPonderado?: number, valorTotal?: number, saldoAntes?: number}}
 */
export function validarBaixaFIFO({ lotesNota, produto, localEstoqueId, quantidade }) {
  const resultado = calcularRateioFIFO({
    lotesNota,
    produtoId: produto.id,
    localEstoqueId,
    quantidade,
  });

  if (!resultado.sucesso) {
    return { ok: false, motivo: "rateio_inviavel", mensagem: resultado.erro };
  }

  const quantidadeFinal = parseNumber(quantidade);
  const saldoAntes = obterSaldoProdutoLocal(lotesNota, produto.id, localEstoqueId);
  const conferencia = conferirDivergenciaEstoque({
    lotesNota,
    produtoId: produto.id,
    localEstoqueId,
    saldoProduto: produto.estoque_atual || 0,
  });

  if (conferencia.inconsistente && conferencia.saldoLotes <= 0) {
    return {
      ok: false,
      motivo: "divergencia_de_estoque",
      mensagem: `Divergência de estoque detectada. Lotes: ${conferencia.saldoLotes.toFixed(3)} / Produto: ${conferencia.saldoCadastro.toFixed(3)}.`,
    };
  }

  if (conferencia.saldoLotes - quantidadeFinal < 0) {
    return {
      ok: false,
      motivo: "saldo_negativo",
      mensagem: "Não é permitido saldo negativo no local de origem.",
    };
  }

  return {
    ok: true,
    rateio: resultado.rateio,
    custoMedioPonderado: resultado.custoMedioPonderado,
    valorTotal: resultado.valorTotal,
    saldoAntes,
  };
}
