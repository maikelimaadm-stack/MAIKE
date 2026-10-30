/**
 * Repositório de Usuario (P6.0, D-PROD-34).
 *
 * Nunca devolve `senha_hash` fora de caminhos internos de autenticação.
 */

import { getPrismaClient } from '../../database/prismaClient.js';

const SELECAO_PUBLICA = Object.freeze({
  id: true,
  cliente_id: true,
  nome: true,
  login: true,
  ativo: true,
  papel_tenant: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * @param {string} clienteId
 */
export const listarUsuarios = async (clienteId) => {
  const prisma = getPrismaClient();
  return prisma.usuario.findMany({
    where: { cliente_id: clienteId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: SELECAO_PUBLICA,
  });
};

/**
 * Prisma `contains` vira `ILIKE '%valor%'` sem escapar curingas: `q=%` casaria
 * tudo e `q=_` qualquer caractere. Escapa `\\`, `%` e `_` (ESCAPE padrão do
 * PostgreSQL é a barra invertida) para a busca ser literal.
 *
 * @param {string} texto
 */
export const escaparCuringasLike = (texto) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Keyset DESC em (createdAt, id), na forma que o índice
 * `(cliente_id, createdAt, id)` consegue usar como LIMITE DA VARREDURA.
 *
 * O helper compartilhado (`createdAt < t OR (createdAt = t AND id < i)`) só
 * vira filtro: o PostgreSQL varre o índice desde o topo e descarta tudo até o
 * cursor (página do meio de 100k usuários: 50.001 linhas descartadas, ~10 ms).
 * Somar `createdAt <= t` — logicamente redundante — vira Index Cond e a
 * varredura começa no cursor (~0,2 ms). Medição no relatório SCALE-01.
 *
 * @param {{ createdAt: Date, id: string }} cursor
 */
const clausulaKeysetDescIndexavel = (cursor) => ({
  createdAt: { lte: cursor.createdAt },
  OR: [{ createdAt: { lt: cursor.createdAt } }, { id: { lt: cursor.id } }],
});

/**
 * Filtro tenant-scoped da listagem paginada (SCALE-01). `q` busca em nome e
 * login (contains, case-insensitive — parametrizado pelo Prisma, nunca SQL
 * concatenado). `cursor` só entra na página, nunca na contagem.
 *
 * @param {string} clienteId
 * @param {{ q?: string|null, ativo?: boolean|null, cursor?: { createdAt: Date, id: string }|null }} filtro
 */
const whereUsuarios = (clienteId, filtro) => {
  /** @type {Record<string, unknown>} */
  const where = { cliente_id: clienteId };
  if (filtro.ativo === true || filtro.ativo === false) where.ativo = filtro.ativo;
  const q = typeof filtro.q === 'string' ? filtro.q.trim() : '';
  /** @type {Record<string, unknown>[]} */
  const and = [];
  if (q) {
    const literal = escaparCuringasLike(q);
    and.push({
      OR: [
        { nome: { contains: literal, mode: 'insensitive' } },
        { login: { contains: literal, mode: 'insensitive' } },
      ],
    });
  }
  if (filtro.cursor) and.push(clausulaKeysetDescIndexavel(filtro.cursor));
  if (and.length) where.AND = and;
  return where;
};

/**
 * Página keyset `createdAt DESC, id DESC` com `take: limit + 1`.
 *
 * @param {string} clienteId
 * @param {{ q?: string|null, ativo?: boolean|null, cursor?: { createdAt: Date, id: string }|null, limit: number }} filtro
 */
export const listarUsuariosPagina = async (clienteId, filtro) =>
  getPrismaClient().usuario.findMany({
    where: whereUsuarios(clienteId, filtro),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: filtro.limit + 1,
    select: SELECAO_PUBLICA,
  });

/**
 * Contagem do conjunto filtrado (sem cursor).
 *
 * @param {string} clienteId
 * @param {{ q?: string|null, ativo?: boolean|null }} filtro
 */
export const contarUsuarios = async (clienteId, filtro) =>
  getPrismaClient().usuario.count({ where: whereUsuarios(clienteId, { ...filtro, cursor: null }) });

/**
 * @param {string} clienteId
 * @param {string} id
 * @param {import('@prisma/client').Prisma.TransactionClient} [tx]
 */
export const buscarUsuario = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.usuario.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    select: SELECAO_PUBLICA,
  });
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {object} dados inclui senha_hash
 */
export const inserirUsuario = async (tx, dados) =>
  tx.usuario.create({ data: dados, select: SELECAO_PUBLICA });

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} id
 * @param {object} dados
 */
export const atualizarUsuarioPorId = async (tx, clienteId, id, dados) =>
  tx.usuario.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
    select: SELECAO_PUBLICA,
  });
