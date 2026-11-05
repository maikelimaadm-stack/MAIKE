/**
 * Repositório de MovimentacaoMapa (P5.5).
 */
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../../database/prismaClient.js';
import { opcoesTakeDeFiltros } from '../../shared/http/listQueryLimit.js';
import { movimentoCitaLotes } from './movimentacaoVinculoLote.js';

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
 * Histórico de movimentações — página keyset por OCORRÊNCIA (D-PROD-123, H2),
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
 * Os filtros (e o COUNT) são os mesmos de antes do H2: só a ORDEM mudou.
 *
 * @param {string} clienteId
 * @param {{ empresaId: string, areaId?: string|null, loteIds?: string[], lotesNomesLegado?: string[], limit?: number }} filtro
 */
const condicoesHistorico = (clienteId, filtro) => {
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
      // R2B-P1/R2 (D-PROD-101): vínculo estrutural único (primário, participantes,
      // efeitos e lotes de matrizes do nascimento); nome só para legado sem id.
      Prisma.sql`(${movimentoCitaLotes('m', loteIds)} OR (COALESCE(m.dados->>'lote_id', '') = '' AND lower(btrim(m.dados->>'lote')) = ANY(${nomes}::text[])))`
    );
  }
  return Prisma.join(partes, ' AND ');
};

/**
 * Dia LITERAL de `dados.data_movimentacao` (legado), sem conversão de fuso:
 * 'YYYY-MM-DD' ou 'YYYY-MM-DDT…' com data de calendário válida; senão NULL.
 * `pg_input_is_valid` (PG 16+) evita erro de cast em '2026-02-30'.
 */
const DIA_LEGADO = Prisma.sql`CASE
      WHEN m.dados->>'data_movimentacao' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|T)'
       AND pg_input_is_valid(left(m.dados->>'data_movimentacao', 10), 'date')
      THEN left(m.dados->>'data_movimentacao', 10)::date
    END`;

/**
 * Ordem H2 (a mesma no ORDER BY, no predicado e no cursor v2):
 *   (tem_ocorrencia DESC, ocorrencia DESC, registrado DESC, createdAt DESC, id DESC)
 *
 *  - ocorrência = `EventoRebanho.data_operacional` quando o vínculo é
 *    inequívoco (mesmo tenant, mesma empresa, `ev.movimentacao_id = m.id` E
 *    `ev.id = dados.efeito_servidor.evento_id`); senão o dia literal de
 *    `dados.data_movimentacao`; senão NULL ("não informada") — NULL vai para o
 *    fim, nunca vira data inventada;
 *  - registrado = `EventoRebanho.registrado_em` (vínculo inequívoco) ou o
 *    `createdAt` real da linha;
 *  - `id COLLATE "C"`: desempate binário, idêntico ao do navegador.
 * O LEFT JOIN é por chave única (`EventoRebanho.id`): no máximo uma linha —
 * não multiplica o movimento.
 *
 * Página com `limit + 1` linhas (a extra só detecta `has_more`).
 * @param {string} clienteId
 * @param {{ empresaId: string, areaId?: string|null, loteIds?: string[], lotesNomesLegado?: string[], limit: number,
 *   cursor?: { ocorrencia: string|null, registrado: string, createdAt: string, id: string }|null }} filtro
 * @returns {import('@prisma/client').Prisma.Sql}
 */
export const sqlHistoricoPagina = (clienteId, filtro) => {
  const where = condicoesHistorico(clienteId, filtro);
  const c = filtro.cursor ?? null;
  const posCursor = c
    ? Prisma.sql`WHERE (h.h_tem, h.h_dia_ord, h.h_registrado, h."createdAt", h.id COLLATE "C")
        < (${c.ocorrencia ? 1 : 0}::int, ${c.ocorrencia ?? '0001-01-01'}::date, ${c.registrado}::timestamp(3), ${c.createdAt}::timestamp(3), ${c.id}::text COLLATE "C")`
    : Prisma.empty;
  return Prisma.sql`
    SELECT h.id, h.cliente_id, h.empresa_id, h.dados, h."createdAt", h."updatedAt",
           to_char(h.h_dia, 'YYYY-MM-DD') AS h_ocorrencia, h.h_origem, h.h_registrado
    FROM (
      SELECT m.id, m.cliente_id, m.empresa_id, m.dados, m."createdAt", m."updatedAt",
             x.dia AS h_dia,
             CASE WHEN ev.id IS NOT NULL THEN 'evento' WHEN x.dia IS NOT NULL THEN 'data_movimentacao' END AS h_origem,
             CASE WHEN x.dia IS NULL THEN 0 ELSE 1 END AS h_tem,
             COALESCE(x.dia, DATE '0001-01-01') AS h_dia_ord,
             COALESCE(ev.registrado_em, m."createdAt") AS h_registrado
      FROM "MovimentacaoMapa" m
      LEFT JOIN "EventoRebanho" ev
        ON ev.id = m.dados->'efeito_servidor'->>'evento_id'
       AND ev.cliente_id = m.cliente_id
       AND ev.empresa_id = m.empresa_id
       AND ev.movimentacao_id = m.id
      CROSS JOIN LATERAL (SELECT COALESCE(ev.data_operacional, ${DIA_LEGADO}) AS dia) x
      WHERE ${where}
    ) h
    ${posCursor}
    ORDER BY h.h_tem DESC, h.h_dia_ord DESC, h.h_registrado DESC, h."createdAt" DESC, h.id COLLATE "C" DESC
    LIMIT ${filtro.limit + 1}`;
};

/** Executa `sqlHistoricoPagina` (a mesma consulta que o EXPLAIN de evidência mede). */
export const listarHistoricoPagina = async (clienteId, filtro) =>
  /** @type {Promise<Array<Record<string, any>>>} */ (getPrismaClient().$queryRaw(sqlHistoricoPagina(clienteId, filtro)));

/** Total do conjunto filtrado, sem cursor — prova de completude na tela (inalterado no H2). */
export const contarHistorico = async (clienteId, filtro) => {
  const prisma = getPrismaClient();
  const where = condicoesHistorico(clienteId, filtro);
  const linhas = /** @type {Array<{ total: number }>} */ (
    await prisma.$queryRaw`SELECT COUNT(*)::int AS total FROM "MovimentacaoMapa" m WHERE ${where}`
  );
  const linha = linhas[0];
  return Number(linha?.total ?? 0);
};
