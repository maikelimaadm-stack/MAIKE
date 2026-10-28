/**
 * SSOT de apresentação visual do perfil Base1 “lista integrada” (piloto Marcas).
 * Sem nomes de entidade, sem imports de domínio — só flags de chrome/workspace/grade.
 *
 * @typedef {Object} Base1WorkspaceVisualPreset
 * @property {'base1-list'} pageLayout
 *
 * @typedef {Object} Base1ListaChromeVisualPreset
 * @property {false} showFilterRail
 * @property {true} joinTableToolbar
 * @property {true} portalComprasSkin
 *
 * @typedef {Object} Base1GradeVisualPreset
 * @property {true} referenceHeaders
 */

/** @type {Readonly<Base1WorkspaceVisualPreset>} */
export const BASE1_WORKSPACE_LIST_VISUAL = Object.freeze({
  pageLayout: "base1-list",
});

/** @type {Readonly<Base1ListaChromeVisualPreset>} */
export const BASE1_LISTA_CHROME_VISUAL = Object.freeze({
  showFilterRail: false,
  joinTableToolbar: true,
  portalComprasSkin: true,
});

/** @type {Readonly<Base1GradeVisualPreset>} */
export const BASE1_GRADE_REFERENCE_HEADERS = Object.freeze({
  referenceHeaders: true,
});

/**
 * Spread único para CadastroWorkspace + CadastroListaChrome (Marcas e futuras telas).
 * Overrides de entidade (seleção, cards mobile, colunas, storageKey) ficam na tela.
 */
export const BASE1_MARCAS_MODEL_VISUAL = Object.freeze({
  workspace: BASE1_WORKSPACE_LIST_VISUAL,
  chrome: BASE1_LISTA_CHROME_VISUAL,
  grade: BASE1_GRADE_REFERENCE_HEADERS,
});
