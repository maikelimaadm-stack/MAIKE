/**
 * API do módulo Atividades — cadastro de tipos de atividade (D-PROD-182; padrões
 * e flags, D-PROD-197) e o Lançamento de Atividades (D-PROD-200): a ATIVIDADE
 * (cabeçalho aberto) e os APONTAMENTOS dela, por dia e turno.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import {
  FLAGS_TIPO_ATIVIDADE,
  RECURSOS_OPCOES_TIPO_ATIVIDADE,
  opcoesNativas as opcoesDoTipoNativas,
  tipoAtividadeDeResposta,
  tipoAtividadePort,
} from './tipoAtividadePort.js';
import { RECURSOS_OPCOES_ATIVIDADE, operacoesNativas as atividadeNativa } from './lancamentoAtividadePort.js';
import { LIMITE_PADRAO, normalizarEnvelopePagina } from '@/lib/cadastroListaScale';

const RESOURCE = 'TipoAtividade';
/** @param {unknown} valor */
const isId = (valor) => typeof valor === 'string' && valor.trim().length > 0;
/** @param {unknown} valor */
const isObjeto = (valor) => Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
/** @param {unknown} registros */
const comoLista = (registros) => (Array.isArray(registros) ? registros : []);
/** @param {string} operation */
const ctx = (operation) => ({ operation, resource: RESOURCE });

export { FLAGS_TIPO_ATIVIDADE, RECURSOS_OPCOES_TIPO_ATIVIDADE };

// A resposta passa por `tipoAtividadeDeResposta` DEPOIS do adapter offline: o
// registro do cache (inclusive o criado sem conexão) chega à tela na mesma forma.
export const listTiposAtividade = async (_opcoes = {}) =>
  comoLista(await runProviderCall(() => tipoAtividadePort.list(), ctx('listTiposAtividade'))).map(tipoAtividadeDeResposta);

