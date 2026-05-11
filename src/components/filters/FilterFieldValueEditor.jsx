import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

const compactInputClass = "h-7 rounded-none border-slate-300 px-1.5 text-xs shadow-none";
const compactSelectClass = "h-7 rounded-none border-slate-300 px-1.5 text-xs shadow-none";
const CONFIG_FLAGS = [
  ["quickFilter", "Filtro rápido"],
  ["favorite", "Favorito"],
  ["autoApply", "Aplicar automático"],
  ["required", "Obrigatório"],
  ["hidden", "Oculto"],
  ["readOnly", "Somente leitura"]
];

const isNoValueOperator = (operator) => operator === "empty" || operator === "notEmpty";
const isListOperator = (operator) => ["custom", "in", "notIn"].includes(operator);
const isExactLike = (operator) => ["exact", "different"].includes(operator);
const isLowerBound = (operator) => ["gte", "gt"].includes(operator);
const isUpperBound = (operator) => ["lte", "lt"].includes(operator);

function ValueInput({ type, value, onChange, placeholder }) {
  if (type === "boolean") {
    return (
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger className={compactSelectClass}><SelectValue placeholder="Sim/Não" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Sim</SelectItem>
          <SelectItem value="false">Não</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      type={type === "date" ? "date" : type === "number" ? "number" : "text"}
      inputMode={type === "number" ? "decimal" : undefined}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder || "Valor padrão"}
      className={compactInputClass}
    />
  );
}

export default function FilterFieldValueEditor({ field, operator, value = {}, config = {}, onValueChange, onConfigChange }) {
  const fieldType = field?.type === "select" && field?.options?.length ? "select" : field?.type;
  const inputType = ["number", "date", "boolean"].includes(fieldType) ? fieldType : "text";

  const updateValue = (patch) => onValueChange({ ...value, ...patch });
  const updateConfig = (patch) => onConfigChange({ ...config, ...patch });

  return (
    <div className="col-span-4 rounded-sm border border-slate-200 bg-slate-50/70 p-2 space-y-2">
      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-600">Valor padrão</div>
        {isNoValueOperator(operator) ? (
          <div className="h-7 flex items-center rounded-sm border border-slate-200 bg-white px-2 text-[11px] text-slate-500">
            Este operador não usa valor.
          </div>
        ) : operator === "between" ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
            <ValueInput type={inputType} value={value.min} onChange={(next) => updateValue({ min: next })} placeholder="Valor inicial" />
            <span className="text-[11px] text-slate-500">até</span>
            <ValueInput type={inputType} value={value.max} onChange={(next) => updateValue({ max: next })} placeholder="Valor final" />
          </div>
        ) : isListOperator(operator) ? (
          <Textarea
            value={value.value || value.exact || ""}
            onChange={(event) => updateValue({ value: event.target.value, exact: event.target.value })}
            placeholder="Informe uma lista separada por ; ou quebra de linha"
            className="min-h-[58px] rounded-none border-slate-300 px-1.5 py-1 text-xs shadow-none"
          />
        ) : fieldType === "select" && field.options?.length && (isExactLike(operator) || !operator) ? (
          <Select value={value.value || value.exact || ""} onValueChange={(next) => updateValue({ value: next, exact: next })}>
            <SelectTrigger className={compactSelectClass}><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
          </Select>
        ) : isLowerBound(operator) ? (
          <ValueInput type={inputType} value={value.min} onChange={(next) => updateValue({ min: next })} placeholder="Valor mínimo" />
        ) : isUpperBound(operator) ? (
          <ValueInput type={inputType} value={value.max} onChange={(next) => updateValue({ max: next })} placeholder="Valor máximo" />
        ) : field?.type === "codeName" || field?.type === "codeNameDynamic" ? (
          <div className="grid grid-cols-2 gap-1">
            <ValueInput type="text" value={value.codigo} onChange={(next) => updateValue({ codigo: next })} placeholder="Código" />
            <ValueInput type="text" value={value.nome || value.value} onChange={(next) => updateValue({ nome: next, value: next })} placeholder="Nome" />
          </div>
        ) : (
          <ValueInput type={inputType} value={value.value || value.exact || ""} onChange={(next) => updateValue({ value: next, exact: next })} placeholder={config.placeholder || "Valor padrão"} />
        )}
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold text-slate-600">Configurações do campo</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
          {CONFIG_FLAGS.map(([key, label]) => (
            <label key={key} className="flex items-center gap-1.5 rounded-sm border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600">
              <Checkbox checked={!!config[key]} onCheckedChange={(checked) => updateConfig({ [key]: !!checked })} className="h-3.5 w-3.5 rounded-none" />
              {label}
            </label>
          ))}
        </div>
        <div className="mt-1.5 grid grid-cols-1 md:grid-cols-2 gap-1.5">
          <Input value={config.placeholder || ""} onChange={(event) => updateConfig({ placeholder: event.target.value })} placeholder="Placeholder" className={compactInputClass} />
          <Input value={config.notes || ""} onChange={(event) => updateConfig({ notes: event.target.value })} placeholder="Observações" className={compactInputClass} />
        </div>
      </div>
    </div>
  );
}