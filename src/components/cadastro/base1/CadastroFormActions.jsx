import React from "react";
import { Check, X } from "lucide-react";

/**
 * Rodapé de formulário — botões pill Base1 (verde/cinza). Deve ficar dentro de `.cadastro-b1`.
 */
export default function CadastroFormActions({
  onCancel,
  submitLabel = "Salvar",
  cancelLabel = "Cancelar",
  isSubmitting = false,
  extra = null,
}) {
  return (
    <div className="flex flex-col-reverse lg:flex-row justify-end items-stretch lg:items-center gap-1 pt-2 border-t border-[var(--mg-divider)]">
      {extra}
      {onCancel ? (
        <button type="button" className="tb-btn tb-btn-gray" onClick={onCancel}>
          <X className="h-4 w-4" aria-hidden />
          {cancelLabel}
        </button>
      ) : null}
      <button type="submit" className="tb-btn tb-btn-green" disabled={isSubmitting}>
        <Check className="h-4 w-4" aria-hidden />
        {submitLabel}
      </button>
    </div>
  );
}
