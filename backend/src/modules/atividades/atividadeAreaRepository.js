/**
 * D-PROD-238 — repositório das ÁREAS da atividade (`AtividadeArea`): uma
 * atividade ("Combate à cigarrinha") feita em vários pastos, cada lançamento
 * (o apontamento) de UMA área. Contrato
 * `docs/engineering/MAIKE-ATIVIDADE-AREAS-CONTRATO.md`.
 *
 * Adaptador de dados, sem regra. Tenant SÓ do auth_context: toda função recebe
 * o `clienteId` de quem chama (R11), e toda consulta começa por
 * (cliente_id, empresa_id, atividade_id) — os índices da tabela (R10).
 */

import { AREA_DA_ATIVIDADE_RESUMO, INCLUIR_AREAS_DA_ATIVIDADE, STATUS_APONTAMENTO } from './atividadeComum.js';

/**
 * As áreas da atividade, na ordem em que entraram, com o resumo da área do mapa.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
export const listarAreasDaAtividade = (db, clienteId, empresaId, atividadeId) =>
  db.atividadeArea.findMany({ where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId }, ...INCLUIR_AREAS_DA_ATIVIDADE });

/**
 * UMA área desta atividade (com o resumo); de outra atividade, fazenda ou tenant = `null`.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} id
 */
export const buscarAreaDaAtividade = (db, clienteId, empresaId, atividadeId, id) =>
  db.atividadeArea.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id },
    include: { area: AREA_DA_ATIVIDADE_RESUMO },
  });

/** @param {any} tx @param {Record<string, unknown>} dados @returns {Promise<{ id: string }>} */
export const inserirAreaDaAtividade = (tx, dados) => tx.atividadeArea.create({ data: dados, select: { id: true } });

/**
 * A próxima `ordem` (máx + 1; a ordem nunca é reaproveitada enquanto a maior existe). Chame SOB a trava da atividade.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 */
export const proximaOrdemDaArea = async (tx, clienteId, empresaId, atividadeId) => {
  const r = await tx.atividadeArea.aggregate({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId },
    _max: { ordem: true },
  });
  return (r._max.ordem ?? 0) + 1;
};

/**
 * Quantos lançamentos (apontamentos) a área tem, por status.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} id
 * @returns {Promise<{ confirmados: number, cancelados: number }>}
 */
export const contarLancamentosDaArea = async (tx, clienteId, empresaId, atividadeId, id) => {
  const grupos = /** @type {Array<{ status: string, _count: { _all: number } }>} */ (
    await tx.atividadeApontamento.groupBy({
      by: ['status'],
      where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, atividade_area_id: id },
      _count: { _all: true },
    })
  );
  const de = (/** @type {string} */ s) => grupos.find((g) => g.status === s)?._count._all ?? 0;
  return { confirmados: de(STATUS_APONTAMENTO.CONFIRMADO), cancelados: de(STATUS_APONTAMENTO.CANCELADO) };
};

/**
 * DELETE físico da área SEM lançamento (o serviço conferiu; a FK RESTRICT do lançamento é a rede), com CAS por `versao`.
 * @param {any} tx @param {{ clienteId: string, empresaId: string, atividadeId: string, id: string, versao: number }} alvo
 * @returns {Promise<number>}
 */
export const apagarAreaDaAtividade = async (tx, { clienteId, empresaId, atividadeId, id, versao }) => {
  const r = await tx.atividadeArea.deleteMany({ where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id, versao } });
  return r.count;
};

/**
 * A área do lançamento e o status dela (a linha nova só entra em área EM_ANDAMENTO). Lançamento de outra atividade = `null`.
 * @param {any} tx @param {string} clienteId @param {string} empresaId @param {string} atividadeId @param {string} apontamentoId
 * @returns {Promise<{ atividade_area_id: string|null, atividadeArea: { status: string } | null } | null>}
 */
export const lerAreaDoApontamento = (tx, clienteId, empresaId, atividadeId, apontamentoId) =>
  tx.atividadeApontamento.findFirst({
    where: { cliente_id: clienteId, empresa_id: empresaId, atividade_id: atividadeId, id: apontamentoId },
    select: { atividade_area_id: true, atividadeArea: { select: { status: true } } },
  });

/**
 * Lançamentos por área da atividade: área feita (Σ `area_executada_dia` dos CONFIRMADO), o último dia com lançamento
 * CONFIRMADO e as contagens. Uma instrução, pelo índice (cliente_id, empresa_id, atividade_id, atividade_area_id).
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<Array<{ atividade_area_id: string, area_executada: string|null, ultimo_lancamento: Date|null, confirmados: number, cancelados: number }>>}
 */
