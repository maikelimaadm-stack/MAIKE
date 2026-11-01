/**
 * API do módulo Lotes (P1.2, D-PROD-18).
 *
 * Criada nesta slice já com o domínio do manejo iniciado pelo mapa, para que a
 * P1.3 a reutilize em vez de criar uma segunda API de lote (QLT-P12-01).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { lotePort, operacoesDeExclusao } from './loteNativePort.js';
import {
  listMovimentacoesMapaNativas,
  filterMovimentacoesMapaNativas,
  createMovimentacaoMapaNativa,
  updateMovimentacaoMapaNativa,
  deleteMovimentacaoMapaNativa,
  listHistoricoMovimentacoesMapaNativo,
  cancelarMovimentacaoMapa,
  elegibilidadeCancelamentoMovimentacaoMapa,
  executarManejoLote,
} from '@/apis/movimentacoes-mapa';
import { ehMovimentoAtivo } from '@/domain/lotes/situacaoMovimento';
import { listMovimentacoesPecuariaNativas } from '@/apis/movimentacoes-pecuaria';
import {
  listSuplementacaoEventosNativos,
  createSuplementacaoEventoNativo,
} from '@/apis/suplementacao-eventos';
import {
  listSuplementacaoLotesNativos,
  filterSuplementacaoLotesNativos,
  bulkCreateSuplementacaoLoteNativo,
} from '@/apis/suplementacao-lotes';
import { sincronizarReferencias } from '@/apis/referencias';
import { listFornecedoresNativos as apiListFornecedores } from '@/apis/fornecedores';
import { listCategoriasManejo as apiListCategoriasManejo } from '@/apis/categorias-manejo';

const RESOURCE = 'Lote';

const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

const coincideComCriterio = (registro, criterio) =>
  Object.entries(criterio).every(([campo, valor]) => registro[campo] === valor);

export const listLotes = async () =>
  comoLista(await runProviderCall(() => lotePort.list(), ctx('listLotes')));

export const filterLotes = async (criterio) => {
  const contexto = ctx('filterLotes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const todos = comoLista(await runProviderCall(() => lotePort.list(), contexto));
  return todos.filter((item) => coincideComCriterio(item, criterio));
};

export const createLote = async (dados) => {
  const contexto = ctx('createLote');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotePort.create(dados), contexto);
};

export const updateLote = async (id, dados) => {
  const contexto = ctx('updateLote');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotePort.update(id, dados), { ...contexto, details: { id } });
};

// ── Movimentações do mapa ─────────────────────────────────────────────────

export const MOVIMENTACAO_DEFAULT_ORDER = '-data_movimentacao';
export const MOVIMENTACAO_DEFAULT_LIMIT = 500;

export const listMovimentacoes = async (opcoes = {}) => {
  const contexto = ctx('listMovimentacoes');
  const ordem = opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER;
  const limite = opcoes.limit ?? MOVIMENTACAO_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => listMovimentacoesMapaNativas(ordem, limite), contexto));
};

/** Sem limite: preserva o `list('-data_movimentacao')` sem teto do legado. */
export const listTodasMovimentacoes = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () => listMovimentacoesMapaNativas(opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER),
      ctx('listTodasMovimentacoes')
    )
  );

/**
 * Uma página do histórico (D-PROD-94): filtrada no servidor por empresa, área
 * e lotes, com `total` — a tela sabe quanto falta e nunca afirma completude.
 */
export const listHistoricoMovimentacoesPagina = async (filtros) => {
  const contexto = ctx('listHistoricoMovimentacoesPagina');
  assertArgument(isObjeto(filtros) && isId(filtros.empresaId), 'filtros.empresaId', contexto);
  const pagina = /** @type {any} */ (await runProviderCall(() => listHistoricoMovimentacoesMapaNativo(filtros), contexto));
  return {
    items: comoLista(pagina?.items),
    next_cursor: typeof pagina?.next_cursor === 'string' ? pagina.next_cursor : null,
    has_more: pagina?.has_more === true,
    total: Number.isFinite(pagina?.total) ? pagina.total : null,
    limit: pagina?.limit ?? null,
  };
};

export const filterMovimentacoes = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterMovimentacoes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const ordem = opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER;
  const limite = opcoes.limit ?? 200;
  // Cancelado não tem efeito atual: fica fora da ordem temporal do lote (R2A).
  return comoLista(await runProviderCall(() => filterMovimentacoesMapaNativas(criterio, ordem, limite), contexto)).filter(ehMovimentoAtivo);
};

/**
 * Cancelamento server-side (R2A, D-PROD-99). Só `operation_id` e `motivo` vão no
 * corpo; o servidor lê movimento, lotes e quantidades. Sem fila offline.
 */
export const cancelarMovimentacao = async (id, { operation_id, motivo }) => {
  const contexto = ctx('cancelarMovimentacao');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isId(operation_id) && isId(motivo), 'corpo', contexto);
  return runProviderCall(() => cancelarMovimentacaoMapa(id, { operation_id, motivo }), { ...contexto, details: { id } });
};

/**
 * Comando atômico de manejo (R2A-R1, D-PROD-99a): Morte, Abate ou Transferência
 * numa transação no servidor. Resposta `{movimentacao, lotes, replay}`.
 */
export const registrarManejoLoteServidor = async (corpo) => {
  const contexto = ctx('registrarManejoLote');
  assertArgument(isObjeto(corpo) && isId(corpo.operation_id) && isId(corpo.lote_id), 'corpo', contexto);
  return runProviderCall(() => executarManejoLote(corpo), { ...contexto, details: { lote_id: corpo.lote_id } });
};

