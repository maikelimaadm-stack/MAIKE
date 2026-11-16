/**
 * Repositório do Cadastro de Culturas (D-PROD-215), tabela física "CADCULTURAS"
 * (model Prisma `Cultura`, delegate `cultura`).
 *
 * Toda leitura é pela chave do tenant E da fazenda: uma cultura de outra
 * fazenda do mesmo tenant não é encontrada (404), nem de outro tenant. Escrita
 * sempre em transação, recebendo o `tx` do serviço.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  codigo: true,
  tipo: true,
  nome: true,
  especie: true,
  cultivar: true,
  altura_entrada_cm: true,
  altura_saida_cm: true,
  observacoes: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/** @param {string} clienteId @param {string} empresaId @param {import('@prisma/client').Prisma.TransactionClient} [tx] */
export const listarCulturas = async (clienteId, empresaId, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.cultura.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId },
    orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarCultura = async (clienteId, empresaId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.cultura.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id },
    select: SELECAO,
  });
};

/**
 * Outra cultura da fazenda com o mesmo valor no campo (`nome` ou `codigo`).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {'nome'|'codigo'} campo
 * @param {string} valor
 * @param {string} [ignorarId]
 */
export const existeCulturaCom = async (tx, clienteId, empresaId, campo, valor, ignorarId) => {
  const existente = await tx.cultura.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      [campo]: valor,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

/** Códigos já usados na fazenda (para sugerir o próximo número). @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const codigosDaFazenda = async (tx, clienteId, empresaId) =>
  (await tx.cultura.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId }, select: { codigo: true } })).map((c) => c.codigo);

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirCultura = async (tx, dados) => tx.cultura.create({ data: dados, select: SELECAO });

/**
 * Atualiza pela chave do tenant (o serviço já conferiu a fazenda na leitura,
 * na mesma transação).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 */
export const atualizarCulturaPorId = async (tx, clienteId, id, dados) =>
  tx.cultura.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirCulturaPorId = async (tx, clienteId, id) =>
  tx.cultura.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
