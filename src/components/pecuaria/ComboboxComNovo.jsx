import React, { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, ChevronDown, Check } from "lucide-react";

export default function ComboboxComNovo({ 
  value, 
  onChange, 
  options = [], 
  placeholder = "Selecione ou digite...",
  onAddNew,
  className = ""
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || "");
  const [filteredOptions, setFilteredOptions] = useState([]);
  const wrapperRef = useRef(null);

  // Ordenar opções alfabeticamente e filtrar
  useEffect(() => {
    const sorted = [...options]
      .filter(opt => opt && opt.trim())
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    
    if (inputValue) {
      const filtered = sorted.filter(opt => 
        opt.toLowerCase().includes(inputValue.toLowerCase())
      );
      setFilteredOptions(filtered);
    } else {
      setFilteredOptions(sorted);
    }
  }, [options, inputValue]);

  useEffect(() => {
    setInputValue(value || "");
  }, [value]);

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
        // Se digitou algo novo, salva
        if (inputValue && inputValue !== value) {
          onChange(inputValue);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [inputValue, value, onChange]);

  const handleSelect = (opt) => {
    setInputValue(opt);
    onChange(opt);
    setIsOpen(false);
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    setIsOpen(true);
  };

  const handleFocus = () => {
    setIsOpen(true);
    // Ao focar, limpa o filtro para mostrar todas as opções
    setInputValue("");
  };

  const handleInputBlur = () => {
    // Pequeno delay para permitir clique nos itens
    setTimeout(() => {
      if (inputValue !== value) {
        onChange(inputValue);
      }
    }, 150);
  };

  const handleAddNew = () => {
    if (inputValue && onAddNew) {
      onAddNew(inputValue);
    }
    onChange(inputValue);
    setIsOpen(false);
  };

  const showAddButton = inputValue && 
    !filteredOptions.some(opt => opt.toLowerCase() === inputValue.toLowerCase());

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Input
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleInputBlur}
          placeholder={value || placeholder}
          className="h-9 text-sm pr-8"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-9 w-8"
          onClick={() => setIsOpen(!isOpen)}
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-auto">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => (
              <div
                key={idx}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-slate-100 flex items-center justify-between ${
                  opt === value ? 'bg-slate-50' : ''
                }`}
                onClick={() => handleSelect(opt)}
              >
                <span>{opt}</span>
                {opt === value && <Check className="w-4 h-4 text-emerald-600" />}
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-slate-500">
              Nenhuma opção encontrada
            </div>
          )}
          
          {showAddButton && (
            <div
              className="px-3 py-2 text-sm cursor-pointer hover:bg-emerald-50 border-t flex items-center gap-2 text-emerald-700 font-medium"
              onClick={handleAddNew}
            >
              <Plus className="w-4 h-4" />
              Adicionar "{inputValue}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}