import { base44 } from "@/api/base44Client";

/**
 * Restaura o estoque no local de origem após exclusão de uma movimentação de suplementação.
 * Tenta encontrar o lote FIFO original e incrementar seu saldo. Se não encontrar, cria um novo lote.
 */
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
  movimentacaoEstoqueId,
}) {
  // Busca os lotes existentes no local para tentar restaurar em um lote existente (FIFO reverso)
  const todosLotes = await base44.entities.EstoqueLoteNota.list();
  const lotesNoLocal = todosLotes.filter(
    (lote) => lote.produto_id === produtoId && lote.local_estoque_id === localEstoqueId
  );

  // Tenta encontrar um lote com custo unitário compatível que ainda exista (esgotado ou disponível)
  const loteCompativel = lotesNoLocal.find(
    (lote) => Math.abs((lote.custo_unitario || 0) - (custoUnitario || 0)) < 0.01
  );

  if (loteCompativel) {
    // Restaura o saldo no lote existente
    const novoSaldo = (loteCompativel.quantidade_disponivel || 0) + quantidade;
    await base44.entities.EstoqueLoteNota.update(loteCompativel.id, {
      quantidade_disponivel: novoSaldo,
      status: novoSaldo > 0 ? "Disponivel" : "Esgotado",
    });
  } else {
    // Cria um lote novo apenas se não encontrou nenhum compatível
    await base44.entities.EstoqueLoteNota.create({
      empresa_id: empresaId,
      produto_id: produtoId,
      produto_nome: produtoNome,
      local_estoque_id: localEstoqueId,
      local_estoque_nome: localEstoqueNome,
      numero_documento: "REVERSAO",
      serie_documento: "REV",
      data_documento: new Date().toISOString().split("T")[0],
      fornecedor_id: null,
      fornecedor_nome: null,
      custo_unitario: custoUnitario || 0,
      quantidade_entrada: quantidade,
      quantidade_disponivel: quantidade,
      movimentacao_entrada_id: null,
      status: "Disponivel",
    });
  }

  // Atualiza o estoque global do produto
  const produtos = await base44.entities.Produto.list();
  const produto = produtos.find((item) => item.id === produtoId);
  if (produto) {
    await base44.entities.Produto.update(produtoId, {
      estoque_atual: (produto.estoque_atual || 0) + quantidade,
    });
  }
}

/**
 * Exclui um evento de suplementação e reverte o estoque do depósito.
 * - Exclui os SuplementacaoLote vinculados
 * - Reabre o período anterior (remove métricas de consumo)
 * - Reverte a baixa de estoque no depósito (restaurando lotes FIFO)
 * - Exclui a MovimentacaoEstoque vinculada
 * - Exclui o SuplementacaoEvento
 */
export async function excluirEventoSuplementacaoComReversao({ evento, ponto }) {
  // 1) Excluir lotes de suplementação do evento
  const lotesEvento = await base44.entities.SuplementacaoLote.list();
  const lotesRelacionados = lotesEvento.filter((item) => item.suplementacao_evento_id === evento.id);

  for (const item of lotesRelacionados) {
    await base44.entities.SuplementacaoLote.delete(item.id);
  }

  // 2) Reabrir período do evento anterior
  const todosEventos = await base44.entities.SuplementacaoEvento.list();
  const eventoAnterior = todosEventos
    .filter((item) => item.id !== evento.id && item.empresa_id === evento.empresa_id && item.ponto_suplementacao_id === evento.ponto_suplementacao_id)
    .sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];

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

  // 3) Reverter estoque se havia movimentação vinculada
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
        movimentacaoEstoqueId: movimento.id,
      });
      await base44.entities.MovimentacaoEstoque.delete(movimento.id);
    }
  }

  // 4) Excluir o evento
  await base44.entities.SuplementacaoEvento.delete(evento.id);
}

/**
 * Exclui uma transferência entre depósitos e reverte o estoque.
 * - Encontra a movimentação pareada (saída/entrada)
 * - Deleta os lotes criados no destino
 * - Restaura os lotes na origem (incrementando lotes existentes quando possível)
 * - Exclui as duas movimentações
 */
