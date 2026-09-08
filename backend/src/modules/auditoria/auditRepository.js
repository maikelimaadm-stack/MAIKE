/**
 * Repositório de auditoria.
 *
 * Aceita `tx` opcional para que a escrita de auditoria participe da mesma
 * transação da operação auditada quando isso for desejado. Sem isso, auditoria
 * de operação que deu rollback ficaria no banco descrevendo algo que não
 * aconteceu.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * @param {object} registro
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const inserirAuditLog = async (registro, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.auditLog.create({ data: registro, select: { id: true, createdAt: true } });
};

/**
 * @param {string} clienteId tenant já resolvido pelo contexto
 * @param {{entidade?: string, entidadeId?: string, limite?: number}} filtro
 */
export const listarAuditLogs = async (clienteId, filtro = {}) => {
  const prisma = getPrismaClient();
  return prisma.auditLog.findMany({
    where: {
      cliente_id: clienteId,
      ...(filtro.entidade ? { entidade: filtro.entidade } : {}),
      ...(filtro.entidadeId ? { entidade_id: filtro.entidadeId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(Number(filtro.limite) || 50, 1), 200),
  });
};
