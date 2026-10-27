/**
 * Rascunho para duplicar registro no modo “Novo” (paridade botão Duplicar Base1).
 *
 * @param {object | null | undefined} source
 * @param {{ labelField?: string; suffix?: string; stripId?: boolean }} [options]
 */
export function prepareCadastroDuplicate(source, options = {}) {
  const { labelField = "nome", suffix = "", stripId = true } = options;
  if (!source) return null;
  const draft = { ...source };
  if (stripId) {
    delete draft.id;
  }
  if (labelField && source[labelField] != null) {
    const base = String(source[labelField]);
    draft[labelField] = suffix ? `${base}${suffix}` : base;
  }
  return draft;
}
