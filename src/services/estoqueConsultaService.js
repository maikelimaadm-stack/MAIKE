/**
 * Service das consultas de Estoque (D-PROD-255): saldo e movimentos, somente
 * leitura. Sem fazenda real selecionada, nada é lido (página vazia).
 */
import {
  listSaldoEstoque,
  listMovimentosEstoque,
  getMovimentoEstoque,
  listOpcoesProdutosEstoque,
  listOpcoesLocaisEstoque,
} from '@/apis/estoque-consulta';
import { paginaVazia } from './gestaoCadastroComum.js';

/** Página padrão das listas. */
export const POR_PAGINA_ESTOQUE = 100;

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, produtoId?: string|null, localId?: string|null, somenteComSaldo?: boolean }} [opts]
 */
export const listarSaldoEstoque = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_ESTOQUE;
  if (!empresaId) return paginaVazia(limit);
  return listSaldoEstoque({
    empresa_id: empresaId,
    produto_id: textoOuIndefinido(opts.produtoId),
    local_estoque_id: textoOuIndefinido(opts.localId),
    q: textoOuIndefinido(opts.q),
    somente_com_saldo: opts.somenteComSaldo === false ? 'false' : undefined,
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, produtoId?: string|null, localId?: string|null, origem?: string|null,
 *   tipo?: string|null, dataDe?: string|null, dataAte?: string|null }} [opts]
 */
export const listarMovimentosEstoque = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_ESTOQUE;
  if (!empresaId) return paginaVazia(limit);
  return listMovimentosEstoque({
    empresa_id: empresaId,
    produto_id: textoOuIndefinido(opts.produtoId),
    local_estoque_id: textoOuIndefinido(opts.localId),
    origem_sistema: textoOuIndefinido(opts.origem),
    tipo_movimentacao: textoOuIndefinido(opts.tipo),
    data_de: textoOuIndefinido(opts.dataDe),
    data_ate: textoOuIndefinido(opts.dataAte),
    q: textoOuIndefinido(opts.q),
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/** @param {string|null} empresaId @param {string} id */
export const detalharMovimentoEstoque = async (empresaId, id) => {
  if (!empresaId) throw new Error('detalharMovimentoEstoque: empresa obrigatória');
  return getMovimentoEstoque(id, empresaId);
};

/** Produtos da fazenda para o filtro (até 100, por nome). @param {string|null} empresaId */
export const listarProdutosDoFiltro = async (empresaId) => {
  if (!empresaId) return [];
  const r = await listOpcoesProdutosEstoque({ empresa_id: empresaId, limit: 100 });
  return r.itens.map((p) => ({ id: String(p.id), nome: String(p.nome ?? '') }));
};

/** Depósitos para o filtro (até 100, por nome). */
export const listarDepositosDoFiltro = async () => {
  const r = await listOpcoesLocaisEstoque({ limit: 100 });
  return r.itens.map((l) => ({ id: String(l.id), nome: String(l.nome ?? '') }));
};
