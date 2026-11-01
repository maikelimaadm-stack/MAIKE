/**
 * Service do manejo de lote iniciado pelo mapa (P1.2, D-PROD-18).
 *
 * Reúne o que `DetalhesLote.jsx` executava direto contra o provider:
 * movimentação, morte, nascimento, abate, mudança de categoria, pesagem,
 * junção e a validação de ordem temporal.
 *
 * **Sem transação.** A Base44 não oferece atomicidade multi-entidade
 * (QLT-P12-06). Cada operação composta documenta a ordem e o ponto de falha, e
 * devolve contexto verificável em vez de esconder sucesso parcial.
 *
 * Não conhece React, React Query nem toast: a UI continua dona de
 * `invalidateQueries`, `setQueryData` e diálogos (seção 15.4).
 */

import {
  listLotes,
  filterLotes,
  createLote,
  updateLote,
  createMovimentacao,
  listMovimentacoes,
  listTodasMovimentacoes,
  listHistoricoMovimentacoesPagina,
  filterMovimentacoes,
  cancelarMovimentacao,
  consultarElegibilidadeCancelamento,
  registrarManejoLoteServidor,
  filterSuplementacaoLotes,
  createSuplementacaoEvento,
  listSuplementacaoEventos,
  bulkCreateSuplementacaoLote,
} from '@/apis/lotes';
import { filterProdutos } from '@/apis/estoque';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { existeLancamentoPosterior, isPosteriorOuMesmoDiaMaisNovo } from '@/domain/lotes/ordemTemporal';

/** Mensagem preservada da implementação anterior. */
const MSG_EVENTO_POSTERIOR =
  'Não é possível seguir com este registro, pois existem eventos posteriores para o lote.';
const MSG_REGISTRO_POSTERIOR =
  'Existem registros posteriores para este lote. Exclua primeiro os lançamentos mais recentes e refaça o registro, se necessário.';

/** Carrega os lançamentos do lote pelas APIs explícitas. */
const LIMITE_CONSULTA_TEMPORAL = 200;

const carregarLancamentosDoLote = async (empresaId, loteId) => {
  const [movimentacoes, suplementacoes] = await Promise.all([
    filterMovimentacoes({ empresa_id: empresaId, lote_id: loteId }, { limit: LIMITE_CONSULTA_TEMPORAL }),
    filterSuplementacaoLotes({ empresa_id: empresaId, lote_id: loteId }, { limit: LIMITE_CONSULTA_TEMPORAL }),
  ]);
  if (
    movimentacoes.length >= LIMITE_CONSULTA_TEMPORAL ||
    suplementacoes.length >= LIMITE_CONSULTA_TEMPORAL
  ) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      operation: 'validarOrdemTemporalLote',
      resource: 'LoteManejo',
      details: {
        motivo: 'historico_truncado',
        mensagem:
          'Não foi possível garantir a ordem temporal: há mais registros do que o limite seguro de consulta. Próxima slice deve usar paginação SQL completa.',
      },
    });
  }
  return { movimentacoes, suplementacoes };
};

/**
 * Bloqueia o registro quando existe evento posterior no lote.
 *
 * Mesma regra e mesma mensagem de antes; o que mudou é a origem dos dados.
 */
export const validarOrdemTemporalLote = async ({ empresaId, loteId, dataReferencia }) => {
  if (!empresaId || !loteId || !dataReferencia) return;
  const { movimentacoes, suplementacoes } = await carregarLancamentosDoLote(empresaId, loteId);
  if (existeLancamentoPosterior([...movimentacoes, ...suplementacoes], dataReferencia)) {
    throw new Error(MSG_EVENTO_POSTERIOR);
  }
};

export const validarOrdemTemporalLotes = async ({ empresaId, lotes, dataReferencia }) => {
  const loteIds = [...new Set((lotes || []).map((lote) => lote?.id).filter(Boolean))];
  for (const loteId of loteIds) {
    await validarOrdemTemporalLote({ empresaId, loteId, dataReferencia });
  }
};

