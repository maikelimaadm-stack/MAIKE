// ============================================================================
// estoqueService — Fonte ÚNICA de escrita e de cálculo de saldo de estoque
// ----------------------------------------------------------------------------
// Objetivo: unificar as três fontes de saldo que antes divergiam
//   (Produto.estoque_atual / EstoqueLoteNota / soma de MovimentacaoEstoque).
//
// Fonte de verdade do SALDO por produto+local = soma de
//   EstoqueLoteNota.quantidade_disponivel (lotes Disponíveis).
// Produto.estoque_atual passa a ser um espelho derivado, sempre atualizado
//   por este serviço a cada gravação.
//
// IMPORTANTE (integração com o MAPA):
//   Este serviço REAPROVEITA o motor FIFO de estoqueSuplementacaoUtils
//   (o mesmo que a suplementação/depósitos do mapa usam). Não alteramos a
//   assinatura nem a semântica daquelas funções — apenas as importamos e
//   re-exportamos, para que exista UMA única implementação de FIFO/saldo.
// ============================================================================

import { base44 } from "@/api/base44Client";
import { toValue } from "@/components/movimentacoes/utils/movimentacaoUtils";
import {
  obterSaldoProdutoLocal,
  calcularRateioFIFO,
  conferirDivergenciaEstoque,
  getNextSystemNumber,
  registrarSaidaSuplementacao,
  registrarTransferenciaEntreLocais,
  normalizeText,
  parseNumber,
} from "@/components/suplementacao/estoqueSuplementacaoUtils";

// Re-exporta o motor compartilhado para que as telas importem tudo de um só lugar
export {
  obterSaldoProdutoLocal,
  calcularRateioFIFO,
  conferirDivergenciaEstoque,
  getNextSystemNumber,
  registrarSaidaSuplementacao,
  registrarTransferenciaEntreLocais,
  normalizeText,
  parseNumber,
};

// ----------------------------------------------------------------------------
// LEITURA DE SALDO (fonte única = EstoqueLoteNota)
// ----------------------------------------------------------------------------

/** Saldo disponível de um produto em TODOS os locais (soma dos lotes). */
export function saldoProduto(lotesNota = [], produtoId) {
  return lotesNota
    .filter((l) => l.produto_id === produtoId && (l.quantidade_disponivel || 0) > 0)
    .reduce((total, l) => total + (l.quantidade_disponivel || 0), 0);
}

/** Saldo disponível de um produto num local específico (soma dos lotes). */
export const saldoProdutoLocal = obterSaldoProdutoLocal;

/** Mapa { [produtoId]: { [localId]: saldo } } a partir dos lotes. */
export function mapaSaldosPorProdutoLocal(lotesNota = []) {
  const mapa = {};
  for (const l of lotesNota) {
    if ((l.quantidade_disponivel || 0) <= 0) continue;
    if (!mapa[l.produto_id]) mapa[l.produto_id] = {};
    mapa[l.produto_id][l.local_estoque_id] =
      (mapa[l.produto_id][l.local_estoque_id] || 0) + (l.quantidade_disponivel || 0);
  }
  return mapa;
}

/** Custo médio ponderado de um produto num local (a partir dos lotes disponíveis). */
export function custoMedioProdutoLocal(lotesNota = [], produtoId, localId) {
  const lotes = lotesNota.filter(
    (l) => l.produto_id === produtoId && l.local_estoque_id === localId && (l.quantidade_disponivel || 0) > 0,
  );
  const qtd = lotes.reduce((s, l) => s + (l.quantidade_disponivel || 0), 0);
  if (qtd <= 0) return 0;
  const valor = lotes.reduce((s, l) => s + (l.quantidade_disponivel || 0) * (l.custo_unitario || 0), 0);
  return valor / qtd;
}

