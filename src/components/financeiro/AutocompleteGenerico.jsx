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
  const [dropdownPos, setDropdownPos] = useState(null);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const portalContainerRef = useRef(null);

  const itemSelecionado = items.find(item => item.id === value);

  useEffect(() => {
    if (itemSelecionado) {
      setSearchTerm(itemSelecionado[displayField] || "");
    }
  }, [itemSelecionado, displayField]);

  // Encontrar o container do portal: o DialogContent mais próximo ou o body
  useEffect(() => {
    if (wrapperRef.current) {
      const dialogContent = wrapperRef.current.closest('[role="dialog"]');
      portalContainerRef.current = dialogContent || null;
    }
  }, []);

  const calcPosition = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    
    const container = portalContainerRef.current;
    if (container) {
      // Se estamos dentro de um Dialog, calcular posição relativa ao Dialog
      const containerRect = container.getBoundingClientRect();
      setDropdownPos({
        top: r.bottom - containerRect.top + 2,
        left: r.left - containerRect.left,
        width: r.width,
        inDialog: true
      });
    } else {
      // Fora de Dialog, usar posição fixa na viewport
      setDropdownPos({
        top: r.bottom + 2,
        left: r.left,
        width: r.width,
        inDialog: false
      });
    }
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
          className="bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {itensFiltrados.map((item) => (
            <div
              key={item.id}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleSelect(item);
              }}
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
      );
    } else if (showEmpty) {
      content = (
        <div
          ref={dropdownRef}
          style={style}
          className="bg-white border border-slate-200 rounded-md shadow-lg"
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

    const container = portalContainerRef.current;
    if (container) {
      // Dentro de um Dialog: renderizar via portal no DialogContent
      return ReactDOM.createPortal(content, container);
    }
    // Fora de Dialog: renderizar via portal no body
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
            calcPosition();
            setOpen(true);
          }}
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
      {renderDropdown()}
    </div>
  );
}