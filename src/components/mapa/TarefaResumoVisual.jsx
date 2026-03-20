import React from "react";

const formatDateBR = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
};

export default function TarefaResumoVisual({ status, prioridade, prazo }) {
  return (
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
  );
}