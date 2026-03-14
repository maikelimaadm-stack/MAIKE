import { base44 } from "@/api/base44Client";

export const normalizeText = (value = "") => String(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toUpperCase()
  .trim();

export const parseNumber = (value) => {
  if (typeof value === "number") return value;
  return parseFloat(String(value || 0).replace(/\./g, "").replace(",", ".")) || 0;
};

export const obterSaldoProdutoLocal = (lotesNota, produtoId, localEstoqueId) => {
  return lotesNota
    .filter((lote) => lote.produto_id === produtoId && lote.local_estoque_id === localEstoqueId && (lote.quantidade_disponivel || 0) > 0)
    .reduce((total, lote) => total + (lote.quantidade_disponivel || 0), 0);
};

export async function getNextSystemNumber() {
  const [pesagens, fornecedores, produtos, movimentacoes] = await Promise.all([
    base44.entities.Pesagem.list(),
    base44.entities.Fornecedor.list(),
    base44.entities.Produto.list(),
    base44.entities.MovimentacaoEstoque.list(),
  ]);

  const numeros = [
    ...pesagens.map((item) => parseInt(item.numero_registro) || 0),
    ...fornecedores.map((item) => parseInt(item.numero_cadastro) || 0),
    ...produtos.map((item) => parseInt(item.numero_produto) || 0),
    ...movimentacoes.map((item) => parseInt(item.numero_movimentacao) || 0),
  ].filter((numero) => numero > 0 && numero < 1000000000);

  return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
}

export function calcularRateioFIFO({ lotesNota, produtoId, localEstoqueId, quantidade }) {
  const quantidadeSolicitada = parseNumber(quantidade);
  const lotesOrdenados = lotesNota
    .filter((lote) => lote.produto_id === produtoId && lote.local_estoque_id === localEstoqueId && (lote.quantidade_disponivel || 0) > 0)
    .sort((a, b) => new Date(a.data_documento || a.created_date || 0) - new Date(b.data_documento || b.created_date || 0));

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
    const novoSaldo = Math.max(0, saldoAtual - item.quantidade_consumida);

    await base44.entities.EstoqueLoteNota.update(item.lote_id, {
      quantidade_disponivel: novoSaldo,
      status: novoSaldo > 0 ? "Disponivel" : "Esgotado",
    });
  }
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
  if (estoqueAtual - quantidadeFinal < 0) {
    throw new Error("Não é permitido saldo negativo de estoque.");
  }
  const numeroMovimentacao = await getNextSystemNumber();

  const movimentacao = await base44.entities.MovimentacaoEstoque.create({
    empresa_id: empresaId,
    numero_movimentacao: String(numeroMovimentacao),
    tipo_movimentacao: "Saída",
    tipo_detalhado: "suplementacao",
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
    area_vinculada_id: areaId || undefined,
    area_vinculada_nome: areaNome || undefined,
    tipo_vinculo: areaId ? "area" : undefined,
    centro_custo_nome: areaNome || undefined,
    motivo_movimentacao: "Baixa automática de suplementação",
    observacoes,
    origem_sistema: "suplementacao",
    deposito_id: depositoId || undefined,
    ponto_suplementacao_id: pontoSuplementacaoId || undefined,
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: "cocho",
    saldo_antes: estoqueAtual,
    saldo_depois: Math.max(0, estoqueAtual - quantidadeFinal),
    custo_medio_antes: produto.preco_custo || 0,
    custo_medio_depois: produto.preco_custo || 0,
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
  if (estoqueAtual - quantidadeFinal < 0) {
    throw new Error("Não é permitido saldo negativo de estoque.");
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
    observacoes,
    origem_sistema: "deposito",
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: "deposito",
    saldo_antes: estoqueAtual,
    saldo_depois: estoqueAtual,
    custo_medio_antes: produto.preco_custo || 0,
    custo_medio_depois: produto.preco_custo || 0,
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
    observacoes,
    origem_sistema: "deposito",
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: "deposito",
    movimento_pai_id: movimentacaoSaida.id,
    saldo_antes: estoqueAtual,
    saldo_depois: estoqueAtual,
    custo_medio_antes: produto.preco_custo || 0,
    custo_medio_depois: produto.preco_custo || 0,
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