import React, { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const inputClass = "h-6 rounded-none border-slate-300 px-1.5 text-xs shadow-none bg-white";

const normalize = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export default function SankhyaCodeNameLookup({ label, prefix, source = [], filters, onChange }) {
  const [open, setOpen] = useState(false);
  const query = filters[`${prefix}_nome`] || "";

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

  return (
    <div className="relative">
      <div className="grid grid-cols-[58px_1fr] gap-1 items-center">
        <div className="relative">
          <Input value={filters[`${prefix}_codigo`] || ""} readOnly className={`${inputClass} pr-5 text-center font-semibold text-slate-600 bg-slate-50`} placeholder="Cód." />
          <Search className="absolute right-1 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
        </div>
        <Input
          value={query}
          onChange={(e) => updateName(e.target.value)}
          onFocus={() => setOpen(!!query)}
          className={inputClass}
          placeholder={`Pesquisar ${label.toLowerCase()}`}
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute z-50 left-[59px] right-0 mt-1 max-h-56 overflow-auto border border-slate-300 bg-white shadow-lg">
          {results.map((item) => (
            <button
              key={item.id || `${item.codigo}-${item.nome}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectItem(item)}
              className="w-full text-left px-2 py-1.5 hover:bg-slate-100 border-b border-slate-100 last:border-b-0"
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