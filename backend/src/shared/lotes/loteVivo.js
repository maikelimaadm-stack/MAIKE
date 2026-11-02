/**
 * Guarda de escrita: registro novo (ou alterado) que cita lote — MAIKE-LOTES-R1.
 *
 * Toma `FOR SHARE` nos lotes citados (em ordem de id) dentro da transação do
 * escritor. A exclusão do Cadastro trava o lote com `FOR UPDATE`; as duas
 * travas conflitam, então:
 *   - escritor primeiro → a exclusão espera, vê o vínculo novo e é recusada;
 *   - exclusão primeiro → o escritor espera, vê `excluido_em` e é recusado
 *     (409 LOTE_EXCLUIDO).
 * Lote inexistente segue o contrato anterior (não é validado aqui).
 */

import { AppError } from '../errors/AppError.js';

/** Campos de documento que citam lote por id. */
export const CAMPOS_DE_LOTE = Object.freeze(['lote_id', 'lote_destino_id']);

/** @param {Array<Record<string, unknown>|null|undefined>} documentos */
export const idsDeLoteCitados = (documentos) => {
  const ids = new Set();
  for (const doc of documentos) {
    if (!doc || typeof doc !== 'object') continue;
    for (const campo of CAMPOS_DE_LOTE) {
      const v = doc[campo];
      if (typeof v === 'string' && v.trim()) ids.add(v.trim());
    }
  }
  return [...ids].sort();
};

/**
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {string[]} ids
 */
export const exigirLotesNaoExcluidos = async (tx, clienteId, ids) => {
  const ordenados = [...new Set(ids.filter(Boolean))].sort();
  if (!ordenados.length) return;
  const linhas = /** @type {Array<{id: string, excluido_em: Date|null}>} */ (
    await tx.$queryRaw`SELECT id, excluido_em FROM "Lote" WHERE cliente_id = ${clienteId} AND id = ANY(${ordenados}::text[]) ORDER BY id FOR SHARE`
  );
  const excluido = linhas.find((l) => l.excluido_em);
  if (excluido) {
    throw new AppError('LOTE_EXCLUIDO', 'o lote foi excluído do cadastro e não recebe novos registros', { details: { lote_id: excluido.id } });
  }
};

/**
 * Atalho para documentos JSON (`dados` montado ou corpo de entrada).
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Array<Record<string, unknown>|null|undefined>} documentos
 */
export const exigirLotesDosDocumentos = async (tx, clienteId, documentos) => {
  await resolverPosicoesNosDocumentos(tx, clienteId, documentos);
  return exigirLotesNaoExcluidos(tx, clienteId, idsDeLoteCitados(documentos));
};

/**
 * R2E-R1 (D-PROD-107): numa empresa no ledger o mapa entrega ids de POSIÇÃO.
 * Documento que cita uma posição em `lote_id`/`lote_destino_id` passa a
 * guardar as DUAS coisas, cada uma no seu campo: `posicao_id` (a posição
 * operacional) e `lote_id` = a ENTRADA de origem (cadastro) — ou null quando a
 * posição não tem entrada (nascidos). Nunca grava id de posição como se fosse
 * Lote. Escopo: só posições do mesmo tenant.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {string} clienteId
 * @param {Array<Record<string, unknown>|null|undefined>} documentos
 */
export const resolverPosicoesNosDocumentos = async (tx, clienteId, documentos) => {
  const pares = [['lote_id', 'posicao_id'], ['lote_destino_id', 'posicao_destino_id']];
  const ids = [...new Set(documentos.flatMap((d) => (d && typeof d === 'object' ? pares.map(([c]) => d[c]).filter((v) => typeof v === 'string' && v.trim()) : [])))];
  if (!ids.length) return;
  const posicoes = await tx.posicaoRebanho.findMany({ where: { cliente_id: clienteId, id: { in: ids } }, select: { id: true, lote_entrada_id: true } });
  if (!posicoes.length) return;
  const porId = new Map(posicoes.map((p) => [p.id, p]));
  for (const d of documentos) {
    if (!d || typeof d !== 'object') continue;
    for (const [campoLote, campoPosicao] of pares) {
      const p = typeof d[campoLote] === 'string' ? porId.get(d[campoLote].trim()) : null;
      if (!p) continue;
      d[campoPosicao] = p.id;
      d[campoLote] = p.lote_entrada_id ?? null;
    }
  }
};
