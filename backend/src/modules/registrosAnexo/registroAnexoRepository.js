import { getPrismaClient } from '../../database/prismaClient.js';

export const listarPorFiltro = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtro.entidade) where.entidade = filtro.entidade;
  if (filtro.entidade_id) where.entidade_id = filtro.entidade_id;
  return prisma.registroAnexo.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscar = async (clienteId, id, tx) => {
  const db = tx || getPrismaClient();
  return db.registroAnexo.findFirst({
    where: { cliente_id: clienteId, id },
  });
};

export const inserir = async (tx, dados) => tx.registroAnexo.create({ data: dados });

export const excluir = async (tx, clienteId, id) =>
  tx.registroAnexo.deleteMany({
    where: { cliente_id: clienteId, id },
  });