export const lancamentosPorArea = (db, clienteId, empresaId, atividadeId) =>
  db.$queryRaw`SELECT atividade_area_id,
      (SUM(area_executada_dia) FILTER (WHERE status = 'CONFIRMADO'))::text AS area_executada,
      MAX(data_operacional) FILTER (WHERE status = 'CONFIRMADO') AS ultimo_lancamento,
      (COUNT(*) FILTER (WHERE status = 'CONFIRMADO'))::int AS confirmados,
      (COUNT(*) FILTER (WHERE status = 'CANCELADO'))::int AS cancelados
    FROM "AtividadeApontamento"
    WHERE cliente_id = ${clienteId} AND empresa_id = ${empresaId} AND atividade_id = ${atividadeId} AND atividade_area_id IS NOT NULL
    GROUP BY atividade_area_id`;

/**
 * Custo por área e por tipo, numa consulta agrupada só (sem N+1): as MESMAS parcelas do `custo_total` da atividade
 * (`GET /atividades/:id/totais`) — linhas CONFIRMADO de lançamentos CONFIRMADO (produto e máquina pelo `custo_total`,
 * mão de obra pelo `custo_total`, serviço pelo `valor_total`) e os abastecimentos CONFIRMADO ligados a um lançamento da
 * área (custo, litros e quilos). Lançamento sem área (atividade antiga sem área) não entra em nenhuma área.
 * @param {any} db @param {string} clienteId @param {string} empresaId @param {string} atividadeId
 * @returns {Promise<Array<{ atividade_area_id: string, tipo: string, custo: string|null, litros: string|null, quilos: string|null }>>}
 */
export const custosPorArea = (db, clienteId, empresaId, atividadeId) =>
  db.$queryRaw`SELECT x.atividade_area_id, x.tipo, SUM(x.custo)::text AS custo, SUM(x.litros)::text AS litros, SUM(x.quilos)::text AS quilos FROM (
      SELECT a.atividade_area_id, 'produtos' AS tipo, p.custo_total AS custo, NULL::numeric AS litros, NULL::numeric AS quilos
        FROM "AtividadeApontamentoProduto" p
        JOIN "AtividadeApontamento" a ON a.cliente_id = p.cliente_id AND a.empresa_id = p.empresa_id AND a.id = p.apontamento_id
        WHERE p.cliente_id = ${clienteId} AND p.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
          AND a.atividade_area_id IS NOT NULL AND p.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      UNION ALL
      SELECT a.atividade_area_id, 'maquinas', m.custo_total, NULL, NULL
        FROM "AtividadeApontamentoMaquina" m
        JOIN "AtividadeApontamento" a ON a.cliente_id = m.cliente_id AND a.empresa_id = m.empresa_id AND a.id = m.apontamento_id
        WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
          AND a.atividade_area_id IS NOT NULL AND m.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      UNION ALL
      SELECT a.atividade_area_id, 'mao_obra', l.custo_total, NULL, NULL
        FROM "AtividadeApontamentoMaoObra" l
        JOIN "AtividadeApontamento" a ON a.cliente_id = l.cliente_id AND a.empresa_id = l.empresa_id AND a.id = l.apontamento_id
        WHERE l.cliente_id = ${clienteId} AND l.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
          AND a.atividade_area_id IS NOT NULL AND l.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      UNION ALL
      SELECT a.atividade_area_id, 'servicos', l.valor_total, NULL, NULL
        FROM "AtividadeApontamentoServico" l
        JOIN "AtividadeApontamento" a ON a.cliente_id = l.cliente_id AND a.empresa_id = l.empresa_id AND a.id = l.apontamento_id
        WHERE l.cliente_id = ${clienteId} AND l.empresa_id = ${empresaId} AND a.atividade_id = ${atividadeId}
          AND a.atividade_area_id IS NOT NULL AND l.status = 'CONFIRMADO' AND a.status = 'CONFIRMADO'
      UNION ALL
      SELECT a.atividade_area_id, 'combustivel', ab.custo_total,
          CASE WHEN ab.unidade = 'L' THEN ab.quantidade END, CASE WHEN ab.unidade = 'KG' THEN ab.quantidade END
        FROM "AbastecimentoBem" ab
        JOIN "AtividadeApontamento" a ON a.cliente_id = ab.cliente_id AND a.empresa_id = ab.empresa_id AND a.id = ab.apontamento_id
        WHERE ab.cliente_id = ${clienteId} AND ab.empresa_id = ${empresaId} AND ab.atividade_id = ${atividadeId}
          AND a.atividade_area_id IS NOT NULL AND ab.status = 'CONFIRMADO'
    ) x
    GROUP BY x.atividade_area_id, x.tipo`;
