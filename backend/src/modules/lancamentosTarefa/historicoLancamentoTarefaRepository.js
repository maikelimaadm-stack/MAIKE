/**
 * Repositório de HistoricoLancamentoTarefa (P5.3, D-PROD-49).
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  tarefa_id: true,
  titulo_tarefa: true,
  evento: true,
  data_evento: true,
  status: true,
  responsavel: true,
  descricao: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * @param {string} clienteId
 * @param {{ limite?: number }} [opcoes]
 */
export const listarHistoricos = async (clienteId, opcoes = {}) => {
  const prisma = getPrismaClient();
  const limite = Math.min(Math.max(Number(opcoes.limite) || 500, 1), 2000);
  return prisma.historicoLancamentoTarefa.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ data_evento: 'desc' }, { id: 'desc' }],
    take: limite,
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarHistorico = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.historicoLancamentoTarefa.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirHistorico = async (tx, dados) =>
  tx.historicoLancamentoTarefa.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirHistoricoPorId = async (tx, clienteId, id) =>
  tx.historicoLancamentoTarefa.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
