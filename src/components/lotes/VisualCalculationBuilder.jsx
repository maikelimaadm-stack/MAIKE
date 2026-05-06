import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { OPERACOES_CALCULO, montarFormulaAmigavel, calcularPreviewVisual } from "./camposConfigOptions";

const EMPTY_ITEM = { field: "", operator: "*" };

const fieldRow = "grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1";
const fieldLabel = "text-[12px] text-slate-600 text-right leading-none";
const fieldBox = "h-6 border border-slate-300 bg-white focus-within:border-green-500 transition-colors";
const triggerCls = "h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1";

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
        <div key={index} className={fieldRow}>
          <label className={fieldLabel}>{index === 0 ? "Campo do cálculo" : `Operação ${index}`}</label>
          <div className="flex items-center gap-1">
            {index > 0 && (
              <div className={`${fieldBox} w-[90px]`}>
                <Select value={item.operator || "+"} onValueChange={(operator) => updateItem(index, { operator })}>
                  <SelectTrigger className={triggerCls}><SelectValue /></SelectTrigger>
                  <SelectContent>{OPERACOES_CALCULO.map((op) => <SelectItem key={op.value} value={op.value} className="text-xs">{op.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className={`${fieldBox} flex-1 min-w-0`}>
              <Select value={item.field || "none"} onValueChange={(field) => updateItem(index, { field: field === "none" ? "" : field })}>
                <SelectTrigger className={triggerCls}><SelectValue placeholder="SELECIONE O CAMPO" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">SELECIONE</SelectItem>
                  {fields.map((field) => {
                    const duplicated = selectedFields.includes(field.value) && item.field !== field.value;
                    return <SelectItem key={field.value} value={field.value} disabled={duplicated} className="text-xs uppercase">{field.label}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-red-600 shrink-0" disabled={items.length <= 2} onClick={() => removeItem(index)}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}

      <div className={fieldRow}>
        <div />
        <Button type="button" variant="outline" size="sm" className="h-6 text-[11px] w-fit px-2" onClick={() => onChange([...items, { ...EMPTY_ITEM, operator: "+" }])}>
          <Plus className="w-3 h-3 mr-1" /> Adicionar campo
        </Button>
      </div>

      <div className={fieldRow}>
        <label className={fieldLabel}>Prévia do cálculo</label>
        <div className="border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 min-h-6">
          {formulaPreview || "selecione os campos"}{previewValue !== null ? ` = ${Number(previewValue).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` : ""}
          {hasEmptyFields && <div className="text-[11px] text-amber-700">Preencha todos os campos do cálculo.</div>}
          {hasDuplicateFields && <div className="text-[11px] text-red-600">Use cada campo apenas uma vez.</div>}
        </div>
      </div>
    </>
  );
}