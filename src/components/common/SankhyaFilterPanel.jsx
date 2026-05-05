import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, Plus, ChevronDown, ChevronRight } from "lucide-react";
import SankhyaFilterConfigDialog from "./SankhyaFilterConfigDialog";

const FIELD_DEFS = [
  { id: "lote_codigo_nome", label: "Código + Nome", group: "Detalhes do lote", type: "codeName" },
  { id: "sexo", label: "Sexo", group: "Detalhes do lote", type: "select", options: ["Macho", "Fêmea", "Misto"] },
  { id: "quantidade", label: "Quantidade de cabeças", group: "Detalhes do lote", type: "number" },
  { id: "peso", label: "Peso médio", group: "Detalhes do lote", type: "number" },
  { id: "categoria", label: "Categoria", group: "Detalhes do lote", type: "text" },
  { id: "status", label: "Status", group: "Detalhes do lote", type: "select", options: ["Ativo", "Inativo", "Vendido", "Abatido", "Transferido"] },
  { id: "area_codigo_nome", label: "Área Código + Nome", group: "Localização", type: "codeNameDynamic", source: "areas" },
  { id: "setor_codigo_nome", label: "Setor Código + Nome", group: "Localização", type: "codeNameDynamic", source: "setores" },
  { id: "data", label: "Data de entrada", group: "Identificação", type: "date" }
];

const DEFAULT_FIELDS = ["lote_codigo_nome", "sexo", "quantidade", "peso", "area_codigo_nome", "setor_codigo_nome"];
const DEFAULT_OPERATORS = { quantidade: "between", peso: "between", data: "between" };
const inputClass = "h-6 rounded-none border-slate-300 px-1.5 text-xs shadow-none";
const selectClass = "h-6 rounded-none border-slate-300 px-1.5 text-xs shadow-none";

