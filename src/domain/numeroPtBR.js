/**
 * Leitura de número decimal em formato brasileiro (DBT-25, fechado na P1.4).
 *
 * `parseFloat('12,5')` devolve `12`: o parser para na vírgula e **descarta a
 * parte decimal em silêncio**. Numa área de pastagem isso significa gravar 12
 * hectares onde o usuário digitou 12,5 — sem erro, sem aviso, sem rastro.
 *
 * Módulo puro: sem React, sem provider, sem `window`.
 */

/**
 * Converte texto em número, aceitando vírgula **ou** ponto como separador
 * decimal.
 *
 * Regras, todas exercitadas por teste:
 *
 * - `'12,5'` e `'12.5'` → `12.5`;
 * - `'1.234,56'` → `1234.56` — o ponto é separador de milhar quando existe
 *   vírgula depois dele;
 * - `''`, `'   '`, `null` e `undefined` → `null` (campo opcional em branco);
 * - texto sem número → `null`, nunca `NaN`: `NaN` atravessa comparação e
 *   `JSON.stringify` sem reclamar e vira `null` no servidor de qualquer jeito,
 *   só que mais tarde e sem explicação;
 * - número já numérico passa direto.
 *
 * @param {unknown} valor
 * @returns {number|null}
 */
export const parseDecimalPtBR = (valor) => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (valor === null || valor === undefined) return null;

  const texto = String(valor).trim();
  if (!texto) return null;

  const temVirgula = texto.includes(',');
  // Com vírgula presente, o ponto só pode ser separador de milhar.
  const normalizado = temVirgula ? texto.replace(/\./g, '').replace(',', '.') : texto;

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
};

/**
 * Mesma leitura, arredondada para inteiro.
 *
 * `parseInt('12,5')` também para na vírgula, mas ali o resultado — 12 — é o
 * pretendido. O que muda é `'1.234'`: `parseInt` devolvia 1.
 *
 * @param {unknown} valor
 * @returns {number|null}
 */
export const parseInteiroPtBR = (valor) => {
  const numero = parseDecimalPtBR(valor);
  return numero === null ? null : Math.trunc(numero);
};
