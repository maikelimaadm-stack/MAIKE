/**
 * Repositório de Curvas de Ganho de Peso da fazenda (D-PROD-189; 12 GMD
 * mensais desde a D-PROD-190), tabela física
 * "CADCURVAGANHO" (model Prisma `CadCurvaGanho`, delegate `cadCurvaGanho`).
 *
 * Toda leitura é pela chave do tenant E da fazenda: uma curva de outra fazenda
 * do mesmo tenant não é encontrada (404), nem de outro tenant. Escrita sempre
 * em transação, recebendo o `tx` do serviço.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { CAMPOS_GMD } from './curvaGanhoCampos.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  nome: true,
  ...Object.fromEntries(CAMPOS_GMD.map((campo) => [campo, true])),
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId @param {string} empresaId */
export const listarCurvas = async (clienteId, empresaId) => {
  const prisma = getPrismaClient();
  return prisma.cadCurvaGanho.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId },
    orderBy: [{ nome: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarCurva = async (clienteId, empresaId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.cadCurvaGanho.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id },
    select: SELECAO,
  });
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} nome
 * @param {string} [ignorarId]
 */
export const existeCurvaComNome = async (tx, clienteId, empresaId, nome, ignorarId) => {
  const existente = await tx.cadCurvaGanho.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      nome,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirCurva = async (tx, dados) => tx.cadCurvaGanho.create({ data: dados, select: SELECAO });

/**
 * Atualiza pela chave do tenant (o serviço já conferiu a fazenda na leitura,
 * na mesma transação).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export const atualizarCurvaPorId = async (tx, clienteId, id, dados) =>
  tx.cadCurvaGanho.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirCurvaPorId = async (tx, clienteId, id) =>
  tx.cadCurvaGanho.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
