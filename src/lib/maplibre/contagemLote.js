/**
 * Tamanho da fonte da quantidade de cabeças no marcador do lote (D-PROD-83).
 *
 * Até 4 caracteres cabem no tamanho base, abaixo da figura. Com mais
 * caracteres (ex.: "12500"), a fonte encolhe na mesma proporção para o número
 * continuar dentro do espaço do ícone, nunca abaixo do mínimo legível.
 */

export const FONTE_CONTAGEM_BASE = 11;
export const CARACTERES_NO_TAMANHO_BASE = 4;
export const FONTE_CONTAGEM_MINIMA = 6;

/** @param {string|number} texto @returns {number} tamanho em px */
export const tamanhoFonteContagem = (texto) => {
  const n = String(texto ?? '').length;
  if (n <= CARACTERES_NO_TAMANHO_BASE) return FONTE_CONTAGEM_BASE;
  return Math.max(FONTE_CONTAGEM_MINIMA, Math.floor((FONTE_CONTAGEM_BASE * CARACTERES_NO_TAMANHO_BASE) / n));
};
