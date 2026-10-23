import React from "react";
import { Search, X } from "lucide-react";

/**
 * Campo de busca em pílula (Modelo Base1).
 */
export default function CadastroSearchPill({
  value,
  onChange,
  onApply,
  placeholder = "Buscar…",
  active = false,
}) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onApply?.();
    }
  };

  return (
    <div className={`mg-search-pill ${active ? "is-active" : ""}`}>
      <Search className="mg-search-pill-icon" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          className="tb-btn-icon ml-1 !w-6 !min-w-6 !h-6"
          aria-label="Limpar busca"
          onClick={() => {
            onChange("");
            onApply?.("");
          }}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
