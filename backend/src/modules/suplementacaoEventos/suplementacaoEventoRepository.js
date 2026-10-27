/**
 * Repositório de SuplementacaoEvento (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.suplementacaoEvento.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.suplementacaoEvento.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.suplementacaoEvento.create({ data: dados });

export const inserirRegistros = async (tx, lista) =>
  tx.suplementacaoEvento.createMany({ data: lista });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.suplementacaoEvento.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.suplementacaoEvento.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
