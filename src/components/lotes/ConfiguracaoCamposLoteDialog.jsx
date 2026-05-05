import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import loteRepository from "@/core/repositories/loteRepository";
import GuidedRelationConfig from "./GuidedRelationConfig";
import VisualCalculationBuilder from "./VisualCalculationBuilder";
import DecimalConfig from "./DecimalConfig";
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
      field_name: toSnakeCase(form.label),
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
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const fieldName = toSnakeCase(form.label);
    if (!form.label.trim() || !fieldName) return toast.error("Informe o nome do campo.");
    if (form.tipo === "calculado" && hasInvalidCalculation) return toast.error("Complete o cálculo com campos diferentes.");
    if (form.tipo === "relation" && !form.relation_entity) return toast.error("Selecione o cadastro relacionado.");
    if (form.tipo === "select" && !form.options_source_entity) return toast.error("Selecione a lista do sistema.");
    saveMutation.mutate();
  };

  const updateForm = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value, ...(field === "label" ? { field_name: toSnakeCase(value) } : {}) };
      if (field === "tipo") {
        next.agregacao_tipo = "none";
        next.usar_decimal = ["number", "calculado"].includes(value);
        next.read_only = value === "calculado";
      }
      return next;
    });
  };

  const handleEdit = (campo) => {
    const items = campo.calculation_builder?.items || (campo.campos_dependentes || campo.dependencias || []).map((field, index) => ({ field, operator: index === 0 ? "*" : "*" }));
    setEditingId(campo.id);
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

        <form onSubmit={handleSubmit} className="border rounded-lg p-3 bg-slate-50 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Field label="Nome do campo" className="md:col-span-2"><Input value={form.label} onChange={(e) => updateForm("label", e.target.value)} placeholder="EX: PESO TOTAL" className="h-8 text-xs uppercase" /></Field>
            <Field label="Tipo"><Select value={form.tipo} onValueChange={(value) => updateForm("tipo", value)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{TIPOS_CAMPO.map((tipo) => <SelectItem key={tipo.value} value={tipo.value} className="text-xs">{tipo.label}</SelectItem>)}</SelectContent></Select></Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Field label="Texto de ajuda"><Input value={form.placeholder} onChange={(e) => updateForm("placeholder", e.target.value)} placeholder="TEXTO MOSTRADO NO CAMPO" className="h-8 text-xs uppercase" /></Field>
            <Field label="Descrição" className="md:col-span-2"><Input value={form.descricao} onChange={(e) => updateForm("descricao", e.target.value)} placeholder="EXPLICAÇÃO OPCIONAL" className="h-8 text-xs uppercase" /></Field>
          </div>

          {form.tipo === "select" && <GuidedRelationConfig form={form} updateForm={updateForm} mode="select" />}
          {form.tipo === "relation" && <GuidedRelationConfig form={form} updateForm={updateForm} mode="relation" />}
          {form.tipo === "calculado" && <VisualCalculationBuilder value={form.calculation_builder?.items || []} fields={camposCalculo} onChange={(items) => updateForm("calculation_builder", { items })} />}
          <DecimalConfig form={form} updateForm={updateForm} />

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Field label="Totalizar na tabela">
              <Select value={form.agregacao_tipo} onValueChange={(value) => updateForm("agregacao_tipo", value)} disabled={agregacoesPermitidas.length === 0}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Não totalizar</SelectItem>
                  {agregacoesPermitidas.map((item) => <SelectItem key={item.value} value={item.value} className="text-xs">{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="md:col-span-3 border rounded-md bg-white px-3 py-2 text-xs text-slate-600">
              <div className="font-semibold mb-1">Prévia</div>
              <div className="border rounded bg-slate-50 px-2 py-1 uppercase">{form.label || "Nome do campo"}: {form.tipo === "calculado" ? montarFormulaVisual(form.calculation_builder?.items || []) || "Calculado automaticamente" : form.placeholder || "Valor do campo"}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
            {[["obrigatorio", "Obrigatório"], ["visivel_form", "Formulário"], ["visivel_tabela", "Tabela"], ["visivel_relatorio", "Relatório"]].map(([field, label]) => (
              <label key={field} className="h-8 px-2 border rounded-md bg-white flex items-center justify-between gap-2 text-xs text-slate-700">
                {label}<Switch checked={!!form[field]} onCheckedChange={(checked) => updateForm(field, checked)} className="scale-75" />
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            {editingId && <Button type="button" variant="outline" size="sm" onClick={resetForm} className="h-7 text-xs"><X className="w-3.5 h-3.5" /> Cancelar edição</Button>}
            <Button type="submit" size="sm" disabled={saveMutation.isPending || hasInvalidCalculation} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-3.5 h-3.5" /> {editingId ? "Atualizar Campo" : "Criar Campo"}
            </Button>
          </div>
        </form>

        <div className="flex-1 overflow-auto border rounded-lg">
          <div className="grid grid-cols-[1fr_120px_240px_85px] gap-2 px-3 py-2 bg-slate-100 border-b text-xs font-semibold text-slate-700">
            <span>Campo</span><span>Tipo</span><span>Uso</span><span>Ações</span>
          </div>
          {isLoading ? <div className="p-4 text-xs text-slate-500">Carregando...</div> : campos.length === 0 ? <div className="p-4 text-xs text-slate-400 text-center">Nenhum campo criado.</div> : campos.map((campo) => (
            <div key={campo.id || campo.field_id} className="grid grid-cols-[1fr_120px_240px_85px] gap-2 px-3 py-2 border-b text-xs items-center">
              <span className="font-medium text-slate-800">{campo.label}</span>
              <span>{TIPOS_CAMPO.find((tipo) => tipo.value === campo.tipo)?.label || campo.tipo}</span>
              <div className="flex flex-wrap gap-1">
                {campo.visivel_form && <Badge variant="outline" className="text-[10px]">Form</Badge>}
                {campo.visivel_tabela && <Badge variant="outline" className="text-[10px]">Tabela</Badge>}
                {(campo.options_source_entity || campo.relation_entity) && <Badge variant="secondary" className="text-[10px]">Vínculo</Badge>}
                {(campo.agregacao_tipo || campo.agregacao) && <Badge variant="secondary" className="text-[10px]">Total</Badge>}
                {campo.usar_decimal && <Badge variant="secondary" className="text-[10px]">{campo.decimal_places ?? 2} dec.</Badge>}
              </div>
              <div className="flex justify-end gap-1">
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(campo)}><Pencil className="w-3.5 h-3.5" /></Button>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => handleDelete(campo)}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className = "" }) {
  return <div className={`space-y-1 ${className}`}><label className="text-xs uppercase text-slate-600">{label}</label>{children}</div>;
}