/**
 * Quantidade de cabeças no marcador do lote (D-PROD-82/89/111; substitui o encolhimento da D-PROD-83).
 *
 * Tamanho fixo, sem encolher conforme o número (o ícone de 44 px comporta a
 * quantidade de um lote), e milhar separado por ponto: 5000 → "5.000".
 */

export const FONTE_CONTAGEM_PX = 9.5;

/** @param {number|string|null|undefined} total @returns {string} */
export const formatarContagem = (total) => {
  const n = Math.trunc(Number(total) || 0);
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};
