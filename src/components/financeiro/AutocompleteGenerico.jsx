import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [itemSelecionado, displayField]);

  const itensFiltrados = items.filter(item => {
    const search = searchTerm.toLowerCase();
    return searchFields.some(field => {
      const fieldValue = item[field];
      return fieldValue && String(fieldValue).toLowerCase().includes(search);
    });
  });

  const handleSelect = (item) => {
    onChange(item.id);
    setSearchTerm(item[displayField] || "");
    setOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setSearchTerm("");
    setOpen(false);
  };

  const inputRef = useRef(null);
  const [dropdownStyle, setDropdownStyle] = useState({});

  const updateDropdownPosition = useCallback(() => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, []);

  useEffect(() => {
    if (open) {
      updateDropdownPosition();
      const onScroll = () => updateDropdownPosition();
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onScroll);
      return () => {
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll);
      };
    }
  }, [open, updateDropdownPosition]);

  const renderDropdown = () => {
    if (!open) return null;

    const content = itensFiltrados.length > 0 ? (
      <div style={dropdownStyle} className="bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-auto">
        {itensFiltrados.map((item) => (
          <div
            key={item.id}
            onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
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
    ) : searchTerm ? (
      <div style={dropdownStyle} className="bg-white border border-slate-200 rounded-md shadow-lg">
        <div className="px-3 py-6 text-center text-xs text-slate-500">
          Nenhum item encontrado
        </div>
      </div>
    ) : null;

    if (!content) return null;
    return ReactDOM.createPortal(content, document.body);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => { setOpen(true); updateDropdownPosition(); }}
          placeholder={placeholder}
          className={`pr-8 h-8 text-xs uppercase ${inputClassName}`}
          style={{ textTransform: 'uppercase' }}
        />
        {searchTerm && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {renderDropdown()}
    </div>
  );
}