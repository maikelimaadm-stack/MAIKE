import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, Plus } from "lucide-react";
import SankhyaFilterConfigDialog from "./SankhyaFilterConfigDialog";

const FIELD_DEFS = [
  { id: "numero_lote", label: "Código", type: "text" },
  { id: "nome", label: "Nome", type: "text" },
  { id: "sexo", label: "Sexo", type: "select", options: ["Macho", "Fêmea", "Misto"] },
  { id: "quantidade", label: "Quantidade de cabeças", type: "number" },
  { id: "peso", label: "Peso médio", type: "number" },
  { id: "area", label: "Área", type: "selectDynamic", source: "areas" },
  { id: "setor", label: "Setor", type: "selectDynamic", source: "setores" },
  { id: "categoria", label: "Categoria", type: "text" },
  { id: "status", label: "Status", type: "select", options: ["Ativo", "Inativo", "Vendido", "Abatido", "Transferido"] },
  { id: "data", label: "Data de entrada", type: "date" }
];

const DEFAULT_FIELDS = ["numero_lote", "nome", "sexo", "quantidade", "peso", "area", "setor"];
const DEFAULT_OPERATORS = { quantidade: "between", peso: "between", data: "between" };
const inputClass = "h-6 rounded-none border-slate-300 px-1.5 text-xs shadow-none";
const selectClass = "h-6 rounded-none border-slate-300 px-1.5 text-xs shadow-none";

export default function SankhyaFilterPanel({ open, filters, onChange, onApply, onClear, lotes = [], areas = [] }) {
  const [visibleFields, setVisibleFields] = useState(DEFAULT_FIELDS);
  const [operators, setOperators] = useState(DEFAULT_OPERATORS);
  const [configOpen, setConfigOpen] = useState(false);

  const options = useMemo(() => {
    const uniq = (values) => Array.from(new Set(values.filter(Boolean))).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
    return {
      areas: uniq([...areas.map((a) => a.nome), ...lotes.map((l) => l.area_entrada_nome || l.area_atual_nome)]),
      setores: uniq(lotes.map((l) => l.setor_nome))
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

  const renderNumberInput = (field, suffix) => (
    <Input
      inputMode="decimal"
      value={filters[`${field.id}_${suffix}`] || ""}
      onChange={(e) => update(`${field.id}_${suffix}`, e.target.value)}
      className={inputClass}
    />
  );

  const renderDateInput = (field, suffix) => (
    <Input
      type="date"
      value={filters[`${field.id}_${suffix}`] || ""}
      onChange={(e) => update(`${field.id}_${suffix}`, e.target.value)}
      className={inputClass}
    />
  );

  const renderOperatedField = (field, renderInput) => {
    const operator = operators[field.id] || "between";
    if (operator === "between") {
      return (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
          {renderInput(field, "min")}
          <span className="text-slate-500">a</span>
          {renderInput(field, "max")}
        </div>
      );
    }

    const suffix = operator === "gt" ? "min" : operator === "lt" ? "max" : "exact";
    return renderInput(field, suffix);
  };

  const renderField = (fieldId) => {
    const field = FIELD_DEFS.find((item) => item.id === fieldId);
    if (!field) return null;

    return (
      <div key={field.id} className="border-b border-slate-200 pb-1">
        <label className="block mb-0.5 text-slate-600 truncate">{field.label}</label>

        {field.type === "text" &&
          <Input value={filters[field.id] || ""} onChange={(e) => update(field.id, e.target.value)} className={inputClass} />}

        {field.type === "select" &&
          <Select value={filters[field.id] || "todos"} onValueChange={(value) => update(field.id, value)}>
            <SelectTrigger className={selectClass}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {field.options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>}

        {field.type === "selectDynamic" &&
          <Select value={filters[field.id] || "todos"} onValueChange={(value) => update(field.id, value)}>
            <SelectTrigger className={selectClass}><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(options[field.source] || []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
            </SelectContent>
          </Select>}

        {field.type === "number" && renderOperatedField(field, renderNumberInput)}
        {field.type === "date" && renderOperatedField(field, renderDateInput)}
      </div>
    );
  };

  return (
    <aside className="w-[250px] shrink-0 border-r border-slate-300 bg-white text-xs min-h-[calc(100dvh-150px)]">
      <div className="border-b border-slate-300 p-1 space-y-1 bg-white">
        <div className="flex items-center gap-2 h-6">
          <Checkbox checked={!!filters.esconderAoAtualizar} onCheckedChange={(checked) => update("esconderAoAtualizar", !!checked)} className="h-3.5 w-3.5 rounded-none" />
          <span className="font-semibold text-slate-700">Esconder ao atualizar</span>
        </div>
        <div className="grid grid-cols-[78px_1fr] gap-1">
          <Button type="button" onClick={() => setConfigOpen(true)} className="h-7 rounded-none bg-green-500 hover:bg-green-600 text-white text-xs px-1">
            <Plus className="w-4 h-4" /> Filtro
          </Button>
          <Button type="button" onClick={applyFilters} className="h-7 rounded-none bg-slate-600 hover:bg-slate-700 text-white text-xs">
            Aplicar
          </Button>
        </div>
        <div className="flex items-center justify-between h-6 border-t border-slate-200 pt-1">
          <div className="flex items-center gap-2">
            <Checkbox checked={false} className="h-3.5 w-3.5 rounded-none" />
            <span className="font-semibold text-slate-700">Filtro personalizado</span>
          </div>
          <button type="button" onClick={clearAll} className="inline-flex items-center justify-center h-5 min-w-5 px-1 rounded bg-red-500 text-white text-[11px] font-bold">0</button>
        </div>
      </div>

      <div className="h-8 px-1.5 flex items-center justify-between border-b border-green-500 bg-slate-50 font-semibold text-slate-700">
        <span>Filtros rápidos</span>
        <div className="flex items-center gap-2 text-slate-700">
          <Filter className="w-3.5 h-3.5" />
          <button type="button" onClick={clearAll} className="relative">
            <Filter className="w-4 h-4" />
            <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-slate-700 text-white text-[9px] leading-3">×</span>
          </button>
        </div>
      </div>

      <div className="max-h-[calc(100dvh-270px)] overflow-auto p-1.5 space-y-1.5">
        {visibleFields.map(renderField)}
      </div>

      <div className="border-t border-slate-300 bg-slate-50">
        {["Status Documentos", "Itens", "Liberações", "Parceiros", "WMS"].map((item) =>
          <div key={item} className="h-8 px-2 flex items-center border-b border-slate-200 font-semibold text-slate-700">
            {item}
          </div>
        )}
      </div>

      <SankhyaFilterConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        fields={FIELD_DEFS}
        visibleFields={visibleFields}
        setVisibleFields={setVisibleFields}
        operators={operators}
        setOperators={setOperators}
      />
    </aside>
  );
}