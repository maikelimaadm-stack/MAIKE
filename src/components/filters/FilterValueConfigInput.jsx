import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const inputClass = "h-7 rounded-none border-slate-300 px-1.5 text-xs shadow-none bg-white";
const textareaClass = "min-h-[54px] rounded-none border-slate-300 px-1.5 py-1 text-xs shadow-none bg-white";

const getValueKeys = (field, operator) => {
  if (field.type === "codeName") return ["lote_codigo", "lote_nome"];
  if (field.type === "codeNameDynamic") {
    const prefix = field.id.replace("_codigo_nome", "");
    return [`${prefix}_codigo`, `${prefix}_nome`];
  }
  if (operator === "between") return [`${field.id}_min`, `${field.id}_max`];
  if (["gte", "gt"].includes(operator)) return [`${field.id}_min`];
  if (["lte", "lt"].includes(operator)) return [`${field.id}_max`];
  if (["empty", "notEmpty"].includes(operator)) return [];
  if (["number", "date"].includes(field.type)) return [`${field.id}_exact`];
  return [field.id];
};

export const buildFieldValuePatch = (field, operator, fieldValues = {}) => {
  const keys = getValueKeys(field, operator);
  return Object.fromEntries(keys.map((key) => [key, fieldValues[key] ?? ""]).filter(([, value]) => value !== "" && value !== undefined && value !== null));
};

export const clearFieldValueKeys = (field, fieldValues = {}) => {
  const prefix = field.id;
  const dynamicPrefix = field.type === "codeNameDynamic" ? field.id.replace("_codigo_nome", "") : null;
  return Object.fromEntries(Object.entries(fieldValues).filter(([key]) => {
    if (field.type === "codeName") return !["lote_codigo", "lote_nome"].includes(key);
    if (dynamicPrefix) return ![`${dynamicPrefix}_codigo`, `${dynamicPrefix}_nome`].includes(key);
    return key !== prefix && !key.startsWith(`${prefix}_`);
  }));
};

export default function FilterValueConfigInput({ field, operator, fieldValues = {}, onChange }) {
  const update = (key, value) => onChange({ ...fieldValues, [key]: value });

  if (["empty", "notEmpty"].includes(operator)) {
    return <div className="h-7 flex items-center rounded-none border border-slate-200 bg-slate-50 px-2 text-[11px] text-slate-500">Sem valor para este operador</div>;
  }

  if (field.type === "codeName") {
    return (
      <div className="grid grid-cols-2 gap-1">
        <Input value={fieldValues.lote_codigo || ""} onChange={(e) => update("lote_codigo", e.target.value)} placeholder="Código" className={inputClass} />
        <Input value={fieldValues.lote_nome || ""} onChange={(e) => update("lote_nome", e.target.value)} placeholder="Nome" className={inputClass} />
      </div>
    );
  }

  if (field.type === "codeNameDynamic") {
    const prefix = field.id.replace("_codigo_nome", "");
    return (
      <div className="grid grid-cols-2 gap-1">
        <Input value={fieldValues[`${prefix}_codigo`] || ""} onChange={(e) => update(`${prefix}_codigo`, e.target.value)} placeholder="Código" className={inputClass} />
        <Input value={fieldValues[`${prefix}_nome`] || ""} onChange={(e) => update(`${prefix}_nome`, e.target.value)} placeholder="Nome" className={inputClass} />
      </div>
    );
  }

  if (operator === "between") {
    const type = field.type === "date" ? "date" : "number";
    return (
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
        <Input type={type} value={fieldValues[`${field.id}_min`] || ""} onChange={(e) => update(`${field.id}_min`, e.target.value)} placeholder="Inicial" className={inputClass} />
        <span className="text-[11px] text-slate-500">a</span>
        <Input type={type} value={fieldValues[`${field.id}_max`] || ""} onChange={(e) => update(`${field.id}_max`, e.target.value)} placeholder="Final" className={inputClass} />
      </div>
    );
  }

  if (["in", "notIn", "custom"].includes(operator)) {
    const key = field.type === "number" || field.type === "date" ? `${field.id}_exact` : field.id;
    return <Textarea value={fieldValues[key] || ""} onChange={(e) => update(key, e.target.value)} placeholder="Informe um valor por linha ou separado por ;" className={textareaClass} />;
  }

  if (field.type === "select" && field.options?.length) {
    return (
      <Select value={fieldValues[field.id] || ""} onValueChange={(value) => update(field.id, value)}>
        <SelectTrigger className={inputClass}><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>{field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
      </Select>
    );
  }

  if (field.type === "boolean") {
    return (
      <Select value={fieldValues[field.id] || ""} onValueChange={(value) => update(field.id, value)}>
        <SelectTrigger className={inputClass}><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Sim</SelectItem>
          <SelectItem value="false">Não</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  const key = ["number", "date"].includes(field.type) ? `${field.id}_exact` : field.id;
  const type = field.type === "date" ? "date" : field.type === "number" ? "number" : "text";
  return <Input type={type} value={fieldValues[key] || ""} onChange={(e) => update(key, e.target.value)} placeholder="Valor padrão" className={inputClass} />;
}