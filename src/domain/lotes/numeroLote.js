/**
 * Utilitário legado de numeração client-side — só para testes e UI de preview.
 * A criação real usa sequência no servidor (P5.1, D-PROD-47).
 *
 * @param {any[]} lotes
 * @returns {string}
 */
export const proximoNumeroLote = (lotes) => {
  const maior = (lotes || []).reduce(
    (max, lote) => Math.max(max, parseInt(lote.numero_lote, 10) || 0),
    0
  );
  return String(maior + 1);
};
