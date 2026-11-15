/**
 * Repositório de Funcionários da fazenda (D-PROD-207, Fatia 4 do Lançamento de
 * Atividades), model Prisma `Funcionario`.
 *
 * Toda leitura é pela chave do tenant E da fazenda: um funcionário de outra
 * fazenda do mesmo tenant não é encontrado (404), nem de outro tenant. Escrita
 * sempre em transação, recebendo o `tx` do serviço. Sem exclusão física.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { clausulaKeysetDesc } from '../../shared/pagination/keysetCursor.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero: true,
  nome: true,
  cargo: true,
  tipo: true,
  custo_hora: true,
  custo_diaria: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {{ q?: string, ativo?: boolean|null }} filtro
 */
const ondeDaLista = (clienteId, empresaId, { q, ativo }) => {
  /** @type {Record<string, any>} */
  const where = { cliente_id: clienteId, empresa_id: empresaId };
  if (ativo === true || ativo === false) where.ativo = ativo;
  if (q) {
    where.AND = [
      {
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          { numero: { contains: q } },
          { cargo: { contains: q, mode: 'insensitive' } },
        ],
      },
    ];
  }
  return where;
};

/**
 * Página keyset (createdAt DESC, id DESC) + total do filtro.
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {{ q?: string, ativo?: boolean|null, limit: number, cursor?: { createdAt: Date, id: string }|null }} filtro
 */
export const listarFuncionariosPagina = async (clienteId, empresaId, filtro) => {
  const prisma = getPrismaClient();
  const where = ondeDaLista(clienteId, empresaId, filtro);
  const total = await prisma.funcionario.count({ where });
  const comCursor = filtro.cursor ? { ...where, AND: [...(where.AND ?? []), clausulaKeysetDesc(filtro.cursor)] } : where;
  const registros = await prisma.funcionario.findMany({
    where: comCursor,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: filtro.limit + 1,
    select: SELECAO,
  });
  return { registros, total };
};

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarFuncionario = async (clienteId, empresaId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.funcionario.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, id },
    select: SELECAO,
  });
};

/**
 * Trava a linha do funcionário (`FOR UPDATE`) antes de ler e atualizar, como
 * `parceiroService`/`fornecedorService`: dois PATCH (ou um PATCH e uma
 * inativação) não leem o mesmo "antes"; uma linha de mão de obra em voo (que lê
 * o funcionário FOR SHARE) termina antes. Outro tenant ou inexistente: nada travado.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx @param {string} clienteId @param {string} id
 */
export const travarFuncionario = async (tx, clienteId, id) => {
  await tx.$queryRaw`SELECT id FROM "Funcionario" WHERE cliente_id = ${clienteId} AND id = ${id} FOR UPDATE`;
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirFuncionario = async (tx, dados) =>
  tx.funcionario.create({ data: /** @type {any} */ (dados), select: SELECAO });

/**
 * Atualiza pela chave do tenant (o serviço já conferiu a fazenda na leitura,
 * na mesma transação).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @param {object} dados
 */
export const atualizarFuncionarioPorId = async (tx, clienteId, id, dados) =>
  tx.funcionario.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });
