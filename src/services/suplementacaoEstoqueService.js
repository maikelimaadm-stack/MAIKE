/**
 * Service de estoque da suplementação (P1.4).
 *
 * Recebeu o I/O que vivia em `estoqueSuplementacaoUtils.jsx`: baixa FIFO nos
 * lotes de nota, movimentação de saída, transferência pareada entre locais e o
 * ajuste de `Produto.estoque_atual`.
 *
 * O cálculo continua puro no arquivo de origem. Aqui só há orquestração:
 * validar antes de escrever, escrever na ordem, e — quando a sequência falha no
 * meio — dizer o que já foi feito em vez de fingir que nada aconteceu.
 */

import {
  listMovimentacoesEstoque,
  createMovimentacaoEstoque,
  updateMovimentacaoEstoque,
  filterLotesNota,
  createLoteNota,
  updateLoteNota,
  updateProduto,
  MOVIMENTACAO_RECENTE_ORDER,
  MOVIMENTACAO_RECENTE_LIMIT,
} from '@/apis/suplementacao';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import {
  obterSaldoProdutoLocal,
  proximoNumeroDeMovimentacao,
  buildRateioObservacao,
  validarBaixaFIFO,
  calcularRateioFIFO,
  normalizeText,
  parseNumber,
} from '@/components/suplementacao/estoqueSuplementacaoUtils';

/** Próximo número de movimentação, sobre as 200 mais recentes — como antes. */
export const obterProximoNumeroDeMovimentacao = async () => {
  const movimentacoes = await listMovimentacoesEstoque({
    order: MOVIMENTACAO_RECENTE_ORDER,
    limit: MOVIMENTACAO_RECENTE_LIMIT,
  });
  return proximoNumeroDeMovimentacao(movimentacoes);
};

const recusar = (operation, motivo, detalhes = {}) => {
  throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
    operation,
    resource: 'EstoqueSuplementacao',
    details: { motivo, ...detalhes },
  });
};

const parcial = (operation, etapas, causa) =>
  new ApiError(API_ERROR_CODES.SUPLEMENTACAO_PARTIAL_OPERATION, {
    operation,
    resource: 'EstoqueSuplementacao',
    details: { etapas },
    cause: causa,
  });

/** Baixa cada lote do rateio, conferindo o saldo no momento da escrita. */
const baixarLotesFIFO = async (rateio) => {
  for (const item of rateio) {
    const encontrados = await filterLotesNota({ id: item.lote_id });
    if (!encontrados?.length) continue;

    const saldoAtual = encontrados[0].quantidade_disponivel || 0;
    if (item.quantidade_consumida > saldoAtual) {
      recusar('baixarLotesFIFO', 'baixa_acima_do_saldo', {
        lote: item.numero_documento || item.lote_id,
      });
    }

    const novoSaldo = Math.max(0, saldoAtual - item.quantidade_consumida);
    await updateLoteNota(item.lote_id, {
      quantidade_disponivel: novoSaldo,
      status: novoSaldo > 0 ? 'Disponivel' : 'Esgotado',
    });
  }
};

/**
 * Cria o lote de saldo inicial quando o local de origem não tem lote, mas o
 * produto tem `estoque_atual` naquele local. Preserva o fallback do legado.
 */
const garantirLoteOrigemFallback = async ({ empresaId, produto, localOrigemId, localOrigemNome, lotesNota }) => {
  const saldoLocal = obterSaldoProdutoLocal(lotesNota, produto.id, localOrigemId);
  if (saldoLocal > 0) return lotesNota;
  if (normalizeText(produto?.local_estoque) !== normalizeText(localOrigemNome)) return lotesNota;

  const estoqueAtual = Number(produto?.estoque_atual || 0);
  if (estoqueAtual <= 0) return lotesNota;

  const novoLote = await createLoteNota({
    empresa_id: empresaId,
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    local_estoque_id: localOrigemId,
    local_estoque_nome: localOrigemNome,
    numero_documento: 'SALDO-INICIAL',
    serie_documento: 'INI',
    data_documento: new Date().toISOString().split('T')[0],
    fornecedor_id: null,
    fornecedor_nome: null,
    custo_unitario: produto.preco_custo || 0,
    quantidade_entrada: estoqueAtual,
    quantidade_disponivel: estoqueAtual,
    movimentacao_entrada_id: null,
    status: 'Disponivel',
  });

  return [...lotesNota, novoLote];
};