// ----------------------------------------------------------------------------
// CLASSIFICAÇÃO DE MOVIMENTAÇÕES (usada por TODOS os relatórios)
// Resolve os bugs de classificação que faziam relatórios divergirem:
//  - "Ajuste Positivo" (label com espaço) era contado como saída;
//  - pernas de transferência interna eram contadas em dobro (entrada e saída).
// Sempre normaliza via toValue() para funcionar tanto com slug quanto label.
// ----------------------------------------------------------------------------

/** Slug normalizado do tipo_detalhado (ex.: "Ajuste Positivo" -> "ajuste_positivo"). */
export function slugTipoDetalhado(mov) {
  return toValue(mov?.tipo_detalhado || "");
}

/**
 * Perna de uma transferência (interna). Cobre os três formatos existentes:
 *  - par "transferencia_enviada" / "transferencia_recebida" (util/mapa)
 *  - registro único "transferencia" (tela de Movimentações de Estoque)
 * Transferências não entram/saem do estoque da fazenda — apenas mudam de local.
 */
export function ehPernaTransferencia(mov) {
  return slugTipoDetalhado(mov).includes("transferencia");
}

export function ehAjustePositivo(mov) {
  return mov?.tipo_movimentacao === "Ajuste" && slugTipoDetalhado(mov).includes("positivo");
}

export function ehAjusteNegativo(mov) {
  return mov?.tipo_movimentacao === "Ajuste" && !slugTipoDetalhado(mov).includes("positivo");
}

/** É uma ENTRADA real de estoque na fazenda (exclui pernas de transferência). */
export function ehEntradaReal(mov) {
  if (ehPernaTransferencia(mov)) return false;
  return mov?.tipo_movimentacao === "Entrada" || ehAjustePositivo(mov);
}

/** É uma SAÍDA real de estoque da fazenda (exclui pernas de transferência). */
export function ehSaidaReal(mov) {
  if (ehPernaTransferencia(mov)) return false;
  return mov?.tipo_movimentacao === "Saída" || ehAjusteNegativo(mov);
}

/**
 * Impacto (com sinal) de uma movimentação no saldo.
 * Se `localId` for informado, calcula o impacto NAQUELE local (para kardex por local).
 * Transferências: contam +qtd no destino e -qtd na origem; sem filtro de local,
 * pernas de transferência se cancelam (não alteram o total do produto).
 */
export function impactoSaldo(mov, localId = null) {
  const qtd = mov?.quantidade || 0;
  const tipo = mov?.tipo_movimentacao;

  if (ehPernaTransferencia(mov)) {
    if (localId) {
      if (mov.local_estoque_destino === localId) return qtd;
      if (mov.local_estoque_origem === localId) return -qtd;
      return 0;
    }
    // Sem filtro de local: entrada e saída da transferência se anulam
    if (tipo === "Entrada") return qtd;
    if (tipo === "Saída") return -qtd;
    return 0;
  }

  if (localId) {
    // Só conta a movimentação que toca o local filtrado
    const tocaDestino = mov.local_estoque_destino === localId;
    const tocaOrigem = mov.local_estoque_origem === localId;
    if (!tocaDestino && !tocaOrigem) return 0;
  }

  if (tipo === "Entrada" || ehAjustePositivo(mov)) return qtd;
  if (tipo === "Saída" || ehAjusteNegativo(mov)) return -qtd;
  return 0;
}

// ----------------------------------------------------------------------------
// ESCRITA — motor único de ENTRADA de estoque
// Antes, a tela "Lançamento de Produtos no Estoque" criava a movimentação mas
// NÃO criava o lote nem atualizava Produto.estoque_atual: a entrada "sumia".
// Esta função grava as três coisas de forma consistente.
// ----------------------------------------------------------------------------

/**
 * Registra uma ENTRADA de estoque de forma completa e consistente:
 *   1) cria a MovimentacaoEstoque (Entrada);
 *   2) cria o EstoqueLoteNota (lote FIFO) correspondente;
 *   3) atualiza Produto.estoque_atual (espelho derivado).
 *
 * Retorna { movimentacao, lote }.
 */
