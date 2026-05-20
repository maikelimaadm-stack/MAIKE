import React from "react";

const normalizeListValue = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
};

export default function CustomOptionListControl({ options = [], value, onChange, disabled = false, placeholder = "SELECIONE UMA OU MAIS OPÇÕES" }) {
  const selected = normalizeListValue(value);

  const toggleOption = (optionValue) => {
    const next = selected.includes(optionValue)
      ? selected.filter((item) => item !== optionValue)
      : [...selected, optionValue];
    onChange(next);
  };

  return (
    <div className="px-1 py-1 space-y-1 bg-transparent">
      <div className="text-[11px] leading-none text-slate-500 uppercase">
        {selected.length > 0 ? selected.join(", ") : placeholder}
      </div>
      <div className="border border-slate-300 bg-white rounded-[1.5px] p-1 space-y-1">
        {options.map((option) => {
          const optionValue = String(option.value || option.id || option.label || option.nome || "").toUpperCase();
          const optionLabel = String(option.label || option.nome || option.value || option.id || "").toUpperCase();
          const checked = selected.includes(optionValue);

          return (
            <label key={optionValue} className="flex h-[22px] w-full items-center gap-1 text-xs text-slate-700 uppercase text-left bg-white hover:bg-slate-50 px-1 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleOption(optionValue)}
                disabled={disabled}
                className="h-3 w-3 rounded-none border-slate-400 accent-green-500 focus:ring-0"
              />
              <span>{optionLabel}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}