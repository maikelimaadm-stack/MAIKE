/**
 * Repositório de UnidadeMedida (P4.5, D-PROD-44).
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  numero_unidade: true,
  sigla: true,
  descricao: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarUnidades = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.unidadeMedida.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ sigla: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarUnidade = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.unidadeMedida.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} siglaNormalizada
 * @param {string} [ignorarId]
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const existeUnidadeComSigla = async (clienteId, siglaNormalizada, ignorarId, tx) => {
  const cliente = tx || getPrismaClient();
  const existente = await cliente.unidadeMedida.findFirst({
    where: {
      cliente_id: clienteId,
      sigla: siglaNormalizada,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirUnidade = async (tx, dados) =>
  tx.unidadeMedida.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const atualizarUnidadePorId = async (tx, clienteId, id, dados) =>
  tx.unidadeMedida.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirUnidadePorId = async (tx, clienteId, id) =>
  tx.unidadeMedida.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
