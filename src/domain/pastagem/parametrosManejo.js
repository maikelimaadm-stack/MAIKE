/**
 * Parâmetros de manejo do pasto (D-PROD-215/223), funções puras de leitura e
 * exibição: alturas de entrada e de saída em cm (pt-BR, 1 casa) e dias de
 * descanso (inteiro de 1 a 365). Os mesmos tetos do servidor. Usados no cadastro
 * de Culturas e nos parâmetros próprios do pasto (Área).
 */

/** Mesmo teto do servidor (D-PROD-215). */
export const ALTURA_MAXIMA_CM = 1000;

/**
 * Altura para exibir: "25", "25,5"; vazio quando não há.
 * @param {unknown} valor
 * @returns {string}
 */
export const formatarAlturaCm = (valor) => {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
};

/**
 * Lê a altura digitada (pt-BR). `null` = vazio; `undefined` = inválida
 * (texto, zero, negativa, mais de 1 casa ou acima do teto).
 * @param {unknown} texto
 * @returns {number|null|undefined}
 */
export const lerAlturaCm = (texto) => {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  if (!/^\d+([.,]\d)?$/.test(t)) return undefined;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > ALTURA_MAXIMA_CM) return undefined;
  return n;
};

/** D-PROD-223 — mesmo teto do servidor para os dias de descanso. */
export const DIAS_DESCANSO_MAXIMO = 365;

/**
 * Lê os dias de descanso digitados. `null` = vazio; `undefined` = inválido
 * (não inteiro, zero, negativo ou acima de 365).
 * @param {unknown} texto
 * @returns {number|null|undefined}
 */
export const lerDiasDescanso = (texto) => {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 1 || n > DIAS_DESCANSO_MAXIMO) return undefined;
  return n;
};
