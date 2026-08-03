/**
 * Regras puras da cascata de ponto (P1.2).
 *
 * Sem React, sem provider, sem `window`, sem storage.
 */

/** Normalização usada para casar nome de ponto: sem acento, caixa alta, aparado. */
export const normalizarTexto = (valor = '') =>
  String(valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();

/** É um ponto de suplementação da categoria depósito? */
export const ehDeposito = (pontoSuplementacao) =>
  normalizarTexto(pontoSuplementacao?.categoria_ponto) === 'DEPOSITO';
