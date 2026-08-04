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
  deleteMovimentacao,
  updateMovimentacao,
  listMovimentacoes,
  listTodasMovimentacoes,
  filterMovimentacoes,
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
const carregarLancamentosDoLote = async (empresaId, loteId) => {
  const [movimentacoes, suplementacoes] = await Promise.all([
    filterMovimentacoes({ empresa_id: empresaId, lote_id: loteId }, { limit: 200 }),
    filterSuplementacaoLotes({ empresa_id: empresaId, lote_id: loteId }, { limit: 200 }),
  ]);
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
/** Eventos de suplementação, usados pela conferência de sobras na movimentação. */
export const listarEventosSuplementacao = () => listSuplementacaoEventos();

// ── Escrita ───────────────────────────────────────────────────────────────

export const criarLote = (dados) => createLote(dados);
export const atualizarLote = (id, dados) => updateLote(id, dados);
export const criarMovimentacao = (dados) => createMovimentacao(dados);
export const excluirMovimentacao = (id) => deleteMovimentacao(id);
export const atualizarMovimentacao = (id, dados) => updateMovimentacao(id, dados);
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