export async function excluirTransferenciaDeposito({ movimentacao }) {
  const todasMovimentacoes = await base44.entities.MovimentacaoEstoque.list();

  // Encontra a movimentação pareada
  const pareada = movimentacao.movimento_pai_id
    ? todasMovimentacoes.find((item) => item.id === movimentacao.movimento_pai_id)
    : movimentacao.movimento_filho_id
      ? todasMovimentacoes.find((item) => item.id === movimentacao.movimento_filho_id)
      : null;

  // Identifica qual é a entrada e qual é a saída
  const movEntrada = movimentacao.tipo_movimentacao === "Entrada" ? movimentacao : pareada;
  const movSaida = movimentacao.tipo_movimentacao === "Saída" ? movimentacao : pareada;

  if (!movEntrada) {
    throw new Error("Não foi possível localizar o registro de entrada da transferência.");
  }

  // Busca lotes criados no destino por esta transferência
  const todosLotes = await base44.entities.EstoqueLoteNota.list();
  const lotesNoDestino = todosLotes.filter(
    (item) => item.movimentacao_entrada_id === movEntrada.id
  );

  // Se encontrou lotes vinculados, calcula o que devolver à origem
  let quantidadeDevolver = 0;
  const devolucoesAgrupadas = {}; // custo_unitario -> quantidade

  if (lotesNoDestino.length > 0) {
    for (const lote of lotesNoDestino) {
      const custo = lote.custo_unitario || 0;
      const chave = custo.toFixed(4);
      if (!devolucoesAgrupadas[chave]) {
        devolucoesAgrupadas[chave] = { custoUnitario: custo, quantidade: 0 };
      }
      // Devolve APENAS o saldo disponível (o que já foi consumido não pode ser devolvido)
      devolucoesAgrupadas[chave].quantidade += (lote.quantidade_disponivel || 0);
      quantidadeDevolver += (lote.quantidade_disponivel || 0);
      await base44.entities.EstoqueLoteNota.delete(lote.id);
    }
  } else {
    // Fallback: se não encontrou lotes pelo movimentacao_entrada_id, usa a quantidade da movimentação
    quantidadeDevolver = movEntrada.quantidade || 0;
    devolucoesAgrupadas["0.0000"] = {
      custoUnitario: movEntrada.valor_unitario || 0,
      quantidade: quantidadeDevolver,
    };
  }

  // Restaura os lotes na origem (incrementa lotes existentes quando possível)
  const localOrigemId = movEntrada.local_estoque_origem;
  const localOrigemNome = movEntrada.local_origem;
  const lotesNaOrigem = todosLotes.filter(
    (lote) => lote.produto_id === movEntrada.produto_id && lote.local_estoque_id === localOrigemId
  );

  for (const [, { custoUnitario, quantidade }] of Object.entries(devolucoesAgrupadas)) {
    if (quantidade <= 0) continue;

    // Tenta encontrar um lote existente na origem com custo compatível
    const loteOrigem = lotesNaOrigem.find(
      (lote) => Math.abs((lote.custo_unitario || 0) - custoUnitario) < 0.01
    );

    if (loteOrigem) {
      const novoSaldo = (loteOrigem.quantidade_disponivel || 0) + quantidade;
      await base44.entities.EstoqueLoteNota.update(loteOrigem.id, {
        quantidade_disponivel: novoSaldo,
        status: novoSaldo > 0 ? "Disponivel" : "Esgotado",
      });
    } else {
      // Cria lote de reversão apenas se não encontrou lote compatível
      await base44.entities.EstoqueLoteNota.create({
        empresa_id: movEntrada.empresa_id,
        produto_id: movEntrada.produto_id,
        produto_nome: movEntrada.produto_nome,
        local_estoque_id: localOrigemId,
        local_estoque_nome: localOrigemNome,
        numero_documento: "REVERSAO",
        serie_documento: "TRF",
        data_documento: new Date().toISOString().split("T")[0],
        fornecedor_id: null,
        fornecedor_nome: null,
        custo_unitario: custoUnitario,
        quantidade_entrada: quantidade,
        quantidade_disponivel: quantidade,
        movimentacao_entrada_id: null,
        status: "Disponivel",
      });
    }
  }

  // Exclui as movimentações
  await base44.entities.MovimentacaoEstoque.delete(movEntrada.id);
  if (movSaida && movSaida.id !== movEntrada.id) {
    await base44.entities.MovimentacaoEstoque.delete(movSaida.id);
  }
}