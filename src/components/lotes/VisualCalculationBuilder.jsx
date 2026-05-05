import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { OPERACOES_CALCULO, montarFormulaAmigavel, calcularPreviewVisual } from "./camposConfigOptions";

const EMPTY_ITEM = { field: "", operator: "*" };

export default function VisualCalculationBuilder({ value = [], fields = [], onChange }) {
  const items = value.length ? value : [{ ...EMPTY_ITEM }, { ...EMPTY_ITEM }];
  const selectedFields = items.map((item) => item.field).filter(Boolean);
  const hasEmptyFields = items.some((item) => !item.field);
  const hasDuplicateFields = new Set(selectedFields).size !== selectedFields.length;
  const previewValue = calcularPreviewVisual(items, fields);
  const formulaPreview = montarFormulaAmigavel(items, fields);

  const updateItem = (index, patch) => {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };

  const removeItem = (index) => {
    onChange(items.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className="p-2 border rounded-lg bg-white space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-slate-700 uppercase">Construtor de cálculo</div>
          <div className="text-[11px] text-slate-500">Escolha os campos e a operação, sem digitar fórmula.</div>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => onChange([...items, { ...EMPTY_ITEM, operator: "+" }])}>
          <Plus className="w-3.5 h-3.5" /> Campo
        </Button>
      </div>

      <div className="space-y-1">
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[90px_1fr_34px] gap-2 items-center">
            {index === 0 ? (
              <div className="text-xs text-slate-500 uppercase px-2">Campo</div>
            ) : (
              <Select value={item.operator || "+"} onValueChange={(operator) => updateItem(index, { operator })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{OPERACOES_CALCULO.map((op) => <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>)}</SelectContent>
              </Select>
            )}

            <Select value={item.field || "none"} onValueChange={(field) => updateItem(index, { field: field === "none" ? "" : field })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="SELECIONE O CAMPO" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">SELECIONE</SelectItem>
                {fields.map((field) => {
                  const duplicated = selectedFields.includes(field.value) && item.field !== field.value;
                  return <SelectItem key={field.value} value={field.value} disabled={duplicated} className="text-xs">{field.label}</SelectItem>;
                })}
              </SelectContent>
            </Select>

            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-600" disabled={items.length <= 2} onClick={() => removeItem(index)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="border rounded bg-slate-50 px-2 py-1 text-xs text-slate-700 space-y-1">
        <div><span className="font-semibold">Prévia:</span> {formulaPreview || "selecione os campos"}{previewValue !== null ? ` = ${Number(previewValue).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` : ""}</div>
        {hasEmptyFields && <div className="text-[11px] text-amber-700">Preencha todos os campos do cálculo.</div>}
        {hasDuplicateFields && <div className="text-[11px] text-red-600">Use cada campo apenas uma vez no cálculo.</div>}
      </div>
    </div>
  );
}