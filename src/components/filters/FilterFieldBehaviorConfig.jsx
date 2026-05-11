import React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const FLAGS = [
  ["quickFilter", "Filtro rápido"],
  ["favorite", "Favorito"],
  ["autoApply", "Auto aplicar"],
  ["required", "Obrigatório"],
  ["hidden", "Oculto"],
  ["readOnly", "Somente leitura"]
];

export default function FilterFieldBehaviorConfig({ config = {}, onChange }) {
  const update = (key, value) => onChange({ ...config, [key]: value });

  return (
    <div className="space-y-2 rounded-sm border border-slate-200 bg-slate-50 p-2">
      <div className="grid grid-cols-2 gap-1.5">
        {FLAGS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-[11px] text-slate-700">
            <Checkbox checked={!!config[key]} onCheckedChange={(checked) => update(key, !!checked)} className="h-3.5 w-3.5 rounded-none" />
            {label}
          </label>
        ))}
      </div>
      <Input value={config.placeholder || ""} onChange={(e) => update("placeholder", e.target.value)} placeholder="Placeholder do campo" className="h-7 rounded-none text-xs" />
      <Textarea value={config.notes || ""} onChange={(e) => update("notes", e.target.value)} placeholder="Observações internas" className="min-h-[48px] rounded-none text-xs" />
    </div>
  );
}