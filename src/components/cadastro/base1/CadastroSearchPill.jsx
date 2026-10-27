import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Campo de busca em pílula (Modelo Base1).
 * Digitação mostra listagem; Enter / Confirmar aplica filtro na grade (não abre 1 registro).
 * Clique em um item da listagem filtra só aquele registro (permanece na visão atual).
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(v: string) => void} props.onChange
 * @param {(v?: string) => void} [props.onApply]
 * @param {string} [props.committedValue] valor já aplicado (restaurado no Cancelar)
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
  committedValue = "",
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
  const showPanel = open && q.length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [q, suggestions.length]);

  const cancelar = () => {
    onChange(committedValue);
    setOpen(false);
  };

  const aplicar = (texto) => {
    onApply?.(typeof texto === "string" ? texto : value);
    setOpen(false);
  };

  useEffect(() => {
    if (!showPanel) return;
    const fora = (e) => {
      if (!wrapRef.current?.contains(e.target)) cancelar();
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fecha/cancela no clique fora
  }, [showPanel, committedValue]);

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
    if (e.key === "ArrowDown" && showPanel && suggestions.length) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp" && showPanel && suggestions.length) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      if (showPanel) {
        e.preventDefault();
        cancelar();
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter só aplica o filtro na listagem — nunca abre um único registro.
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
          type="text"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
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
          aria-controls={showPanel ? listId : undefined}
          aria-expanded={showPanel}
        />
      </div>
      {showPanel ? (
        <div className="mg-search-suggest" role="dialog" aria-label="Sugestões de busca">
          <ul id={listId} className="mg-search-suggest__list" role="listbox">
            {suggestions.length === 0 ? (
              <li className="mg-search-suggest__empty">Nenhum registro encontrado</li>
            ) : (
              suggestions.map((item, i) => (
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
              ))
            )}
          </ul>
          <div className="mg-search-suggest__footer">
            <span style={{ flexGrow: 1 }} />
            <button
              type="button"
              className="tb-btn tb-btn-icon tb-btn-sm shrink-0"
              title="Cancelar"
              aria-label="Cancelar"
              onMouseDown={(e) => e.preventDefault()}
              onClick={cancelar}
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="tb-btn tb-btn-icon tb-btn-green tb-btn-sm shrink-0"
              title="Confirmar"
              aria-label="Confirmar"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => aplicar()}
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
