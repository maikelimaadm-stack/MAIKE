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
import { enviarOuGuardar, registrarTipoDeEnvio } from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_TRANSFERENCIA_DEPOSITO } from '@/lib/offline/sincronizacao/tiposDeEnvio';
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

/**
 * D-PROD-296 — transferência entre locais pelo motor de sincronização: sem
 * internet fica no aparelho e sai depois com o mesmo `operation_id` (o comando
 * do servidor deduplica). Tudo que toca o mesmo local de estoque sai na ordem.
 */
registrarTipoDeEnvio({
  tipo: TIPO_TRANSFERENCIA_DEPOSITO,
  versao: 1,
  offline: true,
  recursos: (p) => [`estoque:${p?.local_origem_id ?? ''}`, `estoque:${p?.local_destino_id ?? ''}`],
  rotulo: (p) => `Transferência ${p?.local_origem_nome ?? 'origem'} → ${p?.local_destino_nome ?? 'destino'}`,
  atualiza: ['movimentacaoEstoque', 'estoqueLotes'],
  enviar: (p, { operationId }) => comandoTransferenciaEntreLocais({ ...p, operation_id: operationId }),
});

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
 * D-PROD-296 — o corpo do comando de saída de suplementação, já validado (FIFO
 * nos lotes recebidos) e com o rateio nas observações. Sem `operation_id` e sem
 * I/O: quem envia (direto ou pelo motor) acrescenta o código.
 *
 * D-PROD-282 em todas as telas (D-PROD-298): `lotes` (a escolha manual de produto que controla lote, já no formato do
 * corpo, `[{ estoque_lote_nota_id, quantidade }]`) só vai quando vem; sem ela, o servidor aplica o FEFO. Produto com
 * lote não leva o rateio FIFO calculado aqui nas observações (o servidor grava o rateio real, pelos lotes).
 * @param {{ empresaId: string, produto: any, quantidade: number, localOrigemId: string, localOrigemNome?: string, areaId?: string, areaNome?: string, observacoes?: string, lotesNota?: object[], depositoId?: string, pontoSuplementacaoId?: string, dataMovimentacao?: string, lotes?: Array<{ estoque_lote_nota_id: string, quantidade: string }>|null }} params
 */
export const montarCorpoDaSaidaSuplementacao = ({
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
  lotes,
}) => {
  const validacao = validarBaixaFIFO({ lotesNota, produto, localEstoqueId: localOrigemId, quantidade });
  if (!validacao.ok) recusar('registrarSaidaSuplementacao', validacao.motivo);
  const comLote = produto?.controla_lote === true;
  return {
    empresa_id: empresaId,
    produto_id: produto.id,
    local_origem_id: localOrigemId,
    local_origem_nome: localOrigemNome,
    quantidade: parseNumber(quantidade),
    area_id: areaId || null,
    area_nome: areaNome || null,
    deposito_id: depositoId || null,
    ponto_suplementacao_id: pontoSuplementacaoId || null,
    data_movimentacao: dataMovimentacao || null,
    observacoes: comLote ? observacoes || null : observacaoComRateio(observacoes, validacao.rateio),
    ...(comLote && Array.isArray(lotes) && lotes.length ? { lotes } : {}),
  };
};

/**
 * Baixa de suplementação — comando transacional único no backend (ESTAB-P0-01).
 * @param {Parameters<typeof montarCorpoDaSaidaSuplementacao>[0] & { operationId?: string }} params
 */
export const registrarSaidaSuplementacao = async ({ operationId, ...params }) => {
  exigirConexaoParaComando();
  const corpo = montarCorpoDaSaidaSuplementacao(params);
  const resposta = await comandoSaidaSuplementacao({ operation_id: operationId || novaOperationId(), ...corpo });

  return {
    movimentacao: resposta.movimentacao,
    rateio: resposta.rateio,
    avisos: Array.isArray(resposta.avisos) ? resposta.avisos : [],
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
  // D-PROD-296: pelo motor de sincronização — sem internet fica no aparelho e
  // sai depois com o mesmo código (o servidor deduplica). O saldo da origem é
  // conferido aqui com os lotes do aparelho (já descontado o que espera envio);
  // quem decide de verdade é o servidor quando o registro chega.
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
  const corpo = {
    empresa_id: empresaId,
    produto_id: produto.id,
    local_origem_id: localOrigemId,
    local_origem_nome: localOrigemNome,
    local_destino_id: localDestinoId,
    local_destino_nome: localDestinoNome,
    quantidade: quantidadeFinal,
    data_movimentacao: dataMovimentacao || null,
    observacoes: observacaoComRateio(observacoes, validacao.rateio),
  };
  const envio = await enviarOuGuardar(TIPO_TRANSFERENCIA_DEPOSITO, corpo, {
    empresaId,
    operationId: operationId || novaOperationId(),
  });
  if (envio.estado === 'aguardando') {
    return { aguardandoEnvio: true, operation_id: envio.operationId, committed: false, replay: false, rateio: validacao.rateio };
  }
  const resposta = /** @type {any} */ (envio.resultado) ?? {};

  return {
    aguardandoEnvio: false,
    movimentacaoSaida: resposta.movimentacao_saida,
    movimentacaoEntrada: resposta.movimentacao_entrada,
    rateio: resposta.rateio,
    committed: resposta.committed === true,
    operation_id: resposta.operation_id,
    replay: resposta.replay === true,
  };
};

/**
 * D-PROD-268 — cancelamento (estorno exato no servidor) da transferência entre
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
 * D-PROD-268 — elegibilidade do cancelamento da transferência (ensaio do servidor,
 * só informativo; o POST revalida tudo). Só online.
 * @param {{ movimentacaoId: string, empresaId: string, signal?: AbortSignal }} params
 */
export const consultarCancelamentoTransferencia = async ({ movimentacaoId, empresaId, signal }) => {
  exigirConexaoParaComando();
  return elegibilidadeCancelamentoTransferenciaApi(movimentacaoId, empresaId, { signal });
};

/** Reexportado para quem só precisa do cálculo, sem tocar no service. */
export { calcularRateioFIFO };
