/**
 * API do módulo Patrimônio e Frota (D-PROD-157). Online só; página keyset do
 * motor Base1; opções de seletor paginadas no servidor (sem teto).
 *
 * Catálogos do tenant: nunca `empresa_id`. Bens e vínculos Combustível ×
 * Produto (R2): `empresa_id` obrigatório (query na leitura, corpo na gravação).
 * PATCH sempre com `versao` (CAS).
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { CAMINHOS_CATALOGO, RECURSOS_OPCOES_ABASTECIMENTO, operacoesNativas } from './patrimonioNativePort.js';
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

// ─── Abastecimentos e fatores kg/L (D-PROD-159) ──────────────────────────

export { RECURSOS_OPCOES_ABASTECIMENTO };

const RESOURCE_ABASTECIMENTO = 'AbastecimentoBem';
const RESOURCE_CONVERSAO = 'ConversaoCombustivelProduto';

/** Corpo base da prévia e da confirmação (schema FECHADO no servidor). */
const CORPO_BASE_ABASTECIMENTO = Object.freeze([
  'empresa_id',
  'bem_id',
  'tanque_id',
  'tipo_combustivel_id',
  'produto_id',
  'local_estoque_id',
  'data_operacional',
  'quantidade_litros',
  'medidor_leitura',
  'tanque_cheio',
  'observacao',
  'referencia_externa',
]);
const OBRIGATORIAS_PREVIA = Object.freeze(['empresa_id', 'bem_id', 'tanque_id', 'tipo_combustivel_id', 'produto_id', 'local_estoque_id', 'data_operacional', 'quantidade_litros']);
const EXTRAS_CONFIRMACAO = Object.freeze(['operation_id', 'conversao_id', 'conversao_versao']);
const CORPO_CONFIRMACAO = Object.freeze([...CORPO_BASE_ABASTECIMENTO, ...EXTRAS_CONFIRMACAO]);
const CORPO_CANCELAMENTO = Object.freeze(['empresa_id', 'versao', 'motivo', 'operation_id']);
const CORPO_CONVERSAO = Object.freeze(['empresa_id', 'tipo_combustivel_id', 'produto_id', 'kg_por_litro', 'declara_estoque_em_kg', 'conversao_vigente_id']);
const CORPO_ENCERRAR_CONVERSAO = Object.freeze(['empresa_id', 'versao']);

/** Litros e leitura: texto canônico até 10 inteiros e 4 casas (sem número/float). */
const RE_DECIMAL_4 = /^\d{1,10}(\.\d{1,4})?$/;
/** Fator kg/L: texto canônico até 2 inteiros e 6 casas. */
const RE_FATOR = /^\d{1,2}(\.\d{1,6})?$/;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
/** Mesmo formato do schema do servidor. */
export const PADRAO_OPERATION_ID_ABASTECIMENTO = /^[A-Za-z0-9_.:-]{8,128}$/;

/** @param {Record<string, unknown>} corpo @param {readonly string[]} permitidas */
const soChaves = (corpo, permitidas) => Object.keys(corpo).every((k) => permitidas.includes(k));
/** @param {Record<string, unknown>} corpo @param {readonly string[]} obrigatorias */
const comChaves = (corpo, obrigatorias) => obrigatorias.every((k) => tem(corpo, k));
/** @param {unknown} v */
const textoOuNulo = (v) => v === null || typeof v === 'string';

/**
 * Validação local comum da prévia e da confirmação (falha ANTES da rede).
 * @param {Record<string, unknown>} corpo @param {{ operation: string, resource: string }} contexto
 */
const validarCorpoAbastecimento = (corpo, contexto) => {
  assertArgument(isId(corpo.empresa_id), 'empresa_id', contexto);
  for (const campo of ['bem_id', 'tanque_id', 'tipo_combustivel_id', 'produto_id', 'local_estoque_id']) assertArgument(isId(corpo[campo]), campo, contexto);
  assertArgument(typeof corpo.data_operacional === 'string' && RE_DIA.test(corpo.data_operacional), 'data_operacional', contexto);
  assertArgument(typeof corpo.quantidade_litros === 'string' && RE_DECIMAL_4.test(corpo.quantidade_litros), 'quantidade_litros', contexto);
  if (tem(corpo, 'medidor_leitura')) {
    assertArgument(corpo.medidor_leitura === null || (typeof corpo.medidor_leitura === 'string' && RE_DECIMAL_4.test(corpo.medidor_leitura)), 'medidor_leitura', contexto);
  }
  if (tem(corpo, 'tanque_cheio')) assertArgument(typeof corpo.tanque_cheio === 'boolean', 'tanque_cheio', contexto);
  for (const campo of ['observacao', 'referencia_externa']) if (tem(corpo, campo)) assertArgument(textoOuNulo(corpo[campo]), campo, contexto);
};

