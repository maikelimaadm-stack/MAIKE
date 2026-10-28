/**
 * Repositório de LocalEstoque (P5.2, D-PROD-48).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { clausulaKeysetDesc } from '../../shared/pagination/keysetCursor.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  numero_local: true,
  nome: true,
  descricao: true,
  capacidade: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

export const listarLocais = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.localEstoque.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {{
 *   q?: string|null,
 *   ativo?: boolean|null,
 *   cursor?: { createdAt: Date, id: string }|null,
 *   limit: number,
 * }} filtro
 */
export const montarWhereLocais = (clienteId, filtro) => {
  /** @type {import('@prisma/client').Prisma.LocalEstoqueWhereInput} */
  const where = { cliente_id: clienteId };
  if (filtro.ativo === true || filtro.ativo === false) where.ativo = filtro.ativo;
  const q = typeof filtro.q === 'string' ? filtro.q.trim() : '';
  if (q) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          { descricao: { contains: q, mode: 'insensitive' } },
          { capacidade: { contains: q, mode: 'insensitive' } },
          { numero_local: { contains: q, mode: 'insensitive' } },
        ],
      },
    ];
  }
  if (filtro.cursor) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), clausulaKeysetDesc(filtro.cursor)];
  }
  return where;
};

/**
 * @param {string} clienteId
 * @param {{
 *   q?: string|null,
 *   ativo?: boolean|null,
 *   cursor?: { createdAt: Date, id: string }|null,
 *   limit: number,
 * }} filtro
 */
export const listarLocaisPagina = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  return prisma.localEstoque.findMany({
    where: montarWhereLocais(clienteId, filtro),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: filtro.limit + 1,
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {{ q?: string|null, ativo?: boolean|null }} filtro
 */
export const contarLocais = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  return prisma.localEstoque.count({
    where: montarWhereLocais(clienteId, {
      q: filtro.q,
      ativo: filtro.ativo,
      cursor: null,
      limit: 1,
    }),
  });
};

const CATEGORIA_DEPOSITO = 'DEPOSITO';

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} localId
 */
export const motivoBloqueioExclusaoLocal = async (tx, clienteId, localId, nomeLocal) => {
  const deposito = await tx.pontoSuplementacao.findFirst({
    where: {
      cliente_id: clienteId,
      local_estoque_id: localId,
      categoria_ponto: CATEGORIA_DEPOSITO,
    },
    select: { id: true },
  });
  if (deposito) return 'deposito_do_mapa';

  const produto = await tx.produto.findFirst({
    where: { cliente_id: clienteId, local_estoque: nomeLocal },
    select: { id: true },
  });
  if (produto) return 'produtos_vinculados';

  const movimentacao = await tx.movimentacaoEstoque.findFirst({
    where: {
      cliente_id: clienteId,
      OR: [{ local_estoque_origem: localId }, { local_estoque_destino: localId }],
    },
    select: { id: true },
  });
  if (movimentacao) return 'movimentacoes_vinculadas';

  const lote = await tx.estoqueLoteNota.findFirst({
    where: {
      cliente_id: clienteId,
      local_estoque_id: localId,
      quantidade_disponivel: { gt: 0 },
    },
    select: { id: true },
  });
  if (lote) return 'saldo_em_estoque';

  return null;
};

export const buscarLocal = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.localEstoque.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

export const inserirLocal = async (tx, dados) =>
  tx.localEstoque.create({ data: dados, select: SELECAO });

export const atualizarLocalPorId = async (tx, clienteId, id, dados) =>
  tx.localEstoque.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

export const excluirLocalPorId = async (tx, clienteId, id) =>
  tx.localEstoque.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
