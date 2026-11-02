/**
 * Guarda temporal de COMANDO NOVO retroativo — PR169-R2 (D-PROD-104).
 *
 * O cancelamento compara contra um movimento que já existe (createdAt real) e
 * continua usando `dependenciasPosteriores`. Um comando novo (Junção) ainda
 * não tem createdAt: antes ele era simulado com 9999-12-31, o que fazia
 * "createdAt > mov.createdAt" nunca casar — tarefas e registros sem data
 * operacional NUNCA bloqueavam. Esta consulta é própria e explícita:
 *
 *   data efetiva do registro =
 *     - data operacional confiável: prefixo AAAA-MM-DD do campo de data da
 *       fonte (o dia operacional como foi registrado, sem converter fuso);
 *     - senão, a data de REGISTRO (createdAt, UTC) — registro que entrou no
 *       sistema depois da data pedida não prova ser anterior a ela.
 *   bloqueia quando data efetiva > data do comando (mesmo dia NÃO bloqueia:
 *   o comando é gravado agora, depois dos registros daquele dia).
 *
 *   LancamentoTarefa: data_conclusao (realizado) › data_inicio (iniciado) ›
 *   createdAt (registrado). data_prevista é previsão, não evento: não conta.
 *   Tarefa 'Cancelada' não bloqueia. MovimentacaoMapa 'cancelado' não bloqueia.
 *
 * Vínculo: o mesmo `movimentoCitaLotes` do histórico/exclusão (lote_id,
 * lote_destino_id, lote_ids, efeitos, matrizes) e, só para registro legado
 * SEM lote_id, o nome. Tenant e empresa sempre filtrados. Sem teto (COUNT).
 */

import { Prisma } from '@prisma/client';

import { movimentoCitaLotes } from './movimentacaoVinculoLote.js';
import { FONTES_DE_LOTE, SITUACAO_CANCELADO } from './movimentacaoMapaCancelamentoService.js';

/** Prefixo AAAA-MM-DD do texto, ou NULL (data ausente/malformada). */
const dataConfiavel = (expr) => Prisma.sql`(CASE WHEN COALESCE(${expr}, '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(${expr}, 10) END)`;
const diaDeRegistro = (alias) => Prisma.sql`to_char(${Prisma.raw(alias)}."createdAt", 'YYYY-MM-DD')`;

/** "AAAA-MM-DD" da data do comando (aceita AAAA-MM-DD ou ISO; o dia operacional é o do prefixo). */
export const diaOperacional = (valor) => String(valor ?? '').slice(0, 10);

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string} empresaId
 * @param {{ loteIds: string[], nomes: string[], data: string }} filtro
 * @returns {Promise<Array<{fonte: string, quantidade: number}>>}
 */
export const registrosAtivosPosteriores = async (tx, clienteId, empresaId, { loteIds, nomes, data }) => {
  const dia = diaOperacional(data);
  const lotes = [...new Set(loteIds)];
  const nomesUp = [...new Set(nomes.filter(Boolean).map((n) => String(n).trim().toUpperCase()))];
  const encontrados = [];

  const [mapa] = /** @type {Array<{n: number}>} */ (
    await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM "MovimentacaoMapa" m
       WHERE m.cliente_id = ${clienteId} AND m.empresa_id = ${empresaId}
         AND COALESCE(m.dados->>'situacao', '') <> ${SITUACAO_CANCELADO}
         AND (
           ${movimentoCitaLotes('m', lotes)}
           OR (COALESCE(m.dados->>'lote_id', '') = '' AND upper(btrim(COALESCE(m.dados->>'lote', ''))) = ANY(${nomesUp}::text[]))
         )
         AND COALESCE(${dataConfiavel(Prisma.sql`m.dados->>'data_movimentacao'`)}, ${diaDeRegistro('m')}) > ${dia}`
  );
  if (mapa?.n) encontrados.push({ fonte: 'MovimentacaoMapa', quantidade: mapa.n });

  for (const fonte of FONTES_DE_LOTE) {
    const datas = fonte.datas.map((c) => dataConfiavel(Prisma.sql`d.dados->>${c}`));
    const [linha] = /** @type {Array<{n: number}>} */ (
      await tx.$queryRaw`
        SELECT COUNT(*)::int AS n FROM ${Prisma.raw(`"${fonte.tabela}"`)} d
         WHERE d.cliente_id = ${clienteId} AND d.empresa_id = ${empresaId}
           AND (
             d.dados->>'lote_id' = ANY(${lotes}::text[])
             OR (COALESCE(d.dados->>'lote_id', '') = ''
                 AND upper(btrim(COALESCE(d.dados->>'lote', d.dados->>'lote_nome', d.dados->>'nome_lote', ''))) = ANY(${nomesUp}::text[]))
           )
           AND COALESCE(${Prisma.join(datas, ', ')}, ${diaDeRegistro('d')}) > ${dia}`
    );
    if (linha?.n) encontrados.push({ fonte: fonte.tabela, quantidade: linha.n });
  }

  const [tarefas] = /** @type {Array<{n: number}>} */ (
    await tx.$queryRaw`
      SELECT COUNT(*)::int AS n FROM "LancamentoTarefa" t
       WHERE t.cliente_id = ${clienteId} AND t.empresa_id = ${empresaId}
         AND t.lote_id = ANY(${lotes}::text[])
         AND t.status <> 'Cancelada'
         AND COALESCE(to_char(t.data_conclusao, 'YYYY-MM-DD'), to_char(t.data_inicio, 'YYYY-MM-DD'), ${diaDeRegistro('t')}) > ${dia}`
  );
  if (tarefas?.n) encontrados.push({ fonte: 'LancamentoTarefa', quantidade: tarefas.n });

  return encontrados;
};
