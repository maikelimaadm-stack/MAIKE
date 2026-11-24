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
  listOpcoesFornecedoresEntrada,
  listOpcoesCentrosEntrada,
  listMotivosEntrada,
  createMotivoEntrada,
  updateMotivoEntrada,
} from '@/apis/estoque-entradas';
import { comandoTransferenciaEntreLocais } from '@/apis/movimentacoes-estoque';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'EntradaEstoque';
export const POR_PAGINA_ENTRADAS = 100;

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, status?: string|null, motivo?: string|null, motivoId?: string|null, produtoId?: string|null,
 *   dataDe?: string|null, dataAte?: string|null }} [opts]
 */
export const listarEntradasEstoque = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_ENTRADAS;
  if (!empresaId) return paginaVazia(limit);
  return listEntradasEstoque({
    empresa_id: empresaId,
    status: textoOuIndefinido(opts.status),
    motivo: textoOuIndefinido(opts.motivo),
    motivo_id: textoOuIndefinido(opts.motivoId),
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

/** @param {string|null} empresaId @param {{ id: string, versao: number }} entrada @param {{ motivoEdicao: string, observacao: string|null }} dados */
export const editarEntradaEstoque = async (empresaId, entrada, dados) =>
  updateEntradaEstoque(entrada.id, {
    empresa_id: exigirEmpresa(empresaId, 'editarEntradaEstoque', RESOURCE),
    versao: entrada.versao,
    motivo_edicao: dados.motivoEdicao,
    observacao: dados.observacao,
  });

/**
 * D-PROD-271 — edição completa (SUBSTITUIÇÃO): o corpo já montado por `montarCorpoEdicaoEntrada` (a versão nova
 * completa + `empresa_id`, `versao`, `motivo_edicao` e `operation_id`). @param {string} id @param {Record<string, unknown>} corpo
 */
export const substituirEntradaEstoque = async (id, corpo) => updateEntradaEstoque(id, corpo);

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

// ─── D-PROD-259 ─────────────────────────────────────────────────────────────

const VAZIA = Object.freeze({ itens: [], has_more: false, next_cursor: null });

/** Fornecedores da fazenda (papel de fornecedor/prestador). @param {string|null} empresaId @param {{ q?: string, cursor?: string|null, limit?: number }} [opts] */
export const listarFornecedoresDaEntrada = async (empresaId, opts = {}) =>
  empresaId ? listOpcoesFornecedoresEntrada({ empresa_id: empresaId, q: textoOuIndefinido(opts.q), cursor: textoOuIndefinido(opts.cursor), limit: opts.limit ?? 50 }) : VAZIA;

/** Centros de custo ou de resultado ativos. @param {'custo'|'resultado'} lado @param {string|null} empresaId @param {{ q?: string, cursor?: string|null, limit?: number }} [opts] */
export const listarCentrosDaEntrada = async (lado, empresaId, opts = {}) =>
  empresaId ? listOpcoesCentrosEntrada(lado, { empresa_id: empresaId, q: textoOuIndefinido(opts.q), cursor: textoOuIndefinido(opts.cursor), limit: opts.limit ?? 50 }) : VAZIA;

/** Motivos de entrada do cliente (os padrões nascem na 1ª leitura). @param {{ ativos?: boolean }} [opts] */
export const listarMotivosEntrada = async (opts = {}) => listMotivosEntrada({ ativos: opts.ativos === true });

/** @param {string} nome */
export const criarMotivoEntrada = async (nome) => createMotivoEntrada({ nome });

/** @param {string} id @param {{ nome?: string, ativo?: boolean }} dados */
export const editarMotivoEntrada = async (id, dados) => updateMotivoEntrada(id, dados);

/**
 * Transferência entre depósitos pelo "Novo movimento" (o mesmo comando do Mapa; o servidor confere saldo, locais e a
 * permissão). `quantidade` na unidade de estoque do produto (kg ou L), como número do corpo do comando.
 * @param {string|null} empresaId
 * @param {{ operationId: string, produtoId: string, origemId: string, destinoId: string, quantidade: number, data: string|null, observacao: string|null, lotes?: Array<{ estoque_lote_nota_id: string, quantidade: string }> }} dados `lotes` (D-PROD-281): só com escolha manual
 */
export const transferirEntreDepositos = async (empresaId, dados) =>
  comandoTransferenciaEntreLocais({
    operation_id: dados.operationId,
    empresa_id: exigirEmpresa(empresaId, 'transferirEntreDepositos', 'MovimentacaoEstoqueComando'),
    produto_id: dados.produtoId,
    local_origem_id: dados.origemId,
    local_destino_id: dados.destinoId,
    quantidade: dados.quantidade,
    data_movimentacao: dados.data,
    observacoes: dados.observacao,
    ...(dados.lotes ? { lotes: dados.lotes } : {}), // D-PROD-281
  });
