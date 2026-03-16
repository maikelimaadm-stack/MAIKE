import React from "react";

/**
 * Resumo geral do pasto/área - estilo CardSection igual ao cocho/depósito.
 */
export default function ResumoPasto({ area, lotes = [] }) {
  if (!area) return null;

  const totalCabecas = lotes.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
  const totalUA = lotes.reduce((s, l) => s + ((l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0)) / 450, 0);
  const haEfetivo = area.area_pastejada > 0 ? area.area_pastejada : (area.tamanho_hectares || 0);
  const uaHa = haEfetivo > 0 ? (totalUA / haEfetivo) : 0;

  const dataEntradaMaisAntiga = lotes
    .map(l => l.data_entrada ? new Date(l.data_entrada) : null)
    .filter(Boolean)
    .sort((a, b) => a - b)[0];
  const diasPastejo = dataEntradaMaisAntiga
    ? Math.max(0, Math.floor((new Date() - dataEntradaMaisAntiga) / 86400000))
    : 0;

  return (
    <div className="border border-slate-200 rounded-lg bg-white shadow-sm p-1 space-y-1">
      <div className="text-[11px] font-bold text-slate-900">Informações do Pasto</div>
      <div className="space-y-1 text-[10px]">
        <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Pasto:</span><span className="font-semibold text-slate-900">{area.nome}</span></div>
        <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Cultura:</span><span className="font-semibold text-slate-900">{area.tipo_pastagem || "-"}</span></div>
        <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Área disponível:</span><span className="font-semibold text-slate-900">{haEfetivo} ha</span></div>
        <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Cabeças totais:</span><span className="font-semibold text-slate-900">{totalCabecas.toLocaleString("pt-BR")}</span></div>
        <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">UA total:</span><span className="font-semibold text-slate-900">{totalUA.toFixed(1)}</span></div>
        <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">UA/ha:</span><span className="font-semibold text-slate-900">{uaHa.toFixed(2)}</span></div>
        <div className="flex gap-2"><span className="font-medium text-slate-600 whitespace-nowrap">Dias de pastejo:</span><span className="font-semibold text-slate-900">{diasPastejo > 0 ? `${diasPastejo} dias` : "-"}</span></div>
      </div>
    </div>
  );
}