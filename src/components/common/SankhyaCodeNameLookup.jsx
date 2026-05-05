import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const inputClass = "h-10 md:h-6 rounded-none border-slate-300 px-2 md:px-1.5 text-sm md:text-xs shadow-none bg-white";

const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export default function SankhyaCodeNameLookup({ label, prefix, source = [], filters, onChange }) {
  const [open, setOpen] = useState(false);
  const query = filters[`${prefix}_nome`] || "";
  const codeValue = filters[`${prefix}_codigo`] || "";

  const results = useMemo(() => {
    const term = normalize(query);
    if (!term) return [];
    return source.filter((item) => normalize(`${item.nome} ${item.codigo} ${(item.details || []).join(" ")}`).includes(term)).slice(0, 8);
  }, [source, query]);

  const selectItem = (item) => {
    onChange({
      ...filters,
      [`${prefix}_codigo`]: item.codigo || "",
      [`${prefix}_nome`]: item.nome || ""
    });
    setOpen(false);
  };

  const updateName = (value) => {
    onChange({ ...filters, [`${prefix}_nome`]: value, [`${prefix}_codigo`]: "" });
    setOpen(!!value);
  };

  const updateCode = (value) => {
    const found = source.find((item) => String(item.codigo || "").toLowerCase() === String(value || "").toLowerCase());
    onChange({
      ...filters,
      [`${prefix}_codigo`]: value,
      [`${prefix}_nome`]: found?.nome || filters[`${prefix}_nome`] || ""
    });
  };

  return (
    <div className="relative">
      <div className="grid grid-cols-[92px_1fr] md:grid-cols-[72px_1fr] gap-1 items-center">
        <div className="relative">
          <Input value={codeValue} onChange={(e) => updateCode(e.target.value)} className={`${inputClass} pr-5 text-center font-semibold text-slate-700`} placeholder="Código" />
          <Search className="absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
        </div>
        <Input
          value={query}
          onChange={(e) => updateName(e.target.value)}
          onFocus={() => setOpen(!!query)}
          className={inputClass}
          placeholder={`Nome do ${label.toLowerCase()}`}
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 left-[93px] md:left-[73px] right-0 mt-1 max-h-64 md:max-h-56 overflow-auto border border-slate-300 bg-white shadow-lg">
          {results.map((item) => (
            <button
              key={item.id || `${item.codigo}-${item.nome}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectItem(item)}
              className="w-full text-left px-3 md:px-2 py-2.5 md:py-1.5 hover:bg-slate-100 border-b border-slate-100 last:border-b-0"
            >
              <div className="text-xs font-bold text-slate-800">{item.codigo ? `${item.codigo} - ` : ""}{item.nome}</div>
              {(item.details || []).filter(Boolean).slice(0, 3).map((detail, index) => (
                <div key={index} className="text-[11px] leading-4 text-slate-600">{detail}</div>
              ))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}