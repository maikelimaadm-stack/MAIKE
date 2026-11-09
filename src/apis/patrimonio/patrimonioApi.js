/**
 * API do módulo Patrimônio e Frota (D-PROD-157). Online só; página keyset do
 * motor Base1; opções de seletor paginadas no servidor (sem teto).
 *
 * Catálogos do tenant: nunca `empresa_id`. Bens: `empresa_id` obrigatório
 * (query na leitura, corpo na gravação). PATCH sempre com `versao` (CAS).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { CAMINHOS_CATALOGO, operacoesNativas } from './patrimonioNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

/** Recursos de opções (A3): os de catálogo não pedem empresa; os demais pedem. */
export const RECURSOS_OPCOES_PATRIMONIO = Object.freeze(['familias', 'tipos', 'perfis-medicao', 'combustiveis', 'responsaveis', 'parceiros', 'centros-custo', 'areas']);
export const RECURSOS_OPCOES_DA_EMPRESA = Object.freeze(['responsaveis', 'parceiros', 'centros-custo', 'areas']);

/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v */
const ehVersao = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 1;
/** @param {unknown} recurso */
const ehCatalogo = (recurso) => typeof recurso === 'string' && Object.prototype.hasOwnProperty.call(CAMINHOS_CATALOGO, recurso);
/** @param {Record<string, unknown>} corpo @param {string} campo */
const tem = (corpo, campo) => Object.prototype.hasOwnProperty.call(corpo, campo);
/** @param {string} operation @param {string} resource */
const ctx = (operation, resource) => ({ operation, resource });

// ─── Catálogos ───────────────────────────────────────────────────────────

/** @param {string} recurso @param {Record<string, unknown>} [filtros] */
export const listPatrimonioCatalogoPage = async (recurso, filtros = {}) => {
  const contexto = ctx('listPatrimonioCatalogoPage', String(recurso));
  assertArgument(ehCatalogo(recurso), 'recurso', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.catalogoListPage(recurso, filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} recurso @param {string} id */
export const getPatrimonioCatalogo = async (recurso, id) => {
  const contexto = ctx('getPatrimonioCatalogo', String(recurso));
  assertArgument(ehCatalogo(recurso), 'recurso', contexto);
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => operacoesNativas.catalogoGet(recurso, id), contexto);
};

/** @param {string} recurso @param {Record<string, unknown>} corpo */
export const createPatrimonioCatalogo = async (recurso, corpo) => {
  const contexto = ctx('createPatrimonioCatalogo', String(recurso));
  assertArgument(ehCatalogo(recurso), 'recurso', contexto);
  assertArgument(isObjeto(corpo) && !tem(corpo, 'empresa_id'), 'empresa_id', contexto);
  assertArgument(isId(corpo.codigo) && isId(corpo.nome), 'codigo', contexto);
  return runProviderCall(() => operacoesNativas.catalogoCreate(recurso, corpo), contexto);
};

/**
 * PATCH com `versao` (concorrência otimista). Código e campos de classificação
 * (natureza, família, dimensão, finalidade, unidade) nunca vão: são imutáveis.
 * @param {string} recurso @param {string} id @param {Record<string, unknown>} corpo
 */
export const updatePatrimonioCatalogo = async (recurso, id, corpo) => {
  const contexto = ctx('updatePatrimonioCatalogo', String(recurso));
  assertArgument(ehCatalogo(recurso), 'recurso', contexto);
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && ehVersao(corpo.versao), 'versao', contexto);
  for (const imutavel of ['codigo', 'natureza', 'familia_id', 'dimensao', 'finalidade', 'unidade', 'empresa_id']) {
    assertArgument(!tem(corpo, imutavel), imutavel, contexto);
  }
  return runProviderCall(() => operacoesNativas.catalogoUpdate(recurso, id, corpo), { ...contexto, details: { id } });
};

