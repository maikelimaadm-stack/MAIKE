/**
 * API do módulo Patrimônio e Frota (D-PROD-157, simplificada pela D-PROD-162 e
 * pela D-PROD-169). Online só; página keyset do motor Base1; opções de seletor
 * paginadas no servidor (sem teto).
 *
 * Catálogo do tenant: nunca `empresa_id`. D-PROD-169: a tela só mexe nos
 * TIPOS — criados com `{natureza, nome}` (o servidor põe o tipo na família
 * padrão da natureza; `familia_id` não vai), renomeados por PATCH com `versao`
 * e excluídos por DELETE com `versao` (409 `PATRIMONIO_TIPO_EM_USO` quando
 * algum bem usa o tipo); o `codigo` é opcional no POST (P-05). Bens e os
 * Produtos que um tanque aceita: `empresa_id` obrigatório (query na leitura,
 * corpo na gravação); o bem vai com `natureza` + `tipo_id` (sem `familia_id`:
 * o servidor a deriva do tipo). PATCH sempre com `versao` (CAS). Abastecimento:
 * `quantidade` na unidade de estoque do Produto (L; kg para KG e SACO), sem
 * conversão nem fator.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { CAMINHOS_CATALOGO, RECURSOS_OPCOES_ABASTECIMENTO, operacoesNativas } from './patrimonioNativePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';
import { UNIDADES_ESTOQUE_TANQUE, ehNatureza } from '@/lib/patrimonioDominio';

/**
 * Recursos de opções (A3): `tipos` (catálogo do tenant) não pede empresa; os
 * demais pedem. `produtos` (D-PROD-162; D-PROD-169) = Produtos ativos da
 * fazenda, em L, KG ou SACO, que um tanque pode aceitar (filtro opcional
 * `unidade`). D-PROD-169: saíram `familias` e `areas` (a tela não as usa mais).
 */
