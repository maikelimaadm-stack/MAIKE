import React from "react";

const formatDateBR = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
};

export default function TarefaResumoVisual({ iconUrl, status, prioridade, prazo }) {
  return (
    <div className="my-1 grid grid-cols-1 md:grid-cols-[auto,1fr] gap-1 items-center">
      <div className="pb-1 flex flex-col gap-1">
        <div className="flex items-end gap-3">
          <div className="flex flex-col items-center gap-0.5" title="Tarefa">
            <div className="my-2 relative h-[68px] w-[68px] shrink-0 flex items-center justify-center">
              {iconUrl ? (
                <img src={iconUrl} alt="Ícone da tarefa" className="h-[68px] w-[68px] object-contain pointer-events-none" />
              ) : (
                <div className="h-[68px] w-[68px] rounded border border-slate-200 bg-slate-50" />
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[10px]">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="text-slate-500">Prazo</div>
          <div className="text-sm font-bold text-slate-900">{formatDateBR(prazo)}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="text-slate-500">Prioridade</div>
          <div className="text-sm font-bold text-slate-900">{prioridade || "-"}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="text-slate-500">Status</div>
          <div className="text-sm font-bold text-slate-900">{status || "-"}</div>
        </div>
      </div>
    </div>
  );
}