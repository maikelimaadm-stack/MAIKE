import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENTIDADES_RELACIONAIS } from "./camposConfigOptions";

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
      <label className="text-[12px] text-slate-600 text-right leading-none">{label}</label>
      <div className="h-6 border border-slate-300 bg-white focus-within:border-green-500 transition-colors [&_button]:h-[22px]">
        {children}
      </div>
    </div>
  );
}

export default function GuidedRelationConfig({ form, updateForm, mode = "select" }) {
  const entity = mode === "relation" ? form.relation_entity : form.options_source_entity;
  const selectedEntity = ENTIDADES_RELACIONAIS.find((item) => item.value === entity);
  const displayField = mode === "relation" ? form.relation_display_field : form.options_label_field;
  const title = mode === "relation" ? "Cadastro relacionado" : "Lista do sistema";

  const handleEntityChange = (value) => {
    const next = value === "none" ? "" : value;
    const firstField = ENTIDADES_RELACIONAIS.find((item) => item.value === next)?.fields?.[0] || "nome";
    if (mode === "relation") {
      updateForm("relation_entity", next);
      updateForm("relation_display_field", firstField);
      return;
    }
    updateForm("options_source_entity", next);
    updateForm("options_label_field", firstField);
    updateForm("options_value_field", "id");
  };

  return (
    <>
      <Field label={title}>
        <Select value={entity || "none"} onValueChange={handleEntityChange}>
          <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">SELECIONE UM CADASTRO</SelectItem>
            {ENTIDADES_RELACIONAIS.map((item) => <SelectItem key={item.value} value={item.value} className="text-xs uppercase">{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <div className="ml-[191px] border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600">
        {selectedEntity ? `O sistema exibirá automaticamente: ${displayField}` : "Escolha um cadastro para o sistema configurar sozinho."}
      </div>
    </>
  );
}