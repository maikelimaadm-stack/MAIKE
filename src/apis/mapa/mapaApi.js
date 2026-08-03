/**
 * API do módulo Mapa (P1.2, D-PROD-18).
 *
 * Implementação interna: quem está fora do módulo importa `@/apis/mapa`.
 *
 * Esta camada é adaptador de dados, e só isso:
 *  - não importa React, React Query, toast, componente ou hook;
 *  - não conhece cache nem `localStorage`;
 *  - não aceita `entityName`;
 *  - devolve dados, nunca objeto do provider.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { mapaProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Mapa';

const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/**
 * O provider devolve `undefined` quando não há registro; a fronteira nunca.
 *
 * O tipo é `any[]` porque o documento da Base44 é, de fato, não tipado — dizer
 * `object[]` seria uma afirmação falsa que quebraria todo acesso a campo nos
 * consumidores. Quando o provider nativo chegar em P7, cada módulo ganha o tipo
 * real do seu agregado.
 *
 * @param {unknown} registros
 * @returns {any[]}
 */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);

const ctx = (operation) => ({ operation, resource: RESOURCE });

// ── Áreas de pastagem ─────────────────────────────────────────────────────

export const listAreas = async () =>
  comoLista(await runProviderCall(() => mapaProvider.listAreas(), ctx('listAreas')));

export const filterAreas = async (criterio) => {
  const contexto = ctx('filterAreas');
  assertArgument(isObjeto(criterio), 'criterio', contexto);
  return comoLista(await runProviderCall(() => mapaProvider.filterAreas(criterio), contexto));
};

export const createArea = async (dados) => {
  const contexto = ctx('createArea');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => mapaProvider.createArea(dados), contexto);
};

export const updateArea = async (id, dados) => {
  const contexto = ctx('updateArea');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => mapaProvider.updateArea(id, dados), { ...contexto, details: { id } });
};

// ── Pontos de referência ──────────────────────────────────────────────────

export const listPontos = async () =>
  comoLista(await runProviderCall(() => mapaProvider.listPontos(), ctx('listPontos')));

export const createPonto = async (dados) => {
  const contexto = ctx('createPonto');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => mapaProvider.createPonto(dados), contexto);
};

export const updatePonto = async (id, dados) => {
  const contexto = ctx('updatePonto');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => mapaProvider.updatePonto(id, dados), { ...contexto, details: { id } });
};

export const deletePonto = async (id) => {
  const contexto = ctx('deletePonto');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => mapaProvider.deletePonto(id), { ...contexto, details: { id } });
};

// ── Pontos de suplementação ───────────────────────────────────────────────

export const listPontosSuplementacao = async () =>
  comoLista(await runProviderCall(() => mapaProvider.listPontosSuplementacao(), ctx('listPontosSuplementacao')));

export const createPontoSuplementacao = async (dados) => {
  const contexto = ctx('createPontoSuplementacao');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => mapaProvider.createPontoSuplementacao(dados), contexto);
};

export const updatePontoSuplementacao = async (id, dados) => {
  const contexto = ctx('updatePontoSuplementacao');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => mapaProvider.updatePontoSuplementacao(id, dados), { ...contexto, details: { id } });
};

export const deletePontoSuplementacao = async (id) => {
  const contexto = ctx('deletePontoSuplementacao');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => mapaProvider.deletePontoSuplementacao(id), { ...contexto, details: { id } });
};

// ── Linhas geográficas ────────────────────────────────────────────────────

export const listLinhas = async () =>
  comoLista(await runProviderCall(() => mapaProvider.listLinhas(), ctx('listLinhas')));

export const createLinha = async (dados) => {
  const contexto = ctx('createLinha');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => mapaProvider.createLinha(dados), contexto);
};

export const updateLinha = async (id, dados) => {
  const contexto = ctx('updateLinha');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return runProviderCall(() => mapaProvider.updateLinha(id, dados), { ...contexto, details: { id } });
};

// ── Apoio: setores, ícones, bebedouros ────────────────────────────────────

export const listSetores = async () =>
  comoLista(await runProviderCall(() => mapaProvider.listSetores(), ctx('listSetores')));

export const listIcones = async () =>
  comoLista(await runProviderCall(() => mapaProvider.listIcones(), ctx('listIcones')));

export const listBebedouros = async () =>
  comoLista(await runProviderCall(() => mapaProvider.listBebedouros(), ctx('listBebedouros')));
