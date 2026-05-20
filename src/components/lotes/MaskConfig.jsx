import React from "react";
import { Textarea } from "@/components/ui/textarea";
import ToggleSwitch from "@/components/common/ToggleSwitch";

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
      <label className="text-[12px] text-slate-600 text-right leading-none">{label}:</label>
      {children}
    </div>
  );
}

export default function MaskConfig({ form, updateForm }) {
  if (form.tipo !== "number") return null;

  return (
    <>
      <Field label="Usar máscara">
        <div className="h-6 flex items-center px-1">
          <ToggleSwitch checked={!!form.usar_mascara} onChange={(checked) => updateForm("usar_mascara", checked)} />
        </div>
      </Field>
      {form.usar_mascara && (
        <div className="grid grid-cols-[190px_minmax(0,1fr)] items-start gap-1">
          <label className="text-[12px] text-slate-600 text-right leading-none pt-1">Máscaras:</label>
          <div className="min-h-[72px] border border-slate-300 bg-white focus-within:border-green-500 transition-colors overflow-hidden [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:shadow-none [&_textarea]:focus-visible:ring-0">
            <Textarea
              value={form.mascaras_text || ""}
              onChange={(event) => updateForm("mascaras_text", event.target.value)}
              placeholder="(##) #####-####&#10;###.###.###-##&#10;##.###.###/####-##"
              className="w-full min-h-[70px] resize-none bg-transparent px-2 py-1 text-xs outline-none"
            />
          </div>
        </div>
      )}
      {form.usar_mascara && (
        <div className="ml-[191px] border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600">
          Use # para cada número. Cadastre uma máscara por linha; o sistema escolhe conforme a quantidade de dígitos.
        </div>
      )}
    </>
  );
}