import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, X, Plus } from "lucide-react";

export default function SankhyaFilterPanel({ open, filters, onChange, onApply, onClear }) {
  if (!open) return null;

  const update = (field, value) => onChange({ ...filters, [field]: value });

  return (
    <aside className="w-[250px] shrink-0 border-r border-slate-300 bg-white text-xs min-h-[calc(100dvh-150px)]">
      <div className="border-b border-slate-300 p-1.5 space-y-1.5">
        <div className="flex items-center justify-between font-semibold text-slate-700">
          <span>Filtro personalizado</span>
          <button type="button" onClick={onClear} className="inline-flex items-center gap-1 text-red-600 hover:text-red-700">
            <X className="w-3 h-3" /> Limpar
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox checked={!!filters.esconderAoAtualizar} onCheckedChange={(checked) => update("esconderAoAtualizar", !!checked)} className="h-3.5 w-3.5" />
          <span className="font-semibold text-slate-700">Esconder ao atualizar</span>
        </div>
        <div className="grid grid-cols-[1fr_2fr] gap-1">
          <Button type="button" className="h-8 rounded-sm bg-green-500 hover:bg-green-600 text-white text-xs">
            <Plus className="w-4 h-4" /> Filtro
          </Button>
          <Button type="button" onClick={onApply} className="h-8 rounded-sm bg-slate-600 hover:bg-slate-700 text-white text-xs">
            Aplicar
          </Button>
        </div>
      </div>

      <div className="h-8 px-2 flex items-center justify-between border-b border-green-500 bg-slate-50 font-semibold text-slate-700">
        <span>Filtros rápidos</span>
        <div className="flex items-center gap-2 text-slate-700">
          <Filter className="w-3.5 h-3.5" />
          <button type="button" onClick={onClear} className="relative">
            <Filter className="w-4 h-4" />
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-slate-700 text-white text-[9px] leading-3">×</span>
          </button>
        </div>
      </div>

      <div className="max-h-[calc(100dvh-260px)] overflow-auto p-1.5 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-slate-600 mb-1">Código</label>
            <Input value={filters.numero_lote || ""} onChange={(e) => update("numero_lote", e.target.value)} className="h-7 text-xs" />
          </div>
          <div>
            <label className="block text-slate-600 mb-1">Nome</label>
            <Input value={filters.nome || ""} onChange={(e) => update("nome", e.target.value)} className="h-7 text-xs" />
          </div>
        </div>
        <div>
          <label className="block text-slate-600 mb-1">Categoria</label>
          <Input value={filters.categoria || ""} onChange={(e) => update("categoria", e.target.value)} className="h-7 text-xs" />
        </div>
        <div>
          <label className="block text-slate-600 mb-1">Status</label>
          <Select value={filters.status || "todos"} onValueChange={(value) => update("status", value)}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="Ativo">Ativo</SelectItem>
              <SelectItem value="Inativo">Inativo</SelectItem>
              <SelectItem value="Vendido">Vendido</SelectItem>
              <SelectItem value="Abatido">Abatido</SelectItem>
              <SelectItem value="Transferido">Transferido</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-slate-600 mb-1">Data de entrada</label>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Input type="date" value={filters.data_inicio || ""} onChange={(e) => update("data_inicio", e.target.value)} className="h-7 text-xs" />
            <span className="text-slate-500">a</span>
            <Input type="date" value={filters.data_fim || ""} onChange={(e) => update("data_fim", e.target.value)} className="h-7 text-xs" />
          </div>
        </div>
      </div>
    </aside>
  );
}