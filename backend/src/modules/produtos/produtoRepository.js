/**
 * Repositório de Produto (P5.2, D-PROD-48).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { clausulaKeysetDesc } from '../../shared/pagination/keysetCursor.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero_produto: true,
  nome_produto: true,
  tipo_uso: true,
  codigo_interno: true,
  codigo_barras: true,
  categoria: true,
  marca: true,
  descricao: true,
  unidade_medida: true,
  preco_custo: true,
  preco_venda: true,
  estoque_atual: true,
  estoque_minimo: true,
  local_estoque: true,
  tipo_consumo: true,
  percentual_consumo_pv: true,
  consumo_minimo_pv: true,
  consumo_maximo_pv: true,
  unidade_principal_estoque: true,
  peso_por_saco_kg: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

export const listarProdutos = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  if (filtros.ativo !== undefined) where.ativo = filtros.ativo;
  return prisma.produto.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {{
 *   empresaId: string,
 *   q?: string|null,
 *   ativo?: boolean|null,
 *   cursor?: { createdAt: Date, id: string }|null,
 *   limit: number,
 * }} filtro
 */
export const montarWhereProdutos = (clienteId, filtro) => {
  /** @type {import('@prisma/client').Prisma.ProdutoWhereInput} */
  const where = { cliente_id: clienteId, empresa_id: filtro.empresaId };
  if (filtro.ativo === true || filtro.ativo === false) where.ativo = filtro.ativo;
  const q = typeof filtro.q === 'string' ? filtro.q.trim() : '';
  if (q) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { nome_produto: { contains: q, mode: 'insensitive' } },
          { codigo_interno: { contains: q, mode: 'insensitive' } },
          { codigo_barras: { contains: q, mode: 'insensitive' } },
          { categoria: { contains: q, mode: 'insensitive' } },
          { marca: { contains: q, mode: 'insensitive' } },
          { numero_produto: { contains: q, mode: 'insensitive' } },
        ],
      },
    ];
  }
  if (filtro.cursor) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), clausulaKeysetDesc(filtro.cursor)];
  }
  return where;
};

/** @param {string} clienteId @param {Parameters<typeof montarWhereProdutos>[1]} filtro */
export const listarProdutosPagina = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  return prisma.produto.findMany({
    where: montarWhereProdutos(clienteId, filtro),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: filtro.limit + 1,
    select: SELECAO,
  });
};

/** @param {string} clienteId @param {{ empresaId: string, q?: string|null, ativo?: boolean|null }} filtro */
export const contarProdutos = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  return prisma.produto.count({
    where: montarWhereProdutos(clienteId, {
      empresaId: filtro.empresaId,
      q: filtro.q,
      ativo: filtro.ativo,
      cursor: null,
      limit: 1,
    }),
  });
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} produtoId
 */
export const contarMovimentacoesPorProduto = async (tx, clienteId, produtoId) =>
  tx.movimentacaoEstoque.count({
    where: { cliente_id: clienteId, produto_id: produtoId },
  });

export const buscarProduto = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.produto.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

export const existeProdutoComNome = async (clienteId, empresaId, nome, ignorarId, tx) => {
  const cliente = tx || getPrismaClient();
  const existente = await cliente.produto.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      nome_produto: nome,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

export const inserirProduto = async (tx, dados) =>
  tx.produto.create({ data: dados, select: SELECAO });

export const atualizarProdutoPorId = async (tx, clienteId, id, dados) =>
  tx.produto.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

export const excluirProdutoPorId = async (tx, clienteId, id) =>
  tx.produto.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
