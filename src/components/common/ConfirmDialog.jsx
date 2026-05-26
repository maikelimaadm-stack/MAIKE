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
import { X } from "lucide-react";

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
      <AlertDialogContent className="max-w-md rounded-none border border-slate-200">
        <AlertDialogCancel className="absolute right-2 top-2 h-7 w-7 rounded-none border-0 bg-white p-0 text-slate-700 shadow-none hover:bg-slate-50">
          <X className="w-4 h-4" />
        </AlertDialogCancel>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-slate-600 pt-2">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-8 text-xs rounded-none border-slate-200">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={`h-8 text-xs rounded-none ${
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