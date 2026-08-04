/**
 * API do módulo Lotes (P1.2, D-PROD-18).
 *
 * Criada nesta slice já com o domínio do manejo iniciado pelo mapa, para que a
 * P1.3 a reutilize em vez de criar uma segunda API de lote (QLT-P12-01).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { ApiError, API_ERROR_CODES } from '../_core/ApiError.js';
import {
  lotesProvider,
  loteLayoutProvider,
  fornecedoresProvider,
  categoriasManejoProvider,
  referenciasProvider,
} from '../_providers/base44Provider.js';

const RESOURCE = 'Lote';

const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
const ctx = (operation) => ({ operation, resource: RESOURCE });

export const listLotes = async () =>
  comoLista(await runProviderCall(() => lotesProvider.listLotes(), ctx('listLotes')));

export const filterLotes = async (criterio) => {
  const contexto = ctx('filterLotes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(await runProviderCall(() => lotesProvider.filterLotes(criterio), contexto));
};

export const createLote = async (dados) => {
  const contexto = ctx('createLote');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotesProvider.createLote(dados), contexto);
};

export const updateLote = async (id, dados) => {
  const contexto = ctx('updateLote');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotesProvider.updateLote(id, dados), { ...contexto, details: { id } });
};

// ── Movimentações do mapa ─────────────────────────────────────────────────

export const MOVIMENTACAO_DEFAULT_ORDER = '-data_movimentacao';
export const MOVIMENTACAO_DEFAULT_LIMIT = 500;

export const listMovimentacoes = async (opcoes = {}) => {
  const contexto = ctx('listMovimentacoes');
  const ordem = opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER;
  const limite = opcoes.limit ?? MOVIMENTACAO_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => lotesProvider.listMovimentacoes(ordem, limite), contexto));
};

/** Sem limite: preserva o `list('-data_movimentacao')` sem teto do legado. */
export const listTodasMovimentacoes = async (opcoes = {}) =>
  comoLista(
    await runProviderCall(
      () => lotesProvider.listTodasMovimentacoes(opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER),
      ctx('listTodasMovimentacoes')
    )
  );

export const filterMovimentacoes = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterMovimentacoes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const ordem = opcoes.order ?? MOVIMENTACAO_DEFAULT_ORDER;
  const limite = opcoes.limit ?? 200;
  return comoLista(await runProviderCall(() => lotesProvider.filterMovimentacoes(criterio, ordem, limite), contexto));
};

export const createMovimentacao = async (dados) => {
  const contexto = ctx('createMovimentacao');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotesProvider.createMovimentacao(dados), contexto);
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
  return comoLista(await runProviderCall(() => lotesProvider.listMovimentacoesPecuarias(ordem, limite), contexto));
};

export const deleteMovimentacao = async (id) => {
  const contexto = ctx('deleteMovimentacao');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => lotesProvider.deleteMovimentacao(id), { ...contexto, details: { id } });
};

// ── Suplementação ─────────────────────────────────────────────────────────

export const SUPLEMENTACAO_LOTE_DEFAULT_ORDER = '-data_lancamento';
export const SUPLEMENTACAO_LOTE_DEFAULT_LIMIT = 500;

export const listSuplementacaoEventos = async () =>
  comoLista(await runProviderCall(() => lotesProvider.listSuplementacaoEventos(), ctx('listSuplementacaoEventos')));

export const createSuplementacaoEvento = async (dados) => {
  const contexto = ctx('createSuplementacaoEvento');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => lotesProvider.createSuplementacaoEvento(dados), contexto);
};

export const listSuplementacaoLotes = async (opcoes = {}) => {
  const contexto = ctx('listSuplementacaoLotes');
  const ordem = opcoes.order ?? SUPLEMENTACAO_LOTE_DEFAULT_ORDER;
  const limite = opcoes.limit ?? SUPLEMENTACAO_LOTE_DEFAULT_LIMIT;
  return comoLista(await runProviderCall(() => lotesProvider.listSuplementacaoLotes(ordem, limite), contexto));
};

export const filterSuplementacaoLotes = async (criterio, opcoes = {}) => {
  const contexto = ctx('filterSuplementacaoLotes');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  const ordem = opcoes.order ?? SUPLEMENTACAO_LOTE_DEFAULT_ORDER;
  const limite = opcoes.limit ?? 200;
  return comoLista(await runProviderCall(() => lotesProvider.filterSuplementacaoLotes(criterio, ordem, limite), contexto));
};

