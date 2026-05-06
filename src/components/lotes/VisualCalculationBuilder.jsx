import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { OPERACOES_CALCULO, montarFormulaAmigavel, calcularPreviewVisual } from "./camposConfigOptions";

const EMPTY_ITEM = { field: "", operator: "*" };

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
      <label className="text-[12px] text-slate-600 text-right leading-none">{label}</label>
      <div className="h-6 border border-slate-300 bg-white focus-within:border-green-500 transition-colors [&_button]:h-[22px]">
        {children}
      </div>
    </div>
  );
}

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
    <>
      {items.map((item, index) => (
        <div key={index} className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
          <label className="text-[12px] text-slate-600 text-right leading-none">
            {index === 0 ? "Cálculo" : ""}
          </label>
          <div className="grid grid-cols-[80px_1fr_28px] gap-1 items-center">
            {index === 0 ? (
              <div className="h-6 flex items-center px-1 text-[11px] text-slate-500 uppercase">Campo</div>
            ) : (
              <div className="h-6 border border-slate-300 bg-white focus-within:border-green-500">
                <Select value={item.operator || "+"} onValueChange={(operator) => updateItem(index, { operator })}>
                  <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue /></SelectTrigger>
                  <SelectContent>{OPERACOES_CALCULO.map((op) => <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            <div className="h-6 border border-slate-300 bg-white focus-within:border-green-500">
              <Select value={item.field || "none"} onValueChange={(field) => updateItem(index, { field: field === "none" ? "" : field })}>
                <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue placeholder="SELECIONE O CAMPO" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">SELECIONE</SelectItem>
                  {fields.map((field) => {
                    const duplicated = selectedFields.includes(field.value) && item.field !== field.value;
                    return <SelectItem key={field.value} value={field.value} disabled={duplicated} className="text-xs uppercase">{field.label}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>

            <Button type="button" variant="ghost" size="icon" className="h-6 w-7 text-red-600" disabled={items.length <= 2} onClick={() => removeItem(index)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
        <div />
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs w-fit" onClick={() => onChange([...items, { ...EMPTY_ITEM, operator: "+" }])}>
          <Plus className="w-3.5 h-3.5" /> Adicionar campo
        </Button>
      </div>

      <div className="grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1">
        <label className="text-[12px] text-slate-600 text-right leading-none">Prévia do cálculo</label>
        <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 min-h-6">
          {formulaPreview || "selecione os campos"}{previewValue !== null ? ` = ${Number(previewValue).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` : ""}
          {hasEmptyFields && <div className="text-[11px] text-amber-700">Preencha todos os campos do cálculo.</div>}
          {hasDuplicateFields && <div className="text-[11px] text-red-600">Use cada campo apenas uma vez.</div>}
        </div>
      </div>
    </>
  );
}