/** @param {unknown} v */
const contagens = (v) => {
  const o = isObjeto(v) ? v : {};
  /** @param {unknown} n */
  const n = (n) => (Number.isInteger(n) && /** @type {number} */ (n) >= 0 ? /** @type {number} */ (n) : 0);
  return { familias: n(o.familias), tipos: n(o.tipos), perfis: n(o.perfis), combustiveis: n(o.combustiveis) };
};

/**
 * Instala o catálogo padrão (idempotente: cria só o que falta por código).
 * @returns {Promise<{ criados: { familias: number, tipos: number, perfis: number, combustiveis: number },
 *   existentes: { familias: number, tipos: number, perfis: number, combustiveis: number },
 *   conflitos: Array<{ recurso: string, codigo: string, motivo: string }> }>}
 */
export const instalarPatrimonioCatalogoPadrao = async () => {
  const contexto = ctx('instalarPatrimonioCatalogoPadrao', 'PatrimonioCatalogoPadrao');
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.catalogoPadrao(), contexto));
  const conflitos = isObjeto(bruto) && Array.isArray(bruto.conflitos) ? bruto.conflitos : [];
  return {
    criados: contagens(bruto?.criados),
    existentes: contagens(bruto?.existentes),
    conflitos: conflitos
      .filter(isObjeto)
      .map((c) => ({ recurso: String(c.recurso ?? ''), codigo: String(c.codigo ?? ''), motivo: String(c.motivo ?? '') })),
  };
};

// ─── Bens ────────────────────────────────────────────────────────────────

/** @param {Record<string, unknown>} [filtros] */
export const listBensPatrimoniaisPage = async (filtros = {}) => {
  const contexto = ctx('listBensPatrimoniaisPage', 'BemPatrimonial');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.bensListPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getBemPatrimonial = async (id, empresaId) => {
  const contexto = ctx('getBemPatrimonial', 'BemPatrimonial');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.bemGet(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo */
export const createBemPatrimonial = async (corpo) => {
  const contexto = ctx('createBemPatrimonial', 'BemPatrimonial');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(isId(corpo.familia_id) && isId(corpo.tipo_id), 'familia_id', contexto);
  return runProviderCall(() => operacoesNativas.bemCreate(corpo), contexto);
};

/**
 * PATCH mínimo do agregado (bem + medições + medidor + tanques) com `versao`.
 * `numero` e `natureza` nunca vão (imutáveis); `empresa_id` é só escopo.
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const updateBemPatrimonial = async (id, corpo) => {
  const contexto = ctx('updateBemPatrimonial', 'BemPatrimonial');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(!tem(corpo, 'numero') && !tem(corpo, 'natureza'), 'numero', contexto);
  return runProviderCall(() => operacoesNativas.bemUpdate(id, corpo), { ...contexto, details: { id } });
};

/**
 * Prévia gerencial de depreciação linear (não grava nada).
 * @param {Record<string, unknown>} corpo
 */
export const previaDepreciacaoBemPatrimonial = async (corpo) => {
  const contexto = ctx('previaDepreciacaoBemPatrimonial', 'BemPatrimonial');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.previaDepreciacao(corpo), contexto);
};

/**
 * Uma página de opções ATIVAS de um seletor (keyset nome+id).
 * @param {string} recurso
 * @param {{ empresa_id?: string|null, q?: string, cursor?: string|null, limit?: number, familia_id?: string|null }} [filtros]
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesBemPatrimonial = async (recurso, filtros = {}) => {
  const contexto = ctx('listOpcoesBemPatrimonial', 'BemPatrimonial');
  assertArgument(RECURSOS_OPCOES_PATRIMONIO.includes(recurso), 'recurso', contexto);
  if (RECURSOS_OPCOES_DA_EMPRESA.includes(recurso)) assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.opcoes(recurso, filtros), contexto));
  const itens = isObjeto(bruto) && Array.isArray(bruto.itens) ? bruto.itens : [];
  const proximo = isObjeto(bruto) && typeof bruto.next_cursor === 'string' && bruto.next_cursor ? bruto.next_cursor : null;
  return { itens, has_more: Boolean(isObjeto(bruto) && bruto.has_more === true && proximo), next_cursor: proximo };
};
