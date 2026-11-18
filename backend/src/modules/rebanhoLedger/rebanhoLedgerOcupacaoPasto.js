/**
 * D-PROD-223 — leitura (só leitura) da ocupação dos pastos pelo ledger do rebanho,
 * para o farol de forragem estimado pelos dias de descanso. Fica no módulo do
 * ledger (D-PROD-107): só ele toca `PartidaRebanho`; os outros módulos chamam esta
 * função.
 */
import { getPrismaClient } from '../../database/prismaClient.js';

/**
 * D-PROD-223 — situação de ocupação de cada pasto da fazenda pelo ledger do rebanho
 * (`PartidaRebanho` ativas, somadas por pasto e dia operacional): o saldo de cabeças
 * acumulado no fim e o ÚLTIMO dia em que o saldo ficou em zero (a saída do último
 * lote). Pasto sem nenhuma partida não aparece (nunca ocupado pelo ledger). Só
 * leitura; o tenant é o do auth_context (quem chama o confere).
 * @param {string} clienteId
 * @param {string} empresaId
 * @returns {Promise<Array<{ area_id: string, saldo: number, ultima_saida: Date|null }>>}
 */
export const ocupacaoPorPasto = (clienteId, empresaId) =>
  getPrismaClient().$queryRaw`
    WITH por_dia AS (
      SELECT p.area_id, pr.data_operacional AS dia, SUM(pr.delta)::int AS delta
        FROM "PartidaRebanho" pr
        JOIN "PosicaoRebanho" p ON p.cliente_id = pr.cliente_id AND p.empresa_id = pr.empresa_id AND p.id = pr.posicao_id
       WHERE pr.cliente_id = ${clienteId} AND pr.empresa_id = ${empresaId} AND pr.ativa = true
       GROUP BY p.area_id, pr.data_operacional
    ), saldos AS (
      SELECT area_id, dia, SUM(delta) OVER (PARTITION BY area_id ORDER BY dia) AS saldo FROM por_dia
    )
    SELECT area_id,
           ((array_agg(saldo ORDER BY dia DESC))[1])::int AS saldo,
           MAX(dia) FILTER (WHERE saldo <= 0) AS ultima_saida
      FROM saldos
     GROUP BY area_id`;