const criarLotesDestinoTransferencia = async ({
  empresaId,
  produto,
  localDestinoId,
  localDestinoNome,
  rateio,
  movimentacaoEntradaId,
}) => {
  for (const item of rateio) {
    await createLoteNota({
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
      status: 'Disponivel',
    });
  }
};

const dataIso = (dataMovimentacao) =>
  dataMovimentacao ? `${dataMovimentacao}T12:00:00.000Z` : new Date().toISOString();

const observacaoComRateio = (observacoes, rateio) =>
  `${observacoes || ''}${observacoes ? '\n' : ''}[RATEIO_FIFO] ${buildRateioObservacao(rateio)}`;

/**
 * Baixa de suplementação: uma movimentação de saída, os lotes baixados em FIFO
 * e o `estoque_atual` do produto ajustado.
 *
 * A sequência não é atômica — dívida aberta até a P3. O que muda em relação ao
 * legado é que uma falha depois da movimentação criada vira
 * `SUPLEMENTACAO_PARTIAL_OPERATION` com as etapas concluídas em `details`.
 */
export const registrarSaidaSuplementacao = async ({
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
}) => {
  const validacao = validarBaixaFIFO({ lotesNota, produto, localEstoqueId: localOrigemId, quantidade });
  if (!validacao.ok) recusar('registrarSaidaSuplementacao', validacao.motivo);

  const quantidadeFinal = parseNumber(quantidade);
  const estoqueAtual = produto.estoque_atual || 0;
  const numeroMovimentacao = await obterProximoNumeroDeMovimentacao();

  const movimentacao = await createMovimentacaoEstoque({
    empresa_id: empresaId,
    numero_movimentacao: String(numeroMovimentacao),
    tipo_movimentacao: 'Saída',
    tipo_detalhado: 'suplementacao',
    data_movimentacao: dataIso(dataMovimentacao),
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    produto_codigo: produto.codigo_interno || produto.codigo_barras || '',
    produto_categoria: produto.categoria,
    quantidade: quantidadeFinal,
    unidade_medida: produto.unidade_medida || 'KG',
    valor_unitario: validacao.custoMedioPonderado,
    valor_total: validacao.valorTotal,
    local_estoque_origem: localOrigemId,
    local_origem: localOrigemNome,
    area_vinculada_id: areaId || undefined,
    area_vinculada_nome: areaNome || undefined,
    tipo_vinculo: areaId ? 'area' : undefined,
    centro_custo_nome: areaNome || undefined,
    motivo_movimentacao: 'Baixa automática de suplementação',
    observacoes: observacaoComRateio(observacoes, validacao.rateio),
    origem_sistema: 'suplementacao',
    deposito_id: depositoId || undefined,
    ponto_suplementacao_id: pontoSuplementacaoId || undefined,
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: 'cocho',
    is_registro_principal: true,
    numero_movimentacao_seq: 1,
    total_movimentacoes_grupo: 1,
    saldo_antes: validacao.saldoAntes,
    saldo_depois: Math.max(0, validacao.saldoAntes - quantidadeFinal),
    custo_medio_antes: produto.preco_custo || 0,
    custo_medio_depois: validacao.custoMedioPonderado || 0,
    usuario_responsavel: userEmail || 'Sistema',
    status: 'Ativa',
  });

  try {
    await baixarLotesFIFO(validacao.rateio);
  } catch (erro) {
    throw parcial('registrarSaidaSuplementacao', ['movimentacao'], erro);
  }

  try {
    await updateProduto(produto.id, { estoque_atual: Math.max(0, estoqueAtual - quantidadeFinal) });
  } catch (erro) {
    throw parcial('registrarSaidaSuplementacao', ['movimentacao', 'lotes'], erro);
  }

  return { movimentacao, rateio: validacao.rateio };
};

/**
 * Transferência entre locais: saída, baixa FIFO, entrada pareada, vínculo
 * saída→entrada e os lotes recriados no destino com o custo de origem.
 */