export const bulkCreateSuplementacaoLote = async (registros) => {
  const contexto = ctx('bulkCreateSuplementacaoLote');
  assertArgument(Array.isArray(registros) && registros.length > 0, 'registros', contexto);
  return runProviderCall(() => lotesProvider.bulkCreateSuplementacaoLote(registros), contexto);
};

// ── P1.3 — cadastro de lote: exclusão, layout e fontes de opção ────────────

export const deleteLote = async (id) => {
  const contexto = ctx('deleteLote');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => lotesProvider.deleteLote(id), contexto);
};

/**
 * Catálogo **fechado** de fontes de opção de campo personalizado (P1.3).
 *
 * O repositório legado fazia `base44.entities[source.entity]`: qualquer string
 * vinda de um registro de `LayoutCampo` virava acesso a entidade. Isso é
 * exatamente o que `gate:api-boundary` reprova como `DYNAMIC-ENTITY`, e o risco
 * não era teórico — o nome vem de dado editável pelo usuário.
 *
 * As seis entradas abaixo não são um palpite: são exatamente as que a interface
 * permite escolher, em `ENTIDADES_RELACIONAIS`
 * (`src/components/lotes/camposConfigOptions.jsx`). Ampliar "por garantia"
 * reabriria o buraco que esta slice fecha.
 */
export const OPTION_SOURCES = Object.freeze({
  Fornecedor: 'nome',
  Produto: 'nome_produto',
  CategoriaManejo: 'nome',
  Setor: 'nome',
  AreaPastagem: 'nome',
  LocalEstoque: 'nome',
});

export const isOptionSourceSuportada = (nome) =>
  Object.prototype.hasOwnProperty.call(OPTION_SOURCES, nome);

/**
 * Registros de uma fonte de opção suportada.
 *
 * Fonte desconhecida **lança** com código estável em vez de devolver lista
 * vazia: vazio silencioso faria um campo obrigatório parecer "sem cadastros"
 * quando na verdade a configuração está inválida.
 *
 * @param {string} nome uma chave de {@link OPTION_SOURCES}
 */
export const listOptionSource = async (nome) => {
  const contexto = { operation: 'listOptionSource', resource: 'LayoutCampo' };
  if (!isOptionSourceSuportada(nome)) {
    throw new ApiError(API_ERROR_CODES.LOTE_OPTION_SOURCE_UNSUPPORTED, {
      ...contexto,
      details: { fonte: typeof nome === 'string' ? nome : null },
    });
  }
  return comoLista(await runProviderCall(() => loteLayoutProvider.listOptionSource(nome), contexto));
};

const layoutCtx = (operation) => ({ operation, resource: 'LayoutCampo' });

export const listLayoutConfiguracoes = async () =>
  comoLista(await runProviderCall(() => loteLayoutProvider.listConfiguracoes(), layoutCtx('listLayoutConfiguracoes')));

export const createLayoutConfiguracao = async (dados) => {
  const contexto = layoutCtx('createLayoutConfiguracao');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => loteLayoutProvider.createConfiguracao(dados), contexto);
};

export const listLayoutSecoes = async () =>
  comoLista(await runProviderCall(() => loteLayoutProvider.listSecoes(), layoutCtx('listLayoutSecoes')));

export const createLayoutSecao = async (dados) => {
  const contexto = layoutCtx('createLayoutSecao');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => loteLayoutProvider.createSecao(dados), contexto);
};

export const listLayoutCampos = async () =>
  comoLista(await runProviderCall(() => loteLayoutProvider.listCampos(), layoutCtx('listLayoutCampos')));

export const createLayoutCampo = async (dados) => {
  const contexto = layoutCtx('createLayoutCampo');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => loteLayoutProvider.createCampo(dados), contexto);
};

export const updateLayoutCampo = async (id, dados) => {
  const contexto = layoutCtx('updateLayoutCampo');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => loteLayoutProvider.updateCampo(id, dados), contexto);
};

export const deleteLayoutCampo = async (id) => {
  const contexto = layoutCtx('deleteLayoutCampo');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => loteLayoutProvider.deleteCampo(id), contexto);
};

export const listFornecedores = async () =>
  comoLista(await runProviderCall(() => fornecedoresProvider.list(), { operation: 'listFornecedores', resource: 'Fornecedor' }));

export const listCategoriasManejo = async () =>
  comoLista(await runProviderCall(() => categoriasManejoProvider.list(), { operation: 'listCategoriasManejo', resource: 'CategoriaManejo' }));

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
    () => referenciasProvider.sincronizar({
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
  return runProviderCall(() => lotesProvider.updateMovimentacao(id, dados), contexto);
};
