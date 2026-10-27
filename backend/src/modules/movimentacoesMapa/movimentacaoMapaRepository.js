/**
 * Repositório de MovimentacaoMapa (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.movimentacaoMapa.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.movimentacaoMapa.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.movimentacaoMapa.create({ data: dados });

export const inserirRegistros = async (tx, lista) =>
  tx.movimentacaoMapa.createMany({ data: lista });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.movimentacaoMapa.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.movimentacaoMapa.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