export const registrarTransferenciaEntreLocais = async ({
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
  dataMovimentacao,
}) => {
  const quantidadeFinal = parseNumber(quantidade);
  const lotesAtualizados = await garantirLoteOrigemFallback({
    empresaId,
    produto,
    localOrigemId,
    localOrigemNome,
    lotesNota,
  });
  const lotesDisponiveis = (lotesAtualizados || lotesNota).filter(
    (lote) => lote.empresa_id === empresaId && lote.status === 'Disponivel'
  );

  const validacao = validarBaixaFIFO({
    lotesNota: lotesDisponiveis,
    produto,
    localEstoqueId: localOrigemId,
    quantidade,
  });
  if (!validacao.ok) recusar('registrarTransferenciaEntreLocais', validacao.motivo);

  const saldoAntesDestino = obterSaldoProdutoLocal(lotesDisponiveis, produto.id, localDestinoId);
  const numeroBase = await obterProximoNumeroDeMovimentacao();
  const dataMovimentacaoIso = dataIso(dataMovimentacao);
  const comum = {
    empresa_id: empresaId,
    data_movimentacao: dataMovimentacaoIso,
    produto_id: produto.id,
    produto_nome: produto.nome_produto,
    produto_codigo: produto.codigo_interno || produto.codigo_barras || '',
    produto_categoria: produto.categoria,
    quantidade: quantidadeFinal,
    unidade_medida: produto.unidade_medida || 'KG',
    valor_unitario: validacao.custoMedioPonderado,
    valor_total: validacao.valorTotal,
    local_estoque_origem: localOrigemId,
    local_origem: localOrigemNome,
    local_estoque_destino: localDestinoId,
    local_destino: localDestinoNome,
    motivo_movimentacao: 'Transferência entre locais de estoque',
    observacoes: observacaoComRateio(observacoes, validacao.rateio),
    origem_sistema: 'deposito',
    bloqueado_exclusao_estoque: true,
    exclusao_somente_em: 'deposito',
    custo_medio_antes: produto.preco_custo || 0,
    custo_medio_depois: validacao.custoMedioPonderado || 0,
    usuario_responsavel: userEmail || 'Sistema',
    status: 'Ativa',
  };

  const movimentacaoSaida = await createMovimentacaoEstoque({
    ...comum,
    numero_movimentacao: String(numeroBase),
    tipo_movimentacao: 'Saída',
    tipo_detalhado: 'transferencia_enviada',
    is_registro_principal: true,
    numero_movimentacao_seq: 1,
    total_movimentacoes_grupo: 1,
    saldo_antes: validacao.saldoAntes,
    saldo_depois: Math.max(0, validacao.saldoAntes - quantidadeFinal),
  });

  const etapas = ['movimentacao_saida'];

  try {
    await baixarLotesFIFO(validacao.rateio);
    etapas.push('lotes_origem');

    const movimentacaoEntrada = await createMovimentacaoEstoque({
      ...comum,
      numero_movimentacao: String(numeroBase + 1),
      tipo_movimentacao: 'Entrada',
      tipo_detalhado: 'transferencia_recebida',
      movimento_pai_id: movimentacaoSaida.id,
      is_registro_principal: false,
      numero_movimentacao_seq: 2,
      total_movimentacoes_grupo: 2,
      saldo_antes: saldoAntesDestino,
      saldo_depois: saldoAntesDestino + quantidadeFinal,
    });
    etapas.push('movimentacao_entrada');

    await updateMovimentacaoEstoque(movimentacaoSaida.id, { movimento_filho_id: movimentacaoEntrada.id });
    etapas.push('vinculo');

    await criarLotesDestinoTransferencia({
      empresaId,
      produto,
      localDestinoId,
      localDestinoNome,
      rateio: validacao.rateio,
      movimentacaoEntradaId: movimentacaoEntrada.id,
    });

    return { movimentacaoSaida, movimentacaoEntrada, rateio: validacao.rateio };
  } catch (erro) {
    throw parcial('registrarTransferenciaEntreLocais', etapas, erro);
  }
};

/** Reexportado para quem só precisa do cálculo, sem tocar no service. */
export { calcularRateioFIFO };
