import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function ConfirmDialog({ 
  open, 
  onOpenChange, 
  title = "Confirmar exclusão", 
  description = "Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita.", 
  onConfirm,
  confirmText = "Excluir",
  cancelText = "Cancelar",
  variant = "default" // "default", "destructive", "warning"
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-slate-600 pt-2">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-8 text-xs">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={`h-8 text-xs ${
              variant === "destructive" 
                ? "bg-red-600 hover:bg-red-700" 
                : variant === "warning"
                ? "bg-orange-600 hover:bg-orange-700"
                : "bg-emerald-600 hover:bg-emerald-700"
            }`}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}