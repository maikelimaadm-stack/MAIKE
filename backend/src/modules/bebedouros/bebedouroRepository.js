/**
 * Repositório de Bebedouro (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.bebedouro.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.bebedouro.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.bebedouro.create({ data: dados });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.bebedouro.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.bebedouro.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });

/**
 * Histórico que impede apagar o bebedouro: lançamentos (limpeza/inspeção) e
 * avaliações de sanidade gravados com `dados.bebedouro_id`. Vazio = sem histórico.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @returns {Promise<string[]>}
 */
export const motivosHistoricoBebedouro = async (tx, clienteId, id) => {
  const filtro = { cliente_id: clienteId, dados: { path: ['bebedouro_id'], equals: id } };
  const motivos = [];
  if (await tx.bebedouroHistorico.findFirst({ where: filtro, select: { id: true } })) motivos.push('historico');
  if (await tx.bebedouroSanidade.findFirst({ where: filtro, select: { id: true } })) motivos.push('sanidade');
  return motivos;
};

/** Bebedouros ligados ao ponto de referência (o único vínculo é o id). */
export const listarPorPontoReferencia = async (tx, clienteId, pontoReferenciaId) =>
  tx.bebedouro.findMany({ where: { cliente_id: clienteId, ponto_referencia_id: pontoReferenciaId } });
