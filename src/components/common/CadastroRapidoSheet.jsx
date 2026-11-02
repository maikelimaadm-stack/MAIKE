import React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Check, Loader2, X } from "lucide-react";
import MobileSheet, { useMediaQuery } from "@/components/common/MobileSheet";
import { PillBtn } from "@/components/cadastro/base1/Base1Ui";

/**
 * Cadastro rápido aberto pelo + de uma lista de seleção (D-PROD-95): o
 * formulário da entidade abre por cima do formulário atual, que fica intacto.
 *
 * - Celular/tablet: folha grande com ✕ / ✓ redondos no cabeçalho (padrão iOS).
 * - Desktop (≥1024px, D-PROD-105): diálogo de desktop — título à esquerda,
 *   ✕ Cancelar e ✓ Salvar com os mesmos botões da barra do registro. Nada de
 *   folha, alça ou botões redondos do celular.
 *
 * ✓ envia o `<form id={formId}>`.
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
  const desktop = useMediaQuery("(min-width: 1024px)");

  if (desktop) {
    return (
      <DialogPrimitive.Root open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="mk-crd-scrim" />
          <DialogPrimitive.Content className="mk-crd" aria-describedby={undefined}>
            <div className="mk-crd__head cadastro-b1">
              <DialogPrimitive.Title className="mk-crd__title">{title}</DialogPrimitive.Title>
              <div className="mk-crd__acoes">
                <PillBtn tone="gray" className="mg-act-ic mg-act-cancelar" onClick={onClose} disabled={saving} aria-label="Cancelar" title="Cancelar">
                  <X className="h-4 w-4" aria-hidden />
                </PillBtn>
                <PillBtn
                  type="submit"
                  form={formId}
                  className="mg-act-ic mg-act-novo mg-act-salvar"
                  disabled={saving}
                  aria-label={saving ? "Salvando…" : "Salvar"}
                  title={saving ? "Salvando…" : "Salvar"}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                </PillBtn>
              </div>
            </div>
            <div className="mk-crd__body">
              <div className="mk-cr__corpo cadastro-b1 cadastro-b1--full-page">{children}</div>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

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
