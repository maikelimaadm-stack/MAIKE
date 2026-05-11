import React from "react";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import { ENTIDADES_RELACIONAIS } from "./camposConfigOptions";

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
      <label className="text-[12px] text-slate-600 text-right leading-none">{label}:</label>
      <div className="h-6 border border-slate-300 bg-white focus-within:border-green-500 transition-colors overflow-hidden [&_input]:h-[22px] [&_input]:border-0 [&_input]:rounded-none [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_button]:h-[22px] [&_button]:border-0 [&_button]:rounded-none [&_button]:shadow-none">
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
        <AutocompleteGenerico
          items={ENTIDADES_RELACIONAIS}
          value={entity || ""}
          onChange={(value) => handleEntityChange(value || "none")}
          placeholder="BUSCAR CADASTRO..."
          displayField="label"
          searchFields={["label", "value"]}
          className="w-full"
          inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1 uppercase"
        />
      </Field>

      <div className="ml-[191px] border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600">
        {selectedEntity ? `O sistema exibirá automaticamente: ${displayField}` : "Escolha um cadastro para o sistema configurar sozinho."}
      </div>
    </>
  );
}