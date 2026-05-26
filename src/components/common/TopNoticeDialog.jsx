import React from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Info, X } from "lucide-react";

const iconButtonClass = "rounded-none border-0 bg-white hover:bg-slate-50 text-slate-700 shadow-none h-7 w-7";

export default function TopNoticeDialog({
  open,
  onOpenChange,
  badge = "AVISO",
  title = "Aviso",
  description = "",
  type = "warning",
  confirmText = "Entendi",
  cancelText,
  onConfirm,
}) {
  const isDanger = type === "danger" || type === "destructive";
  const badgeClass = isDanger ? "bg-red-600" : type === "info" ? "bg-slate-500" : "bg-amber-500";
  const Icon = type === "info" ? Info : AlertTriangle;
  const iconClass = isDanger ? "text-red-600" : type === "info" ? "text-slate-500" : "text-amber-500";

  const handleConfirm = () => {
    onConfirm?.();
    onOpenChange?.(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => nextOpen && onOpenChange?.(nextOpen)}>
      <DialogContent
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="bg-transparent fixed left-[50%] top-4 z-[70] w-[calc(100%-1rem)] max-w-[900px] translate-x-[-50%] translate-y-0 gap-0 overflow-hidden border-0 shadow-lg rounded-none p-0"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="bg-white overflow-hidden">
          <div className="h-8 flex items-center gap-2 border-b border-slate-200 px-2">
            <span className={`px-1.5 py-0.5 rounded-sm text-white text-[11px] font-bold ${badgeClass}`}>{badge}</span>
            <span className="text-xs font-semibold text-slate-700 truncate flex-1">{title}</span>
            <Button type="button" onClick={() => onOpenChange?.(false)} title="Fechar" className={iconButtonClass}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="p-4 flex gap-3 text-xs text-slate-700">
            <Icon className={`w-5 h-5 shrink-0 ${iconClass}`} />
            <p>{description}</p>
          </div>
          {(confirmText || cancelText) && (
            <div className="flex justify-end gap-1 border-t border-slate-200 bg-slate-50 p-2">
              {cancelText && (
                <Button type="button" variant="outline" onClick={() => onOpenChange?.(false)} className="h-8 text-xs rounded-none border-slate-200">
                  {cancelText}
                </Button>
              )}
              {confirmText && (
                <Button type="button" onClick={handleConfirm} className={`h-8 text-xs rounded-none text-white ${isDanger ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                  {confirmText}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}