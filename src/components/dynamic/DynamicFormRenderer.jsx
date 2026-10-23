import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import ToggleSwitch from "@/components/common/ToggleSwitch";
import {
  CADASTRO_AC_INPUT_CLS,
  CADASTRO_INPUT_CLS,
  CADASTRO_TEXTAREA_CLS,
} from "@/components/cadastro/base1/cadastroBase1Form";

function DefaultControl({ field, value, onChange, readOnly }) {
  if (field.type === "textarea") {
    return (
      <Textarea
        value={value || ""}
        onChange={(e) => onChange(field.name, e.target.value)}
        readOnly={readOnly || field.readOnly}
        placeholder={field.placeholder}
        className={`${CADASTRO_TEXTAREA_CLS} ${field.uppercase ? "uppercase" : ""}`}
        rows={field.rows || 3}
      />
    );
  }

  if (["select", "autocomplete", "relation"].includes(field.type)) {
    return (
      <AutocompleteGenerico
        items={field.options || []}
        value={value || ""}
        onChange={(nextValue) => onChange(field.name, nextValue || "")}
        placeholder={field.placeholder || "Buscar…"}
        displayField={field.displayField || "nome"}
        searchFields={field.searchFields || [field.displayField || "nome"]}
        disabled={readOnly || field.readOnly}
        readOnly={readOnly || field.readOnly}
        className="w-full"
        inputClassName={CADASTRO_AC_INPUT_CLS}
      />
    );
  }

  if (field.type === "checkbox") {
    return (
      <div className="h-7 flex items-center px-2">
        <ToggleSwitch
          checked={!!value}
          onChange={(checked) => onChange(field.name, checked)}
          disabled={readOnly || field.readOnly}
        />
      </div>
    );
  }

  return (
    <Input
      type={field.type === "datetime" ? "datetime-local" : field.type || "text"}
      value={value || ""}
      onChange={(e) => onChange(field.name, e.target.value)}
      readOnly={readOnly || field.readOnly}
      placeholder={field.placeholder}
      className={`${CADASTRO_INPUT_CLS} ${field.uppercase ? "uppercase" : ""}`}
    />
  );
}

const isCustomField = (field) =>
  field?.origem === "customizado" || String(field?.id || "").startsWith("custom:");
const CustomMarker = () => (
  <span className="pointer-events-none absolute bottom-0 right-0 z-10 w-0 h-0 border-l-[7px] border-l-transparent border-b-[7px] border-b-emerald-500" />
);
const normalizeConditionText = (value) =>
  String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
const getOptionValue = (option) => String(option?.id ?? option?.value ?? option?.label ?? option?.nome ?? "");
const getOptionLabel = (option) => String(option?.nome ?? option?.label ?? option?.value ?? option?.id ?? "");
const conditionMatches = (current, expected, sourceField) => {
  const expectedText = normalizeConditionText(expected);
  const currentValues = new Set([normalizeConditionText(current)]);
  (sourceField?.options || []).forEach((option) => {
    const optionValue = getOptionValue(option);
    const optionLabel = getOptionLabel(option);
    if (
      normalizeConditionText(optionValue) === normalizeConditionText(current) ||
      normalizeConditionText(optionLabel) === normalizeConditionText(current)
    ) {
      currentValues.add(normalizeConditionText(optionValue));
      currentValues.add(normalizeConditionText(optionLabel));
    }
  });
  return currentValues.has(expectedText);
};

function FieldFrame({ field, error, children }) {
  return (
    <div data-field={field.dataField || field.name} className={field.wide ? "md:col-span-2" : ""}>
      <label className="text-[12px] text-slate-500 pl-1 leading-none">
        {field.label}
        {field.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div
        className={`relative rounded-md border ${
          error ? "border-red-500 bg-red-50" : "border-slate-300"
        } focus-within:border-emerald-500 transition-colors overflow-hidden`}
      >
        {isCustomField(field) && <CustomMarker />}
        {children}
      </div>
    </div>
  );
}

export default function DynamicFormRenderer({
  panels = [],
  fields = [],
  layout = {},
  hiddenFieldIds = [],
  lockedFieldIds = [],
  requiredFieldIds = [],
  visibilityRules = {},
  activePanelId,
  values = {},
  errors = {},
  onChange,
  readOnly = false,
  context = {},
}) {
  const activePanel = panels.find((panel) => panel.id === activePanelId) || panels[0];
  const activeFieldIds = layout?.[activePanel?.id] || [];

  const visibleFields = activeFieldIds
    .map((fieldId) => fields.find((field) => field.id === fieldId))
    .filter(Boolean)
    .filter((field) => field.visible !== false && !hiddenFieldIds.includes(field.id))
    .filter((field) => {
      const rule = visibilityRules[field.id] || field.defaultVisibilityRule;
      if (rule?.always) return true;
      if (rule?.sourceFieldName) {
        const sourceField = fields.find((item) => item.id === rule.sourceFieldId);
        if (sourceField?.type !== "select" || !["manual", "native"].includes(sourceField?.optionsMode))
          return true;
        const current = values[rule.sourceFieldName] ?? values.campos_personalizados?.[rule.sourceFieldName];
        return conditionMatches(current, rule.value, sourceField);
      }
      return typeof field.showWhen === "function" ? field.showWhen(values, context) : true;
    });

  if (!activePanel) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
      {visibleFields.length === 0 ? (
        <div className="col-span-full text-xs text-slate-500 py-2">Nenhum campo configurado para este painel.</div>
      ) : (
        visibleFields.map((field) => {
          const value = field.getValue ? field.getValue(values, context) : values[field.name];
          const error = errors[field.errorKey || field.name];
          const configuredField = { ...field, required: field.required || requiredFieldIds.includes(field.id) };
          const fieldReadOnly = readOnly || lockedFieldIds.includes(field.id);
          return (
            <FieldFrame key={field.id} field={configuredField} error={error}>
              {field.render
                ? field.render({
                    field: configuredField,
                    value,
                    values,
                    errors,
                    onChange,
                    readOnly: fieldReadOnly,
                    context,
                  })
                : (
                  <DefaultControl
                    field={configuredField}
                    value={value}
                    onChange={onChange}
                    readOnly={fieldReadOnly}
                  />
                )}
            </FieldFrame>
          );
        })
      )}
    </div>
  );
}
