import React from "react";
import { Check, Loader2 } from "lucide-react";
import MobileSheet from "@/components/common/MobileSheet";

/**
 * Cadastro rápido aberto pelo + de uma lista de seleção (D-PROD-95): o
 * formulário da entidade abre numa folha grande por cima do formulário atual,
 * que fica intacto. ✓ à direita do título salva (envia o `<form id={formId}>`).
 * No tablet/desktop a folha vira diálogo centralizado.
 *
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   title: string,
 *   formId: string,
 *   saving?: boolean,
 *   children: React.ReactNode,
 * }} props
 */
export default function CadastroRapidoSheet({ open, onClose, title, formId, saving = false, children }) {
  return (
    <MobileSheet
      open={open}
      onClose={onClose}
      label={title}
      title={title}
      initialLarge
      className="mk-cr"
      headerAction={
        <button
          type="submit"
          form={formId}
          className="mk-sheet__new mk-sheet__new--salvar"
          aria-label={saving ? "Salvando…" : "Salvar"}
          title="Salvar"
          disabled={saving}
        >
          {saving ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Check size={22} aria-hidden />}
        </button>
      }
    >
      <div className="mk-cr__corpo cadastro-b1 cadastro-b1--full-page">{children}</div>
    </MobileSheet>
  );
}
