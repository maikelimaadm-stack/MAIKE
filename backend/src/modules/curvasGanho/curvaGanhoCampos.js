/**
 * Campos de GMD da Curva de Ganho de Peso (D-PROD-194): um por mês do
 * calendário, de janeiro (`gmd_jan`) a dezembro (`gmd_dez`), em kg/dia, de
 * -2 a 3 (negativo = perda de peso). Fica num módulo próprio para o serviço,
 * as rotas e o repositório usarem a MESMA lista sem import circular.
 */

export const GMD_MINIMO = -2;
export const GMD_MAXIMO = 3;

/** Os 12 meses do calendário, na ordem: o campo de cada um é `gmd_<mes>`. */
export const MESES = Object.freeze(['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);
export const CAMPOS_GMD = Object.freeze(MESES.map((mes) => `gmd_${mes}`));
