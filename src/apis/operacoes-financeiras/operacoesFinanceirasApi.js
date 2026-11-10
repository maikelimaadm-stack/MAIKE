/**
 * API da Central Única de Lançamentos (D-PROD-155): documento gerencial
 * `OperacaoFinanceira` (PAGAR|RECEBER × COM|SEM produtos × AVISTA|PRAZO|PARCELADO),
 * títulos, liquidações manuais e o perfil financeiro da empresa. Online só.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { operacoesNativas } from './operacaoFinanceiraNativePort.js';
import { normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'OperacaoFinanceira';
/** Teto do servidor para a listagem (§4: limit 1..100). */
export const LIMITE_MAXIMO_LISTA = 100;
const RECURSOS_OPCOES = new Set(['parceiros', 'produtos', 'locais', 'saldos', 'naturezas', 'centros-custo', 'centros-resultado']);

/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.trim().length > 0;
/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });
/** @param {Record<string, unknown>} corpo @param {string} operation */
const exigirCorpoComEmpresa = (corpo, operation) => assertArgument(isObjeto(corpo) && isId(corpo.empresa_id), 'empresa_id', ctx(operation));
/** @param {Record<string, unknown>} corpo @param {string} operation */
const exigirOperationId = (corpo, operation) =>
  assertArgument(typeof corpo.operation_id === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(corpo.operation_id), 'operation_id', ctx(operation));

/** @param {string} empresaId */
export const getPerfilFinanceiroEmpresa = async (empresaId) => {
  const contexto = ctx('getPerfilFinanceiroEmpresa');
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return runProviderCall(() => operacoesNativas.getPerfil(empresaId), contexto);
};

/** @param {{ empresa_id: string, pais: string, moeda: string, locale: string }} corpo */
export const putPerfilFinanceiroEmpresa = async (corpo) => {
  exigirCorpoComEmpresa(corpo, 'putPerfilFinanceiroEmpresa');
  return runProviderCall(() => operacoesNativas.putPerfil(corpo), ctx('putPerfilFinanceiroEmpresa'));
};

