import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import AutocompleteGenerico from "@/components/financeiro/AutocompleteGenerico";

const inputClass = "h-8 rounded-none border-slate-300 bg-white px-2 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-emerald-500";
const textareaClass = "min-h-[58px] rounded-none border-slate-300 bg-white px-2 py-1.5 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-emerald-500";
const selectClass = "h-8 rounded-none border-slate-300 bg-white px-2 text-xs shadow-none";

const isNoValueOperator = (operator) => operator === "empty" || operator === "notEmpty";
const isListOperator = (operator) => ["custom", "in", "notIn"].includes(operator);
const isLowerBound = (operator) => ["gte", "gt"].includes(operator);
const isUpperBound = (operator) => ["lte", "lt"].includes(operator);

function hasValue(value = {}) {
  return Object.values(value || {}).some((item) => item !== "" && item !== null && item !== undefined);
}

function SimpleValueInput({ type, value, onChange, placeholder }) {
  return (
    <Input
      type={type === "date" ? "date" : type === "number" ? "number" : "text"}
      inputMode={type === "number" ? "decimal" : undefined}
      value={value || ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder || "Valor padrão"}
      className={inputClass}
    />
  );
}

function SelectValueInput({ field, value, onChange }) {
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger className={selectClass}><SelectValue placeholder="Selecione" /></SelectTrigger>
      <SelectContent>{(field.options || []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function BooleanValueInput({ value, onChange }) {
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger className={selectClass}><SelectValue placeholder="Selecione" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="true">Sim</SelectItem>
        <SelectItem value="false">Não</SelectItem>
      </SelectContent>
    </Select>
  );
}

function RelationalValueInput({ value = {}, onChange, relationOptions = [] }) {
  const items = relationOptions.map((item) => ({ ...item, nome: item.nome || item.label || item.name || "" }));
  const selectedItem = items.find((item) => item.nome === (value.nome || value.value) || item.codigo === value.codigo);

  return (
    <AutocompleteGenerico
      items={items}
      value={selectedItem?.id || ""}
      onChange={(selectedId) => {
        const selected = items.find((item) => item.id === selectedId);
        onChange({
          codigo: selected?.codigo || "",
          nome: selected?.nome || "",
          value: selected?.nome || ""
        });
      }}
      displayField="nome"
      searchFields={["codigo", "nome"]}
      placeholder="Pesquisar e selecionar"
      inputClassName="h-8"
      renderSubtext={(item) => item.codigo ? `Código: ${item.codigo}` : ""}
    />
  );
}

export default function FilterFieldValueEditor({ field, operator, value = {}, onValueChange, relationOptions = [] }) {
  const fieldType = field?.type === "select" && field?.options?.length ? "select" : field?.type;
  const inputType = fieldType === "date" ? "date" : fieldType === "number" ? "number" : "text";

  const updateValue = (patch) => onValueChange({ ...value, ...patch });
  const updateSingleValue = (next) => updateValue({ value: next, exact: next });

  const renderValueControl = () => {
    if (isNoValueOperator(operator)) {
      return <div className="flex h-8 items-center border border-slate-200 bg-slate-50 px-2 text-[11px] text-slate-500">Este operador não usa valor padrão.</div>;
    }

    if (operator === "between") {
      const startLabel = fieldType === "date" ? "Data inicial" : "Mínimo";
      const endLabel = fieldType === "date" ? "Data final" : "Máximo";
      return (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <SimpleValueInput type={inputType} value={value.min} onChange={(next) => updateValue({ min: next })} placeholder={startLabel} />
          <span className="text-[11px] font-semibold text-slate-500">até</span>
          <SimpleValueInput type={inputType} value={value.max} onChange={(next) => updateValue({ max: next })} placeholder={endLabel} />
        </div>
      );
    }

    if (isListOperator(operator)) {
      return <Textarea value={value.value || value.exact || ""} onChange={(event) => updateSingleValue(event.target.value)} placeholder="Informe um valor por linha ou separado por ;" className={textareaClass} />;
    }

    if (isLowerBound(operator)) return <SimpleValueInput type={inputType} value={value.min} onChange={(next) => updateValue({ min: next })} placeholder="Valor mínimo" />;
    if (isUpperBound(operator)) return <SimpleValueInput type={inputType} value={value.max} onChange={(next) => updateValue({ max: next })} placeholder="Valor máximo" />;

    if (fieldType === "boolean") return <BooleanValueInput value={value.value || value.exact || ""} onChange={updateSingleValue} />;
    if (fieldType === "select") return <SelectValueInput field={field} value={value.value || value.exact || ""} onChange={updateSingleValue} />;
    if (field?.type === "codeName" || field?.type === "codeNameDynamic") return <RelationalValueInput value={value} onChange={onValueChange} relationOptions={relationOptions} />;

    return <SimpleValueInput type={inputType} value={value.value || value.exact || ""} onChange={updateSingleValue} placeholder="Valor padrão" />;
  };

  return (
    <div className="border-t border-slate-100 bg-slate-50/70 px-2 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Valor padrão do filtro</span>
        {hasValue(value) && <span className="rounded-sm border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">salvo</span>}
      </div>
      {renderValueControl()}
    </div>
  );
}