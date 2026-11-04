import React from "react";
import ConfirmDialog from "@/components/common/ConfirmDialog";

/** Aviso de permissão — mesmo diálogo do sistema, um botão só (D-PROD-121). */
export default function PermissionAlertDialog({ open, onOpenChange, title, description }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmText="Entendi"
      soInformar
    />
  );
}
