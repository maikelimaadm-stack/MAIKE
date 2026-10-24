import { useCallback } from "react";
import { prepareCadastroDuplicate } from "@/components/cadastro/base1/cadastroDuplicateHelpers";

/**
 * @param {object} p
 * @param {any} p.chrome estado do `useCadastroListaChromeState`
 * @param {(id: string) => object | undefined} p.findById
 * @param {(draft: object) => void} p.openDraft
 * @param {string} [p.labelField]
 */
export function useCadastroDuplicateAction({ chrome, findById, openDraft, labelField = "nome" }) {
  return useCallback(() => {
    const id = chrome.selectedIds[0];
    if (!id) return;
    const draft = prepareCadastroDuplicate(findById(id), { labelField });
    if (!draft) return;
    openDraft(draft);
    chrome.setViewMode("record");
  }, [chrome, findById, openDraft, labelField]);
}