export const consultarElegibilidadeCancelamento = async (id) => {
  const contexto = ctx('consultarElegibilidadeCancelamento');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => elegibilidadeCancelamentoMovimentacaoMapa(id), { ...contexto, details: { id } });
};

export const createMovimentacao = async (dados) => {
  const contexto = ctx('createMovimentacao');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => createMovimentacaoMapaNativa(dados), contexto);
};

/**
 * Movimentações pecuárias — leitura usada pela regra de bloqueio de exclusão.
 *
 * Escopo estreito: a P1.2 só precisa listar. O CRUD entra quando a slice que
 * possui esse domínio tiver consumidor migrado.
 */
export const listMovimentacoesPecuarias = async (opcoes = {}) => {
  const contexto = ctx('listMovimentacoesPecuarias');
  const ordem = opcoes.order ?? '-created_date';
  const limite = opcoes.limit ?? 5000;
  return comoLista(await runProviderCall(() => listMovimentacoesPecuariaNativas(ordem, limite), contexto));
};

export const deleteMovimentacao = async (id) => {
  const contexto = ctx('deleteMovimentacao');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => deleteMovimentacaoMapaNativa(id), { ...contexto, details: { id } });
};

// ── Suplementação ─────────────────────────────────────────────────────────

export const SUPLEMENTACAO_LOTE_DEFAULT_ORDER = '-data_lancamento';
export const SUPLEMENTACAO_LOTE_DEFAULT_LIMIT = 500;

export const listSuplementacaoEventos = async () =>
  comoLista(await runProviderCall(() => listSuplementacaoEventosNativos(), ctx('listSuplementacaoEventos')));

export const createSuplementacaoEvento = async (dados) => {
  const contexto = ctx('createSuplementacaoEvento');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => createSuplementacaoEventoNativo(dados), contexto);
};

export const listSuplementacaoLotes = async (opcoes = {}) => {
  const contexto = ctx('listSuplementacaoLotes');
  const ordem = opcoes.order ?? SUPLEMENTACAO_LOTE_DEFAULT_ORDER;
  const limite = opcoes.limit ?? SUPLEMENTACAO_LOTE_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => listSuplementacaoLotesNativos(ordem, limite), contexto));
};

export const filterSuplementacaoLotes = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterSuplementacaoLotes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const ordem = opcoes.order ?? SUPLEMENTACAO_LOTE_DEFAULT_ORDER;
  const limite = opcoes.limit ?? 200;
  return comoLista(await runProviderCall(() => filterSuplementacaoLotesNativos(criterio, ordem, limite), contexto));
};

export const bulkCreateSuplementacaoLote = async (registros) => {
  const contexto = ctx('bulkCreateSuplementacaoLote');
  assertArgument(Array.isArray(registros) && registros.length > 0, 'registros', contexto);
  return runProviderCall(() => bulkCreateSuplementacaoLoteNativo(registros), contexto);
};

// ── P1.3 — cadastro de lote: exclusão e cadastros auxiliares ───────────────

/** Elegibilidade de exclusão (só leitura; o DELETE revalida). MAIKE-LOTES-R1. */
export const consultarElegibilidadeExclusaoLote = async (id) => {
  const contexto = ctx('consultarElegibilidadeExclusaoLote');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => operacoesDeExclusao.elegibilidade(id), { ...contexto, details: { id } });
};

/** Lote por id no servidor, inclusive excluído logicamente (só leitura). MAIKE-LOTES-R1. */
export const buscarLotePorIdServidor = async (id) => {
  const contexto = ctx('buscarLotePorIdServidor');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => operacoesDeExclusao.buscarPorId(id), { ...contexto, details: { id } });
};

/** Exclusão definitiva, só online (sem fila offline). MAIKE-LOTES-R1. */
export const excluirLoteOnline = async (id) => {
  const contexto = ctx('excluirLoteOnline');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => operacoesDeExclusao.excluirOnline(id), { ...contexto, details: { id } });
};

export const deleteLote = async (id) => {
  const contexto = ctx('deleteLote');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => lotePort.delete(id), { ...contexto, details: { id } });
};

export const listFornecedores = async () =>
  comoLista(await runProviderCall(() => apiListFornecedores(), { operation: 'listFornecedores', resource: 'Fornecedor' }));

export const listCategoriasManejo = async () =>
  comoLista(await runProviderCall(() => apiListCategoriasManejo(), { operation: 'listCategoriasManejo', resource: 'CategoriaManejo' }));

/**
 * Sincroniza referências denormalizadas depois de renomear um lote.
 *
 * Capacidade **explícita**: o nome da function fica no provider. A API não
 * aceita `invoke(nomeQualquer, payload)` do chamador (QLT-P13-09).
 */
export const sincronizarReferenciasLote = async ({ registro, registroAnterior }) => {
  const contexto = ctx('sincronizarReferenciasLote');
  assertArgument(isObjeto(registro), 'registro', contexto);
  return runProviderCall(
    () => sincronizarReferencias({
      event: { type: 'update', entity_name: 'Lote' },
      data: registro,
      old_data: registroAnterior,
    }),
    contexto
  );
};

export const updateMovimentacao = async (id, dados) => {
  const contexto = ctx('updateMovimentacao');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => updateMovimentacaoMapaNativa(id, dados), contexto);
};
