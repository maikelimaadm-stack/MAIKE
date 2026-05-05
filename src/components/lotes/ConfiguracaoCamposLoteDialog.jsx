import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import loteRepository from "@/core/repositories/loteRepository";
import GuidedRelationConfig from "./GuidedRelationConfig";
import VisualCalculationBuilder from "./VisualCalculationBuilder";
import DecimalConfig from "./DecimalConfig";
import LegacyRecordToolbar from "./LegacyRecordToolbar.jsx";
import { AGREGACOES_POR_TIPO, montarCamposDisponiveis, montarFormulaVisual } from "./camposConfigOptions";

const TIPOS_CAMPO = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "select", label: "Lista de seleção" },
  { value: "relation", label: "Relação com cadastro" },
  { value: "calculado", label: "Calculado" },
  { value: "textarea", label: "Observação" }
];

const toSnakeCase = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();

const initialForm = {
  label: "",
  field_name: "",
  placeholder: "",
  descricao: "",
  tipo: "text",
  col_span: 12,
  largura_coluna: 160,
  ordem_tabela: 999,
  obrigatorio: false,
  read_only: false,
  visivel_form: true,
  visivel_tabela: true,
  visivel_relatorio: true,
  ordenavel: true,
  filtravel: true,
  alinhamento: "left",
  agregacao_tipo: "none",
  agregacao_campo_base: "",
  options_source_entity: "",
  options_label_field: "nome",
  options_value_field: "id",
  relation_entity: "",
  relation_display_field: "nome",
  formula: "",
  calculation_builder: { items: [{ field: "", operator: "*" }, { field: "", operator: "*" }] },
  campos_dependentes: [],
  usar_decimal: false,
  decimal_places: 2
};

