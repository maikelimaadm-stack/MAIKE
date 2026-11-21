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
  MOVIMENTACAO_RECENTE_ORDER,
  MOVIMENTACAO_RECENTE_LIMIT,
} from '@/apis/suplementacao';
import {
  comandoSaidaSuplementacao,
  comandoTransferenciaEntreLocais,
  cancelarTransferenciaEntreLocais as cancelarTransferenciaApi,
  elegibilidadeCancelamentoTransferencia as elegibilidadeCancelamentoTransferenciaApi,
} from '@/apis/movimentacoes-estoque';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import {
  proximoNumeroDeMovimentacao,
  buildRateioObservacao,
  validarBaixaFIFO,
  calcularRateioFIFO,
  parseNumber,
} from '@/components/suplementacao/estoqueSuplementacaoUtils';

/** @deprecated Numeração exclusiva do backend; mantido só para leituras legadas de UI. */
export const obterProximoNumeroDeMovimentacao = async () => {
  const movimentacoes = await listMovimentacoesEstoque({
    order: MOVIMENTACAO_RECENTE_ORDER,
    limit: MOVIMENTACAO_RECENTE_LIMIT,
  });
  return proximoNumeroDeMovimentacao(movimentacoes);
};

const exigirConexaoParaComando = () => {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      operation: 'comandoEstoque',
      resource: 'EstoqueSuplementacao',
      details: { motivo: 'offline_comando_composto', mensagem: 'Lançamento requer conexão para confirmar.' },
    });
  }
};

const novaOperationId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const recusar = (operation, motivo, detalhes = {}) => {
  throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
    operation,
    resource: 'EstoqueSuplementacao',
    details: { motivo, ...detalhes },
  });
};

const observacaoComRateio = (observacoes, rateio) =>
  `${observacoes || ''}${observacoes ? '\n' : ''}[RATEIO_FIFO] ${buildRateioObservacao(rateio)}`;

/**
 * Baixa de suplementação — comando transacional único no backend (ESTAB-P0-01).
 * @param {{ empresaId: string, produto: object, quantidade: number, localOrigemId: string, localOrigemNome?: string, areaId?: string, areaNome?: string, observacoes?: string, lotesNota?: object[], depositoId?: string, pontoSuplementacaoId?: string, dataMovimentacao?: string, operationId?: string }} params
 */
export const registrarSaidaSuplementacao = async ({
  empresaId,
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
  operationId,
}) => {
  exigirConexaoParaComando();
  const validacao = validarBaixaFIFO({ lotesNota, produto, localEstoqueId: localOrigemId, quantidade });
  if (!validacao.ok) recusar('registrarSaidaSuplementacao', validacao.motivo);

  const quantidadeFinal = parseNumber(quantidade);
  const resposta = await comandoSaidaSuplementacao({
    operation_id: operationId || novaOperationId(),
    empresa_id: empresaId,
    produto_id: produto.id,
    local_origem_id: localOrigemId,
    local_origem_nome: localOrigemNome,
    quantidade: quantidadeFinal,
    area_id: areaId || null,
    area_nome: areaNome || null,
    deposito_id: depositoId || null,
    ponto_suplementacao_id: pontoSuplementacaoId || null,
    data_movimentacao: dataMovimentacao || null,
    observacoes: observacaoComRateio(observacoes, validacao.rateio),
  });

  return {
    movimentacao: resposta.movimentacao,
    rateio: resposta.rateio,
    committed: resposta.committed === true,
    operation_id: resposta.operation_id,
    replay: resposta.replay === true,
  };
};

/**
 * Transferência entre locais: saída, baixa FIFO, entrada pareada, vínculo
 * saída→entrada e os lotes recriados no destino com o custo de origem.
 */
/**
 * @param {{ empresaId: string, produto: object, quantidade: number, localOrigemId: string, localOrigemNome?: string, localDestinoId: string, localDestinoNome?: string, observacoes?: string, lotesNota?: object[], dataMovimentacao?: string, operationId?: string }} params
 */
