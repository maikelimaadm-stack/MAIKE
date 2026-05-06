import React from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

export default function DecimalConfig({ form, updateForm }) {
  if (!["number", "calculado"].includes(form.tipo)) return null;

  return (
    <>
      <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
        <label className="text-[12px] text-slate-600 text-right leading-none">Usar casas decimais</label>
        <div className="h-6 border border-slate-300 bg-white flex items-center justify-between px-1 text-xs text-slate-700">
          <span>{form.usar_decimal ? "Sim" : "Não"}</span>
          <Switch checked={!!form.usar_decimal} onCheckedChange={(checked) => updateForm("usar_decimal", checked)} className="scale-75" />
        </div>
      </div>
      <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
        <label className="text-[12px] text-slate-600 text-right leading-none">Casas decimais</label>
        <div className="h-6 border border-slate-300 bg-white focus-within:border-green-500 transition-colors [&_input]:h-[22px]">
          <Input type="number" min="0" max="6" value={form.decimal_places} disabled={!form.usar_decimal} onChange={(e) => updateForm("decimal_places", Math.min(6, Math.max(0, Number(e.target.value) || 0)))} className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" />
        </div>
      </div>
    </>
  );
}