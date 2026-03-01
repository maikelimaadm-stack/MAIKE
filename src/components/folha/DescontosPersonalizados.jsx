import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";

export default function DescontosPersonalizados({ value = [], onChange, disabled }) {
  const items = value || [];
  const update = (idx, patch) => {
    const next = items.map((it, i) => i === idx ? { ...it, ...patch } : it);
    onChange?.(next);
  };
  const add = () => onChange?.([...(items||[]), { descricao: "", valor: 0 }]);
  const remove = (idx) => onChange?.(items.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Descontos Personalizados</Label>
        {!disabled && (
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={add}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Adicionar
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {items.map((it, idx) => (
          <div key={idx} className="grid grid-cols-5 gap-2 items-center">
            <Input className="h-8 text-xs col-span-3" placeholder="Descrição" value={it.descricao}
              onChange={e=>update(idx, { descricao: e.target.value })} disabled={disabled} />
            <Input type="number" className="h-8 text-xs col-span-1" placeholder="Valor (ex.: 1234.56)" value={it.valor}
              onChange={e=>update(idx, { valor: parseFloat(e.target.value||'0') })} disabled={disabled} />
            {!disabled && (
              <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>remove(idx)}>
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Excluir
              </Button>
            )}
          </div>
        ))}
        {items.length === 0 && (
          <div className="text-xs text-slate-500">Nenhum desconto lançado.</div>
        )}
      </div>
    </div>
  );
}