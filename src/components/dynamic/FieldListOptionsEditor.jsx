import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

const getOptionLabel = (option, displayField = "nome") => {
  if (typeof option === "string") return option;
  return option?.[displayField] || option?.label || option?.nome || option?.value || option?.id || "";
};

const normalizeOptionText = (value) => String(value || "").trim().toUpperCase();

export default function FieldListOptionsEditor({ selectedField, optionsConfig = {}, onChange, disabled = false }) {
  const [newOption, setNewOption] = useState("");
  const isListField = ["select", "autocomplete"].includes(selectedField?.type) && Array.isArray(selectedField?.options);
  const fieldConfig = selectedField ? optionsConfig[selectedField.id] || { customOptions: [] } : { customOptions: [] };
  const displayField = selectedField?.displayField || "nome";

  const nativeLabels = useMemo(() => {
    return new Set((selectedField?.options || []).map((option) => normalizeOptionText(getOptionLabel(option, displayField))).filter(Boolean));
  }, [selectedField, displayField]);

  const customOptions = useMemo(() => {
    return (fieldConfig.customOptions || []).map(normalizeOptionText).filter(Boolean);
  }, [fieldConfig.customOptions]);

  if (!selectedField || !isListField) return null;

  const updateOptions = (nextOptions) => {
    onChange?.(selectedField.id, { customOptions: nextOptions });
  };

  const handleAdd = () => {
    const normalized = normalizeOptionText(newOption);
    if (!normalized || nativeLabels.has(normalized) || customOptions.includes(normalized)) return;
    updateOptions([...customOptions, normalized].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })));
    setNewOption("");
  };

  const handleRemove = (option) => {
    updateOptions(customOptions.filter((item) => item !== option));
  };

  return (
    <div className="flex items-center gap-1 min-w-[280px] max-w-[420px]">
      <span className="text-[12px] text-slate-600 whitespace-nowrap">Opções:</span>
      <Input
        value={newOption}
        onChange={(event) => setNewOption(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            handleAdd();
          }
        }}
        disabled={disabled}
        placeholder="NOVA OPÇÃO"
        className="h-7 rounded-none text-xs bg-white uppercase"
      />
      <Button type="button" variant="outline" size="icon" disabled={disabled || !newOption.trim()} onClick={handleAdd} className="h-7 w-8 rounded-none bg-white">
        <Plus className="w-3.5 h-3.5" />
      </Button>
      {customOptions.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto max-w-[180px]">
          {customOptions.map((option) => (
            <span key={option} className="inline-flex items-center gap-1 h-6 px-1.5 border border-green-300 bg-green-50 text-green-800 text-[11px] whitespace-nowrap">
              {option}
              <button type="button" disabled={disabled} onClick={() => handleRemove(option)} className="text-green-700 disabled:opacity-50">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}