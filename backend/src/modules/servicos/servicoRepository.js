/**
 * Repositório de Serviços da fazenda (D-PROD-203, Fatia 4 do Lançamento de
 * Atividades), model Prisma `Servico`.
 *
 * Toda leitura é pela chave do tenant E da fazenda; a leitura traz o resumo da
 * unidade de medida (sigla, descrição) e do centro de custo padrão (número,
 * nome). Escrita sempre em transação, recebendo o `tx` do serviço. Sem exclusão
 * física.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { clausulaKeysetDesc } from '../../shared/pagination/keysetCursor.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero: true,
  nome: true,
  unidade_medida_id: true,
  centro_custo_padrao_id: true,
  valor_referencia: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
  unidadeMedida: { select: { id: true, sigla: true, descricao: true, ativo: true } },
  centroCustoPadrao: { select: { id: true, numero: true, nome: true, ativo: true } },
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
    where.AND = [{ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }] }];
  }
  return where;
};

/**
 * Página keyset (createdAt DESC, id DESC) + total do filtro.
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {{ q?: string, ativo?: boolean|null, limit: number, cursor?: { createdAt: Date, id: string }|null }} filtro
 */
export const listarServicosPagina = async (clienteId, empresaId, filtro) => {
  const prisma = getPrismaClient();
  const where = ondeDaLista(clienteId, empresaId, filtro);
  const total = await prisma.servico.count({ where });
  const comCursor = filtro.cursor ? { ...where, AND: [...(where.AND ?? []), clausulaKeysetDesc(filtro.cursor)] } : where;
  const registros = await prisma.servico.findMany({
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
export const buscarServico = async (clienteId, empresaId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.servico.findFirst({ where: { cliente_id: clienteId, empresa_id: empresaId, id }, select: SELECAO });
};

/**
 * Unidade de medida do CLIENTE (cadastro por tenant, sem fazenda), sob
 * `FOR KEY SHARE`: não some nem muda de chave até o fim da transação.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @returns {Promise<{ id: string, ativo: boolean } | null>}
 */
export const lerUnidadeMedida = async (tx, clienteId, id) => {
  const linhas = /** @type {Array<{ id: string, ativo: boolean }>} */ (
    await tx.$queryRaw`SELECT "id", "ativo" FROM "UnidadeMedida" WHERE "cliente_id" = ${clienteId} AND "id" = ${id} FOR KEY SHARE`
  );
  return linhas[0] ?? null;
};

/**
 * Centro de custo da MESMA fazenda (o centro é por empresa), sob `FOR KEY SHARE`.
 * Outra fazenda, outro tenant ou inexistente → null (sem oráculo).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} id
 * @returns {Promise<{ id: string, ativo: boolean } | null>}
 */
export const lerCentroCustoDaFazenda = async (tx, clienteId, empresaId, id) => {
  const linhas = /** @type {Array<{ id: string, ativo: boolean }>} */ (
    await tx.$queryRaw`SELECT "id", "ativo" FROM "CentroCusto" WHERE "cliente_id" = ${clienteId} AND "empresa_id" = ${empresaId} AND "id" = ${id} FOR KEY SHARE`
  );
  return linhas[0] ?? null;
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirServico = async (tx, dados) => tx.servico.create({ data: /** @type {any} */ (dados), select: SELECAO });

/**
 * Atualiza pela chave do tenant (o serviço já conferiu a fazenda na leitura,
 * na mesma transação).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @param {object} dados
 */
export const atualizarServicoPorId = async (tx, clienteId, id, dados) =>
  tx.servico.update({ where: { cliente_id_id: { cliente_id: clienteId, id } }, data: dados, select: SELECAO });
