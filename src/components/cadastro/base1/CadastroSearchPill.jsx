import React, { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Campo de busca em pílula (Modelo Base1).
 * Digitação mostra listagem de sugestões; Enter aplica o filtro na grade.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(v: string) => void} props.onChange
 * @param {(v?: string) => void} [props.onApply]
 * @param {string} [props.placeholder]
 * @param {boolean} [props.active]
 * @param {boolean} [props.autoFocus]
 * @param {{ id: string; label: string; secondary?: string }[]} [props.suggestions]
 * @param {(item: { id: string; label: string; secondary?: string }) => void} [props.onPickSuggestion]
 */
export default function CadastroSearchPill({
  value,
  onChange,
  onApply,
  placeholder = "Buscar…",
  active = false,
  autoFocus = false,
  suggestions = [],
  onPickSuggestion,
}) {
  const listId = useId();
  const wrapRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const q = value.trim();
  const showList = open && q.length > 0 && suggestions.length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [q, suggestions.length]);

  useEffect(() => {
    if (!showList) return;
    const fora = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [showList]);

  const aplicar = (texto) => {
    onApply?.(typeof texto === "string" ? texto : value);
    setOpen(false);
  };

  const escolher = (item) => {
    if (onPickSuggestion) {
      onPickSuggestion(item);
      setOpen(false);
      return;
    }
    onChange(item.label);
    aplicar(item.label);
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown" && showList) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && showList) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      if (showList) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (showList && suggestions[highlight]) {
        escolher(suggestions[highlight]);
        return;
      }
      aplicar();
    }
  };

  return (
    <div className="mg-search-pill-wrap" ref={wrapRef}>
      <div className={cn("mg-search-pill", active && "is-active")} role="search">
        {value ? (
          <button
            type="button"
            className="mg-search-pill-clear"
            aria-label="Limpar busca"
            onClick={() => {
              onChange("");
              onApply?.("");
              setOpen(false);
            }}
          >
            <X className="mg-search-pill-icon" aria-hidden />
          </button>
        ) : (
          <Search className="mg-search-pill-icon" aria-hidden />
        )}
        <input
          type="search"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-autocomplete="list"
          aria-controls={showList ? listId : undefined}
          aria-expanded={showList}
        />
      </div>
      {showList ? (
        <ul
          id={listId}
          className="mg-search-suggest"
          role="listbox"
          aria-label="Sugestões de busca"
        >
          {suggestions.map((item, i) => (
            <li key={item.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={cn("mg-search-suggest__item", i === highlight && "is-active")}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => escolher(item)}
              >
                <span className="mg-search-suggest__label">{item.label}</span>
                {item.secondary ? (
                  <span className="mg-search-suggest__sec">{item.secondary}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
