/**
 * SSOT textual/semântico para coluna booleana `ativo` em cadastros Base1.
 * Política legada: ausência ou valor !== false → ativo.
 */

/** @param {unknown} value */
export function isCadastroAtivo(value) {
  return value !== false;
}

/** @param {unknown} value */
export function cadastroAtivoLabel(value) {
  return isCadastroAtivo(value) ? "Ativo" : "Inativo";
}

/** @param {object | null | undefined} item @param {string} [fieldId='ativo'] */
export function readCadastroAtivoValue(item, fieldId = "ativo") {
  if (!item || typeof item !== "object") return undefined;
  return item[fieldId];
}

/** Valor string para busca, filtro, ordenação e export CSV. */
export function getCadastroAtivoFieldValue(item, fieldId = "ativo") {
  return cadastroAtivoLabel(readCadastroAtivoValue(item, fieldId));
}
