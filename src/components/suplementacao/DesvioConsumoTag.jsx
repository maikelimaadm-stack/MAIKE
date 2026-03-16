import React from "react";
import { CheckCircle2, AlertTriangle, AlertCircle } from "lucide-react";

/**
 * Ícone de desvio de consumo (sem texto de %, sem cor/borda customizada).
 * Apenas o ícone colorido conforme faixa de desvio.
 * 
 * Verde: -5% a +5% (normal)
 * Amarelo: -10% a -5% ou +5% a +10% (atenção)
 * Vermelho: < -10% ou > +10% (alerta)
 */
export default function DesvioConsumoTag({ real, esperado }) {
  if (!esperado || esperado <= 0 || !real || real <= 0) return null;

  const desvioPercent = ((real - esperado) / esperado) * 100;
  const abs = Math.abs(desvioPercent);

  let Icon, colorClass;

  if (abs <= 5) {
    Icon = CheckCircle2;
    colorClass = "text-emerald-600";
  } else if (abs <= 10) {
    Icon = AlertTriangle;
    colorClass = "text-yellow-600";
  } else {
    Icon = AlertCircle;
    colorClass = "text-red-600";
  }

  return <Icon className={`w-3.5 h-3.5 shrink-0 inline-block ${colorClass}`} />;
}