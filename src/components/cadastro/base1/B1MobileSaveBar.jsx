import React from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useMobileShellState } from "@/lib/mobileShellContext";

/** A mesma ação do cabeçalho, em uma barra no rodapé do tema de vidro. */
export default function B1MobileSaveBar() {
  const { record } = useMobileShellState();
  if (!record?.editing || !record.formId) return null;
  return (
    <div className="b1-glass-savebar">
      <button
        type="submit"
        form={record.formId}
        disabled={record.saving}
        data-permissao-explicita={record.permissaoExplicita ? "" : undefined}
        className="b1-glass-savebar__button"
      >
        {record.saving ? <Loader2 size={23} className="animate-spin" aria-hidden /> : <CheckCircle2 size={23} aria-hidden />}
        {record.saving ? "Salvando…" : "Salvar"}
      </button>
    </div>
  );
}