/** @param {string} id */
export const getTipoAtividade = async (id) => {
  const contexto = ctx('getTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  return tipoAtividadeDeResposta(await runProviderCall(() => tipoAtividadePort.get(id), { ...contexto, details: { id } }));
};

/** @param {Record<string, unknown>} dados */
export const createTipoAtividade = async (dados) => {
  const contexto = ctx('createTipoAtividade');
  assertArgument(isObjeto(dados), 'dados', contexto);
  return tipoAtividadeDeResposta(await runProviderCall(() => tipoAtividadePort.create(dados), contexto));
};

/** @param {string} id @param {Record<string, unknown>} dados */
export const updateTipoAtividade = async (id, dados) => {
  const contexto = ctx('updateTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(dados), 'dados', contexto);
  return tipoAtividadeDeResposta(await runProviderCall(() => tipoAtividadePort.update(id, dados), { ...contexto, details: { id } }));
};

/**
 * Centros ATIVOS de uma fazenda para os padrões do tipo (D-PROD-197, contrato
 * §3.4): `{ itens: [{ id, numero, nome }] }`, por `numero`, até 1000, sem
 * página. Recurso e empresa são obrigatórios (falha ANTES da rede); a empresa
 * de outro cliente volta 404 do servidor.
 * @param {string} recurso 'centros-custo' | 'centros-resultado'
 * @param {string} empresaId
 * @returns {Promise<{ itens: any[] }>}
 */
export const listOpcoesTipoAtividade = async (recurso, empresaId) => {
  const contexto = ctx('listOpcoesTipoAtividade');
  assertArgument(RECURSOS_OPCOES_TIPO_ATIVIDADE.includes(recurso), 'recurso', contexto);
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => opcoesDoTipoNativas.listar(recurso, empresaId), { ...contexto, details: { recurso } });
  const o = isObjeto(bruto) ? /** @type {Record<string, unknown>} */ (bruto) : {};
  const itens = Array.isArray(o.itens) ? o.itens.filter((item) => isObjeto(item) && isId(item.id)) : [];
  return { itens };
};

/** @param {string} id */
export const deleteTipoAtividade = async (id) => {
  const contexto = ctx('deleteTipoAtividade');
  assertArgument(isId(id), 'id', contexto);
  return runProviderCall(() => tipoAtividadePort.delete(id), { ...contexto, details: { id } });
};

// ─── Lançamento de Atividades (D-PROD-200) ──────────────────────────────

const RESOURCE_ATIVIDADE = 'Atividade';
const RESOURCE_APONTAMENTO = 'AtividadeApontamento';
/** @param {string} operation */
const ctxAtividade = (operation) => ({ operation, resource: RESOURCE_ATIVIDADE });
/** @param {string} operation */
const ctxApontamento = (operation) => ({ operation, resource: RESOURCE_APONTAMENTO });
/** @param {unknown} v */
const ehVersao = (v) => Number.isInteger(v) && /** @type {number} */ (v) >= 1;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
/** @param {unknown} v */
const ehDia = (v) => typeof v === 'string' && RE_DIA.test(v);
/** @param {unknown} v */
const ehObjetoComEmpresa = (v) => isObjeto(v) && isId(/** @type {Record<string, unknown>} */ (v).empresa_id);

export { RECURSOS_OPCOES_ATIVIDADE };

/**
 * Escrita de apontamento (criar, editar, cancelar, duplicar): `{ apontamento,
 * atividade, alertas }` (§10). `atividade` é o cabeçalho com os totais
 * recalculados; `alertas` é `[]` ou `[{ codigo: 'FORA_DO_INTERVALO', … }]`.
 * @param {unknown} bruto
 * @returns {{ apontamento: any, atividade: any, alertas: any[] }}
 */
const respostaDeApontamento = (bruto) => {
  const o = isObjeto(bruto) ? /** @type {Record<string, any>} */ (bruto) : {};
  return {
    apontamento: isObjeto(o.apontamento) ? o.apontamento : null,
    atividade: isObjeto(o.atividade) ? o.atividade : null,
    alertas: Array.isArray(o.alertas) ? o.alertas.filter(isObjeto) : [],
  };
};

/**
 * Uma página (keyset `createdAt desc, id desc`) das atividades da EMPRESA, com
 * os filtros da tela (status, tipo, área e o período sobre `data_inicio`).
 * @param {Record<string, unknown>} [filtros]
 */
export const listAtividadesPage = async (filtros = {}) => {
  const contexto = ctxAtividade('listAtividadesPage');
  assertArgument(isId(filtros.empresa_id), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => atividadeNativa.listPage(filtros), contexto);
  return normalizarEnvelopePagina(bruto, Number(filtros.limit) || LIMITE_PADRAO);
};

/** Detalhe: o cabeçalho com os objetos e os `totais`. @param {string} id @param {string} empresaId */
export const getAtividade = async (id, empresaId) => {
  const contexto = ctxAtividade('getAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return runProviderCall(() => atividadeNativa.get(id, empresaId), { ...contexto, details: { id } });
};

/**
 * Abrir atividade: empresa, tipo e nome são obrigatórios (falha ANTES da rede).
 * @param {Record<string, unknown>} corpo
 */
export const createAtividade = async (corpo) => {
  const contexto = ctxAtividade('createAtividade');
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(isId(corpo.tipo_atividade_id), 'tipo_atividade_id', contexto);
  assertArgument(isId(corpo.nome), 'nome', contexto);
  return runProviderCall(() => atividadeNativa.create(corpo), contexto);
};

/**
 * Editar o cabeçalho (só ABERTA no servidor), com a `versao` lida (CAS).
 * @param {string} id @param {Record<string, unknown>} corpo
 */
export const updateAtividade = async (id, corpo) => {
  const contexto = ctxAtividade('updateAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isObjeto(corpo) && ehVersao(corpo.versao), 'versao', contexto);
  return runProviderCall(() => atividadeNativa.update(id, corpo), { ...contexto, details: { id } });
};

/**
 * Concluir (só ABERTA): `data_conclusao` opcional (o servidor usa hoje na fazenda).
 * @param {string} id @param {{ empresa_id: string, versao: number, data_conclusao?: string }} corpo
 */
export const completeAtividade = async (id, corpo) => {
  const contexto = ctxAtividade('completeAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  if (corpo.data_conclusao !== undefined) assertArgument(ehDia(corpo.data_conclusao), 'data_conclusao', contexto);
  return runProviderCall(() => atividadeNativa.concluir(id, corpo), { ...contexto, details: { id } });
};

/**
 * Reabrir (só CONCLUIDA, permissão própria): motivo obrigatório.
 * @param {string} id @param {{ empresa_id: string, versao: number, motivo: string }} corpo
 */
export const reopenAtividade = async (id, corpo) => {
  const contexto = ctxAtividade('reopenAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(isId(corpo.motivo), 'motivo', contexto);
  return runProviderCall(() => atividadeNativa.reabrir(id, corpo), { ...contexto, details: { id } });
};

/**
 * Cancelar (só ABERTA): motivo obrigatório; o servidor cancela junto os
 * apontamentos confirmados.
 * @param {string} id @param {{ empresa_id: string, versao: number, motivo: string }} corpo
 */
export const cancelAtividade = async (id, corpo) => {
  const contexto = ctxAtividade('cancelAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(isId(corpo.motivo), 'motivo', contexto);
  return runProviderCall(() => atividadeNativa.cancelar(id, corpo), { ...contexto, details: { id } });
};

/**
 * Duplicar: abertura NOVA a partir desta (nome, tipo, área, máquina, safra, área
 * planejada, tarefa e observação; sem apontamentos). Corpo opcional além da empresa.
 * @param {string} id @param {{ empresa_id: string, nome?: string, data_inicio?: string, data_prevista_fim?: string }} corpo
 */
export const duplicateAtividade = async (id, corpo) => {
  const contexto = ctxAtividade('duplicateAtividade');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  return runProviderCall(() => atividadeNativa.duplicar(id, corpo), { ...contexto, details: { id } });
};

/**
 * Apontamentos da atividade: `{ items }` (sem paginação; dia desc, turno, sequência).
 * @param {string} atividadeId @param {string} empresaId
 * @returns {Promise<{ items: any[] }>}
 */
export const listAtividadeApontamentos = async (atividadeId, empresaId) => {
  const contexto = ctxApontamento('listAtividadeApontamentos');
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => atividadeNativa.listApontamentos(atividadeId, empresaId), { ...contexto, details: { atividadeId } });
  const o = isObjeto(bruto) ? /** @type {Record<string, unknown>} */ (bruto) : {};
  return { items: Array.isArray(o.items) ? o.items.filter(isObjeto) : [] };
};

/** @param {string} atividadeId @param {string} apontamentoId @param {string} empresaId */
export const getAtividadeApontamento = async (atividadeId, apontamentoId, empresaId) => {
  const contexto = ctxApontamento('getAtividadeApontamento');
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(isId(apontamentoId), 'id', contexto);
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  return runProviderCall(() => atividadeNativa.getApontamento(atividadeId, apontamentoId, empresaId), {
    ...contexto,
    details: { atividadeId, apontamentoId },
  });
};

/**
 * Novo apontamento (só em atividade ABERTA): empresa e dia obrigatórios.
 * @param {string} atividadeId @param {Record<string, unknown>} corpo
 */
export const createAtividadeApontamento = async (atividadeId, corpo) => {
  const contexto = ctxApontamento('createAtividadeApontamento');
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(ehDia(corpo.data_operacional), 'data_operacional', contexto);
  return respostaDeApontamento(await runProviderCall(() => atividadeNativa.createApontamento(atividadeId, corpo), { ...contexto, details: { atividadeId } }));
};

/**
 * Editar o apontamento CONFIRMADO, com a `versao` lida (CAS).
 * @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} corpo
 */
export const updateAtividadeApontamento = async (atividadeId, apontamentoId, corpo) => {
  const contexto = ctxApontamento('updateAtividadeApontamento');
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(isId(apontamentoId), 'id', contexto);
  assertArgument(isObjeto(corpo) && ehVersao(corpo.versao), 'versao', contexto);
  return respostaDeApontamento(
    await runProviderCall(() => atividadeNativa.updateApontamento(atividadeId, apontamentoId, corpo), {
      ...contexto,
      details: { atividadeId, apontamentoId },
    }),
  );
};

/**
 * Cancelar o apontamento CONFIRMADO: motivo e `versao` obrigatórios.
 * @param {string} atividadeId @param {string} apontamentoId @param {{ empresa_id: string, versao: number, motivo: string }} corpo
 */
export const cancelAtividadeApontamento = async (atividadeId, apontamentoId, corpo) => {
  const contexto = ctxApontamento('cancelAtividadeApontamento');
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(isId(apontamentoId), 'id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(isId(corpo.motivo), 'motivo', contexto);
  return respostaDeApontamento(
    await runProviderCall(() => atividadeNativa.cancelarApontamento(atividadeId, apontamentoId, corpo), {
      ...contexto,
      details: { atividadeId, apontamentoId },
    }),
  );
};

/**
 * "Repetir" o apontamento (turno, operador, área do dia, produção e observação)
 * num dia (padrão hoje no servidor), com sequência nova.
 * @param {string} atividadeId @param {string} apontamentoId @param {{ empresa_id: string, data_operacional?: string }} corpo
 */
export const duplicateAtividadeApontamento = async (atividadeId, apontamentoId, corpo) => {
  const contexto = ctxApontamento('duplicateAtividadeApontamento');
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(isId(apontamentoId), 'id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  if (corpo.data_operacional !== undefined) assertArgument(ehDia(corpo.data_operacional), 'data_operacional', contexto);
  return respostaDeApontamento(
    await runProviderCall(() => atividadeNativa.duplicarApontamento(atividadeId, apontamentoId, corpo), {
      ...contexto,
      details: { atividadeId, apontamentoId },
    }),
  );
};

/**
 * Uma página de opções ATIVAS de um seletor da tela (`{ itens, has_more,
 * next_cursor }`; `has_more` só com cursor): máquinas (`bens`) ou operadores.
 * @param {string} recurso
 * @param {{ empresa_id: string, q?: string, cursor?: string|null, limit?: number }} filtros
 * @returns {Promise<{ itens: any[], has_more: boolean, next_cursor: string|null }>}
 */
export const listOpcoesAtividade = async (recurso, filtros) => {
  const contexto = ctxAtividade('listOpcoesAtividade');
  assertArgument(RECURSOS_OPCOES_ATIVIDADE.includes(recurso), 'recurso', contexto);
  assertArgument(ehObjetoComEmpresa(filtros), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => atividadeNativa.opcoes(recurso, filtros), { ...contexto, details: { recurso } });
  const o = isObjeto(bruto) ? /** @type {Record<string, unknown>} */ (bruto) : {};
  const itens = Array.isArray(o.itens) ? o.itens.filter(isObjeto) : [];
  const proximo = typeof o.next_cursor === 'string' && o.next_cursor ? o.next_cursor : null;
  return { itens, has_more: Boolean(o.has_more === true && proximo), next_cursor: proximo };
};

// ─── Linhas de produto e de máquina e totais (D-PROD-202, Fatia 3) ──────

/** Tipos de linha do apontamento (o segmento da rota). */
export const TIPOS_LINHA_ATIVIDADE = Object.freeze(['produtos', 'maquinas']);
/** @param {unknown} v */
const ehTipoDeLinha = (v) => typeof v === 'string' && TIPOS_LINHA_ATIVIDADE.includes(v);
/** @param {unknown} v */
const ehOperationId = (v) => typeof v === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(v);

/**
 * Totais da atividade (`GET /atividades/:id/totais`): `{ area_executada, area_planejada, unidade_area, produtos[],
 * maquinas[], custo_total, custo_por_ha }`. Só linhas confirmadas de apontamentos confirmados; `custo_por_ha` nulo sem área.
 * @param {string} id @param {string} empresaId
 */
export const getAtividadeTotais = async (id, empresaId) => {
  const contexto = ctxAtividade('getAtividadeTotais');
  assertArgument(isId(id), 'id', contexto);
  assertArgument(isId(empresaId), 'empresa_id', contexto);
  const bruto = await runProviderCall(() => atividadeNativa.totais(id, empresaId), { ...contexto, details: { id } });
  const o = isObjeto(bruto) ? /** @type {Record<string, any>} */ (bruto) : {};
  return {
    ...o,
    produtos: Array.isArray(o.produtos) ? o.produtos.filter(isObjeto) : [],
    maquinas: Array.isArray(o.maquinas) ? o.maquinas.filter(isObjeto) : [],
  };
};

/**
 * Adiciona UMA linha (produto ou máquina) ao apontamento CONFIRMADO de atividade ABERTA: a empresa, a `versao` do
 * apontamento (CAS) e o `operation_id` são obrigatórios (falha ANTES da rede). Devolve `{ apontamento, atividade, alertas }`.
 * @param {'produtos'|'maquinas'} tipo @param {string} atividadeId @param {string} apontamentoId @param {Record<string, unknown>} corpo
 */
export const createAtividadeLinha = async (tipo, atividadeId, apontamentoId, corpo) => {
  const contexto = ctxApontamento('createAtividadeLinha');
  assertArgument(ehTipoDeLinha(tipo), 'tipo', contexto);
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(isId(apontamentoId), 'apontamento_id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(ehOperationId(corpo.operation_id), 'operation_id', contexto);
  return respostaDeApontamento(
    await runProviderCall(() => atividadeNativa.criarLinha(tipo, atividadeId, apontamentoId, corpo), { ...contexto, details: { atividadeId, apontamentoId, tipo } }),
  );
};

/**
 * Edita UMA linha CONFIRMADA (produto: estorno exato + nova saída; máquina: cancela e cria outra, no servidor).
 * @param {'produtos'|'maquinas'} tipo @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId
 * @param {Record<string, unknown>} corpo
 */
export const updateAtividadeLinha = async (tipo, atividadeId, apontamentoId, linhaId, corpo) => {
  const contexto = ctxApontamento('updateAtividadeLinha');
  assertArgument(ehTipoDeLinha(tipo), 'tipo', contexto);
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(isId(apontamentoId), 'apontamento_id', contexto);
  assertArgument(isId(linhaId), 'linha_id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(ehOperationId(corpo.operation_id), 'operation_id', contexto);
  return respostaDeApontamento(
    await runProviderCall(() => atividadeNativa.editarLinha(tipo, atividadeId, apontamentoId, linhaId, corpo), {
      ...contexto,
      details: { atividadeId, apontamentoId, linhaId, tipo },
    }),
  );
};

/**
 * Cancela UMA linha CONFIRMADA com motivo (produto: estorno exato aos lotes de origem).
 * @param {'produtos'|'maquinas'} tipo @param {string} atividadeId @param {string} apontamentoId @param {string} linhaId
 * @param {{ empresa_id: string, versao: number, operation_id: string, motivo: string }} corpo
 */
export const cancelAtividadeLinha = async (tipo, atividadeId, apontamentoId, linhaId, corpo) => {
  const contexto = ctxApontamento('cancelAtividadeLinha');
  assertArgument(ehTipoDeLinha(tipo), 'tipo', contexto);
  assertArgument(isId(atividadeId), 'atividade_id', contexto);
  assertArgument(isId(apontamentoId), 'apontamento_id', contexto);
  assertArgument(isId(linhaId), 'linha_id', contexto);
  assertArgument(ehObjetoComEmpresa(corpo), 'empresa_id', contexto);
  assertArgument(ehVersao(corpo.versao), 'versao', contexto);
  assertArgument(ehOperationId(corpo.operation_id), 'operation_id', contexto);
  assertArgument(isId(corpo.motivo), 'motivo', contexto);
  return respostaDeApontamento(
    await runProviderCall(() => atividadeNativa.cancelarLinha(tipo, atividadeId, apontamentoId, linhaId, corpo), {
      ...contexto,
      details: { atividadeId, apontamentoId, linhaId, tipo },
    }),
  );
};

/**
 * Leitura do medidor de UM bem para a linha de máquina (`/atividades-opcoes/medidor`): tipo e unidade do medidor (do
 * bem), a leitura vigente na data e o teto do salto. O objeto do servidor, como veio (a tela normaliza).
 * @param {{ empresa_id: string, bem_id: string, data?: string }} filtros
 */
export const getMedidorAtividade = async (filtros) => {
  const contexto = ctxAtividade('getMedidorAtividade');
  assertArgument(ehObjetoComEmpresa(filtros), 'empresa_id', contexto);
  assertArgument(isId(filtros.bem_id), 'bem_id', contexto);
  const bruto = await runProviderCall(() => atividadeNativa.opcoes('medidor', filtros), { ...contexto, details: { recurso: 'medidor' } });
  return isObjeto(bruto) ? /** @type {Record<string, any>} */ (bruto) : {};
};
