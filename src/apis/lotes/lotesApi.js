/**
 * API do módulo Lotes (P1.2, D-PROD-18).
 *
 * Criada nesta slice já com o domínio do manejo iniciado pelo mapa, para que a
 * P1.3 a reutilize em vez de criar uma segunda API de lote (QLT-P12-01).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { lotePort } from './loteNativePort.js';
import {
  listMovimentacoesMapaNativas,
  filterMovimentacoesMapaNativas,
  createMovimentacaoMapaNativa,
  updateMovimentacaoMapaNativa,
  deleteMovimentacaoMapaNativa,
} from '@/apis/movimentacoes-mapa';
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

export const filterMovimentacoes = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterMovimentacoes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const ordem = opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER;
  const limite = opcoes.limit ?? 200;
  return comoLista(await runProviderCall(() => filterMovimentacoesMapaNativas(criterio, ordem, limite), contexto));
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
