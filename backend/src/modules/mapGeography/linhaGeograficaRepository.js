import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero_linha: true,
  nome: true,
  sigla: true,
  tipo: true,
  coordenadas: true,
  comprimento_metros: true,
  cor: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarLinhas = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.linhaGeografica.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/** @param {string} clienteId @param {string} id @param {import('@prisma/client').Prisma.TransactionClient} [tx] */
export const buscarLinha = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.linhaGeografica.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirLinha = async (tx, dados) =>
  tx.linhaGeografica.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} clienteId @param {string} id @param {object} dados */
export const atualizarLinhaPorId = async (tx, clienteId, id, dados) =>
  tx.linhaGeografica.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });
