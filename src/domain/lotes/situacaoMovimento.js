/**
 * Situação de uma movimentação do mapa (R2A, D-PROD-95).
 *
 * O cancelamento é server-side e preserva o original com
 * `situacao: 'cancelado'` + `cancelamento: {em, por_login, motivo, ...}`.
 * Quem calcula efeito atual (cache do mapa, ordem temporal do lote) ignora o
 * cancelado; quem mostra histórico ou checa referência o mantém.
 */

export const SITUACAO_CANCELADO = 'cancelado';

/** Tipos com cancelamento certificado no servidor (espelho de `TIPOS_CANCELAVEIS`). */
export const TIPOS_COM_CANCELAMENTO = Object.freeze(['Morte', 'Abate', 'Transferência de Área']);

/** @param {any} mov */
export const ehMovimentoCancelado = (mov) => mov?.situacao === SITUACAO_CANCELADO;

/** @param {any} mov */
export const ehMovimentoAtivo = (mov) => !ehMovimentoCancelado(mov);

/** O tipo pode ter cancelamento? (a decisão final é sempre do servidor) */
export const tipoTemCancelamento = (mov) =>
  !!mov && TIPOS_COM_CANCELAMENTO.includes(mov.tipo) && !mov.motivo && ehMovimentoAtivo(mov);
