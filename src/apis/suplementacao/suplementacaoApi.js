/**
 * API do módulo Suplementação (P1.4).
 *
 * Fronteira, não redesenho de domínio: as regras de período, consumo, FIFO,
 * rateio e formatação continuam puras em `src/components/suplementacao/*`. Aqui
 * mora só o I/O que estava espalhado por componentes e por arquivos `*Utils`.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import {
  listSuplementacaoEventosNativos,
  filterSuplementacaoEventosNativos,
  createSuplementacaoEventoNativo,
  updateSuplementacaoEventoNativo,
  deleteSuplementacaoEventoNativo,
} from '@/apis/suplementacao-eventos';
import {
  listSuplementacaoLotesNativos,
  bulkCreateSuplementacaoLoteNativo,
  updateSuplementacaoLoteNativo,
  deleteSuplementacaoLoteNativo,
} from '@/apis/suplementacao-lotes';
import { listMovimentacoesPecuariaNativas } from '@/apis/movimentacoes-pecuaria';
import { listProdutos as apiListProdutos } from '@/apis/produtos';
import { listMovimentacoesEstoque as apiListMovimentacoesEstoque } from '@/apis/movimentacoes-estoque';
import {
  listLotesNotaEstoque as apiListLotesNota,
  filterLotesNotaEstoque as apiFilterLotesNota,
} from '@/apis/estoque-lotes-nota';
import { listPontosSuplementacao as apiListPontosSuplementacao } from '@/apis/pontos-suplementacao';
import { listLotes } from '../lotes/index.js';

const RESOURCE = 'Suplementacao';
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const MOVIMENTACAO_RECENTE_ORDER = '-created_date';
export const MOVIMENTACAO_RECENTE_LIMIT = 200;

// ── Evento de suplementação ───────────────────────────────────────────────

export const listEventos = async (opcoes = {}) =>
  comoLista(await runProviderCall(() => listSuplementacaoEventosNativos(opcoes.order), ctx('listEventos')));

export const filterEventos = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterEventos');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(
    await runProviderCall(
      () => filterSuplementacaoEventosNativos(criterio, opcoes.order, opcoes.limit),
      contexto
    )
  );
};

export const createEvento = async (dados) => {
  const contexto = ctx('createEvento');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => createSuplementacaoEventoNativo(dados), contexto);
};

export const updateEvento = async (id, dados) => {
  const contexto = ctx('updateEvento');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => updateSuplementacaoEventoNativo(id, dados), { ...contexto, details: { id } });
};

export const deleteEvento = async (id) => {
  const contexto = ctx('deleteEvento');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => deleteSuplementacaoEventoNativo(id), { ...contexto, details: { id } });
};

// ── Lote de suplementação ─────────────────────────────────────────────────

export const listLotesSuplementacao = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () => listSuplementacaoLotesNativos(opcoes.order, opcoes.limit),
      ctx('listLotesSuplementacao')
    )
  );

export const bulkCreateLotesSuplementacao = async (registros) => {
  const contexto = ctx('bulkCreateLotesSuplementacao');
  assertArgument(Array.isArray(registros) && registros.length > 0, 'registros', contexto);
  return runProviderCall(() => bulkCreateSuplementacaoLoteNativo(registros), contexto);
};

export const updateLoteSuplementacao = async (id, dados) => {
  const contexto = ctx('updateLoteSuplementacao');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => updateSuplementacaoLoteNativo(id, dados), { ...contexto, details: { id } });
};

export const deleteLoteSuplementacao = async (id) => {
  const contexto = ctx('deleteLoteSuplementacao');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => deleteSuplementacaoLoteNativo(id), { ...contexto, details: { id } });
};

// ── Estoque consumido pela suplementação ──────────────────────────────────
//
// D-PROD-161 (MAIKE-ESTOQUE-P0-01, F3): só LEITURA. A baixa e a transferência
// vão pelos comandos transacionais (`suplementacaoEstoqueService`), e a
// reversão pelo navegador foi cortada. As escritas genéricas de movimento,
// lote e `estoque_atual` (create/update/delete) que só ela usava saíram daqui.

export const listMovimentacoesEstoque = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () => apiListMovimentacoesEstoque(opcoes.order, opcoes.limit),
      ctx('listMovimentacoesEstoque')
    )
  );

export const listLotesNota = async () =>
  comoLista(await runProviderCall(() => apiListLotesNota(), ctx('listLotesNota')));

export const filterLotesNota = async (criterio) => {
  const contexto = ctx('filterLotesNota');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(await runProviderCall(() => apiFilterLotesNota(criterio), contexto));
};

// ── Leituras de apoio ─────────────────────────────────────────────────────

export const listProdutos = async () =>
  comoLista(await runProviderCall(() => apiListProdutos(), ctx('listProdutos')));

export const listLotesRebanho = async () =>
  comoLista(await runProviderCall(() => listLotes(), ctx('listLotesRebanho')));

export const listMovimentacoesPecuarias = async () =>
  comoLista(
    await runProviderCall(() => listMovimentacoesPecuariaNativas(), ctx('listMovimentacoesPecuarias'))
  );

/**
 * Nativa desde a P4.2, e com dono em `@/apis/areas` (D-PROD-31).
 *
 * A suplementação era o segundo leitor de `AreaPastagem` — o outro é o mapa.
 * Manter os dois com porta própria depois da migração criaria dois caches
 * offline do mesmo agregado, com a mesma chave e sem garantia de concordarem.
 * Um agregado, um dono.
 */
export { listAreas } from '@/apis/areas';

export const listPontosSuplementacao = async () =>
  comoLista(
    await runProviderCall(() => apiListPontosSuplementacao(), ctx('listPontosSuplementacao'))
  );
