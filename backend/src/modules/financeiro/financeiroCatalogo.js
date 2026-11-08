/**
 * D-PROD-154 — catálogo FECHADO do perfil financeiro (moeda, país, locale e
 * métodos). Exportado também para o navegador pela rota do perfil.
 *
 * País é METADADO (sem efeito fiscal). PIX só existe para BR com BRL (§8.6):
 * um perfil BR em USD não liquida por PIX. Locales fechados e sempre com
 * numeração latina no navegador (`numberingSystem: 'latn'`).
 */

/** Moeda → casas decimais (escala de arredondamento ROUND_HALF_UP). */
export const MOEDAS = Object.freeze({ BRL: 2, USD: 2, EUR: 2, ARS: 2, UYU: 2, PYG: 0, JPY: 0, KWD: 3 });

export const PAISES = Object.freeze(['BR', 'AR', 'PY', 'UY', 'US', 'PT', 'ES', 'JP', 'KW']);

export const LOCALES = Object.freeze(['pt-BR', 'pt-PT', 'es-AR', 'es-PY', 'es-UY', 'es-ES', 'en-US', 'ja-JP']);

/** Todos os métodos de liquidação conhecidos (mesmo domínio do CHECK no banco). */
export const METODOS = Object.freeze(['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'PIX', 'OUTRO']);

/** Métodos de qualquer perfil (sem PIX). */
export const METODOS_BASE = Object.freeze(['DINHEIRO', 'TRANSFERENCIA', 'CARTAO', 'OUTRO']);

/** Versão do contrato do perfil/documento gravada nas linhas novas. */
export const VERSAO_CONTRATO = 1;

/** @param {{ pais?: string|null, moeda?: string|null }} perfil */
export const pixPermitido = (perfil) => perfil?.pais === 'BR' && perfil?.moeda === 'BRL';

/**
 * Métodos permitidos pelo perfil (PIX só BR + BRL).
 * @param {{ pais?: string|null, moeda?: string|null }} perfil
 * @returns {readonly string[]}
 */
export const metodosPermitidos = (perfil) => (pixPermitido(perfil) ? METODOS : METODOS_BASE);

/** @param {string} moeda */
export const casasDaMoeda = (moeda) => (Object.prototype.hasOwnProperty.call(MOEDAS, moeda) ? MOEDAS[/** @type {keyof typeof MOEDAS} */ (moeda)] : null);

/**
 * Locale do catálogo FECHADO e suportado pelo runtime (sem cair em en-US calado).
 * @param {unknown} locale
 */
export const localeSuportado = (locale) => {
  if (typeof locale !== 'string' || !LOCALES.includes(locale)) return false;
  try {
    return Intl.getCanonicalLocales(locale)[0] === locale && Intl.NumberFormat.supportedLocalesOf([locale]).length === 1;
  } catch {
    return false;
  }
};

/** Catálogo público (resposta do GET do perfil). */
export const catalogoPublico = () => ({
  moedas: Object.entries(MOEDAS).map(([codigo, casas]) => ({ codigo, casas })),
  paises: [...PAISES],
  locales: [...LOCALES],
  // `BR` vale para BR + BRL (PIX); qualquer outra combinação usa `_padrao`.
  metodos_por_pais: { BR: [...METODOS], _padrao: [...METODOS_BASE] },
  pix_exige: { pais: 'BR', moeda: 'BRL' },
});
