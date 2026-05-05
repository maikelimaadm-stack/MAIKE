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

  const handleFieldChange = (value) => {
    if (mode === "relation") updateForm("relation_display_field", value);
    else updateForm("options_label_field", value);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-2 border rounded-lg bg-white">
      <Field label="Buscar dados de">
        <Select value={entity || "none"} onValueChange={handleEntityChange}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none" className="text-xs">NÃO USAR LISTA DO SISTEMA</SelectItem>
            {ENTIDADES_RELACIONAIS.map((item) => <SelectItem key={item.value} value={item.value} className="text-xs">{item.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Campo exibido">
        <Select value={displayField || "nome"} onValueChange={handleFieldChange} disabled={!selectedEntity}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{(selectedEntity?.fields || ["nome"]).map((field) => <SelectItem key={field} value={field} className="text-xs">{field}</SelectItem>)}</SelectContent>
        </Select>
      </Field>

      <div className="text-[11px] text-slate-500 flex items-end">O sistema salva o vínculo automaticamente e exibe o campo escolhido.</div>
    </div>
  );
}