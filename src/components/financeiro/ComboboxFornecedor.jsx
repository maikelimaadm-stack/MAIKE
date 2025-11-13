import React, { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";

export default function ComboboxFornecedor({ fornecedores, value, onChange, className }) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const wrapperRef = useRef(null);

  const fornecedorSelecionado = fornecedores.find(f => f.id === value);

  useEffect(() => {
    if (fornecedorSelecionado) {
      setSearchTerm(fornecedorSelecionado.nome);
    }
  }, [fornecedorSelecionado]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
        if (fornecedorSelecionado) {
          setSearchTerm(fornecedorSelecionado.nome);
        } else {
          setSearchTerm("");
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [fornecedorSelecionado]);

  const formatarDocumento = (fornecedor) => {
    if (fornecedor.cnpj) {
      return `CNPJ: ${fornecedor.cnpj}`;
    }
    if (fornecedor.cpf) {
      return `CPF: ${fornecedor.cpf}`;
    }
    return '';
  };

  const fornecedoresFiltrados = fornecedores.filter(f => {
    const search = searchTerm.toLowerCase();
    return (
      f.nome?.toLowerCase().includes(search) ||
      f.cnpj?.includes(search) ||
      f.cpf?.includes(search)
    );
  });

  const handleSelect = (fornecedor) => {
    onChange(fornecedor.id);
    setSearchTerm(fornecedor.nome);
    setOpen(false);
  };

  const handleClear = () => {
    onChange("");
    setSearchTerm("");
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <Input
          value={searchTerm}
          onChange={(e) => {
            setSearchTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar fornecedor..."
          className="pl-8 pr-8 h-8 text-xs"
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

      {open && fornecedoresFiltrados.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-60 overflow-auto">
          {fornecedoresFiltrados.map((fornecedor) => (
            <div
              key={fornecedor.id}
              onClick={() => handleSelect(fornecedor)}
              className={`px-3 py-2 cursor-pointer hover:bg-slate-100 border-b border-slate-100 last:border-b-0 ${
                value === fornecedor.id ? 'bg-emerald-50' : ''
              }`}
            >
              <div className="text-xs font-medium text-slate-900">{fornecedor.nome}</div>
              <div className="text-[10px] text-slate-500">{formatarDocumento(fornecedor)}</div>
            </div>
          ))}
        </div>
      )}

      {open && searchTerm && fornecedoresFiltrados.length === 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg">
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            Nenhum fornecedor encontrado
          </div>
        </div>
      )}
    </div>
  );
}