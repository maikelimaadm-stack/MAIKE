import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ENTIDADES_RELACIONAIS } from "./camposConfigOptions";

function Field({ label, children }) {
  return <div className="space-y-1"><label className="text-xs uppercase text-slate-600">{label}</label>{children}</div>;
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
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-2 border rounded-lg bg-white">
      <Field label={title}>
        <Select value={entity || "none"} onValueChange={handleEntityChange}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">SELECIONE UM CADASTRO</SelectItem>
            {ENTIDADES_RELACIONAIS.map((item) => <SelectItem key={item.value} value={item.value} className="text-xs">{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <div className="md:col-span-2 border rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600 flex items-center">
        {selectedEntity ? `O sistema exibirá automaticamente: ${displayField}` : "Escolha um cadastro para o sistema configurar sozinho."}
      </div>
    </div>
  );
}