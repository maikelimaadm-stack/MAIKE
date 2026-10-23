import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero_ponto: true,
  nome: true,
  sigla: true,
  tipo: true,
  configuracao_icone_id: true,
  icone_url: true,
  sub_icone_url: true,
  coordenadas: true,
  cor: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarPontos = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.pontoReferencia.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/** @param {string} clienteId @param {string} id @param {import('@prisma/client').Prisma.TransactionClient} [tx] */
export const buscarPonto = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.pontoReferencia.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirPonto = async (tx, dados) =>
  tx.pontoReferencia.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} clienteId @param {string} id @param {object} dados */
export const atualizarPontoPorId = async (tx, clienteId, id, dados) =>
  tx.pontoReferencia.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} clienteId @param {string} id */
export const excluirPontoPorId = async (tx, clienteId, id) =>
  tx.pontoReferencia.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