export default function ConfiguracaoCamposLoteDialog({ open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const { data: campos = [], isLoading } = useQuery({
    queryKey: ["lote-campos-personalizados"],
    queryFn: () => loteRepository.listCamposPersonalizados(),
    enabled: open,
    initialData: []
  });

  const camposCalculo = useMemo(() => montarCamposDisponiveis(campos, editingId), [campos, editingId]);
  const agregacoesPermitidas = AGREGACOES_POR_TIPO[form.tipo] || [];
  const calculationItems = form.calculation_builder?.items || [];
  const calculationFields = calculationItems.map((item) => item.field).filter(Boolean);
  const hasInvalidCalculation = form.tipo === "calculado" && (calculationItems.length < 2 || calculationItems.some((item) => !item.field) || new Set(calculationFields).size !== calculationFields.length);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      return editingId ? loteRepository.updateCampoPersonalizado(editingId, payload) : loteRepository.createCampoPersonalizado(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lote-campos-personalizados"] });
      resetForm();
      toast.success(editingId ? "Campo atualizado." : "Campo criado.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (campo) => loteRepository.deleteCampoPersonalizado(campo),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lote-campos-personalizados"] });
      toast.success("Campo excluído.");
    },
    onError: (error) => toast.error(error.message || "Não foi possível excluir o campo.")
  });

  const buildPayload = () => {
    const calculationItems = form.calculation_builder?.items || [];
    const formula = form.tipo === "calculado" ? montarFormulaVisual(calculationItems) : "";
    const deps = calculationItems.map((item) => item.field).filter(Boolean);

    return {
      ...form,
      field_name: editingId ? form.field_name : toSnakeCase(form.label),
      col_span: 12,
      largura_coluna: 160,
      ordem_tabela: 999,
      read_only: form.tipo === "calculado",
      ordenavel: true,
      filtravel: !["textarea"].includes(form.tipo),
      alinhamento: ["number", "calculado"].includes(form.tipo) ? "right" : "left",
      options: [],
      options_source: form.options_source_entity || "",
      agregacao_tipo: form.agregacao_tipo === "none" ? undefined : form.agregacao_tipo,
      agregacao_campo_base: "",
      formula,
      calculation_builder: { items: calculationItems },
      campos_dependentes: deps,
      dependencias: deps,
      decimal_places: Math.min(6, Math.max(0, Number(form.decimal_places) || 0)),
      usar_decimal: !!form.usar_decimal
    };
  };

  const resetForm = () => {
    setForm(initialForm);
    setEditingId(null);
    setShowForm(false);
  };

  const handleNew = () => {
    setForm(initialForm);
    setEditingId(null);
    setShowForm(true);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const fieldName = editingId ? form.field_name : toSnakeCase(form.label);
    if (!form.label.trim() || !fieldName) return toast.error("Informe o nome do campo.");
    if (form.tipo === "calculado" && hasInvalidCalculation) return toast.error("Complete o cálculo com campos diferentes.");
    if (form.tipo === "relation" && !form.relation_entity) return toast.error("Selecione o cadastro relacionado.");
    if (form.tipo === "select" && !form.options_source_entity) return toast.error("Selecione a lista do sistema.");
    saveMutation.mutate();
  };

  const updateForm = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value, ...(field === "label" && !editingId ? { field_name: toSnakeCase(value) } : {}) };
      if (field === "tipo") {
        next.agregacao_tipo = "none";
        next.usar_decimal = ["number", "calculado"].includes(value);
        next.read_only = value === "calculado";
        if (value !== "select") {
          next.options_source_entity = "";
          next.options_label_field = "nome";
          next.options_value_field = "id";
        }
        if (value !== "relation") {
          next.relation_entity = "";
          next.relation_display_field = "nome";
        }
        if (value !== "calculado") {
          next.calculation_builder = initialForm.calculation_builder;
          next.formula = "";
          next.campos_dependentes = [];
        }
      }
      return next;
    });
  };

  const handleEdit = (campo) => {
    const items = campo.calculation_builder?.items || (campo.campos_dependentes || campo.dependencias || []).map((field, index) => ({ field, operator: index === 0 ? "*" : "*" }));
    setEditingId(campo.id);
    setShowForm(true);
    setForm({
      ...initialForm,
      ...campo,
      agregacao_tipo: campo.agregacao_tipo || campo.agregacao || "none",
      calculation_builder: { items: items.length ? items : initialForm.calculation_builder.items },
      usar_decimal: !!campo.usar_decimal,
      decimal_places: campo.decimal_places ?? 2
    });
  };

  const handleDelete = (campo) => {
    if (!window.confirm(`Excluir o campo "${campo.label}"? Esta ação não poderá ser desfeita.`)) return;
    deleteMutation.mutate(campo);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Configuração Guiada de Campos</DialogTitle>
        </DialogHeader>

        {showForm ? (
          <form onSubmit={handleSubmit} className="border border-slate-300 bg-white min-h-[520px]">
            <LegacyRecordToolbar
              title={form.label || (editingId ? "Editar campo" : "Novo campo")}
              statusLabel={editingId ? "Editando campo" : "Inserindo campo"}
              onCancel={resetForm}
              onSettingsClick={() => {}}
            />

            <div className="px-4 md:px-8 py-3 space-y-1 max-w-[780px]">
              <Field label="Nome do campo" required><Input value={form.label} onChange={(e) => updateForm("label", e.target.value)} placeholder="EX: PESO TOTAL" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" /></Field>
              <Field label="Tipo"><Select value={form.tipo} onValueChange={(value) => updateForm("tipo", value)}><SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue /></SelectTrigger><SelectContent>{TIPOS_CAMPO.map((tipo) => <SelectItem key={tipo.value} value={tipo.value} className="text-xs uppercase">{tipo.label}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Texto de ajuda"><Input value={form.placeholder} onChange={(e) => updateForm("placeholder", e.target.value)} placeholder="TEXTO MOSTRADO NO CAMPO" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" /></Field>
              <Field label="Descrição"><Input value={form.descricao} onChange={(e) => updateForm("descricao", e.target.value)} placeholder="EXPLICAÇÃO OPCIONAL" className="h-[22px] text-xs uppercase border-0 rounded-none shadow-none focus-visible:ring-0 bg-transparent px-1" /></Field>
            </div>

            {form.tipo === "select" && <GuidedRelationConfig form={form} updateForm={updateForm} mode="select" />}
            {form.tipo === "relation" && <GuidedRelationConfig form={form} updateForm={updateForm} mode="relation" />}
            {form.tipo === "calculado" && <VisualCalculationBuilder value={form.calculation_builder?.items || []} fields={camposCalculo} onChange={(items) => updateForm("calculation_builder", { items })} />}
            <DecimalConfig form={form} updateForm={updateForm} />

            <div className="px-4 md:px-8 pb-3 space-y-1 max-w-[780px]">
              <Field label="Totalizar na tabela">
                <Select value={form.agregacao_tipo} onValueChange={(value) => updateForm("agregacao_tipo", value)} disabled={agregacoesPermitidas.length === 0}>
                  <SelectTrigger className="h-[22px] text-xs border-0 rounded-none shadow-none focus:ring-0 bg-transparent px-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">Não totalizar</SelectItem>
                    {agregacoesPermitidas.map((item) => <SelectItem key={item.value} value={item.value} className="text-xs">{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Prévia" wide>
                <div className="px-2 py-1 text-xs text-slate-700 uppercase bg-slate-50 min-h-[48px]">
                  {form.label || "Nome do campo"}: {form.tipo === "calculado" ? montarFormulaVisual(form.calculation_builder?.items || []) || "Calculado automaticamente" : form.placeholder || "Valor do campo"}
                </div>
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1 pt-1">
                {[["obrigatorio", "Obrigatório"], ["visivel_form", "Formulário"], ["visivel_tabela", "Tabela"], ["visivel_relatorio", "Relatório"]].map(([field, label]) => (
                  <Field key={field} label={label}>
                    <div className="h-[22px] flex items-center justify-between px-1 text-xs text-slate-700">
                      <span>{form[field] ? "Sim" : "Não"}</span><Switch checked={!!form[field]} onCheckedChange={(checked) => updateForm(field, checked)} className="scale-75" />
                    </div>
                  </Field>
                ))}
              </div>
            </div>
          </form>
        ) : (
          <div className="flex-1 overflow-hidden border border-slate-300 bg-white flex flex-col">
            <div className="flex items-center justify-between p-2 bg-slate-50 border-b border-slate-200">
              <div className="text-xs text-slate-600">{campos.length} campos configurados</div>
              <Button onClick={handleNew} size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="w-3.5 h-3.5" />Adicionar</Button>
            </div>
            <div className="overflow-auto">
              <Table className="border-collapse table-fixed w-full">
                <TableHeader>
                  <TableRow className="bg-blue-600 hover:bg-blue-600">
                    <TableHead className="px-2 py-1 text-white text-xs font-bold border-r border-blue-500">Campo</TableHead>
                    <TableHead className="px-2 py-1 text-white text-xs font-bold border-r border-blue-500 w-[150px]">Tipo</TableHead>
                    <TableHead className="px-2 py-1 text-white text-xs font-bold border-r border-blue-500 w-[260px]">Uso</TableHead>
                    <TableHead className="px-2 py-1 text-white text-xs font-bold w-[90px] text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Carregando...</TableCell></TableRow>
                  ) : campos.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhum campo criado.</TableCell></TableRow>
                  ) : campos.map((campo) => (
                    <TableRow key={campo.id || campo.field_id} className="border-b hover:bg-gray-100" onDoubleClick={() => handleEdit(campo)}>
                      <TableCell className="px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 font-medium">{campo.label}</TableCell>
                      <TableCell className="px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300">{TIPOS_CAMPO.find((tipo) => tipo.value === campo.tipo)?.label || campo.tipo}</TableCell>
                      <TableCell className="px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300">
                        <div className="flex flex-wrap gap-1">
                          {campo.visivel_form && <Badge variant="outline" className="text-[10px]">Form</Badge>}
                          {campo.visivel_tabela && <Badge variant="outline" className="text-[10px]">Tabela</Badge>}
                          {(campo.options_source_entity || campo.relation_entity) && <Badge variant="secondary" className="text-[10px]">Vínculo</Badge>}
                          {(campo.agregacao_tipo || campo.agregacao) && <Badge variant="secondary" className="text-[10px]">Total</Badge>}
                          {campo.usar_decimal && <Badge variant="secondary" className="text-[10px]">{campo.decimal_places ?? 2} dec.</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-1 text-center align-middle border-r border-b border-gray-300">
                        <div className="flex justify-center gap-1">
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(campo)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => handleDelete(campo)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className = "", required = false, wide = false }) {
  return (
    <div className={`grid grid-cols-[190px_minmax(0,1fr)] items-center gap-1 ${wide ? "md:col-span-2" : ""} ${className}`}>
      <label className="text-[12px] text-slate-600 text-right leading-none">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className={`${wide ? "min-h-6" : "h-6"} border border-slate-300 bg-white focus-within:border-green-500 transition-colors [&_input]:h-[22px] [&_button]:h-[22px] [&_textarea]:min-h-[48px] [&_textarea]:rounded-none [&_textarea]:border-0 [&_textarea]:shadow-none [&_textarea]:focus-visible:ring-0`}>
        {children}
      </div>
    </div>
  );
}