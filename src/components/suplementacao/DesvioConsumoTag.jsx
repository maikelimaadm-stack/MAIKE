import React from "react";
import { CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";

/**
 * Tag visual de desvio de consumo com ícone colorido.
 * Desvio (%) = ((real - esperado) / esperado) * 100
 * 
 * Verde: -5% a +5% (normal)
 * Amarelo: -10% a -5% ou +5% a +10% (atenção)
 * Vermelho: < -10% ou > +10% (alerta)
 */
export default function DesvioConsumoTag({ real, esperado }) {
  if (!esperado || esperado <= 0 || !real || real <= 0) return null;

  const desvioPercent = ((real - esperado) / esperado) * 100;
  const abs = Math.abs(desvioPercent);

  let Icon, colorClass, bgClass, borderClass;

  if (abs <= 5) {
    Icon = CheckCircle2;
    colorClass = "text-emerald-700";
    bgClass = "bg-emerald-50";
    borderClass = "border-emerald-300";
  } else if (abs <= 10) {
    Icon = AlertTriangle;
    colorClass = "text-yellow-700";
    bgClass = "bg-yellow-50";
    borderClass = "border-yellow-300";
  } else {
    Icon = AlertCircle;
    colorClass = "text-red-700";
    bgClass = "bg-red-50";
    borderClass = "border-red-300";
  }

  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${colorClass} ${bgClass} ${borderClass}`}>
      <Icon className="w-3 h-3 shrink-0" />
      {desvioPercent > 0 ? "+" : ""}{desvioPercent.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
    </span>
  );
}