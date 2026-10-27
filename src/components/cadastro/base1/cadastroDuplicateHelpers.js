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
    // Remove sufixo legado "(cópia)" / "(CÓPIA)" — duplicar não acrescenta e limpa o antigo.
    const limpo = String(source[labelField]).replace(/\s*\(\s*c[oó]pia\s*\)\s*$/i, "").trimEnd();
    draft[labelField] = suffix ? `${limpo}${suffix}` : limpo;
  }
  return draft;
}
