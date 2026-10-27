/**
 * Repositório de Categoria (P5.2, D-PROD-48).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  numero_categoria: true,
  nome: true,
  categoria_pai_id: true,
  categoria_pai_nome: true,
  descricao: true,
  ordem: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

export const listarCategorias = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.categoria.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ ordem: 'asc' }, { nome: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

export const buscarCategoria = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.categoria.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

export const contarFilhas = async (tx, clienteId, paiId) =>
  tx.categoria.count({
    where: { cliente_id: clienteId, categoria_pai_id: paiId },
  });

export const inserirCategoria = async (tx, dados) =>
  tx.categoria.create({ data: dados, select: SELECAO });

export const atualizarCategoriaPorId = async (tx, clienteId, id, dados) =>
  tx.categoria.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

export const excluirCategoriaPorId = async (tx, clienteId, id) =>
  tx.categoria.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
