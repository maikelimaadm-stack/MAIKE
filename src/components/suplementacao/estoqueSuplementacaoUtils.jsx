import { base44 } from "@/api/base44Client";
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

export async function getNextSystemNumber() {
  // Busca o maior número registrado (não depende de ordenação por data)
  const movimentacoes = await base44.entities.MovimentacaoEstoque.list("-created_date", 200);
  const maiorNumero = movimentacoes.reduce((max, m) => {
    const n = parseInt(m.numero_movimentacao, 10);
    return !isNaN(n) && n > max ? n : max;
  }, 0);
  return maiorNumero + 1;
}

function getValidFifoDate(lote) {
  const rawDate = lote.data_documento || lote.created_date;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function buildRateioObservacao(rateio) {
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

async function baixarLotesFIFO(rateio) {
  for (const item of rateio) {
    const loteAtual = await base44.entities.EstoqueLoteNota.filter({ id: item.lote_id });
    if (!loteAtual?.length) continue;

    const saldoAtual = loteAtual[0].quantidade_disponivel || 0;
    if (item.quantidade_consumida > saldoAtual) {
      throw new Error(`Tentativa de baixar ${item.quantidade_consumida.toFixed(3)} kg acima do saldo do lote ${item.numero_documento || item.lote_id}.`);
    }
    const novoSaldo = Math.max(0, saldoAtual - item.quantidade_consumida);

    await base44.entities.EstoqueLoteNota.update(item.lote_id, {
      quantidade_disponivel: novoSaldo,
      status: novoSaldo > 0 ? "Disponivel" : "Esgotado",
    });
  }
}

async function garantirLoteOrigemFallback({ empresaId, produto, localOrigemId, localOrigemNome, lotesNota }) {
  const saldoLocal = obterSaldoProdutoLocal(lotesNota, produto.id, localOrigemId);
  if (saldoLocal > 0) return;
  if (normalizeText(produto?.local_estoque) !== normalizeText(localOrigemNome)) return;
  const estoqueAtual = Number(produto?.estoque_atual || 0);
  if (estoqueAtual <= 0) return;

  await base44.entities.EstoqueLoteNota.create({
    empresa_id: empresaId,
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    local_estoque_id: localOrigemId,
    local_estoque_nome: localOrigemNome,
    numero_documento: "SALDO-INICIAL",
    serie_documento: "INI",
    data_documento: new Date().toISOString().split("T")[0],
    fornecedor_id: null,
    fornecedor_nome: null,
    custo_unitario: produto.preco_custo || 0,
    quantidade_entrada: estoqueAtual,
    quantidade_disponivel: estoqueAtual,
    movimentacao_entrada_id: null,
    status: "Disponivel",
  });
}

async function criarLotesDestinoTransferencia({ empresaId, produto, localDestinoId, localDestinoNome, rateio, movimentacaoEntradaId }) {
  for (const item of rateio) {
    await base44.entities.EstoqueLoteNota.create({
      empresa_id: empresaId,
      produto_id: produto.id,
      produto_nome: produto.nome_produto,
      local_estoque_id: localDestinoId,
      local_estoque_nome: localDestinoNome,
      numero_documento: item.numero_documento,
      serie_documento: item.serie_documento,
      data_documento: item.data_documento,
      fornecedor_id: item.fornecedor_id,
      fornecedor_nome: item.fornecedor_nome,
      custo_unitario: item.custo_unitario,
      quantidade_entrada: item.quantidade_consumida,
      quantidade_disponivel: item.quantidade_consumida,
      movimentacao_entrada_id: movimentacaoEntradaId,
      status: "Disponivel",
    });
  }
}

export async function registrarSaidaSuplementacao({
  empresaId,
  userEmail,
  produto,
  quantidade,
  localOrigemId,
  localOrigemNome,
  areaId,
  areaNome,
  observacoes,
  lotesNota,
  depositoId,
  pontoSuplementacaoId,
  dataMovimentacao,
}) {
  const resultado = calcularRateioFIFO({
    lotesNota,
    produtoId: produto.id,
    localEstoqueId: localOrigemId,
    quantidade,
  });

  if (!resultado.sucesso) {
    throw new Error(resultado.erro);
  }

  const quantidadeFinal = parseNumber(quantidade);
  const estoqueAtual = produto.estoque_atual || 0;
  const saldoAntesLocal = obterSaldoProdutoLocal(lotesNota, produto.id, localOrigemId);
  
  const conferencia = conferirDivergenciaEstoque({
    lotesNota,
    produtoId: produto.id,
    localEstoqueId: localOrigemId,
    saldoProduto: estoqueAtual,
  });
  if (conferencia.inconsistente && conferencia.saldoLotes <= 0) {
    throw new Error(`Divergência de estoque detectada. Lotes: ${conferencia.saldoLotes.toFixed(3)} / Produto: ${conferencia.saldoCadastro.toFixed(3)}.`);
  }
  if (conferencia.saldoLotes - quantidadeFinal < 0) {
    throw new Error("Não é permitido saldo negativo no local de origem.");
  }
  const numeroMovimentacao = await getNextSystemNumber();

  const movimentacao = await base44.entities.MovimentacaoEstoque.create({
    empresa_id: empresaId,
    numero_movimentacao: String(numeroMovimentacao),
    tipo_movimentacao: "Saída",
    tipo_detalhado: "suplementacao",
    data_movimentacao: dataMovimentacao ? `${dataMovimentacao}T12:00:00.000Z` : new Date().toISOString(),
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    produto_codigo: produto.codigo_interno || produto.codigo_barras || "",
    produto_categoria: produto.categoria,
    quantidade: quantidadeFinal,
    unidade_medida: produto.unidade_medida || "KG",
    valor_unitario: resultado.custoMedioPonderado,
    valor_total: resultado.valorTotal,
    local_estoque_origem: localOrigemId,
    local_origem: localOrigemNome,
    area_vinculada_id: areaId || undefined,
    area_vinculada_nome: areaNome || undefined,
    tipo_vinculo: areaId ? "area" : undefined,
    centro_custo_nome: areaNome || undefined,
    motivo_movimentacao: "Baixa automática de suplementação",
    observacoes: `${observacoes || ""}${observacoes ? "\n" : ""}[RATEIO_FIFO] ${buildRateioObservacao(resultado.rateio)}`,
    origem_sistema: "suplementacao",
    deposito_id: depositoId || undefined,
    ponto_suplementacao_id: pontoSuplementacaoId || undefined,
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: "cocho",
    is_registro_principal: true,
    numero_movimentacao_seq: 1,
    total_movimentacoes_grupo: 1,
    saldo_antes: saldoAntesLocal,
    saldo_depois: Math.max(0, saldoAntesLocal - quantidadeFinal),
    custo_medio_antes: produto.preco_custo || 0,
    custo_medio_depois: resultado.custoMedioPonderado || 0,
    usuario_responsavel: userEmail || "Sistema",
    status: "Ativa",
  });

  await baixarLotesFIFO(resultado.rateio);
  await base44.entities.Produto.update(produto.id, {
    estoque_atual: Math.max(0, estoqueAtual - quantidadeFinal),
  });

  return { movimentacao, rateio: resultado.rateio };
}

export async function registrarTransferenciaEntreLocais({
  empresaId,
  userEmail,
  produto,
  quantidade,
  localOrigemId,
  localOrigemNome,
  localDestinoId,
  localDestinoNome,
  observacoes,
  lotesNota,
}) {
  const quantidadeFinal = parseNumber(quantidade);
  await garantirLoteOrigemFallback({ empresaId, produto, localOrigemId, localOrigemNome, lotesNota });
  const lotesAtualizados = await base44.entities.EstoqueLoteNota.list();
  const lotesDisponiveis = lotesAtualizados.filter((lote) => lote.empresa_id === empresaId && lote.status === "Disponivel");
  const resultado = calcularRateioFIFO({
    lotesNota: lotesDisponiveis,
    produtoId: produto.id,
    localEstoqueId: localOrigemId,
    quantidade,
  });

  if (!resultado.sucesso) {
    throw new Error(resultado.erro);
  }

  const estoqueAtual = produto.estoque_atual || 0;
  const saldoAntesOrigem = obterSaldoProdutoLocal(lotesDisponiveis, produto.id, localOrigemId);
  const saldoAntesDestino = obterSaldoProdutoLocal(lotesDisponiveis, produto.id, localDestinoId);
  
  const conferencia = conferirDivergenciaEstoque({
    lotesNota: lotesDisponiveis,
    produtoId: produto.id,
    localEstoqueId: localOrigemId,
    saldoProduto: estoqueAtual,
  });
  if (conferencia.inconsistente && conferencia.saldoLotes <= 0) {
    throw new Error(`Divergência de estoque detectada. Lotes: ${conferencia.saldoLotes.toFixed(3)} / Produto: ${conferencia.saldoCadastro.toFixed(3)}.`);
  }
  if (conferencia.saldoLotes - quantidadeFinal < 0) {
    throw new Error("Não é permitido saldo negativo no local de origem.");
  }
  const numeroBase = await getNextSystemNumber();

  const movimentacaoSaida = await base44.entities.MovimentacaoEstoque.create({
    empresa_id: empresaId,
    numero_movimentacao: String(numeroBase),
    tipo_movimentacao: "Saída",
    tipo_detalhado: "transferencia_enviada",
    data_movimentacao: new Date().toISOString(),
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    produto_codigo: produto.codigo_interno || produto.codigo_barras || "",
    produto_categoria: produto.categoria,
    quantidade: quantidadeFinal,
    unidade_medida: produto.unidade_medida || "KG",
    valor_unitario: resultado.custoMedioPonderado,
    valor_total: resultado.valorTotal,
    local_estoque_origem: localOrigemId,
    local_origem: localOrigemNome,
    local_estoque_destino: localDestinoId,
    local_destino: localDestinoNome,
    motivo_movimentacao: "Transferência entre locais de estoque",
    observacoes: `${observacoes || ""}${observacoes ? "\n" : ""}[RATEIO_FIFO] ${buildRateioObservacao(resultado.rateio)}`,
    origem_sistema: "deposito",
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: "deposito",
    is_registro_principal: true,
    numero_movimentacao_seq: 1,
    total_movimentacoes_grupo: 1,
    saldo_antes: saldoAntesOrigem,
    saldo_depois: Math.max(0, saldoAntesOrigem - quantidadeFinal),
    custo_medio_antes: produto.preco_custo || 0,
    custo_medio_depois: resultado.custoMedioPonderado || 0,
    usuario_responsavel: userEmail || "Sistema",
    status: "Ativa",
  });

  await baixarLotesFIFO(resultado.rateio);

  const movimentacaoEntrada = await base44.entities.MovimentacaoEstoque.create({
    empresa_id: empresaId,
    numero_movimentacao: String(numeroBase + 1),
    tipo_movimentacao: "Entrada",
    tipo_detalhado: "transferencia_recebida",
    data_movimentacao: new Date().toISOString(),
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    produto_codigo: produto.codigo_interno || produto.codigo_barras || "",
    produto_categoria: produto.categoria,
    quantidade: quantidadeFinal,
    unidade_medida: produto.unidade_medida || "KG",
    valor_unitario: resultado.custoMedioPonderado,
    valor_total: resultado.valorTotal,
    local_estoque_origem: localOrigemId,
    local_origem: localOrigemNome,
    local_estoque_destino: localDestinoId,
    local_destino: localDestinoNome,
    motivo_movimentacao: "Transferência entre locais de estoque",
    observacoes: `${observacoes || ""}${observacoes ? "\n" : ""}[RATEIO_FIFO] ${buildRateioObservacao(resultado.rateio)}`,
    origem_sistema: "deposito",
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: "deposito",
    movimento_pai_id: movimentacaoSaida.id,
    is_registro_principal: false,
    numero_movimentacao_seq: 2,
    total_movimentacoes_grupo: 2,
    saldo_antes: saldoAntesDestino,
    saldo_depois: saldoAntesDestino + quantidadeFinal,
    custo_medio_antes: produto.preco_custo || 0,
    custo_medio_depois: resultado.custoMedioPonderado || 0,
    usuario_responsavel: userEmail || "Sistema",
    status: "Ativa",
  });

  await base44.entities.MovimentacaoEstoque.update(movimentacaoSaida.id, {
    movimento_filho_id: movimentacaoEntrada.id,
  });

  await criarLotesDestinoTransferencia({
    empresaId,
    produto,
    localDestinoId,
    localDestinoNome,
    rateio: resultado.rateio,
    movimentacaoEntradaId: movimentacaoEntrada.id,
  });

  return { movimentacaoSaida, movimentacaoEntrada, rateio: resultado.rateio };
}