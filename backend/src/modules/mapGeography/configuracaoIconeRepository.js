import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  tipo_entidade: true,
  categoria: true,
  icone_url: true,
  sub_icone_url: true,
  cor_padrao: true,
  descricao: true,
  categorias_misto: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarIcones = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.configuracaoIcone.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/** @param {string} clienteId @param {string} id @param {import('@prisma/client').Prisma.TransactionClient} [tx] */
export const buscarIcone = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.configuracaoIcone.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirIcone = async (tx, dados) =>
  tx.configuracaoIcone.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} clienteId @param {string} id @param {object} dados */
export const atualizarIconePorId = async (tx, clienteId, id, dados) =>
  tx.configuracaoIcone.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });
