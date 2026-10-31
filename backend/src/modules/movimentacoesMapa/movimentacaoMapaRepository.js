/**
 * Repositório de MovimentacaoMapa (P5.5).
 */
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../database/prismaClient.js';
import { opcoesTakeDeFiltros } from '../../shared/http/listQueryLimit.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.movimentacaoMapa.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    ...opcoesTakeDeFiltros(filtros),
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.movimentacaoMapa.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.movimentacaoMapa.create({ data: dados });

export const inserirRegistros = async (tx, lista) =>
  tx.movimentacaoMapa.createMany({ data: lista });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.movimentacaoMapa.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.movimentacaoMapa.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });

/**
 * Nomes das áreas do tenant e da empresa, por id (fonte de verdade do nome).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {string[]} ids
 * @returns {Promise<Map<string, string>>}
 */
export const buscarNomesDeAreas = async (tx, clienteId, empresaId, ids) => {
  if (!ids.length) return new Map();
  const areas = await tx.areaPastagem.findMany({
    where: { cliente_id: clienteId, empresa_id: empresaId, id: { in: ids } },
    select: { id: true, nome: true },
  });
  return new Map(areas.map((area) => [area.id, area.nome]));
};

/**
 * Histórico de movimentações — página keyset (createdAt DESC, id DESC),
 * sempre dentro de `cliente_id` (auth) + `empresa_id` (coluna). Só leitura
 * (MAIKE-MAPA-HISTORICO-MOVIMENTACOES-R1, D-PROD-94).
 *
 * Filtros sobre `dados` em SQL parametrizado — `Prisma.sql`, nunca string
 * concatenada:
 *  - `areaId`: a área é origem, destino ou área do evento (entradas E saídas,
 *    com ou sem lote presente hoje);
 *  - `loteIds`: vínculo por ID;
 *  - `lotesNomesLegado`: SÓ para registro sem `lote_id` (legado) — quem tem id
 *    nunca casa por nome, para homônimo não misturar.
 * Com `loteIds` e `lotesNomesLegado` vazios, o filtro de lote não se aplica.
 *
 * @param {string} clienteId
 * @param {{ empresaId: string, areaId?: string|null, loteIds?: string[], lotesNomesLegado?: string[],
 *   cursor?: { createdAt: Date, id: string }|null, limit?: number }} filtro
 * @param {boolean} comCursor
 */
const condicoesHistorico = (clienteId, filtro, comCursor) => {
  const loteIds = filtro.loteIds ?? [];
  const nomes = filtro.lotesNomesLegado ?? [];
  const partes = [Prisma.sql`m.cliente_id = ${clienteId}`, Prisma.sql`m.empresa_id = ${filtro.empresaId}`];
  if (filtro.areaId) {
    partes.push(
      Prisma.sql`(m.dados->>'area_origem_id' = ${filtro.areaId} OR m.dados->>'area_destino_id' = ${filtro.areaId} OR m.dados->>'area_id' = ${filtro.areaId})`
    );
  }
  if (loteIds.length || nomes.length) {
    partes.push(
      Prisma.sql`(m.dados->>'lote_id' = ANY(${loteIds}::text[]) OR (COALESCE(m.dados->>'lote_id', '') = '' AND lower(btrim(m.dados->>'lote')) = ANY(${nomes}::text[])))`
    );
  }
  if (comCursor && filtro.cursor) {
    partes.push(
      Prisma.sql`(m."createdAt" < ${filtro.cursor.createdAt} OR (m."createdAt" = ${filtro.cursor.createdAt} AND m.id < ${filtro.cursor.id}))`
    );
  }
  return Prisma.join(partes, ' AND ');
};

/**
 * Página com `limit + 1` linhas (a extra só detecta `has_more`).
 * @returns {Promise<Array<Record<string, any>>>}
 */
export const listarHistoricoPagina = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  const where = condicoesHistorico(clienteId, filtro, true);
  return /** @type {Promise<Array<Record<string, any>>>} */ (prisma.$queryRaw`
    SELECT m.id, m.cliente_id, m.empresa_id, m.dados, m."createdAt", m."updatedAt"
    FROM "MovimentacaoMapa" m
    WHERE ${where}
    ORDER BY m."createdAt" DESC, m.id DESC
    LIMIT ${filtro.limit + 1}`);
};

/** Total do conjunto filtrado, sem cursor — prova de completude na tela. */
export const contarHistorico = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  const where = condicoesHistorico(clienteId, filtro, false);
  const linhas = /** @type {Array<{ total: number }>} */ (
    await prisma.$queryRaw`SELECT COUNT(*)::int AS total FROM "MovimentacaoMapa" m WHERE ${where}`
  );
  const linha = linhas[0];
  return Number(linha?.total ?? 0);
};
