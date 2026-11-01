/**
 * Teclado dos formulários (D-PROD-95), instalado uma vez pelo `Layout`:
 *
 * - Campo numérico (`type="number"`) abre o teclado numérico do celular
 *   (`inputmode="decimal"`).
 * - Enter num campo de formulário funciona como Tab: vai para o próximo campo.
 *   No último campo, tenta salvar (`requestSubmit` do formulário).
 * - A tecla Enter do teclado do celular mostra "Próximo" ou "OK"
 *   (`enterkeyhint`), conforme haja campo depois.
 *
 * Quem já trata o Enter (autocomplete escolhendo a opção, pesquisa) chama
 * `preventDefault` e fica de fora. Textarea mantém a quebra de linha.
 */

const CAMPO =
  'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea, button[role="combobox"], button[role="switch"]';

/** @param {Element} el */
function visivelEEditavel(el) {
  const campo = /** @type {HTMLInputElement} */ (el);
  if (campo.disabled || (campo.readOnly && el.tagName === "INPUT" && !campo.hasAttribute("aria-haspopup"))) return false;
  if (el.getAttribute("tabindex") === "-1" || el.closest("[aria-hidden='true'], [hidden], [inert]")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** @param {HTMLElement} el */
function formularioDe(el) {
  return el.closest("form");
}

/**
 * Campos navegáveis do formulário, na ordem do documento.
 * @param {HTMLFormElement} form
 * @returns {HTMLElement[]}
 */
function camposDo(form) {
  const dentro = Array.from(form.querySelectorAll(/** @type {any} */ (CAMPO)));
  const fora = form.id
    ? Array.from(document.querySelectorAll(`[form="${CSS.escape(form.id)}"]`)).filter((e) => e.matches(CAMPO))
    : [];
  return [...dentro, ...fora].filter(visivelEEditavel);
}

/** @param {HTMLElement} el */
function ehCampoDeTexto(el) {
  return el.tagName === "INPUT" || el.tagName === "SELECT";
}

/** @param {FocusEvent} event */
function aoFocar(event) {
  const el = /** @type {HTMLElement} */ (event.target);
  if (!(el instanceof HTMLInputElement)) return;
  if (el.type === "number" && !el.hasAttribute("inputmode")) el.setAttribute("inputmode", "decimal");
  const form = formularioDe(el);
  if (!form || el.hasAttribute("enterkeyhint")) return;
  const campos = camposDo(form);
  const i = campos.indexOf(el);
  el.setAttribute("enterkeyhint", i >= 0 && i < campos.length - 1 ? "next" : "done");
}

/** @param {KeyboardEvent} event */
function aoTeclar(event) {
  if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  const el = /** @type {HTMLElement} */ (event.target);
  if (!(el instanceof HTMLElement) || !ehCampoDeTexto(el)) return;
  if (el.closest("[data-enter-livre], [role='search'], .mk-sheet, .mk-pill, .mg-search-pill-wrap")) return;
  const form = formularioDe(el);
  if (!form) return;
  const campos = camposDo(form);
  const i = campos.indexOf(el);
  if (i < 0) return;
  event.preventDefault();
  const proximo = campos[i + 1];
  if (proximo) {
    proximo.focus();
    if (proximo instanceof HTMLInputElement && /^(text|search|tel|email|url|number|password)$/.test(proximo.type)) {
      try {
        proximo.select();
      } catch {
        /* alguns tipos não aceitam seleção */
      }
    }
    return;
  }
  form.requestSubmit();
}

let instalado = false;

/** Instala os ouvintes (idempotente). Devolve a função que remove. */
export function instalarTecladoDoFormulario() {
  if (instalado || typeof document === "undefined") return () => {};
  instalado = true;
  document.addEventListener("focusin", aoFocar);
  document.addEventListener("keydown", aoTeclar);
  return () => {
    instalado = false;
    document.removeEventListener("focusin", aoFocar);
    document.removeEventListener("keydown", aoTeclar);
  };
}

export const __teste = { camposDo, aoTeclar, aoFocar };