export const registrarTransferenciaEntreLocais = async ({
  empresaId,
  produto,
  quantidade,
  localOrigemId,
  localOrigemNome,
  localDestinoId,
  localDestinoNome,
  observacoes,
  lotesNota,
  dataMovimentacao,
  operationId,
}) => {
  exigirConexaoParaComando();
  const lotesDisponiveis = (lotesNota || []).filter(
    (lote) => lote.empresa_id === empresaId && lote.status === 'Disponivel'
  );
  const validacao = validarBaixaFIFO({
    lotesNota: lotesDisponiveis,
    produto,
    localEstoqueId: localOrigemId,
    quantidade,
  });
  if (!validacao.ok) recusar('registrarTransferenciaEntreLocais', validacao.motivo);

  const quantidadeFinal = parseNumber(quantidade);
  const resposta = await comandoTransferenciaEntreLocais({
    operation_id: operationId || novaOperationId(),
    empresa_id: empresaId,
    produto_id: produto.id,
    local_origem_id: localOrigemId,
    local_origem_nome: localOrigemNome,
    local_destino_id: localDestinoId,
    local_destino_nome: localDestinoNome,
    quantidade: quantidadeFinal,
    data_movimentacao: dataMovimentacao || null,
    observacoes: observacaoComRateio(observacoes, validacao.rateio),
  });

  return {
    movimentacaoSaida: resposta.movimentacao_saida,
    movimentacaoEntrada: resposta.movimentacao_entrada,
    rateio: resposta.rateio,
    committed: resposta.committed === true,
    operation_id: resposta.operation_id,
    replay: resposta.replay === true,
  };
};

/**
 * D-PROD-267 — cancelamento (estorno exato no servidor) da transferência entre
 * depósitos, pelo id de qualquer perna. Só online (offline recusa sem I/O e nada vai
 * para a fila). A `operationId` é OBRIGATÓRIA e vem do diálogo, que a persiste e a
 * reenvia enquanto o resultado for desconhecido: este serviço nunca gera chave.
 * @param {{ movimentacaoId: string, empresaId: string, motivo: string, operationId: string }} params
 */
export const cancelarTransferenciaEntreDepositos = async ({ movimentacaoId, empresaId, motivo, operationId }) => {
  exigirConexaoParaComando();
  if (!movimentacaoId || !empresaId) recusar('cancelarTransferenciaEntreDepositos', 'alvo_ausente');
  if (typeof operationId !== 'string' || operationId.trim().length < 8) recusar('cancelarTransferenciaEntreDepositos', 'operation_id_obrigatorio');
  const texto = typeof motivo === 'string' ? motivo.trim() : '';
  if (texto.length < 3) recusar('cancelarTransferenciaEntreDepositos', 'motivo_obrigatorio');
  const resposta = await cancelarTransferenciaApi(movimentacaoId, { empresa_id: empresaId, motivo: texto, operation_id: operationId.trim() });
  return {
    committed: resposta?.committed === true,
    replay: resposta?.replay === true,
    operation_id: resposta?.operation_id,
    movimentacaoSaida: resposta?.movimentacao_saida ?? null,
    movimentacaoEntrada: resposta?.movimentacao_entrada ?? null,
    estornoDestino: resposta?.estorno_destino ?? null,
    estornoOrigem: resposta?.estorno_origem ?? null,
    devolvido: Array.isArray(resposta?.devolvido) ? resposta.devolvido : [],
  };
};

/**
 * D-PROD-267 — elegibilidade do cancelamento da transferência (ensaio do servidor,
 * só informativo; o POST revalida tudo). Só online.
 * @param {{ movimentacaoId: string, empresaId: string, signal?: AbortSignal }} params
 */
export const consultarCancelamentoTransferencia = async ({ movimentacaoId, empresaId, signal }) => {
  exigirConexaoParaComando();
  return elegibilidadeCancelamentoTransferenciaApi(movimentacaoId, empresaId, { signal });
};

/** Reexportado para quem só precisa do cálculo, sem tocar no service. */
export { calcularRateioFIFO };
