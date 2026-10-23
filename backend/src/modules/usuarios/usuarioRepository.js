/**
 * Repositório de Usuario (P6.0, D-PROD-34).
 *
 * Nunca devolve `senha_hash` fora de caminhos internos de autenticação.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO_PUBLICA = Object.freeze({
  id: true,
  cliente_id: true,
  nome: true,
  login: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * @param {string} clienteId
 */
export const listarUsuarios = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.usuario.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECAO_PUBLICA,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarUsuario = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.usuario.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO_PUBLICA,
  });
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} dados inclui senha_hash
 */
export const inserirUsuario = async (tx, dados) =>
  tx.usuario.create({ data: dados, select: SELECAO_PUBLICA });

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @param {object} dados
 */
export const atualizarUsuarioPorId = async (tx, clienteId, id, dados) =>
  tx.usuario.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO_PUBLICA,
  });
