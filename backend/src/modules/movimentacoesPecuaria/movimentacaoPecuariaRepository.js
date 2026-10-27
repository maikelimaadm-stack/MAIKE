/**
 * Repositório de MovimentacaoPecuaria (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { opcoesTakeDeFiltros } from '../../shared/http/listQueryLimit.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.movimentacaoPecuaria.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...opcoesTakeDeFiltros(filtros),
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.movimentacaoPecuaria.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.movimentacaoPecuaria.create({ data: dados });

export const inserirRegistros = async (tx, lista) =>
  tx.movimentacaoPecuaria.createMany({ data: lista });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.movimentacaoPecuaria.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.movimentacaoPecuaria.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
