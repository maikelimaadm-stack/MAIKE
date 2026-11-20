/**
 * Service dos Ajustes de inventário do Estoque (D-PROD-267). Sem fazenda real selecionada, nada é lido (página vazia).
 * Decimais são TEXTO canônico: nada aqui faz aritmética de ponto flutuante. O usuário digita o saldo CONTADO; o
 * servidor recalcula a diferença com o saldo do momento e valoriza (sobra e falta pelo custo médio do depósito; a
 * sobra sem saldo anterior, pelo custo informado). Os seletores são os da entrada (`estoqueEntradasService`).
 */
import {
  listAjustesEstoque,
  getAjusteEstoque,
  getSaldoAjusteEstoque,
  createAjusteEstoque,
  updateAjusteEstoque,
  deleteAjusteEstoque,
} from '@/apis/estoque-ajustes';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'AjusteEstoque';
export const POR_PAGINA_AJUSTES = 100;

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, status?: string|null, produtoId?: string|null, dataDe?: string|null, dataAte?: string|null }} [opts]
 */
export const listarAjustesEstoque = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_AJUSTES;
  if (!empresaId) return paginaVazia(limit);
  return listAjustesEstoque({
    empresa_id: empresaId,
    status: textoOuIndefinido(opts.status),
    produto_id: textoOuIndefinido(opts.produtoId),
    data_de: textoOuIndefinido(opts.dataDe),
    data_ate: textoOuIndefinido(opts.dataAte),
    q: textoOuIndefinido(opts.q),
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/** @param {string|null} empresaId @param {string} id */
export const detalharAjusteEstoque = async (empresaId, id) => getAjusteEstoque(id, exigirEmpresa(empresaId, 'detalharAjusteEstoque', RESOURCE));

/** Saldo atual e custo médio do produto no depósito. @param {string|null} empresaId @param {string} produtoId @param {string} localId */
export const saldoParaAjuste = async (empresaId, produtoId, localId) =>
  getSaldoAjusteEstoque({ empresa_id: exigirEmpresa(empresaId, 'saldoParaAjuste', RESOURCE), produto_id: produtoId, local_estoque_id: localId });

/** Corpo já montado por `montarCorpoAjuste`. @param {Record<string, unknown>} corpo */
export const criarAjusteEstoque = async (corpo) => createAjusteEstoque(corpo);

/** @param {string|null} empresaId @param {{ id: string, versao: number }} ajuste @param {{ motivoEdicao: string, observacao: string|null }} dados */
export const editarAjusteEstoque = async (empresaId, ajuste, dados) =>
  updateAjusteEstoque(ajuste.id, {
    empresa_id: exigirEmpresa(empresaId, 'editarAjusteEstoque', RESOURCE),
    versao: ajuste.versao,
    motivo_edicao: dados.motivoEdicao,
    observacao: dados.observacao,
  });

/** @param {string|null} empresaId @param {{ id: string, versao: number }} ajuste @param {{ motivo: string, operationId: string }} dados */
export const excluirAjusteEstoque = async (empresaId, ajuste, dados) =>
  deleteAjusteEstoque(ajuste.id, {
    empresa_id: exigirEmpresa(empresaId, 'excluirAjusteEstoque', RESOURCE),
    versao: ajuste.versao,
    motivo: dados.motivo,
    operation_id: dados.operationId,
  });
