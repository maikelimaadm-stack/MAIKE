/**
 * Motor Base1 — contrato de escala da lista (D-PROD-54 / D-PROD-55).
 *
 * Independente de entidade (Marcas, Produtos, …). Telas de cadastro consomem
 * estes tetos + `useCadastroInfiniteList`; alterar aqui afeta quem pluga o motor.
 *
 * Espelho do backend `shared/pagination/keysetCursor.js` — não importar `backend/` no Vite.
 */

/** Teto por request HTTP (alinhar com `LIMITE_MAXIMO` do backend). */
export const LIMITE_MAXIMO = 500;

/** Página padrão. */
export const LIMITE_PADRAO = 100;

/**
 * Máximo de linhas acumuladas no browser por listagem.
 * Além disso: refine a busca — não dá para materializar bilhões na UI.
 */
export const CADASTRO_B1_MAX_JANELA = 2000;

/**
 * Page sizes do seletor Base1, limitados ao teto de rede.
 */
export const CADASTRO_B1_PAGE_SIZES_ESCALA = [100, 200, 300, 400, 500];

/**
 * @param {unknown} bruto
 * @param {{ padrao?: number, maximo?: number }} [opts]
 */
export const normalizarLimiteCliente = (bruto, opts = {}) => {
  const padrao = opts.padrao ?? LIMITE_PADRAO;
  const maximo = opts.maximo ?? LIMITE_MAXIMO;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n < 1) return padrao;
  return Math.min(Math.floor(n), maximo);
};

/**
 * @typedef {{
 *   items: object[],
 *   next_cursor: string|null,
 *   has_more: boolean,
 *   total: number,
 *   limit: number,
 * }} CadastroListaPage
 */

/**
 * Normaliza qualquer resposta de listagem paginada Base1.
 * @param {unknown} bruto
 * @param {number} [limitFallback]
 * @returns {CadastroListaPage}
 */
export const normalizarEnvelopePagina = (bruto, limitFallback = LIMITE_PADRAO) => {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return {
      items: [],
      next_cursor: null,
      has_more: false,
      total: 0,
      limit: limitFallback,
    };
  }
  const page = /** @type {Record<string, unknown>} */ (bruto);
  const items = Array.isArray(page.items) ? page.items : [];
  return {
    items,
    next_cursor: typeof page.next_cursor === "string" ? page.next_cursor : null,
    has_more: Boolean(page.has_more),
    total: Number(page.total) || 0,
    limit: Number(page.limit) || items.length || limitFallback,
  };
};
