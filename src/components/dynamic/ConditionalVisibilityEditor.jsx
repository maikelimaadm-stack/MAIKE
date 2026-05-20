import React, { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const ALWAYS = "__always__";
const EMPTY = "__empty__";

const getFieldValueKey = (field) => field?.id || field?.name || "";
const getOptionValue = (option) => String(option?.id ?? option?.value ?? option?.label ?? option?.nome ?? "");
const getOptionLabel = (option) => String(option?.nome ?? option?.label ?? option?.value ?? option?.id ?? "");

export default function ConditionalVisibilityEditor({ selectedField, fields = [], visibilityRules = {}, onChange, disabled = false }) {
  const selectedId = selectedField?.id;
  const savedRule = selectedId ? visibilityRules[selectedId] : null;
  const defaultRule = selectedField?.defaultVisibilityRule || null;
  const rule = savedRule || defaultRule;

  const conditionFields = useMemo(() => {
    return fields.filter((field) => {
      if (!field || field.id === selectedId) return false;
      return field.type === "select" && ["manual", "native"].includes(field.optionsMode) && Array.isArray(field.options) && field.options.length > 0;
    });
  }, [fields, selectedId]);

  const sourceField = !rule?.always ? conditionFields.find((field) => getFieldValueKey(field) === rule?.sourceFieldId) || null : null;
  const sourceValue = sourceField ? getFieldValueKey(sourceField) : ALWAYS;
  const valueOptions = (sourceField?.options || []).map((option) => ({ value: getOptionValue(option), label: getOptionLabel(option) })).filter((option) => option.value);

  const setSource = (nextSource) => {
    if (!selectedId) return;
    if (nextSource === ALWAYS) {
      onChange?.(selectedId, defaultRule ? { always: true } : null);
      return;
    }
    const nextField = conditionFields.find((field) => getFieldValueKey(field) === nextSource);
    const nextOptions = (nextField?.options || []).map((option) => ({ value: getOptionValue(option), label: getOptionLabel(option) })).filter((option) => option.value);
    onChange?.(selectedId, {
      sourceFieldId: getFieldValueKey(nextField),
      sourceFieldName: nextField?.name,
      value: nextOptions[0]?.value || ""
    });
  };

  const setValue = (value) => {
    if (!selectedId || !sourceField) return;
    onChange?.(selectedId, {
      sourceFieldId: getFieldValueKey(sourceField),
      sourceFieldName: sourceField.name,
      value: value === EMPTY ? "" : value
    });
  };

  return (
    <div className="flex items-center gap-2 text-[12px] text-slate-600">
      <span>Exibir se:</span>
      <Select value={sourceValue} onValueChange={setSource} disabled={!selectedId || disabled}>
        <SelectTrigger className="h-7 w-40 rounded-none text-xs bg-white">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALWAYS} className="text-xs">Sempre</SelectItem>
          {conditionFields.map((field) => (
            <SelectItem key={getFieldValueKey(field)} value={getFieldValueKey(field)} className="text-xs">
              {field.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {sourceField && (
        <Select value={rule?.value || EMPTY} onValueChange={setValue} disabled={!selectedId || disabled}>
          <SelectTrigger className="h-7 w-32 rounded-none text-xs bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {valueOptions.map((option) => (
              <SelectItem key={option.value || EMPTY} value={option.value || EMPTY} className="text-xs">
                {option.label || option.value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}