/** @param {Record<string, unknown>} [filtros] */
export const listAbastecimentosPage = async (filtros = {}) => {
  const contexto = ctx('listAbastecimentosPage', RESOURCE_ABASTECIMENTO);
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.abastecimentosListPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** @param {string} id @param {string} empresaId */
export const getAbastecimento = async (id, empresaId) => {
  const contexto = ctx('getAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.abastecimentoGet(id, empresaId), contexto);
};

/**
 * Prévia SEM escrita (A3): o plano (kg, fator e versão, lotes FIFO, custo
 * estimado, medidor) e os bloqueios que impediriam a confirmação.
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<{ plano: any, bloqueios: any[] }>}
 */
export const previaAbastecimento = async (corpo) => {
  const contexto = ctx('previaAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(isObjeto(corpo) && soChaves(corpo, CORPO_BASE_ABASTECIMENTO), 'corpo', contexto);
  assertArgument(comChaves(corpo, OBRIGATORIAS_PREVIA), 'corpo', contexto);
  validarCorpoAbastecimento(corpo, contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.abastecimentoPrevia(corpo), contexto));
  return {
    plano: isObjeto(bruto) && isObjeto(bruto.plano) ? bruto.plano : null,
    bloqueios: isObjeto(bruto) && Array.isArray(bruto.bloqueios) ? bruto.bloqueios.filter(isObjeto) : [],
  };
};

/**
 * Confirmação (A4): corpo EXATO com `operation_id` (idempotência) e o fator
 * (`conversao_id`/`conversao_versao`) visto na prévia.
 * @param {Record<string, unknown>} corpo
 */
export const confirmarAbastecimento = async (corpo) => {
  const contexto = ctx('confirmarAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(isObjeto(corpo) && soChaves(corpo, CORPO_CONFIRMACAO) && comChaves(corpo, CORPO_CONFIRMACAO), 'corpo', contexto);
  validarCorpoAbastecimento(corpo, contexto);
  assertArgument(typeof corpo.operation_id === 'string' && PADRAO_OPERATION_ID_ABASTECIMENTO.test(corpo.operation_id), 'operation_id', contexto);
  assertArgument(isId(corpo.conversao_id), 'conversao_id', contexto);
  assertArgument(ehVersao(corpo.conversao_versao), 'conversao_versao', contexto);
  return runProviderCall(() => operacoesNativas.abastecimentoConfirmar(corpo), contexto);
};

/**
 * Cancelamento com estorno exato (A5): corpo EXATO `{empresa_id, versao, motivo, operation_id}`.
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const cancelarAbastecimento = async (id, corpo) => {
  const contexto = ctx('cancelarAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && soChaves(corpo, CORPO_CANCELAMENTO) && comChaves(corpo, CORPO_CANCELAMENTO), 'corpo', contexto);
  assertArgument(isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(typeof corpo.motivo === 'string' && corpo.motivo.trim().length > 0 && corpo.motivo.length <= 500, 'motivo', contexto);
  assertArgument(typeof corpo.operation_id === 'string' && PADRAO_OPERATION_ID_ABASTECIMENTO.test(corpo.operation_id), 'operation_id', contexto);
  return runProviderCall(() => operacoesNativas.abastecimentoCancelar(id, corpo), { ...contexto, details: { id } });
};

/**
 * Opções da tela Abastecimentos (A7–A12, A16). `tanques` → `{bem, itens}`;
 * `locais` → `{itens}` (com saldo da empresa); `produtos-do-bem` → página com
 * `bem` e `resumo` (ramo próprio: `paginaDeOpcoes` descartaria as duas);
 * demais → página `{itens, has_more, next_cursor}`.
 * @param {string} recurso @param {Record<string, unknown>} [filtros]
 * @returns {Promise<any>}
 */
export const listOpcoesAbastecimento = async (recurso, filtros = {}) => {
  const contexto = ctx('listOpcoesAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(RECURSOS_OPCOES_ABASTECIMENTO.includes(recurso), 'recurso', contexto);
  if (recurso !== 'tipos') assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  if (recurso === 'tanques') assertArgument(isId(filtros.bem_id), 'bem_id', contexto);
  if (recurso === 'produtos') assertArgument(isId(filtros.tipo_combustivel_id), 'tipo_combustivel_id', contexto);
  if (recurso === 'locais') assertArgument(isId(filtros.produto_id), 'produto_id', contexto);
  if (recurso === 'produtos-do-bem') assertArgument(isId(filtros.bem_id), 'bem_id', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.abastecimentoOpcoes(recurso, filtros), contexto));
  if (recurso === 'tanques') {
    return { bem: isObjeto(bruto) && isObjeto(bruto.bem) ? bruto.bem : null, itens: isObjeto(bruto) && Array.isArray(bruto.itens) ? bruto.itens.filter(isObjeto) : [] };
  }
  if (recurso === 'locais') return { itens: isObjeto(bruto) && Array.isArray(bruto.itens) ? bruto.itens.filter(isObjeto) : [] };
  if (recurso === 'produtos-do-bem') {
    const o = isObjeto(bruto) ? bruto : {};
    const pagina = paginaDeOpcoes(o);
    return {
      bem: isObjeto(o.bem) ? o.bem : null,
      itens: pagina.itens.filter(isObjeto),
      has_more: pagina.has_more,
      next_cursor: pagina.next_cursor,
      resumo: isObjeto(o.resumo) ? o.resumo : null,
    };
  }
  return paginaDeOpcoes(bruto);
};

/** Consumo do bem (A6): intervalos entre tanques cheios, com metodologia. @param {Record<string, unknown>} filtros */
export const getConsumoAbastecimento = async (filtros) => {
  const contexto = ctx('getConsumoAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(isObjeto(filtros) && isId(filtros.empresa_id), 'empresa_id', contexto);
  assertArgument(isId(filtros.bem_id), 'bem_id', contexto);
  return runProviderCall(() => operacoesNativas.abastecimentoConsumo(filtros), contexto);
};

/** Fatores kg/L da empresa (A13; keyset). @param {Record<string, unknown>} [filtros] */
export const listConversoesCombustivelPage = async (filtros = {}) => {
  const contexto = ctx('listConversoesCombustivelPage', RESOURCE_CONVERSAO);
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.conversoesListPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/**
 * Novo fator (A14): encerra a vigente do par (`conversao_vigente_id` lido pela
 * tela, ou null) e cria a próxima versão. Corpo EXATO; fator como TEXTO.
 * @param {Record<string, unknown>} corpo
 */
export const createConversaoCombustivel = async (corpo) => {
  const contexto = ctx('createConversaoCombustivel', RESOURCE_CONVERSAO);
  assertArgument(isObjeto(corpo) && soChaves(corpo, CORPO_CONVERSAO) && comChaves(corpo, CORPO_CONVERSAO), 'corpo', contexto);
  assertArgument(isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(isId(corpo.tipo_combustivel_id), 'tipo_combustivel_id', contexto);
  assertArgument(isId(corpo.produto_id), 'produto_id', contexto);
  assertArgument(typeof corpo.kg_por_litro === 'string' && RE_FATOR.test(corpo.kg_por_litro), 'kg_por_litro', contexto);
  assertArgument(typeof corpo.declara_estoque_em_kg === 'boolean', 'declara_estoque_em_kg', contexto);
  assertArgument(corpo.conversao_vigente_id === null || isId(corpo.conversao_vigente_id), 'conversao_vigente_id', contexto);
  return runProviderCall(() => operacoesNativas.conversaoCriar(corpo), contexto);
};

/** Encerra o fator vigente (A15): corpo EXATO `{empresa_id, versao}`. @param {string} id @param {Record<string, unknown>} corpo */
export const encerrarConversaoCombustivel = async (id, corpo) => {
  const contexto = ctx('encerrarConversaoCombustivel', RESOURCE_CONVERSAO);
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && soChaves(corpo, CORPO_ENCERRAR_CONVERSAO) && comChaves(corpo, CORPO_ENCERRAR_CONVERSAO), 'corpo', contexto);
  assertArgument(isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  return runProviderCall(() => operacoesNativas.conversaoEncerrar(id, corpo), { ...contexto, details: { id } });
};
