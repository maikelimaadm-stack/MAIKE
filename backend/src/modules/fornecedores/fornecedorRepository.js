/**
 * Repositório de Fornecedor (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.fornecedor.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.fornecedor.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.fornecedor.create({ data: dados });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.fornecedor.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.fornecedor.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
