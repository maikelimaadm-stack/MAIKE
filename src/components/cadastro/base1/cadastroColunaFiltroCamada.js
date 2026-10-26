/**
 * Camadas portaladas do filtro de coluna (paridade `camada-aninhada-do-filtro.ts`, decisões 357–360).
 */

/** Paridade `camada-aninhada-do-filtro.ts` — sem popovers genéricos (evita bloquear dismiss do `fpop`). */
export const SELETOR_CAMADA_ANINHADA_DO_FILTRO =
  "[data-filtro-camada], [data-radix-select-content], .fsell, .foperadores, .cmd-panel, .mg-dp-panel, .b1-dp-filtro";

/** @param {EventTarget | null} alvo */
export function ehCamadaAninhadaDoFiltro(alvo) {
  return (
    alvo instanceof Element &&
    Boolean(alvo.closest(SELETOR_CAMADA_ANINHADA_DO_FILTRO))
  );
}

/** @param {ParentNode | null | undefined} [doc] */
export function haCamadaAninhadaDoFiltroAberta(doc) {
  const root = doc ?? (typeof document !== "undefined" ? document : null);
  return Boolean(root?.querySelector?.(SELETOR_CAMADA_ANINHADA_DO_FILTRO));
}

/** @param {{ clientX: number; clientY: number } | null | undefined} ponto @param {Element | null | undefined} el */
export function ponteiroSobreElemento(ponto, el) {
  if (!ponto || !el) return false;
  const r = el.getBoundingClientRect();
  return (
    ponto.clientX >= r.left &&
    ponto.clientX <= r.right &&
    ponto.clientY >= r.top &&
    ponto.clientY <= r.bottom
  );
}

/**
 * @param {{ alvo: EventTarget | null; ponto?: { clientX: number; clientY: number } | null; shell: Element | null; ancora?: Element | null; doc?: ParentNode | null }} opts
 */
export function deveFecharFiltroPorFora(opts) {
  const { alvo, ponto, shell, ancora, doc } = opts;
  if (shell && alvo instanceof Node && shell.contains(alvo)) return false;
  if (ancora && alvo instanceof Node && ancora.contains(alvo)) return false;
  if (ehCamadaAninhadaDoFiltro(alvo)) return false;
  if (haCamadaAninhadaDoFiltroAberta(doc)) return false;
  if (ponteiroSobreElemento(ponto, shell) || ponteiroSobreElemento(ponto, ancora)) return false;
  return true;
}
