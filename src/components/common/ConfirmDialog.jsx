import React from "react";
import TopNoticeDialog from "@/components/common/TopNoticeDialog";

export default function ConfirmDialog({
  open,
  onOpenChange,
  title = "Confirmar exclusão",
  description = "Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita.",
  onConfirm,
  confirmText = "Excluir",
  cancelText = "Cancelar",
  variant = "default"
}) {
  return (
    <TopNoticeDialog
      open={open}
      onOpenChange={onOpenChange}
      badge={variant === "destructive" ? "EXCLUIR" : "AVISO"}
      title={title}
      description={description}
      type={variant === "destructive" ? "danger" : variant}
      confirmText={confirmText}
      cancelText={cancelText}
      onConfirm={onConfirm}
    />
  );
}