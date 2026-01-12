import React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function FiltroData({ label = "Data Início", value, onChange }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-xs" />
    </div>
  );
}

export function FiltroSelect({ label, value, onChange, opcoes, placeholder = "Selecione" }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map(op => (
            <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function FiltroMultiplo({ label, selecionados, opcoes, onToggle, renderLabel }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs">
          {label} {selecionados.length > 0 && `(${selecionados.length})`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 max-h-96 overflow-auto">
        <div className="space-y-2">
          <h4 className="font-semibold text-sm mb-2">{label}</h4>
          {opcoes.map(op => (
            <div key={op} className="flex items-center space-x-2">
              <Checkbox checked={selecionados.includes(op)} onCheckedChange={() => onToggle(op)} />
              <label className="text-sm cursor-pointer">{renderLabel ? renderLabel(op) : op}</label>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function BotaoLimparFiltros({ onClick }) {
  return (
    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onClick}>
      Limpar Filtros
    </Button>
  );
}