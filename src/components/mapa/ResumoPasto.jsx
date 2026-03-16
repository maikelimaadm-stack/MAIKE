import React from "react";
import { MapPin } from "lucide-react";

/**
 * Resumo geral do pasto/área - exibido no topo do dashboard de lotes.
 */
export default function ResumoPasto({ area, lotes = [] }) {
  if (!area) return null;

  const totalCabecas = lotes.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0);
  const totalUA = lotes.reduce((s, l) => s + ((l.peso_medio_kg || 0) * (l.quantidade_cabecas || 0)) / 450, 0);
  const haEfetivo = area.area_pastejada > 0 ? area.area_pastejada : (area.tamanho_hectares || 0);
  const uaHa = haEfetivo > 0 ? (totalUA / haEfetivo) : 0;

  // Dias de pastejo: diferença entre hoje e a data de entrada mais antiga dos lotes ativos
  const dataEntradaMaisAntiga = lotes
    .map(l => l.data_entrada ? new Date(l.data_entrada) : null)
    .filter(Boolean)
    .sort((a, b) => a - b)[0];
  const diasPastejo = dataEntradaMaisAntiga
    ? Math.max(0, Math.floor((new Date() - dataEntradaMaisAntiga) / 86400000))
    : 0;

  const metricas = [
    { label: "Pasto", valor: area.nome, destaque: true },
    { label: "Cultura", valor: area.tipo_pastagem || "-" },
    { label: "Cabeças totais", valor: totalCabecas.toLocaleString("pt-BR") },
    { label: "UA total", valor: totalUA.toFixed(1) },
    { label: "UA/ha", valor: uaHa.toFixed(2) },
    { label: "Dias de pastejo", valor: diasPastejo > 0 ? `${diasPastejo} dias` : "-" },
    { label: "Área disponível", valor: `${haEfetivo} ha` },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <MapPin className="w-3.5 h-3.5 text-emerald-600" />
        <span className="text-xs font-bold text-slate-900">Resumo do Pasto</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {metricas.map((m) => (
          <div key={m.label} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">{m.label}</div>
            <div className={`font-semibold text-slate-900 ${m.destaque ? "text-sm" : "text-lg"} leading-tight`}>
              {m.valor}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}