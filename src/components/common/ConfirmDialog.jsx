import React from "react";
import { Trash2, X } from "lucide-react";
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
 * Cancelar: X + texto. Excluir (destructive): lixeira + texto, fundo vermelho, ícone/texto brancos.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title = "Confirme a exclusão",
  description = "Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita.",
  onConfirm,
  confirmText = "Excluir",
  cancelText = "Cancelar",
  variant = "default",
}) {
  const isDestructive = variant === "destructive" || variant === "danger";

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
              isDestructive && "mg-confirm-dialog--danger",
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
                className="tb-btn tb-btn-gray shrink-0"
                title={cancelText}
                aria-label={cancelText}
                onClick={() => onOpenChange?.(false)}
              >
                <X className="h-4 w-4" aria-hidden />
                {cancelText}
              </button>
              <button
                type="button"
                className={cn(
                  "tb-btn shrink-0",
                  isDestructive ? "tb-btn-red mg-confirm-dialog__excluir" : "tb-btn-green",
                )}
                title={confirmText}
                aria-label={confirmText}
                onClick={handleConfirm}
              >
                {isDestructive ? <Trash2 className="h-4 w-4" aria-hidden /> : null}
                {confirmText}
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
