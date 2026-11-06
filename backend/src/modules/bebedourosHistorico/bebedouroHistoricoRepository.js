/**
 * Repositório de BebedouroHistorico (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { opcoesTakeDeFiltros } from '../../shared/http/listQueryLimit.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.bebedouroHistorico.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...opcoesTakeDeFiltros(filtros),
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.bebedouroHistorico.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.bebedouroHistorico.create({ data: dados });

export const inserirRegistros = async (tx, lista) =>
  tx.bebedouroHistorico.createMany({ data: lista });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.bebedouroHistorico.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.bebedouroHistorico.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });

/**
 * Lançamento do MESMO bebedouro (tenant + empresa) que vem DEPOIS de `registro`
 * na ordem da listagem (`createdAt desc, id desc`, acima) — a mesma ordem que
 * põe o lançamento no índice 0 da linha do tempo da tela. `null` = é o último.
 */
export const buscarLancamentoPosterior = async (tx, clienteId, registro, bebedouroId) =>
  tx.bebedouroHistorico.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: registro.empresa_id,
      dados: { path: ['bebedouro_id'], equals: bebedouroId },
      OR: [
        { createdAt: { gt: registro.createdAt } },
        { createdAt: registro.createdAt, id: { gt: registro.id } },
      ],
    },
    select: { id: true },
  });
