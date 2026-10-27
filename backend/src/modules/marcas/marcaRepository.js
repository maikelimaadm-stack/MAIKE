/**
 * Repositório de Marca (P4.4-Marcas, D-PROD-42).
 *
 * Nenhuma consulta sem `cliente_id`. Leituras e escritas usam o unique composto
 * `[cliente_id, id]`.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero_marca: true,
  nome: true,
  descricao: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarMarcas = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.marca.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarMarca = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.marca.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} nomeNormalizado
 * @param {string} [ignorarId]
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const existeMarcaComNome = async (clienteId, empresaId, nomeNormalizado, ignorarId, tx) => {
  const cliente = tx || getPrismaClient();
  const existente = await cliente.marca.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      nome: nomeNormalizado,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirMarca = async (tx, dados) =>
  tx.marca.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const atualizarMarcaPorId = async (tx, clienteId, id, dados) =>
  tx.marca.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirMarcaPorId = async (tx, clienteId, id) =>
  tx.marca.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
