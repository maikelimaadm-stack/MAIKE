/**
 * Repositório de Marca (P4.4-Marcas, D-PROD-42 + D-PROD-54 escala).
 *
 * Nenhuma consulta sem `cliente_id`. Leituras e escritas usam o unique composto
 * `[cliente_id, id]`. Listagem usa keyset (createdAt, id) — sem OFFSET.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { clausulaKeysetDesc } from '../../shared/pagination/keysetCursor.js';

const SELECAO = Object.freeze({
  id: true,
  cliente_id: true,
  empresa_id: true,
  numero_marca: true,
  nome: true,
  descricao: true,
  ativo: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * @param {string} clienteId
 * @param {{
 *   empresaId?: string|null,
 *   q?: string|null,
 *   ativo?: boolean|null,
 *   cursor?: { createdAt: Date, id: string }|null,
 *   limit: number,
 * }} filtro
 */
export const montarWhereMarcas = (clienteId, filtro) => {
  /** @type {import('@prisma/client').Prisma.MarcaWhereInput} */
  const where = { cliente_id: clienteId };
  if (filtro.empresaId) where.empresa_id = filtro.empresaId;
  if (filtro.ativo === true || filtro.ativo === false) where.ativo = filtro.ativo;
  const q = typeof filtro.q === 'string' ? filtro.q.trim() : '';
  if (q) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : []),
      {
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          { descricao: { contains: q, mode: 'insensitive' } },
          { numero_marca: { contains: q, mode: 'insensitive' } },
        ],
      },
    ];
  }
  if (filtro.cursor) {
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), clausulaKeysetDesc(filtro.cursor)];
  }
  return where;
};

/**
 * Página keyset (+1 para detectar has_more).
 * @param {string} clienteId
 * @param {{
 *   empresaId?: string|null,
 *   q?: string|null,
 *   ativo?: boolean|null,
 *   cursor?: { createdAt: Date, id: string }|null,
 *   limit: number,
 * }} filtro
 */
export const listarMarcasPagina = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  return prisma.marca.findMany({
    where: montarWhereMarcas(clienteId, filtro),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: filtro.limit + 1,
    select: SELECAO,
  });
};

/**
 * Contagem do conjunto filtrado (sem cursor) — total do rodapé.
 * Em bilhões pode ficar cara; índices tenant+empresa mitigam o caso típico.
 * @param {string} clienteId
 * @param {{ empresaId?: string|null, q?: string|null, ativo?: boolean|null }} filtro
 */
export const contarMarcas = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  return prisma.marca.count({
    where: montarWhereMarcas(clienteId, {
      empresaId: filtro.empresaId,
      q: filtro.q,
      ativo: filtro.ativo,
      cursor: null,
      limit: 1,
    }),
  });
};

/** @deprecated Preferir listarMarcasPagina — mantido só se algum caller interno precisar. */
/** @param {string} clienteId */
export const listarMarcas = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.marca.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarMarca = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.marca.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
};

/**
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string} nomeNormalizado
 * @param {string} [ignorarId]
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const existeMarcaComNome = async (clienteId, empresaId, nomeNormalizado, ignorarId, tx) => {
  const cliente = tx || getPrismaClient();
  const existente = await cliente.marca.findFirst({
    where: {
      cliente_id: clienteId,
      empresa_id: empresaId,
      nome: nomeNormalizado,
      ...(ignorarId ? { NOT: { id: ignorarId } } : {}),
    },
    select: { id: true },
  });
  return Boolean(existente);
};

/** @param {import('@prisma/client').Prisma.TransactionClient} tx @param {object} dados */
export const inserirMarca = async (tx, dados) =>
  tx.marca.create({ data: dados, select: SELECAO });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const atualizarMarcaPorId = async (tx, clienteId, id, dados) =>
  tx.marca.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO,
  });

/** @param {import('@prisma/client').Prisma.TransactionClient} tx */
export const excluirMarcaPorId = async (tx, clienteId, id) =>
  tx.marca.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO,
  });