export async function registrarEntrada({
  empresaId,
  userEmail,
  produto, // objeto Produto completo
  quantidade,
  custoUnitario,
  valorTotal,
  localDestinoId,
  localDestinoNome,
  tipoDetalhado,
  tipoDocumento,
  numeroDocumento,
  serieDocumento,
  chaveDocumento,
  dataDocumento,
  dataMovimentacao,
  fornecedorId,
  fornecedorNome,
  observacoes,
  origemSistema = "manual",
}) {
  if (!empresaId) throw new Error("Empresa não selecionada.");
  if (!produto?.id) throw new Error("Produto inválido.");
  if (!localDestinoId) throw new Error(`Selecione o local de estoque de destino para ${produto.nome_produto}.`);

  const quantidadeFinal = parseNumber(quantidade);
  if (quantidadeFinal <= 0) throw new Error(`Informe uma quantidade válida para ${produto.nome_produto}.`);

  const custo = Number(custoUnitario ?? produto.preco_custo ?? 0) || 0;
  const valorTotalFinal = valorTotal != null ? Number(valorTotal) : quantidadeFinal * custo;
  const estoqueAntes = Number(produto.estoque_atual || 0);
  const estoqueDepois = estoqueAntes + quantidadeFinal;

  const numeroMovimentacao = await getNextSystemNumber();
  const dataMovimentacaoIso = dataMovimentacao
    ? (String(dataMovimentacao).includes("T") ? dataMovimentacao : `${dataMovimentacao}T12:00:00.000Z`)
    : new Date().toISOString();

  const movimentacao = await base44.entities.MovimentacaoEstoque.create({
    empresa_id: empresaId,
    numero_movimentacao: String(numeroMovimentacao),
    tipo_movimentacao: "Entrada",
    tipo_detalhado: tipoDetalhado || "compra",
    tipo_documento: tipoDocumento || undefined,
    numero_documento: numeroDocumento || undefined,
    chave_documento: chaveDocumento || undefined,
    data_documento: dataDocumento || undefined,
    data_movimentacao: dataMovimentacaoIso,
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    produto_codigo: produto.codigo_interno || produto.codigo_barras || "",
    produto_categoria: produto.categoria || "",
    quantidade: quantidadeFinal,
    unidade_medida: produto.unidade_medida || "KG",
    valor_unitario: custo,
    valor_total: valorTotalFinal,
    local_estoque_destino: localDestinoId,
    local_destino: localDestinoNome || "",
    fornecedor_id: fornecedorId || undefined,
    fornecedor_nome: fornecedorNome || undefined,
    motivo_movimentacao: observacoes || undefined,
    observacoes: observacoes || "",
    saldo_antes: estoqueAntes,
    saldo_depois: estoqueDepois,
    custo_medio_antes: Number(produto.preco_custo || 0),
    custo_medio_depois: custo,
    origem_sistema: origemSistema,
    is_registro_principal: true,
    numero_movimentacao_seq: 1,
    total_movimentacoes_grupo: 1,
    usuario_responsavel: userEmail || "Sistema",
    responsavel: userEmail || "Sistema",
    status: "Ativa",
  });

  const lote = await base44.entities.EstoqueLoteNota.create({
    empresa_id: empresaId,
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    local_estoque_id: localDestinoId,
    local_estoque_nome: localDestinoNome || "",
    numero_documento: numeroDocumento || "",
    serie_documento: serieDocumento || "",
    data_documento: dataDocumento || dataMovimentacaoIso.split("T")[0],
    fornecedor_id: fornecedorId || null,
    fornecedor_nome: fornecedorNome || null,
    custo_unitario: custo,
    quantidade_entrada: quantidadeFinal,
    quantidade_disponivel: quantidadeFinal,
    movimentacao_entrada_id: movimentacao.id,
    status: "Disponivel",
  });

  await base44.entities.Produto.update(produto.id, { estoque_atual: estoqueDepois });

  return { movimentacao, lote };
}
