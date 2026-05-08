import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import { formatKg } from "./formatters";

export default function SobraHerdadaDialog({ open, sobraKg, pontoNome, ultimoLancamentoData, onAproveitar, onDescartar, onCancel }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel?.()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Sobra do ciclo anterior
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-600 pt-1">
            O cocho <span className="font-semibold text-slate-900">{pontoNome}</span> ficou sem lote no pasto e tinha sobra registrada no fechamento.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
          <div className="text-xs text-amber-700">Sobra registrada</div>
          <div className="text-2xl font-bold text-amber-900">{formatKg(sobraKg)}</div>
          {ultimoLancamentoData && (
            <div className="text-[10px] text-amber-700 mt-1">
              Fechamento em {new Date(ultimoLancamentoData).toLocaleDateString("pt-BR")}
            </div>
          )}
        </div>

        <div className="text-xs text-slate-600">O que deseja fazer com esse produto?</div>

        <div className="grid gap-2">
          <Button
            type="button"
            onClick={onAproveitar}
            className="bg-emerald-600 hover:bg-emerald-700 text-white justify-start h-auto py-2.5"
          >
            <RefreshCw className="w-4 h-4 mr-2 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-semibold">Aproveitar a sobra</div>
              <div className="text-[10px] font-normal opacity-90">Considera os {formatKg(sobraKg)} ainda no cocho — sem nova baixa no depósito</div>
            </div>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={onDescartar}
            className="justify-start h-auto py-2.5 border-slate-300"
          >
            <Trash2 className="w-4 h-4 mr-2 shrink-0 text-slate-500" />
            <div className="text-left">
              <div className="text-xs font-semibold">Sobra já foi descartada/baixada</div>
              <div className="text-[10px] font-normal text-slate-500">Lançamento limpo, começa do zero</div>
            </div>
          </Button>
        </div>

        <div className="flex justify-end pt-1 border-t">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="h-7 text-xs text-slate-500">
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}