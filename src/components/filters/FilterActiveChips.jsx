import React from "react";
import { X, Filter } from "lucide-react";

const isActiveValue = (value) => {
  if (value === undefined || value === null || value === "" || value === "todos") return false;
  if (typeof value === "object") return Object.values(value).some(isActiveValue);
  return String(value).trim() !== "";
};

export default function FilterActiveChips({ filters = {}, fields = [], onRemove, onClear }) {
  const fieldMap = new Map(fields.map((field) => [field.id, field]));
  const chips = Object.entries(filters)
    .filter(([key, value]) => key !== "_operators" && isActiveValue(value))
    .map(([key, value]) => {
      const baseId = key.replace(/_(min|max|exact|codigo|nome)$/g, "");
      const field = fieldMap.get(baseId) || fieldMap.get(key);
      const suffix = key.endsWith("_min") ? "mín." : key.endsWith("_max") ? "máx." : key.endsWith("_exact") ? "exato" : "";
      return {
        key,
        label: field?.label || key.replaceAll("_", " "),
        suffix,
        value
      };
    });

  if (!chips.length) return null;

  return (
    <div className="border-b border-slate-200 bg-emerald-50/60 px-1.5 py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
          <Filter className="h-3.5 w-3.5" />
          {chips.length} filtro{chips.length > 1 ? "s" : ""} ativo{chips.length > 1 ? "s" : ""}
        </div>
        <button type="button" onClick={onClear} className="text-[10px] font-semibold text-red-600 hover:text-red-700">
          Limpar tudo
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {chips.slice(0, 12).map((chip) => (
          <span key={chip.key} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-emerald-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700 shadow-sm">
            <span className="font-semibold truncate">{chip.label}</span>
            {chip.suffix && <span className="text-slate-400">{chip.suffix}</span>}
            <span className="max-w-[90px] truncate text-slate-500">{String(chip.value)}</span>
            <button type="button" onClick={() => onRemove?.(chip.key)} className="text-slate-400 hover:text-red-600">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {chips.length > 12 && <span className="text-[10px] text-slate-500">+{chips.length - 12}</span>}
      </div>
    </div>
  );
}