export const RECURSOS_OPCOES_PATRIMONIO = Object.freeze(['tipos', 'produtos', 'responsaveis', 'parceiros', 'centros-custo']);
export const RECURSOS_OPCOES_DA_EMPRESA = Object.freeze(['produtos', 'responsaveis', 'parceiros', 'centros-custo']);

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
  assertArgument(filtros.natureza == null || ehNatureza(filtros.natureza), 'natureza', contexto);
  const bruto = await runProviderCall(() => operacoesNativas.catalogoListPage(recurso, filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/**
 * POST de tipo (D-PROD-169): `{natureza, nome, codigo?, descricao?,
 * vida_util_meses_sugerida?}`. `natureza` = o "Tipo de bem" (o servidor põe o
 * tipo na família padrão dela; `familia_id` não vai); `nome` obrigatório;
 * `codigo` opcional (P-05: sem ele o servidor gera a partir do nome) e, se
 * vier, não vazio. Nunca `empresa_id` nem `perfis` (o servidor responderia 400).
 * @param {string} recurso @param {Record<string, unknown>} corpo
 */
export const createPatrimonioCatalogo = async (recurso, corpo) => {
  const contexto = ctx('createPatrimonioCatalogo', String(recurso));
  assertArgument(ehCatalogo(recurso), 'recurso', contexto);
  assertArgument(isObjeto(corpo) && !tem(corpo, 'empresa_id'), 'empresa_id', contexto);
  assertArgument(ehNatureza(corpo.natureza) && !tem(corpo, 'familia_id'), 'natureza', contexto);
  assertArgument(isId(corpo.nome), 'nome', contexto);
  assertArgument(!tem(corpo, 'codigo') || isId(corpo.codigo), 'codigo', contexto);
  assertArgument(!tem(corpo, 'perfis'), 'perfis', contexto);
  return runProviderCall(() => operacoesNativas.catalogoCreate(recurso, corpo), contexto);
};

/**
 * PATCH com `versao` (concorrência otimista). Código e campos de classificação
 * (natureza da família, família do tipo) nunca vão: são imutáveis.
 * @param {string} recurso @param {string} id @param {Record<string, unknown>} corpo
 */
export const updatePatrimonioCatalogo = async (recurso, id, corpo) => {
  const contexto = ctx('updatePatrimonioCatalogo', String(recurso));
  assertArgument(ehCatalogo(recurso), 'recurso', contexto);
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && ehVersao(corpo.versao), 'versao', contexto);
  for (const imutavel of ['codigo', 'natureza', 'familia_id', 'empresa_id', 'perfis']) {
    assertArgument(!tem(corpo, imutavel), imutavel, contexto);
  }
  return runProviderCall(() => operacoesNativas.catalogoUpdate(recurso, id, corpo), { ...contexto, details: { id } });
};

/**
 * DELETE de um tipo (D-PROD-169) com a `versao` lida: 204 quando nenhum bem
 * (ativo ou inativo) usa o tipo; 409 `PATRIMONIO_TIPO_EM_USO` (`details.bens`)
 * quando algum usa; 409 `PATRIMONIO_VERSAO_CONFLITO` quando outra pessoa mexeu
 * no tipo antes.
 * @param {string} recurso @param {string} id @param {number} versao
 */
export const deletePatrimonioCatalogo = async (recurso, id, versao) => {
  const contexto = ctx('deletePatrimonioCatalogo', String(recurso));
  assertArgument(ehCatalogo(recurso), 'recurso', contexto);
  assertArgument(isId(id), 'id', contexto);
  assertArgument(ehVersao(versao), 'versao', contexto);
  await runProviderCall(() => operacoesNativas.catalogoDelete(recurso, id, versao), { ...contexto, details: { id } });
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

/**
 * POST do bem (D-PROD-169): `natureza` (o "Tipo de bem") + `tipo_id`, sem
 * `familia_id` (o servidor a deriva do tipo e exige a mesma natureza).
 * @param {Record<string, unknown>} corpo
 */
export const createBemPatrimonial = async (corpo) => {
  const contexto = ctx('createBemPatrimonial', 'BemPatrimonial');
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehNatureza(corpo.natureza), 'natureza', contexto);
  assertArgument(isId(corpo.tipo_id), 'tipo_id', contexto);
  assertArgument(!tem(corpo, 'familia_id'), 'familia_id', contexto);
  return runProviderCall(() => operacoesNativas.bemCreate(corpo), contexto);
};

/**
 * PATCH mínimo do agregado (bem + medidor + tanques com os Produtos aceitos) com `versao`.
 * `numero` e `natureza` nunca vão (imutáveis); `familia_id` também não
 * (D-PROD-169: o servidor a deriva do `tipo_id`); `empresa_id` é só escopo.
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const updateBemPatrimonial = async (id, corpo) => {
  const contexto = ctx('updateBemPatrimonial', 'BemPatrimonial');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(!tem(corpo, 'numero') && !tem(corpo, 'natureza'), 'numero', contexto);
  assertArgument(!tem(corpo, 'familia_id'), 'familia_id', contexto);
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
 * Uma página de opções ATIVAS de um seletor (keyset nome+id). Em `produtos`
 * (D-PROD-162; D-PROD-169), cada item é `{ id, nome, codigo_interno,
 * unidade_principal_estoque }` e `unidade` (`L` | `KG` | `SACO`) filtra; sem
 * ela, vêm todas. Em `tipos` (D-PROD-169), `natureza` filtra pelo "Tipo de bem".
 * @param {string} recurso
 * @param {{ empresa_id?: string|null, q?: string, cursor?: string|null, limit?: number, natureza?: string|null, unidade?: 'L'|'KG'|'SACO'|null }} [filtros]
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesBemPatrimonial = async (recurso, filtros = {}) => {
  const contexto = ctx('listOpcoesBemPatrimonial', 'BemPatrimonial');
  assertArgument(RECURSOS_OPCOES_PATRIMONIO.includes(recurso), 'recurso', contexto);
  if (RECURSOS_OPCOES_DA_EMPRESA.includes(recurso)) assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  if (recurso === 'tipos' && filtros.natureza != null) assertArgument(ehNatureza(filtros.natureza), 'natureza', contexto);
  if (recurso === 'produtos' && filtros.unidade != null) {
    assertArgument(typeof filtros.unidade === 'string' && UNIDADES_ESTOQUE_TANQUE.includes(filtros.unidade), 'unidade', contexto);
  }
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

// ─── Abastecimentos (D-PROD-159, simplificados pela D-PROD-162) ──────────

export { RECURSOS_OPCOES_ABASTECIMENTO };

const RESOURCE_ABASTECIMENTO = 'AbastecimentoBem';

/**
 * Corpo base da prévia e da confirmação (schema FECHADO no servidor).
 * D-PROD-162: `quantidade` na unidade de estoque do Produto (L; kg para KG e,
 * D-PROD-169, para SACO); saíram
 * `tipo_combustivel_id`, `quantidade_litros` e `conversao_*` (o servidor
 * responderia 400 — aqui falha antes da rede).
 */
const CORPO_BASE_ABASTECIMENTO = Object.freeze([
  'empresa_id',
  'bem_id',
  'tanque_id',
  'produto_id',
  'local_estoque_id',
  'data_operacional',
  'quantidade',
  'medidor_leitura',
  'tanque_cheio',
  'observacao',
  'referencia_externa',
]);
/**
 * D-PROD-210 — opcionais: `origem` (`ESTOQUE` padrão | `EXTERNO`), `custo_total` (só no `EXTERNO`: o valor da nota,
 * até 2 casas) e `apontamento_id` (o lançamento da atividade; a atividade o servidor deriva e nunca vai). No
 * `EXTERNO` o `local_estoque_id` NÃO vai.
 */
const OPCIONAIS_ABASTECIMENTO = Object.freeze(['origem', 'custo_total', 'apontamento_id']);
const CORPO_ABASTECIMENTO = Object.freeze([...CORPO_BASE_ABASTECIMENTO, ...OPCIONAIS_ABASTECIMENTO]);
const OBRIGATORIAS_PREVIA = Object.freeze(['empresa_id', 'bem_id', 'tanque_id', 'produto_id', 'local_estoque_id', 'data_operacional', 'quantidade']);
const EXTRAS_CONFIRMACAO = Object.freeze(['operation_id']);
const CORPO_CONFIRMACAO = Object.freeze([...CORPO_BASE_ABASTECIMENTO, ...EXTRAS_CONFIRMACAO]);
/** @param {Record<string, unknown>} corpo */
const ehCorpoExterno = (corpo) => corpo.origem === 'EXTERNO';
/** As chaves obrigatórias do corpo (o `EXTERNO` sem o local). @param {readonly string[]} chaves @param {Record<string, unknown>} corpo */
const obrigatoriasDoCorpo = (chaves, corpo) => (ehCorpoExterno(corpo) ? chaves.filter((k) => k !== 'local_estoque_id') : chaves);
/** Valor da nota do posto externo: texto canônico positivo com até 2 casas. */
const RE_CUSTO_EXTERNO = /^\d{1,10}(\.\d{1,2})?$/;
const CORPO_CANCELAMENTO = Object.freeze(['empresa_id', 'versao', 'motivo', 'operation_id']);

/** Quantidade e leitura: texto canônico até 10 inteiros e 4 casas (sem número/float; `PADRAO_QUANTIDADE` no servidor). */
const RE_DECIMAL_4 = /^\d{1,10}(\.\d{1,4})?$/;
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
  for (const campo of ['bem_id', 'tanque_id', 'produto_id']) assertArgument(isId(corpo[campo]), campo, contexto);
  if (tem(corpo, 'origem')) assertArgument(corpo.origem === 'ESTOQUE' || corpo.origem === 'EXTERNO', 'origem', contexto);
  if (ehCorpoExterno(corpo)) {
    // Posto externo: sem local (o servidor recusaria) e com o valor da nota.
    assertArgument(!tem(corpo, 'local_estoque_id'), 'local_estoque_id', contexto);
    assertArgument(typeof corpo.custo_total === 'string' && RE_CUSTO_EXTERNO.test(corpo.custo_total) && /[1-9]/.test(corpo.custo_total), 'custo_total', contexto);
  } else {
    assertArgument(isId(corpo.local_estoque_id), 'local_estoque_id', contexto);
    assertArgument(!tem(corpo, 'custo_total'), 'custo_total', contexto);
  }
  if (tem(corpo, 'apontamento_id')) assertArgument(isId(corpo.apontamento_id), 'apontamento_id', contexto);
  assertArgument(typeof corpo.data_operacional === 'string' && RE_DIA.test(corpo.data_operacional), 'data_operacional', contexto);
  assertArgument(typeof corpo.quantidade === 'string' && RE_DECIMAL_4.test(corpo.quantidade), 'quantidade', contexto);
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
 * Prévia SEM escrita (A3): o plano (quantidade e unidade do Produto, lotes FIFO,
 * custo estimado, medidor) e os bloqueios que impediriam a confirmação.
 * @param {Record<string, unknown>} corpo
 * @returns {Promise<{ plano: any, bloqueios: any[] }>}
 */
export const previaAbastecimento = async (corpo) => {
  const contexto = ctx('previaAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(isObjeto(corpo) && soChaves(corpo, CORPO_ABASTECIMENTO), 'corpo', contexto);
  assertArgument(comChaves(corpo, obrigatoriasDoCorpo(OBRIGATORIAS_PREVIA, corpo)), 'corpo', contexto);
  validarCorpoAbastecimento(corpo, contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.abastecimentoPrevia(corpo), contexto));
  return {
    plano: isObjeto(bruto) && isObjeto(bruto.plano) ? bruto.plano : null,
    bloqueios: isObjeto(bruto) && Array.isArray(bruto.bloqueios) ? bruto.bloqueios.filter(isObjeto) : [],
  };
};

/**
 * Confirmação (A4): corpo EXATO com `operation_id` (idempotência; recibo v2 no
 * servidor). D-PROD-162: sem fator — a baixa é a `quantidade` digitada.
 * @param {Record<string, unknown>} corpo
 */
export const confirmarAbastecimento = async (corpo) => {
  const contexto = ctx('confirmarAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(
    isObjeto(corpo) && soChaves(corpo, [...CORPO_CONFIRMACAO, ...OPCIONAIS_ABASTECIMENTO]) && comChaves(corpo, obrigatoriasDoCorpo(CORPO_CONFIRMACAO, corpo)),
    'corpo',
    contexto,
  );
  validarCorpoAbastecimento(corpo, contexto);
  assertArgument(typeof corpo.operation_id === 'string' && PADRAO_OPERATION_ID_ABASTECIMENTO.test(corpo.operation_id), 'operation_id', contexto);
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
 * Opções da tela Abastecimentos (A7, A8, A11, A12, A16). `tanques` → `{bem, itens}`
 * (cada tanque com os Produtos aceitos); `locais` → `{itens}` (com o saldo na
 * unidade do Produto); `produtos-do-bem` → página com `bem` e `resumo` (ramo
 * próprio: `paginaDeOpcoes` descartaria as duas); demais → página
 * `{itens, has_more, next_cursor}`. Todas pedem a empresa.
 * @param {string} recurso @param {Record<string, unknown>} [filtros]
 * @returns {Promise<any>}
 */
export const listOpcoesAbastecimento = async (recurso, filtros = {}) => {
  const contexto = ctx('listOpcoesAbastecimento', RESOURCE_ABASTECIMENTO);
  assertArgument(RECURSOS_OPCOES_ABASTECIMENTO.includes(recurso), 'recurso', contexto);
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  if (recurso === 'tanques') assertArgument(isId(filtros.bem_id), 'bem_id', contexto);
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
