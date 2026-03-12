import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function SyncProgressDialog({ 
  open,
  onOpenChange,
  syncState // { isRunning, currentStep, totalSteps, currentItem, currentPhase, items: [{name, status, message}], completed, errors }
}) {
  const { isRunning, currentStep, totalSteps, currentItem, currentPhase, items = [], completed, errors } = syncState || {};
  
  const progressPercent = totalSteps > 0 ? Math.round((currentStep / totalSteps) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isRunning) onOpenChange?.(nextOpen); }}>
      <DialogContent className="max-w-md" onPointerDownOutside={(e) => { if (isRunning) e.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {isRunning ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                Sincronizando...
              </>
            ) : completed ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                Sincronização Concluída
              </>
            ) : (
              <>
                <Clock className="w-5 h-5 text-slate-500" />
                Preparando...
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Barra de Progresso */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-slate-500">
              <span>{currentPhase || 'Sincronização'}</span>
              <span>{currentStep || 0} de {totalSteps || 0}</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>

          {/* Item atual sendo processado */}
          {isRunning && currentItem && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                <span className="text-sm text-blue-800 font-medium">Processando:</span>
              </div>
              <p className="text-sm text-blue-700 mt-1 font-mono">{currentItem}</p>
            </div>
          )}

          {/* Lista de itens processados */}
          {items.length > 0 && (
            <div className="max-h-48 overflow-auto space-y-1 border rounded-lg p-2 bg-slate-50">
              {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-white">
                  {item.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />}
                  {item.status === 'error' && <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                  {item.status === 'skip' && <Badge variant="outline" className="text-[8px] px-1">SKIP</Badge>}
                  <span className={`flex-1 truncate ${item.status === 'error' ? 'text-red-600' : 'text-slate-700'}`}>
                    {item.name}
                  </span>
                  {item.message && (
                    <span className="text-slate-400 text-[10px]">{item.message}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Resumo final */}
          {completed && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-emerald-700">{items.filter(i => i.status === 'success').length}</div>
              <div className="text-xs text-emerald-600">registros sincronizados</div>
              {errors > 0 && (
                <div className="text-xs text-red-600 mt-1">{errors} erro(s)</div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}