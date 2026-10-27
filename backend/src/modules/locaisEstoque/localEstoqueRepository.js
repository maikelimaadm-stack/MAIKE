/**
 * Repositório de LocalEstoque (P5.2, D-PROD-48).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

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
