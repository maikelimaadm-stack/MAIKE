/**
 * Repositório de TipoTarefa (P5.0, D-PROD-45).
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  nome_tipo: true,
  grupo_atividade_id: true,
  grupo_atividade_nome: true,
  ativo: true,
  descricao: true,
  exige_area: true,
  pode_ter_produto: true,
  pode_ter_maquina: true,
  pode_ter_implemento: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarTipos = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.tipoTarefa.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarTipo = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.tipoTarefa.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} grupoId
 * @param {string} nomeNormalizado
 * @param {string} [ignorarId]
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const existeTipoComNomeNoGrupo = async (clienteId, grupoId, nomeNormalizado, ignorarId, tx) => {
  const cliente = tx || getPrismaClient();
  const existente = await cliente.tipoTarefa.findFirst({
    where: {
      cliente_id: clienteId,
      grupo_atividade_id: grupoId,
      nome_tipo: nomeNormalizado,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirTipo = async (tx, dados) => tx.tipoTarefa.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const atualizarTipoPorId = async (tx, clienteId, id, dados) =>
  tx.tipoTarefa.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirTipoPorId = async (tx, clienteId, id) =>
  tx.tipoTarefa.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