export const validarSemRegistrosPosteriores = async ({
  empresaId,
  loteId,
  dataReferencia,
  createdDateReferencia,
  ignorarMovimentacaoId,
}) => {
  if (!empresaId || !loteId || !dataReferencia) return;
  const { movimentacoes, suplementacoes } = await carregarLancamentosDoLote(empresaId, loteId);

  const movimentacoesPosteriores = movimentacoes
    .filter((item) => item.id !== ignorarMovimentacaoId)
    .some((item) =>
      isPosteriorOuMesmoDiaMaisNovo({
        itemDate: item.data_movimentacao || item.created_date,
        itemCreatedDate: item.created_date,
        referenceDate: dataReferencia,
        referenceCreatedDate: createdDateReferencia,
      })
    );

  const suplementacoesPosteriores = suplementacoes.some((item) =>
    isPosteriorOuMesmoDiaMaisNovo({
      itemDate: item.data_lancamento || item.created_date,
      itemCreatedDate: item.created_date,
      referenceDate: dataReferencia,
      referenceCreatedDate: createdDateReferencia,
    })
  );

  if (movimentacoesPosteriores || suplementacoesPosteriores) {
    throw new Error(MSG_REGISTRO_POSTERIOR);
  }
};

// ── Leitura ───────────────────────────────────────────────────────────────

export const listarLotesDaEmpresa = (empresaId) => filterLotes({ empresa_id: empresaId });
export const listarTodosLotes = () => listLotes();
export const listarProdutosDaEmpresa = (empresaId) => filterProdutos({ empresa_id: empresaId });
export const listarMovimentacoes = (opcoes) => listMovimentacoes(opcoes);
/** Sem teto — usada onde o legado listava tudo para localizar um registro. */
export const listarTodasMovimentacoes = () => listTodasMovimentacoes();
/** Página do histórico filtrada no servidor (D-PROD-94); `total` diz quanto existe. */
export const listarHistoricoMovimentacoesPagina = (filtros) => listHistoricoMovimentacoesPagina(filtros);
/** Eventos de suplementação, usados pela conferência de sobras na movimentação. */
export const listarEventosSuplementacao = () => listSuplementacaoEventos();

// ── Escrita ───────────────────────────────────────────────────────────────

export const criarLote = (dados) => createLote(dados);
export const atualizarLote = (id, dados) => updateLote(id, dados);
export const criarMovimentacao = (dados) => createMovimentacao(dados);
/**
 * R2A (D-PROD-99): movimento do mapa não se apaga nem se reescreve — o servidor
 * recusa com MOVIMENTO_CANCELAMENTO_OBRIGATORIO. O caminho é o cancelamento.
 */
export const cancelarMovimentacaoMapa = (id, corpo) => cancelarMovimentacao(id, corpo);
export const consultarCancelamentoMovimentacao = (id) => consultarElegibilidadeCancelamento(id);
/** Manejo atômico no servidor (R2A-R1): efeito e movimento numa transação. */
export const registrarManejoLote = (corpo) => registrarManejoLoteServidor(corpo);
export const criarEventoSuplementacao = (dados) => createSuplementacaoEvento(dados);
export const registrarSuplementacaoEmLote = (registros) => bulkCreateSuplementacaoLote(registros);

/**
 * Falha parcial de operação composta.
 *
 * Existe para que a UI possa distinguir "nada aconteceu" de "aconteceu em
 * parte" sem ler texto de erro (QLT-P12-06).
 */
export const erroOperacaoParcial = ({ operation, etapaConcluida, etapaFalha }) =>
  new ApiError(API_ERROR_CODES.MAPA_PARTIAL_OPERATION, {
    operation,
    resource: 'Lote',
    details: { etapaConcluida, etapaFalha },
  });
