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
  enviarOuGuardar,
  registrarTipoDeEnvio,
  alterarNaFila,
  registrosAguardandoDoTipo,
  situacaoNaFila,
  descartarDaFila,
  registroNaFila,
} from '@/lib/offline/sincronizacao/motorDeSincronizacao';
import { TIPO_TRANSFERENCIA_DEPOSITO, TIPO_CANCELAMENTO_TRANSFERENCIA } from '@/lib/offline/sincronizacao/tiposDeEnvio';
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
 * D-PROD-282 em todas as telas (D-PROD-300): `lotes` (a escolha manual de produto que controla lote, já no formato do
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
 * @param {{ empresaId: string, produto: object, quantidade: number, localOrigemId: string, localOrigemNome?: string, localDestinoId: string, localDestinoNome?: string, observacoes?: string, lotesNota?: object[], dataMovimentacao?: string, operationId?: string, edicao?: string }} params
 *   `edicao` (D-PROD-298): o código da transferência que ainda não subiu e está sendo corrigida.
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
  edicao,
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
  // D-PROD-298: corrigir a transferência que ainda não subiu (mesma posição, mesmo código).
  if (edicao) {
    const ok = await alterarNaFila(edicao, corpo);
    if (!ok) {
      throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
        operation: 'alterarTransferenciaEntreLocais',
        resource: 'EstoqueSuplementacao',
        details: { motivo: 'transferencia_nao_editavel', mensagem: 'Esta transferência já está subindo ou já chegou ao sistema: não dá mais para editar.' },
      });
    }
    return { aguardandoEnvio: true, operation_id: edicao, committed: false, replay: false, rateio: validacao.rateio };
  }
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

// ── D-PROD-298: transferências que ainda não subiram ──────────────────────

/** Tira o rateio e o texto padrão das observações guardadas (para o formulário de edição). @param {unknown} obs */
const observacaoDigitada = (obs) => {
  const texto = String(obs ?? '').split('\n[RATEIO_FIFO]')[0].replace(/^\[RATEIO_FIFO\].*$/s, '').trim();
  return /^(Entrada|Saída) pelo depósito /.test(texto) ? '' : texto;
};

/**
 * Transferências deste local de estoque que ainda não subiram (entrada ou saída).
 * @param {string} localEstoqueId
 */
export const transferenciasAguardandoDoLocal = async (localEstoqueId) => {
  try {
    return (await registrosAguardandoDoTipo(TIPO_TRANSFERENCIA_DEPOSITO))
      .filter((r) => {
        const p = /** @type {any} */ (r.payload);
        return p?.local_origem_id === localEstoqueId || p?.local_destino_id === localEstoqueId;
      })
      .map((r) => {
        const p = /** @type {any} */ (r.payload);
        return {
          operationId: r.operationId,
          criado_em: r.criado_em,
          confirmando: r.estado === 'pendente' && r.tentado,
          atencao: r.estado === 'atencao',
          direcao: p.local_destino_id === localEstoqueId ? 'entrada' : 'saida',
          produto_id: p.produto_id,
          quantidade: Number(p.quantidade) || 0,
          local_origem_id: p.local_origem_id,
          local_origem_nome: p.local_origem_nome,
          local_destino_id: p.local_destino_id,
          local_destino_nome: p.local_destino_nome,
          data_movimentacao: p.data_movimentacao,
          observacoes: observacaoDigitada(p.observacoes),
        };
      });
  } catch {
    return [];
  }
};

/** @param {string} mensagem */
const indisponivel = (mensagem) => {
  const erro = new Error(mensagem);
  /** @type {any} */ (erro).code = 'TRANSFERENCIA_AGUARDANDO_INDISPONIVEL';
  return erro;
};

/**
 * Exclui a transferência que ainda não subiu (sai só do aparelho).
 * @param {string} operationId
 */
export const descartarTransferenciaAguardando = async (operationId) => {
  const situacao = await situacaoNaFila(operationId);
  if (situacao === 'confirmando') throw indisponivel('Esta transferência está sendo enviada agora. Espere confirmar para excluir.');
  if (situacao === 'enviado') throw indisponivel('Esta transferência já chegou ao sistema. Atualize a tela.');
  if (situacao && !(await descartarDaFila(operationId))) throw indisponivel('Não foi possível excluir esta transferência agora.');
};

/**
 * Confere que a transferência ainda pode ser editada (antes de abrir o formulário).
 * @param {string} operationId
 */
export const transferenciaAguardandoPodeEditar = async (operationId) => {
  const registro = await registroNaFila(operationId);
  if (!registro) throw indisponivel('Esta transferência já chegou ao sistema. Atualize a tela.');
  if (!registro.podeAlterar) throw indisponivel('Esta transferência está sendo enviada agora. Espere confirmar.');
  return true;
};

// ── D-PROD-298: excluir sem internet a transferência que já está no servidor ──

registrarTipoDeEnvio({
  tipo: TIPO_CANCELAMENTO_TRANSFERENCIA,
  versao: 1,
  offline: true,
  recursos: (p) => [`estoque:${p?.estorno?.origem ?? ''}`, `estoque:${p?.estorno?.destino ?? ''}`],
  rotulo: (p) => `Excluir transferência ${p?.estorno?.origem_nome ?? ''} → ${p?.estorno?.destino_nome ?? ''}`.trim(),
  atualiza: ['movimentacaoEstoque', 'estoqueLotes'],
  enviar: async (p, { operationId }) => {
    try {
      return await cancelarTransferenciaApi(p.movimentacao_id, { empresa_id: p.empresa_id, motivo: p.motivo, operation_id: operationId });
    } catch (erro) {
      const cause = /** @type {any} */ (erro)?.cause;
      // Já excluída (por esta ou outra tela): conta como feito.
      if (cause?.code === 'TRANSFERENCIA_CANCELAMENTO_BLOQUEADO' && (cause?.details?.reason ?? cause?.reason) === 'original_ja_estornado') return { committed: true, ja_excluida: true };
      throw erro;
    }
  },
});

/**
 * Exclui (cancela) sem internet a transferência que já está no servidor: fica no
 * aparelho e sobe quando a internet voltar. O depósito já mostra a
 * transferência fora do histórico e o saldo de volta.
 * @param {{ movimento: any, empresaId: string, motivo: string, operationId: string }} p
 */
export const cancelarTransferenciaSemInternet = async ({ movimento, empresaId, motivo, operationId }) => {
  const r = await enviarOuGuardar(
    TIPO_CANCELAMENTO_TRANSFERENCIA,
    {
      movimentacao_id: movimento.id,
      empresa_id: empresaId,
      motivo: String(motivo ?? '').trim(),
      estorno: {
        produto_id: movimento.produto_id,
        quantidade: Number(movimento.quantidade) || 0,
        origem: movimento.local_estoque_origem ?? null,
        destino: movimento.local_estoque_destino ?? null,
        origem_nome: movimento.local_origem ?? null,
        destino_nome: movimento.local_destino ?? null,
        data: movimento.data_movimentacao ?? null,
      },
    },
    { empresaId, operationId }
  );
  // O histórico já tira as duas pernas (visão aplicada na leitura do cache).
  return r;
};

