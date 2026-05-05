import React from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export default function DecimalConfig({ form, updateForm }) {
  if (!["number", "calculado"].includes(form.tipo)) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-2 border rounded-lg bg-white">
      <label className="h-8 px-2 border rounded-md bg-slate-50 flex items-center justify-between gap-2 text-xs text-slate-700">
        Usar casas decimais
        <Switch checked={!!form.usar_decimal} onCheckedChange={(checked) => updateForm("usar_decimal", checked)} className="scale-75" />
      </label>
      <div className="space-y-1">
        <label className="text-xs uppercase text-slate-600">Casas decimais</label>
        <Input type="number" min="0" max="6" value={form.decimal_places} disabled={!form.usar_decimal} onChange={(e) => updateForm("decimal_places", Math.min(6, Math.max(0, Number(e.target.value) || 0)))} className="h-8 text-xs" />
      </div>
    </div>
  );
}