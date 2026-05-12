import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";

function DefaultControl({ field, value, onChange, readOnly }) {
  const inputClass = "h-[22px] text-xs border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1";

  if (field.type === "textarea") {
    return <Textarea value={value || ""} onChange={(e) => onChange(field.name, e.target.value)} readOnly={readOnly || field.readOnly} placeholder={field.placeholder} className="text-xs uppercase bg-transparent px-1" rows={field.rows || 2} />;
  }

  if (["select", "autocomplete", "relation"].includes(field.type)) {
    return (
      <AutocompleteGenerico
        items={field.options || []}
        value={value || ""}
        onChange={(nextValue) => onChange(field.name, nextValue || "")}
        placeholder={field.placeholder || "BUSCAR..."}
        displayField={field.displayField || "nome"}
        searchFields={field.searchFields || [field.displayField || "nome"]}
        disabled={readOnly || field.readOnly}
        readOnly={readOnly || field.readOnly}
        className="w-full"
        inputClassName="border-0 shadow-none focus-visible:ring-0 bg-transparent h-[22px] text-xs px-1"
      />
    );
  }

  if (field.type === "checkbox") {
    return (
      <div className="h-[22px] flex items-center px-1">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(field.name, e.target.checked)} disabled={readOnly || field.readOnly} className="h-3.5 w-3.5 accent-green-500" />
      </div>
    );
  }

  return <Input type={field.type === "datetime" ? "datetime-local" : field.type || "text"} value={value || ""} onChange={(e) => onChange(field.name, e.target.value)} readOnly={readOnly || field.readOnly} placeholder={field.placeholder} className={`${inputClass} ${field.uppercase ? "uppercase" : ""}`} />;
}

const isCustomField = (field) => field?.origem === "customizado" || String(field?.id || "").startsWith("custom:");
const CustomMarker = () => <span className="pointer-events-none absolute bottom-0 right-0 z-10 w-0 h-0 border-l-[7px] border-l-transparent border-b-[7px] border-b-green-500" />;

function FieldFrame({ field, error, children }) {
  return (
    <div data-field={field.dataField || field.name} className={`grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1 ${field.wide ? "md:col-span-2" : ""}`}>
      <label className="text-[12px] text-slate-600 text-right leading-none">
        {field.label}:{field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className={`relative ${field.wide ? "min-h-6" : "h-6"} ${field.medium ? "w-64 max-w-full" : field.compact ? "w-44 max-w-full" : "w-full"} border ${error ? "border-red-500 bg-red-50" : "border-slate-300 bg-white"} focus-within:border-green-500 transition-colors overflow-hidden [&_input]:h-[22px] [&_input]:border-0 [&_input]:rounded-none [&_input]:shadow-none [&_input]:focus-visible:ring-0 [&_button]:h-[22px] [&_button]:border-0 [&_button]:rounded-none [&_button]:shadow-none [&_textarea]:min-h-[48px] [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:shadow-none [&_textarea]:focus-visible:ring-0`}>
        {isCustomField(field) && <CustomMarker />}
        {children}
      </div>
    </div>
  );
}

export default function DynamicFormRenderer({ panels = [], fields = [], layout = {}, hiddenFieldIds = [], lockedFieldIds = [], requiredFieldIds = [], activePanelId, values = {}, errors = {}, onChange, readOnly = false, context = {} }) {
  const activePanel = panels.find((panel) => panel.id === activePanelId) || panels[0];
  const activeFieldIds = layout?.[activePanel?.id] || [];

  const visibleFields = activeFieldIds
    .map((fieldId) => fields.find((field) => field.id === fieldId))
    .filter(Boolean)
    .filter((field) => field.visible !== false && !hiddenFieldIds.includes(field.id))
    .filter((field) => typeof field.showWhen === "function" ? field.showWhen(values, context) : true);

  if (!activePanel) return null;

  return (
    <div className="space-y-1">
      {visibleFields.length === 0 ? (
        <div className="ml-[191px] text-xs text-slate-500">Nenhum campo configurado para este painel.</div>
      ) : visibleFields.map((field) => {
        const value = field.getValue ? field.getValue(values, context) : values[field.name];
        const error = errors[field.errorKey || field.name];
        const configuredField = { ...field, required: field.required || requiredFieldIds.includes(field.id) };
        const fieldReadOnly = readOnly || lockedFieldIds.includes(field.id);
        return (
          <FieldFrame key={field.id} field={configuredField} error={error}>
            {field.render ? field.render({ field: configuredField, value, values, errors, onChange, readOnly: fieldReadOnly, context }) : <DefaultControl field={configuredField} value={value} onChange={onChange} readOnly={fieldReadOnly} />}
          </FieldFrame>
        );
      })}
    </div>
  );
}