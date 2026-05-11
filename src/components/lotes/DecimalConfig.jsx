import React from "react";
import { Input } from "@/components/ui/input";

const fieldBoxCls = "h-6 border border-slate-300 bg-white focus-within:border-green-500 transition-colors overflow-hidden [&_input]:h-[22px] [&_input]:border-0 [&_input]:rounded-none [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_button]:h-[22px] [&_button]:border-0 [&_button]:rounded-none [&_button]:shadow-none";

export default function DecimalConfig({ form, updateForm }) {
  if (!["number", "calculado"].includes(form.tipo)) return null;

  return (
    <>
      <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
        <label className="text-[12px] text-slate-600 text-right leading-none">Usar casas decimais:</label>
        <div className={fieldBoxCls}>
          <button type="button" onClick={() => updateForm("usar_decimal", !form.usar_decimal)} className="h-[22px] w-full flex items-center justify-start px-1 bg-transparent">
            <span className={`w-8 h-4 rounded-full relative inline-block transition-colors ${form.usar_decimal ? 'bg-green-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${form.usar_decimal ? 'right-0.5' : 'left-0.5'}`} />
            </span>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
        <label className="text-[12px] text-slate-600 text-right leading-none">Casas decimais:</label>
        <div className={fieldBoxCls}>
          <Input type="number" min="0" max="6" value={form.decimal_places} disabled={!form.usar_decimal} onChange={(e) => updateForm("decimal_places", Math.min(6, Math.max(0, Number(e.target.value) || 0)))} className="h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" />
        </div>
      </div>
    </>
  );
}