/** @param {Record<string, unknown>} [filtros] */
export const listOperacoesFinanceirasPage = async (filtros = {}) => {
  const contexto = ctx('listOperacoesFinanceirasPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const limit = Math.min(Math.max(Number(filtros.limit) || 50, 1), LIMITE_MAXIMO_LISTA);
  const bruto = await runProviderCall(() => operacoesNativas.listPage({ ...filtros, limit }), contexto);
  return normalizarEnvelopePagina(bruto, limit);
};

/** @param {string} id @param {string} empresaId */
export const getOperacaoFinanceira = async (id, empresaId) => {
  const contexto = ctx('getOperacaoFinanceira');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  return runProviderCall(() => operacoesNativas.get(id, empresaId), contexto);
};

/** @param {Record<string, unknown>} corpo DOC + operation_id */
export const createOperacaoFinanceira = async (corpo) => {
  exigirCorpoComEmpresa(corpo, 'createOperacaoFinanceira');
  exigirOperationId(corpo, 'createOperacaoFinanceira');
  return runProviderCall(() => operacoesNativas.create(corpo), ctx('createOperacaoFinanceira'));
};

/** @param {string} id @param {Record<string, unknown>} corpo DOC + versao */
export const replaceOperacaoFinanceira = async (id, corpo) => {
  const contexto = ctx('replaceOperacaoFinanceira');
  assertArgument(isId(id), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'replaceOperacaoFinanceira');
  assertArgument(Number.isInteger(corpo.versao), 'versao', contexto);
  return runProviderCall(() => operacoesNativas.replace(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} id @param {string} empresaId @param {number} versao */
export const deleteOperacaoFinanceira = async (id, empresaId, versao) => {
  const contexto = ctx('deleteOperacaoFinanceira');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  assertArgument(Number.isInteger(versao), 'versao', contexto);
  return runProviderCall(() => operacoesNativas.remove(id, empresaId, versao), { ...contexto, details: { id } });
};

/**
 * `plano: null` é preservado: o servidor o devolve quando o PLANEJAMENTO recusa
 * (os `bloqueios` dizem por quê) e a tela não pode anunciar parcelas nem títulos.
 * @param {string} id @param {string} empresaId @returns {Promise<{ plano: any|null, bloqueios: any[] }>}
 */
export const previaOperacaoFinanceira = async (id, empresaId) => {
  const contexto = ctx('previaOperacaoFinanceira');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.previa(id, empresaId), contexto));
  return { plano: isObjeto(bruto?.plano) ? bruto.plano : null, bloqueios: Array.isArray(bruto?.bloqueios) ? bruto.bloqueios : [] };
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const confirmarOperacaoFinanceira = async (id, corpo) => {
  const contexto = ctx('confirmarOperacaoFinanceira');
  assertArgument(isId(id), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'confirmarOperacaoFinanceira');
  exigirOperationId(corpo, 'confirmarOperacaoFinanceira');
  return runProviderCall(() => operacoesNativas.confirmar(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} id @param {Record<string, unknown>} corpo */
export const cancelarOperacaoFinanceira = async (id, corpo) => {
  const contexto = ctx('cancelarOperacaoFinanceira');
  assertArgument(isId(id), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'cancelarOperacaoFinanceira');
  exigirOperationId(corpo, 'cancelarOperacaoFinanceira');
  return runProviderCall(() => operacoesNativas.cancelar(id, corpo), { ...contexto, details: { id } });
};

// ─── D-PROD-158 — elegibilidade, correção (retificar) e exclusão lógica ──

/** Motivos de uma ação: só objetos com `codigo` texto (o resto é descartado). @param {unknown} v */
const motivosDe = (v) => (Array.isArray(v) ? v.filter((m) => isObjeto(m) && typeof m.codigo === 'string' && m.codigo) : []);

/**
 * Uma ação da elegibilidade, FECHADA por padrão: só é permitida com
 * `permitido === true` E um modo do contrato (quando a ação tem modo). Resposta
 * fora do contrato nunca libera a ação.
 * @param {unknown} bruto @param {readonly string[]|null} modos
 */
const acaoDaElegibilidade = (bruto, modos) => {
  const a = isObjeto(bruto) ? bruto : {};
  const modo = modos && typeof a.modo === 'string' && modos.includes(a.modo) ? a.modo : null;
  const permitido = a.permitido === true && (modos === null || modo !== null);
  return { permitido, modo: permitido ? modo : null, motivos: motivosDe(a.motivos) };
};

/**
 * `GET /operacoes-financeiras/:id/elegibilidade` normalizado (SPEC §3). A
 * decisão final é sempre do servidor, DENTRO da transação do comando: isto só
 * explica à tela o que ele observou agora.
 * @param {string} id @param {string} empresaId
 * @returns {Promise<{ id: string, versao: number|null, status: string|null,
 *   editar: { permitido: boolean, modo: 'RASCUNHO'|'RETIFICACAO'|null, efeito_fisico_permitido: boolean, motivos: any[] },
 *   excluir: { permitido: boolean, modo: 'DESCARTE'|'LOGICA'|null, motivos: any[] },
 *   duplicar: { permitido: boolean, motivos: any[] } }>}
 */
export const getElegibilidadeOperacaoFinanceira = async (id, empresaId) => {
  const contexto = ctx('elegibilidadeOperacaoFinanceira');
  assertArgument(isId(id) && isId(empresaId), 'id', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.elegibilidade(id, empresaId), { ...contexto, details: { id } }));
  const b = isObjeto(bruto) ? bruto : {};
  const editar = acaoDaElegibilidade(b.editar, ['RASCUNHO', 'RETIFICACAO']);
  const excluir = acaoDaElegibilidade(b.excluir, ['DESCARTE', 'LOGICA']);
  return {
    id: isId(b.id) ? String(b.id) : id,
    versao: typeof b.versao === 'number' && Number.isInteger(b.versao) ? b.versao : null,
    status: typeof b.status === 'string' ? b.status : null,
    editar: {
      ...editar,
      modo: /** @type {'RASCUNHO'|'RETIFICACAO'|null} */ (editar.modo),
      // Sem a resposta explícita do servidor, mexer no estoque NÃO é prometido.
      efeito_fisico_permitido: editar.permitido && isObjeto(b.editar) && b.editar.efeito_fisico_permitido === true,
    },
    excluir: { ...excluir, modo: /** @type {'DESCARTE'|'LOGICA'|null} */ (excluir.modo) },
    duplicar: acaoDaElegibilidade(b.duplicar, null),
  };
};

/** Corpo dos comandos de confirmado: versão (CAS) e motivo obrigatório (até 500). @param {Record<string, unknown>} corpo @param {string} operation */
const exigirVersaoEMotivo = (corpo, operation) => {
  assertArgument(Number.isInteger(corpo.versao), 'versao', ctx(operation));
  assertArgument(typeof corpo.motivo === 'string' && corpo.motivo.trim().length > 0 && corpo.motivo.length <= 500, 'motivo', ctx(operation));
};

/**
 * `POST /operacoes-financeiras/:id/retificar` — DOC completo + `versao`,
 * `operation_id` e `motivo`. A resposta é o detalhe do documento ATUAL (o novo,
 * na substituição) com `retificacao: { modo, operacao_anterior_id, operacao_atual_id }`.
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const retificarOperacaoFinanceira = async (id, corpo) => {
  const contexto = ctx('retificarOperacaoFinanceira');
  assertArgument(isId(id), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'retificarOperacaoFinanceira');
  exigirOperationId(corpo, 'retificarOperacaoFinanceira');
  exigirVersaoEMotivo(corpo, 'retificarOperacaoFinanceira');
  return runProviderCall(() => operacoesNativas.retificar(id, corpo), { ...contexto, details: { id } });
};

/**
 * `POST /operacoes-financeiras/:id/excluir` — exclusão LÓGICA do confirmado
 * (`{empresa_id, versao, operation_id, motivo}`); nunca DELETE de confirmado.
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const excluirOperacaoFinanceira = async (id, corpo) => {
  const contexto = ctx('excluirOperacaoFinanceira');
  assertArgument(isId(id), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'excluirOperacaoFinanceira');
  exigirOperationId(corpo, 'excluirOperacaoFinanceira');
  exigirVersaoEMotivo(corpo, 'excluirOperacaoFinanceira');
  return runProviderCall(() => operacoesNativas.excluir(id, corpo), { ...contexto, details: { id } });
};

/** @param {string} tituloId @param {Record<string, unknown>} corpo */
export const registrarLiquidacaoTitulo = async (tituloId, corpo) => {
  const contexto = ctx('registrarLiquidacaoTitulo');
  assertArgument(isId(tituloId), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'registrarLiquidacaoTitulo');
  exigirOperationId(corpo, 'registrarLiquidacaoTitulo');
  return runProviderCall(() => operacoesNativas.liquidar(tituloId, corpo), { ...contexto, details: { id: tituloId } });
};

/** @param {string} liquidacaoId @param {Record<string, unknown>} corpo */
export const estornarLiquidacaoFinanceira = async (liquidacaoId, corpo) => {
  const contexto = ctx('estornarLiquidacaoFinanceira');
  assertArgument(isId(liquidacaoId), 'id', contexto);
  exigirCorpoComEmpresa(corpo, 'estornarLiquidacaoFinanceira');
  exigirOperationId(corpo, 'estornarLiquidacaoFinanceira');
  return runProviderCall(() => operacoesNativas.estornar(liquidacaoId, corpo), { ...contexto, details: { id: liquidacaoId } });
};

/**
 * Uma página de opções de um seletor da tela (rotas próprias guardadas pela
 * tela de Lançamentos — quem só tem esta tela não leva 403).
 * @param {string} recurso
 * @param {Record<string, unknown>} filtros
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesOperacaoFinanceira = async (recurso, filtros) => {
  const contexto = ctx(`listOpcoes:${recurso}`);
  assertArgument(RECURSOS_OPCOES.has(recurso), 'recurso', contexto);
  assertArgument(isObjeto(filtros), 'filtros', contexto);
  const bruto = /** @type {any} */ (await runProviderCall(() => operacoesNativas.opcoes(recurso, filtros), contexto));
  const itens = isObjeto(bruto) && Array.isArray(bruto.itens) ? bruto.itens : [];
  const proximo = isObjeto(bruto) && typeof bruto.next_cursor === 'string' && bruto.next_cursor ? bruto.next_cursor : null;
  return { itens, has_more: Boolean(isObjeto(bruto) && bruto.has_more === true && proximo), next_cursor: proximo };
};
