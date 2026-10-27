/**
 * Repositório de GrupoAtividade (P5.0, D-PROD-45).
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  nome_grupo: true,
  ativo: true,
  descricao: true,
  cor_icone: true,
  observacoes: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId */
export const listarGrupos = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.grupoAtividade.findMany({
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
export const buscarGrupo = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.grupoAtividade.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} nomeNormalizado
 * @param {string} [ignorarId]
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const existeGrupoComNome = async (clienteId, nomeNormalizado, ignorarId, tx) => {
  const cliente = tx || getPrismaClient();
  const existente = await cliente.grupoAtividade.findFirst({
    where: {
      cliente_id: clienteId,
      nome_grupo: nomeNormalizado,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const contarTiposDoGrupo = async (tx, clienteId, grupoId) =>
  tx.tipoTarefa.count({
    where: { cliente_id: clienteId, grupo_atividade_id: grupoId },
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirGrupo = async (tx, dados) =>
  tx.grupoAtividade.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const atualizarGrupoPorId = async (tx, clienteId, id, dados) =>
  tx.grupoAtividade.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirGrupoPorId = async (tx, clienteId, id) =>
  tx.grupoAtividade.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const propagarNomeGrupoNosTipos = async (tx, clienteId, grupoId, nomeGrupo) =>
  tx.tipoTarefa.updateMany({
    where: { cliente_id: clienteId, grupo_atividade_id: grupoId },
    data: { grupo_atividade_nome: nomeGrupo },
  });
