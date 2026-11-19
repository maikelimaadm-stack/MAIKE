/**
 * Service das Entradas do Estoque (D-PROD-257). Sem fazenda real selecionada, nada é lido (página vazia).
 * Decimais são TEXTO canônico: nada aqui faz aritmética de ponto flutuante.
 */
import {
  listEntradasEstoque,
  getEntradaEstoque,
  createEntradaEstoque,
  updateEntradaEstoque,
  deleteEntradaEstoque,
  listOpcoesProdutosEntrada,
  listOpcoesLocaisEntrada,
} from '@/apis/estoque-entradas';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'EntradaEstoque';
export const POR_PAGINA_ENTRADAS = 100;

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, status?: string|null, motivo?: string|null, produtoId?: string|null,
 *   dataDe?: string|null, dataAte?: string|null }} [opts]
 */
export const listarEntradasEstoque = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_ENTRADAS;
  if (!empresaId) return paginaVazia(limit);
  return listEntradasEstoque({
    empresa_id: empresaId,
    status: textoOuIndefinido(opts.status),
    motivo: textoOuIndefinido(opts.motivo),
    produto_id: textoOuIndefinido(opts.produtoId),
    data_de: textoOuIndefinido(opts.dataDe),
    data_ate: textoOuIndefinido(opts.dataAte),
    q: textoOuIndefinido(opts.q),
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/** @param {string|null} empresaId @param {string} id */
export const detalharEntradaEstoque = async (empresaId, id) => getEntradaEstoque(id, exigirEmpresa(empresaId, 'detalharEntradaEstoque', RESOURCE));

/** Corpo já montado por `montarCorpoEntrada`. @param {Record<string, unknown>} corpo */
export const criarEntradaEstoque = async (corpo) => createEntradaEstoque(corpo);

/** @param {string|null} empresaId @param {{ id: string, versao: number }} entrada @param {{ motivoEdicao: string, observacao: string|null, justificativa?: string|null }} dados */
export const editarEntradaEstoque = async (empresaId, entrada, dados) =>
  updateEntradaEstoque(entrada.id, {
    empresa_id: exigirEmpresa(empresaId, 'editarEntradaEstoque', RESOURCE),
    versao: entrada.versao,
    motivo_edicao: dados.motivoEdicao,
    observacao: dados.observacao,
    ...(dados.justificativa !== undefined ? { justificativa: dados.justificativa } : {}),
  });

/** @param {string|null} empresaId @param {{ id: string, versao: number }} entrada @param {{ motivo: string, operationId: string }} dados */
export const excluirEntradaEstoque = async (empresaId, entrada, dados) =>
  deleteEntradaEstoque(entrada.id, {
    empresa_id: exigirEmpresa(empresaId, 'excluirEntradaEstoque', RESOURCE),
    versao: entrada.versao,
    motivo: dados.motivo,
    operation_id: dados.operationId,
  });

/** Produtos ativos da fazenda para o formulário. @param {string|null} empresaId @param {{ q?: string, cursor?: string|null, limit?: number }} [opts] */
export const listarProdutosDaEntrada = async (empresaId, opts = {}) => {
  if (!empresaId) return { itens: [], has_more: false, next_cursor: null };
  return listOpcoesProdutosEntrada({ empresa_id: empresaId, q: textoOuIndefinido(opts.q), cursor: textoOuIndefinido(opts.cursor), limit: opts.limit ?? 50 });
};

/** Depósitos ativos para o formulário. @param {{ q?: string, cursor?: string|null, limit?: number }} [opts] */
export const listarDepositosDaEntrada = async (opts = {}) =>
  listOpcoesLocaisEntrada({ q: textoOuIndefinido(opts.q), cursor: textoOuIndefinido(opts.cursor), limit: opts.limit ?? 50 });
