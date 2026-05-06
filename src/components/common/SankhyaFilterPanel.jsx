import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, Plus, ChevronDown, ChevronRight } from "lucide-react";
import SankhyaFilterConfigDialog from "./SankhyaFilterConfigDialog";
import SankhyaCodeNameLookup from "./SankhyaCodeNameLookup";

const FIELD_DEFS = [
  { id: "lote_codigo_nome", label: "Lote", group: "Detalhes do lote", type: "codeName" },
  { id: "sexo", label: "Sexo", group: "Detalhes do lote", type: "select", options: ["Macho", "Fêmea", "Misto"] },
  { id: "quantidade", label: "Quantidade de cabeças", group: "Detalhes do lote", type: "number" },
  { id: "peso", label: "Peso médio", group: "Detalhes do lote", type: "number" },
  { id: "categoria", label: "Categoria", group: "Detalhes do lote", type: "text" },
  { id: "status", label: "Status", group: "Detalhes do lote", type: "select", options: ["Ativo", "Inativo", "Vendido", "Abatido", "Transferido"] },
  { id: "area_codigo_nome", label: "Área", group: "Localização", type: "codeNameDynamic", source: "areas" },
  { id: "setor_codigo_nome", label: "Setor", group: "Localização", type: "codeNameDynamic", source: "setores" },
  { id: "data", label: "Data de entrada", group: "Identificação", type: "date" }
];

const DEFAULT_FIELDS = ["lote_codigo_nome", "sexo", "quantidade", "peso", "area_codigo_nome", "setor_codigo_nome"];
const DEFAULT_OPERATORS = { quantidade: "between", peso: "between", data: "between" };
const DEFAULT_FOLDERS = [
  { id: "detalhes_lote", name: "Detalhes do lote" },
  { id: "localizacao", name: "Localização" },
  { id: "identificacao", name: "Identificação" }
];
const DEFAULT_FIELD_GROUPS = FIELD_DEFS.reduce((acc, field) => {
  const folder = DEFAULT_FOLDERS.find((item) => item.name === field.group);
  acc[field.id] = folder?.id || DEFAULT_FOLDERS[0].id;
  return acc;
}, {});
const inputClass = "h-6 rounded-none border-slate-300 px-1.5 text-xs shadow-none";
const selectClass = "h-6 rounded-none border-slate-300 px-1.5 text-xs shadow-none";

export default function SankhyaFilterPanel({ open, filters, onChange, onApply, onClear, lotes = [], areas = [] }) {
  const [visibleFields, setVisibleFields] = useState(DEFAULT_FIELDS);
  const [operators, setOperators] = useState(DEFAULT_OPERATORS);
  const [configOpen, setConfigOpen] = useState(false);
  const [filterFolders, setFilterFolders] = useState(DEFAULT_FOLDERS);
  const [fieldGroups, setFieldGroups] = useState(DEFAULT_FIELD_GROUPS);
  const [openGroups, setOpenGroups] = useState({ detalhes_lote: true, localizacao: true, identificacao: true });

  const options = useMemo(() => {
    const uniqBy = (items, key) => Array.from(new Map(items.filter((item) => item?.[key]).map((item) => [item[key], item])).values())
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));

    return {
      areas: uniqBy([
        ...areas.map((a) => ({
          codigo: a.numero_area || a.codigo || a.cod_area || "",
          nome: a.nome,
          id: a.id,
          details: [a.setor_nome && `Setor: ${a.setor_nome}`, a.tipo_area && `Tipo: ${a.tipo_area}`, a.status && `Status: ${a.status}`]
        })),
        ...lotes.map((l) => ({
          codigo: l.area_atual_codigo || l.area_entrada_codigo || "",
          nome: l.area_atual_nome || l.area_entrada_nome,
          id: l.area_atual_id || l.area_entrada_id,
          details: [l.setor_nome && `Setor: ${l.setor_nome}`, l.nome && `Lote vinculado: ${l.nome}`]
        }))
      ], "nome"),
      setores: uniqBy(lotes.map((l) => ({
        codigo: l.setor_codigo || l.numero_setor || "",
        nome: l.setor_nome,
        id: l.setor_id,
        details: [l.area_atual_nome && `Área: ${l.area_atual_nome}`, l.nome && `Lote: ${l.nome}`]
      })), "nome"),
      lotes: uniqBy(lotes.map((l) => ({
        codigo: l.numero_lote,
        nome: l.nome,
        id: l.id,
        details: [l.categoria && `Categoria: ${l.categoria}`, l.area_atual_nome && `Área atual: ${l.area_atual_nome}`, l.status && `Status: ${l.status}`]
      })), "nome")
    };
  }, [areas, lotes]);

  if (!open) return null;

  const update = (field, value) => onChange({ ...filters, [field]: value });

  const clearAll = () => {
    onClear();
  };

  const applyFilters = () => {
    onChange({ ...filters, _operators: operators });
    onApply();
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

  const renderCodeName = (prefix, source, label) => (
    <SankhyaCodeNameLookup
      label={label}
      prefix={prefix}
      source={options[source] || []}
      filters={filters}
      onChange={onChange}
    />
  );

  const renderField = (fieldId) => {
    const field = FIELD_DEFS.find((item) => item.id === fieldId);
    if (!field) return null;

    return (
      <div key={field.id} className="border-b border-slate-200 pb-1">
        <label className="block mb-0.5 text-slate-600 truncate">{field.label}</label>
        {field.type === "codeName" && renderCodeName("lote", "lotes", "Lote")}
        {field.type === "codeNameDynamic" && renderCodeName(field.id.replace("_codigo_nome", ""), field.source, field.label)}
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

  const groupedFolders = filterFolders.map((folder) => ({
    ...folder,
    fields: visibleFields.filter((fieldId) => (fieldGroups[fieldId] || DEFAULT_FOLDERS[0].id) === folder.id)
  })).filter((folder) => folder.fields.length > 0);

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
        {groupedFolders.map((folder) => (
          <div key={folder.id} className="border-b border-slate-300">
            <button type="button" onClick={() => setOpenGroups({ ...openGroups, [folder.id]: !openGroups[folder.id] })} className="w-full h-8 px-2 flex items-center gap-1 bg-slate-100 font-semibold text-slate-700 text-left">
              {openGroups[folder.id] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {folder.name}
            </button>
            {openGroups[folder.id] && <div className="p-1.5 space-y-1.5">{folder.fields.map(renderField)}</div>}
          </div>
        ))}

      </div>

      <SankhyaFilterConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        fields={FIELD_DEFS}
        visibleFields={visibleFields}
        setVisibleFields={setVisibleFields}
        operators={operators}
        setOperators={setOperators}
        filterFolders={filterFolders}
        setFilterFolders={setFilterFolders}
        fieldGroups={fieldGroups}
        setFieldGroups={setFieldGroups}
        setOpenGroups={setOpenGroups}
      />
    </aside>
  );
}