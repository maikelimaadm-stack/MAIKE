/**
 * Rascunho para duplicar registro no modo “Novo” (paridade botão Duplicar Base1).
 *
 * @param {object | null | undefined} source
 * @param {{ labelField?: string; suffix?: string; stripId?: boolean }} [options]
 */
export function prepareCadastroDuplicate(source, options = {}) {
  const { labelField = "nome", suffix = " (cópia)", stripId = true } = options;
  if (!source) return null;
  const draft = { ...source };
  if (stripId) {
    delete draft.id;
  }
  if (labelField && source[labelField]) {
    draft[labelField] = `${source[labelField]}${suffix}`;
  }
  return draft;
}
