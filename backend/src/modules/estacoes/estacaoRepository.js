/**
 * Repositório de Estações da fazenda (D-PROD-188), tabela física "CADESTACOES"
 * (model Prisma `CadEstacao`, delegate `cadEstacao`).
 *
 * Toda leitura é pela chave do tenant E da fazenda: uma estação de outra
 * fazenda do mesmo tenant não é encontrada (404), nem de outro tenant. Escrita
 * sempre em transação, recebendo o `tx` do serviço.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  nome: true,
  tipo: true,
  data_inicio: true,
  data_fim: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId @param {string} empresaId */
export const listarEstacoes = async (clienteId, empresaId) => {
  const prisma = getPrismaClient();
  return prisma.cadEstacao.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId },
    orderBy: [{ data_inicio: 'desc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarEstacao = async (clienteId, empresaId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.cadEstacao.findFirst({
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
export const existeEstacaoComNome = async (tx, clienteId, empresaId, nome, ignorarId) => {
  const existente = await tx.cadEstacao.findFirst({
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

/**
 * Outra estação ATIVA da mesma fazenda cujo período encosta no informado
 * (intervalos fechados: o dia de fim de uma e o de início da outra não podem
 * ser o mesmo).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {Date} inicio
 * @param {Date} fim
 * @param {string} [ignorarId]
 */
export const buscarEstacaoAtivaSobreposta = async (tx, clienteId, empresaId, inicio, fim, ignorarId) =>
  tx.cadEstacao.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      ativo: true,
      data_inicio: { lte: fim },
      data_fim: { gte: inicio },
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    orderBy: [{ data_inicio: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirEstacao = async (tx, dados) => tx.cadEstacao.create({ data: dados, select: SELECAO });

/**
 * Atualiza pela chave do tenant (o serviço já conferiu a fazenda na leitura,
 * na mesma transação).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export const atualizarEstacaoPorId = async (tx, clienteId, id, dados) =>
  tx.cadEstacao.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirEstacaoPorId = async (tx, clienteId, id) =>
  tx.cadEstacao.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
