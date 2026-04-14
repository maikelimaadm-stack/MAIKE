import React, { useState, useEffect, useRef, useCallback } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function AutocompleteGenerico({ 
  items, 
  value, 
  onChange, 
  className,
  placeholder = "Buscar...",
  displayField = "nome",
  searchFields = ["nome"],
  renderItem,
  renderSubtext,
  inputClassName = ""
}) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState(null);

  const itemSelecionado = items.find(item => item.id === value);

  useEffect(() => {
    if (itemSelecionado) {
      setSearchTerm(itemSelecionado[displayField] || "");
    }
  }, [itemSelecionado, displayField]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
        if (itemSelecionado) {
          setSearchTerm(itemSelecionado[displayField] || "");
        } else {
          setSearchTerm("");
        }
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open, itemSelecionado, displayField]);

  const calcPos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (open) {
      calcPos();
      const handler = () => calcPos();
      window.addEventListener('scroll', handler, true);
      window.addEventListener('resize', handler);
      return () => {
        window.removeEventListener('scroll', handler, true);
        window.removeEventListener('resize', handler);
      };
    }
  }, [open, calcPos]);

  const itensFiltrados = items.filter(item => {
    const search = searchTerm.toLowerCase();
    return searchFields.some(field => {
      const fieldValue = item[field];
      return fieldValue && String(fieldValue).toLowerCase().includes(search);
    });
  });

  const handleSelect = useCallback((item) => {
    onChange(item.id);
    setSearchTerm(item[displayField] || "");
    setOpen(false);
  }, [onChange, displayField]);

  const handleClear = () => {
    onChange("");
    setSearchTerm("");
    setOpen(false);
  };

  const showDropdown = open && pos;
  const hasResults = itensFiltrados.length > 0;
  const showEmpty = open && searchTerm && !hasResults;

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!open) setOpen(true);
            calcPos();
          }}
          onFocus={() => { setOpen(true); calcPos(); }}
          placeholder={placeholder}
          className={`pr-8 h-8 text-xs uppercase ${inputClassName}`}
          style={{ textTransform: 'uppercase' }}
        />
        {searchTerm && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleClear(); }}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showDropdown && hasResults && (
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 99999 }}
          className="bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {itensFiltrados.map((item) => (
            <div
              key={item.id}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleSelect(item); }}
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); handleSelect(item); }}
              className={`px-3 py-2 cursor-pointer hover:bg-slate-100 border-b border-slate-100 last:border-b-0 ${
                value === item.id ? 'bg-emerald-50' : ''
              }`}
            >
              {renderItem ? renderItem(item) : (
                <>
                  <div className="text-xs font-medium text-slate-900">
                    {item[displayField]}
                  </div>
                  {renderSubtext && (
                    <div className="text-[10px] text-slate-500">{renderSubtext(item)}</div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {showEmpty && (
        <div
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 99999 }}
          className="bg-white border border-slate-200 rounded-md shadow-lg"
        >
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            Nenhum item encontrado
          </div>
        </div>
      )}
    </div>
  );
}