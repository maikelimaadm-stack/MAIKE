/**
 * Service de reversão da suplementação (P1.4).
 *
 * Era `src/components/suplementacao/historicoSuplementacaoUtils.jsx` — um
 * arquivo de "utilitários" que excluía eventos, apagava movimentações de
 * estoque e reescrevia lotes de nota. Nada disso é utilitário: é a operação
 * mais destrutiva do módulo.
 *
 * O comportamento é o mesmo, inclusive nos detalhes que importam:
 *
 *  - restauração **por custo**: procura um lote com custo compatível (±0,01) e
 *    incrementa o saldo dele; só cria lote `REVERSAO` quando não acha nenhum;
 *  - `Produto.estoque_atual` volta a subir junto;
 *  - o período anterior é reaberto;
 *  - na transferência, devolve **apenas o saldo disponível** — o que já foi
 *    consumido no destino não volta.
 *
 * As duas operações são compostas e não são atômicas (dívida aberta até a P3).
 * A diferença é que agora uma falha no meio vira
 * `SUPLEMENTACAO_PARTIAL_OPERATION` com as etapas concluídas em `details`, em
 * vez de propagar um `Error` cru e deixar a tela dizer que deu certo.
 */

import {
  listEventos,
  deleteEvento,
  listLotesSuplementacao,
  deleteLoteSuplementacao,
  listMovimentacoesEstoque,
  deleteMovimentacaoEstoque,
  listLotesNota,
  createLoteNota,
  updateLoteNota,
  deleteLoteNota,
  listProdutos,
  updateProduto,
} from '@/apis/suplementacao';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { reabrirPeriodoSuplementacao } from './suplementacaoService';

const TOLERANCIA_DE_CUSTO = 0.01;
const hoje = () => new Date().toISOString().split('T')[0];

const parcial = (operation, etapas, causa) =>
  new ApiError(API_ERROR_CODES.SUPLEMENTACAO_PARTIAL_OPERATION, {
    operation,
    resource: 'SuplementacaoHistorico',
    details: { etapas },
    cause: causa,
  });

const custoCompativel = (lote, custoUnitario) =>
  Math.abs((lote.custo_unitario || 0) - (custoUnitario || 0)) < TOLERANCIA_DE_CUSTO;

/**
 * Devolve `quantidade` ao local, preferindo incrementar um lote existente com
 * custo compatível. Só cria lote novo quando não há compatível.
 */
const devolverAoLocal = async ({ lotesNoLocal, custoUnitario, quantidade, novoLote }) => {
  const compativel = lotesNoLocal.find((lote) => custoCompativel(lote, custoUnitario));

  if (compativel) {
    const novoSaldo = (compativel.quantidade_disponivel || 0) + quantidade;
    await updateLoteNota(compativel.id, {
      quantidade_disponivel: novoSaldo,
      status: novoSaldo > 0 ? 'Disponivel' : 'Esgotado',
    });
    return;
  }

  await createLoteNota(novoLote());
};

/**
 * Restaura o estoque no local de origem depois de excluir uma movimentação de
 * suplementação.
 */
export const restaurarEstoqueNoLocal = async ({
  empresaId,
  produtoId,
  produtoNome,
  quantidade,
  localEstoqueId,
  localEstoqueNome,
  custoUnitario,
}) => {
  const todosLotes = await listLotesNota();
  const lotesNoLocal = todosLotes.filter(
    (lote) => lote.produto_id === produtoId && lote.local_estoque_id === localEstoqueId
  );

  await devolverAoLocal({
    lotesNoLocal,
    custoUnitario,
    quantidade,
    novoLote: () => ({
      empresa_id: empresaId,
      produto_id: produtoId,
      produto_nome: produtoNome,
      local_estoque_id: localEstoqueId,
      local_estoque_nome: localEstoqueNome,
      numero_documento: 'REVERSAO',
      serie_documento: 'REV',
      data_documento: hoje(),
      fornecedor_id: null,
      fornecedor_nome: null,
      custo_unitario: custoUnitario || 0,
      quantidade_entrada: quantidade,
      quantidade_disponivel: quantidade,
      movimentacao_entrada_id: null,
      status: 'Disponivel',
    }),
  });

  const produtos = await listProdutos();
  const produto = produtos.find((item) => item.id === produtoId);
  if (produto) {
    await updateProduto(produtoId, { estoque_atual: (produto.estoque_atual || 0) + quantidade });
  }
};

/**
 * Exclui um evento de suplementação e reverte o que ele produziu.
 *
 * Ordem preservada: lotes do evento, reabertura do período anterior, reversão
 * do estoque, exclusão da movimentação e, por fim, do evento.
 */
