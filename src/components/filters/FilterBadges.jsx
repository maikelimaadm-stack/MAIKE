import React from "react";
import { Badge } from "@/components/ui/badge";
import { Star, Lock, EyeOff, Zap } from "lucide-react";

const TYPE_LABELS = {
  text: "Texto",
  textarea: "Texto longo",
  number: "Número",
  decimal: "Decimal",
  currency: "Moeda",
  percentage: "Percentual",
  boolean: "Sim/Não",
  select: "Seleção",
  multiselect: "Múltipla",
  autocomplete: "Busca",
  relational: "Relação",
  codeName: "Código/Nome",
  codeNameDynamic: "Código/Nome",
  date: "Data",
  datetime: "Data/Hora",
  calculated: "Calculado",
  customField: "Personalizado"
};

export function FieldTypeBadge({ type }) {
  return (
    <Badge variant="outline" className="h-5 rounded-sm border-slate-300 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-600">
      {TYPE_LABELS[type] || type || "Campo"}
    </Badge>
  );
}

export function OperatorBadge({ label }) {
  if (!label) return null;
  return (
    <Badge variant="outline" className="h-5 rounded-sm border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700">
      {label}
    </Badge>
  );
}

export function FieldMetaIndicators({ metadata = {} }) {
  const items = [
    metadata.required && { icon: Lock, title: "Obrigatório", className: "text-red-500" },
    metadata.favorite && { icon: Star, title: "Favorito", className: "text-amber-500" },
    metadata.quickFilter && { icon: Zap, title: "Filtro rápido", className: "text-blue-500" },
    metadata.hidden && { icon: EyeOff, title: "Oculto", className: "text-slate-400" }
  ].filter(Boolean);

  if (!items.length) return null;

  return (
    <div className="flex items-center gap-1">
      {items.map(({ icon: Icon, title, className }) => (
        <Icon key={title} title={title} className={`h-3.5 w-3.5 ${className}`} />
      ))}
    </div>
  );
}