/**
 * API do módulo Patrimônio e Frota (D-PROD-157). Online só; página keyset do
 * motor Base1; opções de seletor paginadas no servidor (sem teto).
 *
 * Catálogos do tenant: nunca `empresa_id`. Bens e vínculos Combustível ×
 * Produto (R2): `empresa_id` obrigatório (query na leitura, corpo na gravação).
 * PATCH sempre com `versao` (CAS).
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
  const bruto = await runProviderCall(() => operacoesNativas.opcoes(recurso, filtros), contexto);
  return paginaDeOpcoes(bruto);
};

/**
 * Envelope de opções `{itens, has_more, next_cursor}`: `has_more` só com cursor.
 * @param {unknown} bruto
 * @returns {{ itens: any[], has_more: boolean, next_cursor: string|null }}
 */
const paginaDeOpcoes = (bruto) => {
  const o = isObjeto(bruto) ? bruto : {};
  const itens = Array.isArray(o.itens) ? o.itens : [];
  const proximo = typeof o.next_cursor === 'string' && o.next_cursor ? o.next_cursor : null;
  return { itens, has_more: Boolean(o.has_more === true && proximo), next_cursor: proximo };
};

/** Campos do item de produto elegível (contrato da P1-02): nada de preço, saldo ou custo. */
const CAMPOS_ELEGIVEL = Object.freeze([
  'tanque_id',
  'tanque_identificador',
  'tipo_combustivel_id',
  'tipo_combustivel_nome',
  'produto_id',
  'produto_nome',
  'unidade_principal_estoque',
  'empresa_id',
]);

/**
 * Produtos elegíveis de um bem (leitura para a P1-02): por tanque ATIVO do bem
 * (ou só o informado), interseção dos combustíveis do tanque com os vínculos
 * ATIVOS da empresa do bem e os produtos ATIVOS dessa empresa. Sem vínculo →
 * lista vazia. Cada item sai só com os campos do contrato.
 * @param {string} bemId
 * @param {{ empresa_id: string, tanque_id?: string|null }} filtros
 * @returns {Promise<{ itens: Array<Record<string, unknown>> }>}
 */
export const listProdutosElegiveisBemPatrimonial = async (bemId, filtros) => {
  const contexto = ctx('listProdutosElegiveisBemPatrimonial', 'BemPatrimonial');
  assertArgument(isId(bemId), 'id', contexto);
  assertArgument(isObjeto(filtros) && isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.bemProdutosElegiveis(bemId, filtros), contexto));
  const lista = Array.isArray(bruto) ? bruto : isObjeto(bruto) && Array.isArray(bruto.itens) ? bruto.itens : isObjeto(bruto) && Array.isArray(bruto.items) ? bruto.items : [];
  return {
    itens: lista.filter(isObjeto).map((item) => Object.fromEntries(CAMPOS_ELEGIVEL.map((campo) => [campo, item[campo] ?? null]))),
  };
};

// ─── Combustível × Produto por empresa (R2) ──────────────────────────────

const RESOURCE_VINCULO = 'TipoCombustivelProduto';

/**
 * Vínculos do tipo de combustível NA empresa (keyset; inativos inclusos para
 * rastreabilidade, salvo filtro `ativo`).
 * @param {string} tipoId
 * @param {{ empresa_id: string, ativo?: boolean, limit?: number, cursor?: string|null }} filtros
 */
export const listProdutosDoCombustivelPage = async (tipoId, filtros) => {
  const contexto = ctx('listProdutosDoCombustivelPage', RESOURCE_VINCULO);
  assertArgument(isId(tipoId), 'id', contexto);
  assertArgument(isObjeto(filtros) && isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.combustivelProdutosListPage(tipoId, filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/**
 * Vincula um produto da empresa ao tipo: corpo EXATO `{empresa_id, produto_id}`.
 * @param {string} tipoId @param {{ empresa_id: string, produto_id: string }} corpo
 */
export const createVinculoCombustivelProduto = async (tipoId, corpo) => {
  const contexto = ctx('createVinculoCombustivelProduto', RESOURCE_VINCULO);
  assertArgument(isId(tipoId), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(isId(corpo.produto_id), 'produto_id', contexto);
  assertArgument(Object.keys(corpo).every((k) => k === 'empresa_id' || k === 'produto_id'), 'corpo', contexto);
  return runProviderCall(() => operacoesNativas.combustivelProdutoCreate(tipoId, corpo), contexto);
};

/**
 * Inativa/reativa um vínculo: corpo EXATO `{empresa_id, versao, ativo}` (tipo,
 * produto e empresa são imutáveis; `versao` = concorrência otimista).
 * @param {string} vinculoId @param {{ empresa_id: string, versao: number, ativo: boolean }} corpo
 */
export const updateVinculoCombustivelProduto = async (vinculoId, corpo) => {
  const contexto = ctx('updateVinculoCombustivelProduto', RESOURCE_VINCULO);
  assertArgument(isId(vinculoId), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(typeof corpo.ativo === 'boolean', 'ativo', contexto);
  assertArgument(Object.keys(corpo).every((k) => k === 'empresa_id' || k === 'versao' || k === 'ativo'), 'corpo', contexto);
  return runProviderCall(() => operacoesNativas.combustivelProdutoUpdate(vinculoId, corpo), { ...contexto, details: { id: vinculoId } });
};

/**
 * Uma página de produtos ATIVOS da empresa para vincular (keyset nome+id); cada
 * item diz se o produto já tem vínculo ativo (`vinculo_ativo`).
 * @param {{ empresa_id: string, q?: string, cursor?: string|null, limit?: number }} filtros
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesProdutosCombustivel = async (filtros) => {
  const contexto = ctx('listOpcoesProdutosCombustivel', RESOURCE_VINCULO);
  assertArgument(isObjeto(filtros) && isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.combustivelProdutoOpcoes(filtros), contexto);
  return paginaDeOpcoes(bruto);
};
