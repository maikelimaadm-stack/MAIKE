import React from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Confirmação centrada no modelo Base1 (foto: Confirme a exclusão).
 * Fechar / Confirmar em pílulas cinza; X circular no cabeçalho.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title = "Confirme a exclusão",
  description = "Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita.",
  onConfirm,
  confirmText = "Confirmar",
  cancelText = "Fechar",
  variant = "default",
}) {
  const handleConfirm = () => {
    onConfirm?.();
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        className={cn(
          "fixed left-[50%] top-[50%] z-[70] w-auto max-w-none translate-x-[-50%] translate-y-[-50%]",
          "gap-0 overflow-visible border-0 bg-transparent p-0 shadow-none",
          "[&>button]:hidden",
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div
          className={cn(
            "mg-confirm-dialog cadastro-b1 b1ref b1-portal-compras",
            variant === "destructive" && "mg-confirm-dialog--danger",
          )}
          role="alertdialog"
          aria-labelledby="mg-confirm-title"
          aria-describedby="mg-confirm-desc"
        >
          <div className="mg-confirm-dialog__h">
            <span id="mg-confirm-title" className="mg-confirm-dialog__t">
              {title}
            </span>
            <span style={{ flexGrow: 1 }} />
            <button
              type="button"
              className="mg-confirm-dialog__close"
              aria-label="Fechar"
              title="Fechar"
              onClick={() => onOpenChange?.(false)}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div id="mg-confirm-desc" className="mg-confirm-dialog__b">
            {description}
          </div>
          <div className="mg-confirm-dialog__f">
            <span style={{ flexGrow: 1 }} />
            <button
              type="button"
              className="tb-btn tb-btn-gray"
              onClick={() => onOpenChange?.(false)}
            >
              {cancelText}
            </button>
            <button type="button" className="tb-btn tb-btn-gray" onClick={handleConfirm}>
              {confirmText}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
