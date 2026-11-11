import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";
import ToggleSwitch from "@/components/common/ToggleSwitch";
import B1Field, { B1CampoChave } from "@/components/cadastro/base1/B1Field";
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

/** Largura em doze avos a partir de 768px; `field.span` vence os atalhos `wide`/`compact`/`medium`. */
function spanForField(field) {
  if (Number.isInteger(field.span)) return field.span;
  if (field.wide) return 12;
  if (field.compact) return 4;
  if (field.medium) return 8;
  return 6;
}

function resolveSwitchChecked(field, value, values) {
  if (typeof field.getChecked === "function") return Boolean(field.getChecked(value, values));
  if (typeof field.switchGetChecked === "function") return Boolean(field.switchGetChecked(value, values));
  return Boolean(value);
}

function resolveSwitchToValue(field, checked, values) {
  if (typeof field.toValue === "function") return field.toValue(checked, values);
  if (typeof field.switchToValue === "function") return field.switchToValue(checked, values);
  return checked;
}

function hasFieldValue(field, value, values = {}) {
  if (field.type === "switch") return resolveSwitchChecked(field, value, values) || value === "Inativo" || value === "Ativo" || Boolean(value);
  if (field.type === "checkbox") return Boolean(value);
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined) return false;
  return String(value).trim() !== "";
}

/** Campo de número (alinhamento próprio no design — D-PROD-164). */
const ehCampoNumerico = (field) => field.type === "number" || field.inputMode === "numeric" || field.inputMode === "decimal";

function Base1FieldFrame({ field, error, value, values, readOnly, children }) {
  return (
    <B1Field
      label={field.label}
      required={field.required}
      error={error ? String(error) : undefined}
      span={spanForField(field)}
      spanLg={field.spanLg}
      hasValue={hasFieldValue(field, value, values)}
      // Leitura: campo apagado; edição de campo que o sistema preenche (código, valor calculado): travado.
      locked={readOnly || Boolean(field.readOnly)}
      disabled={readOnly}
      multiline={field.type === "textarea" || (field.type === "checkbox" && typeof field.render === "function")}
      variant={field.type === "switch" ? "switch" : "default"}
      fieldClassName={ehCampoNumerico(field) ? "b1-campo--num" : undefined}
      dica={typeof field.dica === "function" ? field.dica(values) : field.dica}
    >
      {children}
    </B1Field>
  );
}

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
  visualVariant = "legacy",
  grupos = undefined,
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

  const useBase1 = visualVariant === "base1";

  const renderField = (field) => {
    const value = field.getValue ? field.getValue(values, context) : values[field.name];
    const error = errors[field.errorKey || field.name];
    const configuredField = { ...field, required: field.required || requiredFieldIds.includes(field.id) };
    const fieldReadOnly = readOnly || lockedFieldIds.includes(field.id);

    if (useBase1 && configuredField.type === "switch" && !configuredField.render) {
      const checked = resolveSwitchChecked(configuredField, value, values);
      return (
        <B1CampoChave
          key={field.id}
          label={configuredField.label}
          span={spanForField(configuredField)}
          spanLg={configuredField.spanLg}
          checked={checked}
          onChange={
            fieldReadOnly
              ? undefined
              : (nextChecked) =>
                  onChange(configuredField.name, resolveSwitchToValue(configuredField, nextChecked, values))
          }
          disabled={fieldReadOnly}
          dataField={configuredField.dataField || configuredField.name}
        />
      );
    }

    const control = field.render
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
      );
    if (useBase1) {
      return (
        <Base1FieldFrame
          key={field.id}
          field={configuredField}
          error={error}
          value={value}
          values={values}
          readOnly={fieldReadOnly}
        >
          {control}
        </Base1FieldFrame>
      );
    }
    return (
      <FieldFrame key={field.id} field={configuredField} error={error}>
        {control}
      </FieldFrame>
    );
  };

  if (!useBase1) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
        {visibleFields.length === 0 ? (
          <div className="col-span-full text-xs text-slate-500 py-2">Nenhum campo configurado para este painel.</div>
        ) : (
          visibleFields.map((field) => renderField(field))
        )}
      </div>
    );
  }

  // Base1 (D-PROD-164): os campos vêm em grupos (`b1-grupo`), cada um com a sua grade — como no design.
  // Sem `grupos`, o painel é um grupo só; campo fora de qualquer grupo entra no último.
  const gruposDoPainel = (grupos?.[activePanel.id] ?? []).filter((g) => Array.isArray(g) && g.length);
  /** @type {object[][]} */
  const blocos = gruposDoPainel.length ? gruposDoPainel.map(() => []) : [[]];
  for (const field of visibleFields) {
    const i = gruposDoPainel.findIndex((g) => g.includes(field.id));
    blocos[i >= 0 ? i : blocos.length - 1].push(field);
  }
  const preenchidos = blocos.filter((b) => b.length);
  if (!preenchidos.length) {
    return (
      <div className="b1-grupo">
        <div className="b1 mg-b1-form-grid w-full min-h-0 col-span-12">
          <div className="col-span-full text-xs text-slate-500 py-2">Nenhum campo configurado para este painel.</div>
        </div>
      </div>
    );
  }
  return (
    <>
      {preenchidos.map((bloco) => (
        <div key={bloco[0].id} className="b1-grupo">
          <div className="b1 mg-b1-form-grid w-full min-h-0 col-span-12">{bloco.map((field) => renderField(field))}</div>
        </div>
      ))}
    </>
  );
}
