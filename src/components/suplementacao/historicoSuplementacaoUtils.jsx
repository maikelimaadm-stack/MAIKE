import { base44 } from "@/api/base44Client";

export async function restaurarEstoqueNoLocal({
  empresaId,
  produtoId,
  produtoNome,
  produtoCodigo,
  produtoCategoria,
  unidadeMedida = "KG",
  quantidade,
  localEstoqueId,
  localEstoqueNome,
  custoUnitario,
  observacoes,
}) {
  const produtos = await base44.entities.Produto.list();
  const produto = produtos.find((item) => item.id === produtoId);
  const estoqueAtual = produto?.estoque_atual || 0;

  await base44.entities.EstoqueLoteNota.create({
    empresa_id: empresaId,
    produto_id: produtoId,
    produto_nome: produtoNome,
    local_estoque_id: localEstoqueId,
    local_estoque_nome: localEstoqueNome,
    numero_documento: "AJUSTE",
    serie_documento: "REV",
    data_documento: new Date().toISOString().split("T")[0],
    fornecedor_id: null,
    fornecedor_nome: null,
    custo_unitario: custoUnitario || 0,
    quantidade_entrada: quantidade,
    quantidade_disponivel: quantidade,
    status: "Disponivel",
  });

  if (produto) {
    await base44.entities.Produto.update(produtoId, {
      estoque_atual: estoqueAtual + quantidade,
    });
  }

  return null;
}

export async function excluirEventoSuplementacaoComReversao({ evento, ponto }) {
  const lotesEvento = await base44.entities.SuplementacaoLote.list();
  const lotesRelacionados = lotesEvento.filter((item) => item.suplementacao_evento_id === evento.id);
  const todosEventos = await base44.entities.SuplementacaoEvento.list();
  const eventoAnterior = todosEventos
    .filter((item) => item.id !== evento.id && item.empresa_id === evento.empresa_id && item.ponto_suplementacao_id === evento.ponto_suplementacao_id)
    .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];

  for (const item of lotesRelacionados) {
    await base44.entities.SuplementacaoLote.delete(item.id);
  }

  if (eventoAnterior) {
    await base44.entities.SuplementacaoEvento.update(eventoAnterior.id, {
      dias_periodo: null,
      consumo_diario_grupo_kg: null,
    });
    const lotesAnteriores = lotesEvento.filter((item) => item.suplementacao_evento_id === eventoAnterior.id);
    for (const lote of lotesAnteriores) {
      await base44.entities.SuplementacaoLote.update(lote.id, {
        dias_periodo: null,
        consumo_unitario_dia: null,
        consumo_por_cabeca_dia_kg: null,
        consumo_total_lote_periodo_kg: null,
      });
    }
  }

  if (evento.movimentacao_estoque_id && ponto?.deposito_origem_id) {
    const movimentacoes = await base44.entities.MovimentacaoEstoque.list();
    const movimento = movimentacoes.find((item) => item.id === evento.movimentacao_estoque_id);
    if (movimento) {
      await restaurarEstoqueNoLocal({
        empresaId: evento.empresa_id,
        produtoId: movimento.produto_id,
        produtoNome: movimento.produto_nome,
        produtoCodigo: movimento.produto_codigo,
        produtoCategoria: movimento.produto_categoria,
        unidadeMedida: movimento.unidade_medida,
        quantidade: movimento.quantidade,
        localEstoqueId: movimento.local_estoque_origem,
        localEstoqueNome: movimento.local_origem,
        custoUnitario: movimento.valor_unitario,
        observacoes: `Reversão do lançamento do cocho ${evento.ponto_nome}`,
      });
      await base44.entities.MovimentacaoEstoque.delete(movimento.id);
    }
  }

  await base44.entities.SuplementacaoEvento.delete(evento.id);
}

export async function excluirTransferenciaDeposito({ movimentacao }) {
  const todasMovimentacoes = await base44.entities.MovimentacaoEstoque.list();
  const pareada = movimentacao.movimento_pai_id
    ? todasMovimentacoes.find((item) => item.id === movimentacao.movimento_pai_id)
    : movimentacao.movimento_filho_id
      ? todasMovimentacoes.find((item) => item.id === movimentacao.movimento_filho_id)
      : todasMovimentacoes.find((item) => {
          const numeroAtual = parseInt(movimentacao.numero_movimentacao || 0, 10);
          const numeroItem = parseInt(item.numero_movimentacao || 0, 10);
          return item.id !== movimentacao.id
            && item.produto_id === movimentacao.produto_id
            && Math.abs(numeroItem - numeroAtual) === 1
            && item.local_estoque_origem === movimentacao.local_estoque_origem
            && item.local_estoque_destino === movimentacao.local_estoque_destino;
        });

  const movimentacaoEntrada = movimentacao.tipo_movimentacao === "Entrada" ? movimentacao : pareada;
  if (!movimentacaoEntrada) {
    throw new Error("Não foi possível localizar o registro filho da transferência.");
  }

  const lotesDestino = await base44.entities.EstoqueLoteNota.list();
  const lotesRelacionados = lotesDestino.filter((item) => item.movimentacao_entrada_id === movimentacaoEntrada.id);
  const quantidadeTotal = lotesRelacionados.reduce((total, item) => total + (item.quantidade_disponivel || item.quantidade_entrada || 0), 0);
  const custoMedio = quantidadeTotal > 0
    ? lotesRelacionados.reduce((total, item) => total + ((item.quantidade_disponivel || item.quantidade_entrada || 0) * (item.custo_unitario || 0)), 0) / quantidadeTotal
    : movimentacaoEntrada.valor_unitario || 0;

  for (const item of lotesRelacionados) {
    await base44.entities.EstoqueLoteNota.delete(item.id);
  }

  await base44.entities.EstoqueLoteNota.create({
    empresa_id: movimentacaoEntrada.empresa_id,
    produto_id: movimentacaoEntrada.produto_id,
    produto_nome: movimentacaoEntrada.produto_nome,
    local_estoque_id: movimentacaoEntrada.local_estoque_origem,
    local_estoque_nome: movimentacaoEntrada.local_origem,
    numero_documento: "REVERSAO",
    serie_documento: "TRF",
    data_documento: new Date().toISOString().split("T")[0],
    fornecedor_id: null,
    fornecedor_nome: null,
    custo_unitario: custoMedio,
    quantidade_entrada: quantidadeTotal || movimentacaoEntrada.quantidade,
    quantidade_disponivel: quantidadeTotal || movimentacaoEntrada.quantidade,
    status: "Disponivel",
  });

  await base44.entities.MovimentacaoEstoque.delete(movimentacaoEntrada.id);
  if (pareada) {
    await base44.entities.MovimentacaoEstoque.delete(pareada.id);
  }
}