export default function SankhyaFilterPanel({ open, filters, onChange, onApply, onClear, lotes = [], areas = [] }) {
  const [visibleFields, setVisibleFields] = useState(DEFAULT_FIELDS);
  const [operators, setOperators] = useState(DEFAULT_OPERATORS);
  const [configOpen, setConfigOpen] = useState(false);
  const [groupNames, setGroupNames] = useState({ "Detalhes do lote": "Detalhes do lote", Localização: "Localização", Identificação: "Identificação" });
  const [openGroups, setOpenGroups] = useState({ "Detalhes do lote": true, Localização: true, Identificação: true });

  const options = useMemo(() => {
    const uniqBy = (items, key) => Array.from(new Map(items.filter((item) => item?.[key]).map((item) => [item[key], item])).values())
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));

    return {
      areas: uniqBy([
        ...areas.map((a) => ({ codigo: a.numero_area || a.codigo || a.id, nome: a.nome, id: a.id })),
        ...lotes.map((l) => ({ codigo: l.area_atual_id || l.area_entrada_id, nome: l.area_atual_nome || l.area_entrada_nome, id: l.area_atual_id || l.area_entrada_id }))
      ], "nome"),
      setores: uniqBy(lotes.map((l) => ({ codigo: l.setor_id, nome: l.setor_nome, id: l.setor_id })), "nome"),
      lotes: uniqBy(lotes.map((l) => ({ codigo: l.numero_lote, nome: l.nome, id: l.id })), "nome")
    };
  }, [areas, lotes]);

  if (!open) return null;

  const update = (field, value) => onChange({ ...filters, [field]: value });

  const clearAll = () => {
    onClear();
    setVisibleFields(DEFAULT_FIELDS);
    setOperators(DEFAULT_OPERATORS);
  };

  const applyFilters = () => {
    onChange({ ...filters, _operators: operators });
    onApply();
  };

  const syncCodeName = (source, prefix, side, value) => {
    const normalized = String(value || "").toLowerCase();
    const found = (options[source] || []).find((item) => String(item[side] || "").toLowerCase() === normalized);
    onChange({
      ...filters,
      [`${prefix}_${side}`]: value,
      ...(found ? { [`${prefix}_${side === "codigo" ? "nome" : "codigo"}`]: found[side === "codigo" ? "nome" : "codigo"] || "" } : {})
    });
  };

  const renderNumberInput = (field, suffix) => (
    <Input inputMode="decimal" value={filters[`${field.id}_${suffix}`] || ""} onChange={(e) => update(`${field.id}_${suffix}`, e.target.value)} className={inputClass} />
  );

  const renderDateInput = (field, suffix) => (
    <Input type="date" value={filters[`${field.id}_${suffix}`] || ""} onChange={(e) => update(`${field.id}_${suffix}`, e.target.value)} className={inputClass} />
  );

  const renderOperatedField = (field, renderInput) => {
    const operator = operators[field.id] || "between";
    if (operator === "between") {
      return <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">{renderInput(field, "min")}<span className="text-slate-500">a</span>{renderInput(field, "max")}</div>;
    }
    const suffix = operator === "gt" ? "min" : operator === "lt" ? "max" : "exact";
    return renderInput(field, suffix);
  };

  const renderCodeName = (prefix, source) => (
    <div className="grid grid-cols-[82px_1fr] gap-1">
      <Input list={`${prefix}-codigos`} value={filters[`${prefix}_codigo`] || ""} onChange={(e) => syncCodeName(source, prefix, "codigo", e.target.value)} className={inputClass} placeholder="Código" />
      <Input list={`${prefix}-nomes`} value={filters[`${prefix}_nome`] || ""} onChange={(e) => syncCodeName(source, prefix, "nome", e.target.value)} className={inputClass} placeholder="Nome" />
      <datalist id={`${prefix}-codigos`}>{(options[source] || []).map((item) => <option key={`${item.id}-codigo`} value={item.codigo || ""}>{item.nome}</option>)}</datalist>
      <datalist id={`${prefix}-nomes`}>{(options[source] || []).map((item) => <option key={`${item.id}-nome`} value={item.nome || ""}>{item.codigo}</option>)}</datalist>
    </div>
  );

  const renderField = (fieldId) => {
    const field = FIELD_DEFS.find((item) => item.id === fieldId);
    if (!field) return null;

    return (
      <div key={field.id} className="border-b border-slate-200 pb-1">
        <label className="block mb-0.5 text-slate-600 truncate">{field.label}</label>
        {field.type === "codeName" && renderCodeName("lote", "lotes")}
        {field.type === "codeNameDynamic" && renderCodeName(field.id.replace("_codigo_nome", ""), field.source)}
        {field.type === "text" && <Input value={filters[field.id] || ""} onChange={(e) => update(field.id, e.target.value)} className={inputClass} />}
        {field.type === "select" &&
          <Select value={filters[field.id] || "todos"} onValueChange={(value) => update(field.id, value)}>
            <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Todos</SelectItem>{field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent>
          </Select>}
        {field.type === "number" && renderOperatedField(field, renderNumberInput)}
        {field.type === "date" && renderOperatedField(field, renderDateInput)}
      </div>
    );
  };

  const groupedFields = visibleFields.reduce((acc, fieldId) => {
    const field = FIELD_DEFS.find((item) => item.id === fieldId);
    if (!field) return acc;
    const groupLabel = groupNames[field.group] || field.group;
    acc[groupLabel] = [...(acc[groupLabel] || []), fieldId];
    return acc;
  }, {});

  return (
    <aside className="w-[310px] shrink-0 border-r border-slate-300 bg-white text-xs h-[calc(100dvh-150px)] max-h-[calc(100dvh-150px)] overflow-hidden flex flex-col">
      <div className="border-b border-slate-300 p-1 space-y-1 bg-white shrink-0">
        <div className="flex items-center gap-2 h-6">
          <Checkbox checked={!!filters.esconderAoAtualizar} onCheckedChange={(checked) => update("esconderAoAtualizar", !!checked)} className="h-3.5 w-3.5 rounded-none" />
          <span className="font-semibold text-slate-700">Esconder ao atualizar</span>
        </div>
        <div className="grid grid-cols-[88px_1fr] gap-1">
          <Button type="button" onClick={() => setConfigOpen(true)} className="h-7 rounded-none bg-green-500 hover:bg-green-600 text-white text-xs px-1"><Plus className="w-4 h-4" /> Filtro</Button>
          <Button type="button" onClick={applyFilters} className="h-7 rounded-none bg-slate-600 hover:bg-slate-700 text-white text-xs">Aplicar</Button>
        </div>
        <div className="flex items-center justify-between h-6 border-t border-slate-200 pt-1">
          <div className="flex items-center gap-2"><Checkbox checked={false} className="h-3.5 w-3.5 rounded-none" /><span className="font-semibold text-slate-700">Filtro personalizado</span></div>
          <button type="button" onClick={clearAll} className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-red-500 text-white text-[11px] font-bold">0</button>
        </div>
      </div>

      <div className="h-8 px-1.5 flex items-center justify-between border-b border-green-500 bg-slate-50 font-semibold text-slate-700 shrink-0">
        <span>Filtros rápidos</span>
        <button type="button" onClick={clearAll} className="relative"><Filter className="w-4 h-4" /><span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-slate-700 text-white text-[9px] leading-3">×</span></button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {Object.entries(groupedFields).map(([group, fields]) => (
          <div key={group} className="border-b border-slate-300">
            <button type="button" onClick={() => setOpenGroups({ ...openGroups, [group]: !openGroups[group] })} className="w-full h-8 px-2 flex items-center gap-1 bg-slate-100 font-semibold text-slate-700 text-left">
              {openGroups[group] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {group}
            </button>
            {openGroups[group] && <div className="p-1.5 space-y-1.5">{fields.map(renderField)}</div>}
          </div>
        ))}
        {["Status Documentos", "Itens", "Liberações", "Parceiros", "WMS"].map((item) =>
          <div key={item} className="h-8 px-2 flex items-center border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">{item}</div>
        )}
      </div>

      <SankhyaFilterConfigDialog open={configOpen} onOpenChange={setConfigOpen} fields={FIELD_DEFS} visibleFields={visibleFields} setVisibleFields={setVisibleFields} operators={operators} setOperators={setOperators} groupNames={groupNames} setGroupNames={setGroupNames} />
    </aside>
  );
}