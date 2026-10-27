import React from "react";
import { Check, X } from "lucide-react";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/**
 * Pedido de confirmação — sempre no centro da tela.
 * Rodapé: X cinza + Check verde (paridade filtro do cabeçalho).
 * Notificações (salvar/excluir) ficam no canto via `maikeNotify`.
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
      <DialogPortal>
        <DialogOverlay className="fixed inset-0 z-[70] bg-black/45 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className={cn(
            "fixed inset-0 z-[71] flex items-center justify-center p-4",
            "border-0 bg-transparent shadow-none outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
          style={{ transform: "none", left: 0, top: 0, right: 0, bottom: 0 }}
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
            </div>
            <div id="mg-confirm-desc" className="mg-confirm-dialog__b">
              {description}
            </div>
            <div className="mg-confirm-dialog__f">
              <span style={{ flexGrow: 1 }} />
              <button
                type="button"
                className="tb-btn tb-btn-icon tb-btn-sm shrink-0"
                title={cancelText}
                aria-label={cancelText}
                onClick={() => onOpenChange?.(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-icon tb-btn-green tb-btn-sm shrink-0"
                title={confirmText}
                aria-label={confirmText}
                onClick={handleConfirm}
              >
                <Check className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