export const excluirEventoSuplementacaoComReversao = async ({ evento, ponto }) => {
  const etapas = [];

  try {
    const lotesSupl = await listLotesSuplementacao();
    const doEvento = lotesSupl.filter((item) => item.suplementacao_evento_id === evento.id);
    for (const item of doEvento) {
      await deleteLoteSuplementacao(item.id);
    }
    etapas.push('lotes_do_evento');

    const todosEventos = await listEventos();
    const anterior = todosEventos
      .filter(
        (item) =>
          item.id !== evento.id &&
          item.empresa_id === evento.empresa_id &&
          item.ponto_suplementacao_id === evento.ponto_suplementacao_id
      )
      .sort((a, b) => new Date(b.data_lancamento).getTime() - new Date(a.data_lancamento).getTime())[0];

    if (anterior) {
      await reabrirPeriodoSuplementacao({ eventoId: anterior.id, lotesSupl });
      etapas.push('periodo_reaberto');
    }

    if (evento.movimentacao_estoque_id && ponto?.deposito_origem_id) {
      const movimentacoes = await listMovimentacoesEstoque();
      const movimento = movimentacoes.find((item) => item.id === evento.movimentacao_estoque_id);
      if (movimento) {
        await restaurarEstoqueNoLocal({
          empresaId: evento.empresa_id,
          produtoId: movimento.produto_id,
          produtoNome: movimento.produto_nome,
          quantidade: movimento.quantidade,
          localEstoqueId: movimento.local_estoque_origem,
          localEstoqueNome: movimento.local_origem,
          custoUnitario: movimento.valor_unitario,
        });
        etapas.push('estoque_restaurado');

        await deleteMovimentacaoEstoque(movimento.id);
        etapas.push('movimentacao_excluida');
      }
    }

    await deleteEvento(evento.id);
    return { etapas: [...etapas, 'evento_excluido'] };
  } catch (erro) {
    throw parcial('excluirEventoSuplementacaoComReversao', etapas, erro);
  }
};

/**
 * Exclui uma transferência entre depósitos e reverte o estoque.
 *
 * Só o saldo **disponível** dos lotes do destino volta para a origem: o que já
 * foi consumido lá não existe mais para devolver.
 */
export const excluirTransferenciaDeposito = async ({ movimentacao }) => {
  const etapas = [];

  const todasMovimentacoes = await listMovimentacoesEstoque();

  const pareada = movimentacao.movimento_pai_id
    ? todasMovimentacoes.find((item) => item.id === movimentacao.movimento_pai_id)
    : movimentacao.movimento_filho_id
      ? todasMovimentacoes.find((item) => item.id === movimentacao.movimento_filho_id)
      : null;

  const movEntrada = movimentacao.tipo_movimentacao === 'Entrada' ? movimentacao : pareada;
  const movSaida = movimentacao.tipo_movimentacao === 'Saída' ? movimentacao : pareada;

  if (!movEntrada) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      operation: 'excluirTransferenciaDeposito',
      resource: 'MovimentacaoEstoque',
      details: { motivo: 'entrada_nao_localizada' },
    });
  }

  try {
    const todosLotes = await listLotesNota();
    const lotesNoDestino = todosLotes.filter((item) => item.movimentacao_entrada_id === movEntrada.id);

    /** custo → quantidade a devolver. */
    const devolucoes = {};

    if (lotesNoDestino.length > 0) {
      for (const lote of lotesNoDestino) {
        const custo = lote.custo_unitario || 0;
        const chave = custo.toFixed(4);
        if (!devolucoes[chave]) devolucoes[chave] = { custoUnitario: custo, quantidade: 0 };
        devolucoes[chave].quantidade += lote.quantidade_disponivel || 0;
        await deleteLoteNota(lote.id);
      }
      etapas.push('lotes_destino_removidos');
    } else {
      // Sem lotes vinculados, devolve pela quantidade da própria movimentação.
      devolucoes['0.0000'] = {
        custoUnitario: movEntrada.valor_unitario || 0,
        quantidade: movEntrada.quantidade || 0,
      };
    }

    const localOrigemId = movEntrada.local_estoque_origem;
    const localOrigemNome = movEntrada.local_origem;
    const lotesNaOrigem = todosLotes.filter(
      (lote) => lote.produto_id === movEntrada.produto_id && lote.local_estoque_id === localOrigemId
    );

    for (const [, { custoUnitario, quantidade }] of Object.entries(devolucoes)) {
      if (quantidade <= 0) continue;

      await devolverAoLocal({
        lotesNoLocal: lotesNaOrigem,
        custoUnitario,
        quantidade,
        novoLote: () => ({
          empresa_id: movEntrada.empresa_id,
          produto_id: movEntrada.produto_id,
          produto_nome: movEntrada.produto_nome,
          local_estoque_id: localOrigemId,
          local_estoque_nome: localOrigemNome,
          numero_documento: 'REVERSAO',
          serie_documento: 'TRF',
          data_documento: hoje(),
          fornecedor_id: null,
          fornecedor_nome: null,
          custo_unitario: custoUnitario,
          quantidade_entrada: quantidade,
          quantidade_disponivel: quantidade,
          movimentacao_entrada_id: null,
          status: 'Disponivel',
        }),
      });
    }
    etapas.push('origem_restaurada');

    await deleteMovimentacaoEstoque(movEntrada.id);
    etapas.push('entrada_excluida');

    if (movSaida && movSaida.id !== movEntrada.id) {
      await deleteMovimentacaoEstoque(movSaida.id);
      etapas.push('saida_excluida');
    }

    return { etapas };
  } catch (erro) {
    throw parcial('excluirTransferenciaDeposito', etapas, erro);
  }
};
