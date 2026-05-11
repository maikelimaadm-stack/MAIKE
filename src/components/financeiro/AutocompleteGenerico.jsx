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
  inputClassName = "",
  disabled = false,
  readOnly = false,
  uppercaseDisplay = true
}) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [dropdownPos, setDropdownPos] = useState(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const portalContainerRef = useRef(null);

  const itemSelecionado = items.find(item => item.id === value);

  useEffect(() => {
    if (itemSelecionado) {
      setSearchTerm(itemSelecionado[displayField] || "");
    } else if (!value) {
      setSearchTerm("");
    }
  }, [itemSelecionado, displayField, value]);

  useEffect(() => {
    if (wrapperRef.current) {
      portalContainerRef.current = wrapperRef.current.closest('[role="dialog"]') || null;
    }
  }, []);

  const calcPosition = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    
    setDropdownPos({
      top: r.bottom + 2,
      left: r.left,
      width: r.width,
      inDialog: false
    });
  }, []);

  // Recalcular posição quando abre ou quando rola o scroll
  useEffect(() => {
    if (!open) return;
    calcPosition();
    
    const handleScroll = () => calcPosition();
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open, calcPosition]);

  // Fechar ao clicar fora
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event) {
      const isInsideWrapper = wrapperRef.current && wrapperRef.current.contains(event.target);
      const isInsideDropdown = dropdownRef.current && dropdownRef.current.contains(event.target);
      if (!isInsideWrapper && !isInsideDropdown) {
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
  }, [open, itemSelecionado, displayField]);

  const itensFiltrados = [...items]
    .sort((a, b) => String(a?.[displayField] || "").localeCompare(String(b?.[displayField] || ""), "pt-BR", { numeric: true, sensitivity: "base" }))
    .filter(item => {
      const search = searchTerm.toLowerCase();
      return searchFields.some(field => {
        const fieldValue = item[field];
        return fieldValue && String(fieldValue).toLowerCase().includes(search);
      });
    });

  useEffect(() => {
    if (!open) return;
    const selectedIndex = itensFiltrados.findIndex((item) => item.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, searchTerm, value, itensFiltrados.length]);

  const handleSelect = useCallback((item) => {
    if (disabled || readOnly) return;
    onChange(item.id);
    setSearchTerm(item[displayField] || "");
    setOpen(false);
  }, [onChange, displayField, disabled, readOnly]);

  const handleKeyDown = (e) => {
    if (disabled || readOnly) return;

    if (e.key === "Tab") {
      setOpen(false);
      return;
    }

    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((prev) => Math.min(prev + 1, Math.max(itensFiltrados.length - 1, 0)));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (e.key === "Enter" && open && itensFiltrados[activeIndex]) {
      e.preventDefault();
      handleSelect(itensFiltrados[activeIndex]);
    }
  };

  const handleClear = () => {
    if (disabled || readOnly) return;
    onChange("");
    setSearchTerm("");
    calcPosition();
    setOpen(true);
    inputRef.current?.focus();
  };

  const hasResults = itensFiltrados.length > 0;
  const showEmpty = open && searchTerm && !hasResults;

  const renderDropdownContent = () => {
    if (!open || !dropdownPos) return null;

    const style = dropdownPos.inDialog
      ? { position: 'absolute', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 999999 }
      : { position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width, zIndex: 999999 };

    let content = null;

    if (hasResults) {
      content = (
        <div
          ref={dropdownRef}
          style={style}
          className="bg-white border border-slate-200 rounded-none shadow-lg max-h-60 overflow-auto"
        >
          {itensFiltrados.map((item, index) => (
            <div
              key={item.id}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSelect(item);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`px-3 py-2 cursor-pointer hover:bg-slate-100 border-b border-slate-100 last:border-b-0 ${
                activeIndex === index ? 'bg-slate-100' : value === item.id ? 'bg-emerald-50' : ''
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
      );
    } else if (showEmpty) {
      content = (
        <div
          ref={dropdownRef}
          style={style}
          className="bg-white border border-slate-200 rounded-none shadow-lg"
        >
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            Nenhum item encontrado
          </div>
        </div>
      );
    }

    return content;
  };

  const renderDropdown = () => {
    const content = renderDropdownContent();
    if (!content) return null;

    return ReactDOM.createPortal(content, document.body);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className || ''}`}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            if (!open) setOpen(true);
            calcPosition();
          }}
          onFocus={() => {
            if (disabled || readOnly) return;
            calcPosition();
            setOpen(true);
          }}
          onBlur={() => {
            setTimeout(() => {
              const activeElement = document.activeElement;
              const isInsideDropdown = dropdownRef.current && dropdownRef.current.contains(activeElement);
              const isInsideWrapper = wrapperRef.current && wrapperRef.current.contains(activeElement);
              if (!isInsideDropdown && !isInsideWrapper) setOpen(false);
            }, 80);
          }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          className={`pr-8 h-8 text-xs rounded-none ${uppercaseDisplay ? 'uppercase' : ''} ${inputClassName}`}
          style={uppercaseDisplay ? { textTransform: 'uppercase' } : undefined}
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
      {renderDropdown()}
    </div>
  );
}