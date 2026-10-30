/**
 * Repositório de MovimentacaoMapa (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { opcoesTakeDeFiltros } from '../../shared/http/listQueryLimit.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.movimentacaoMapa.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...opcoesTakeDeFiltros(filtros),
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.movimentacaoMapa.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.movimentacaoMapa.create({ data: dados });

export const inserirRegistros = async (tx, lista) =>
  tx.movimentacaoMapa.createMany({ data: lista });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.movimentacaoMapa.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.movimentacaoMapa.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });

/**
 * Nomes das áreas do tenant e da empresa, por id (fonte de verdade do nome).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string[]} ids
 * @returns {Promise<Map<string, string>>}
 */
export const buscarNomesDeAreas = async (tx, clienteId, empresaId, ids) => {
  if (!ids.length) return new Map();
  const areas = await tx.areaPastagem.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: { in: ids } },
    select: { id: true, nome: true },
  });
  return new Map(areas.map((area) => [area.id, area.nome]));
};
