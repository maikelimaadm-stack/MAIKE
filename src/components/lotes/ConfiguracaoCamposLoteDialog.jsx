import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import loteRepository from "@/core/repositories/loteRepository";

const TIPOS_CAMPO = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "select", label: "Select Manual/Dinâmico" },
  { value: "relation", label: "Relação ERP" },
  { value: "calculado", label: "Calculado" },
  { value: "textarea", label: "Observação" }
];

const toSnakeCase = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "")
  .toLowerCase();

const parseOptions = (text) => String(text || "")
  .split("\n")
  .map((item) => item.trim())
  .filter(Boolean)
  .map((item) => ({ label: item.toUpperCase(), value: item }));

const optionsToText = (options = []) => options.map((item) => item.label || item.value).join("\n");

const initialForm = {
  label: "",
  field_name: "",
  placeholder: "",
  descricao: "",
  tipo: "text",
  col_span: 6,
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
  options_text: "",
  options_source_entity: "",
  options_label_field: "nome",
  options_value_field: "id",
  relation_entity: "",
  relation_display_field: "nome",
  formula: "",
  campos_dependentes_text: ""
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

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = buildPayload();
      return editingId ? loteRepository.updateCampoPersonalizado(editingId, payload) : loteRepository.createCampoPersonalizado(payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lote-campos-personalizados"] });
      resetForm();
      toast.success(editingId ? "Campo atualizado." : "Campo criado no LayoutCampo.");
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

  const buildPayload = () => ({
    ...form,
    field_name: toSnakeCase(form.field_name || form.label),
    options: form.tipo === "select" && !form.options_source_entity ? parseOptions(form.options_text) : [],
    agregacao_tipo: form.agregacao_tipo === "none" ? undefined : form.agregacao_tipo,
    campos_dependentes: String(form.campos_dependentes_text || "").split(",").map((item) => toSnakeCase(item)).filter(Boolean),
    dependencias: String(form.campos_dependentes_text || "").split(",").map((item) => toSnakeCase(item)).filter(Boolean)
  });

  const resetForm = () => {
    setForm(initialForm);
    setEditingId(null);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    const fieldName = toSnakeCase(form.field_name || form.label);
    if (!form.label.trim() || !fieldName) return toast.error("Informe o nome do campo.");
    if (form.tipo === "calculado" && !form.formula.trim()) return toast.error("Informe a fórmula do campo calculado.");
    if (form.tipo === "relation" && !form.relation_entity.trim()) return toast.error("Informe a entidade relacionada.");
    saveMutation.mutate();
  };

  const updateForm = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "label" && !prev.field_name ? { field_name: toSnakeCase(value) } : {})
    }));
  };

  const handleEdit = (campo) => {
    setEditingId(campo.id);
    setForm({
      ...initialForm,
      ...campo,
      agregacao_tipo: campo.agregacao_tipo || campo.agregacao || "none",
      options_text: optionsToText(campo.options || []),
      campos_dependentes_text: (campo.campos_dependentes || campo.dependencias || []).join(", ")
    });
  };

  const handleDelete = (campo) => {
    if (!window.confirm(`Excluir o campo "${campo.label}"? Esta ação não poderá ser desfeita.`)) return;
    deleteMutation.mutate(campo);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Campos Dinâmicos do Lote - ERP</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="border rounded-lg p-3 bg-slate-50 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <Field label="Label" className="md:col-span-2"><Input value={form.label} onChange={(e) => updateForm("label", e.target.value)} placeholder="EX: ESCORE CORPORAL" className="h-8 text-xs uppercase" /></Field>
            <Field label="Chave"><Input value={form.field_name} onChange={(e) => updateForm("field_name", toSnakeCase(e.target.value))} placeholder="escore_corporal" className="h-8 text-xs" disabled={!!editingId} /></Field>
            <Field label="Tipo"><Select value={form.tipo} onValueChange={(value) => updateForm("tipo", value)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{TIPOS_CAMPO.map((tipo) => <SelectItem key={tipo.value} value={tipo.value} className="text-xs">{tipo.label}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Col. Form"><Input type="number" min="1" max="12" value={form.col_span} onChange={(e) => updateForm("col_span", Number(e.target.value) || 6)} className="h-8 text-xs" /></Field>
            <Field label="Larg. Tabela"><Input type="number" min="80" value={form.largura_coluna} onChange={(e) => updateForm("largura_coluna", Number(e.target.value) || 160)} className="h-8 text-xs" /></Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <Field label="Placeholder"><Input value={form.placeholder} onChange={(e) => updateForm("placeholder", e.target.value)} placeholder="TEXTO DE AJUDA" className="h-8 text-xs uppercase" /></Field>
            <Field label="Descrição" className="md:col-span-2"><Input value={form.descricao} onChange={(e) => updateForm("descricao", e.target.value)} placeholder="DESCRIÇÃO DO CAMPO" className="h-8 text-xs uppercase" /></Field>
            <Field label="Ordem Tabela"><Input type="number" value={form.ordem_tabela} onChange={(e) => updateForm("ordem_tabela", Number(e.target.value) || 999)} className="h-8 text-xs" /></Field>
            <Field label="Alinhamento"><Select value={form.alinhamento} onValueChange={(value) => updateForm("alinhamento", value)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="left" className="text-xs">Esquerda</SelectItem><SelectItem value="center" className="text-xs">Centro</SelectItem><SelectItem value="right" className="text-xs">Direita</SelectItem></SelectContent></Select></Field>
          </div>

          {form.tipo === "select" && <AdvancedSelectConfig form={form} updateForm={updateForm} />}
          {form.tipo === "relation" && <RelationConfig form={form} updateForm={updateForm} />}
          {form.tipo === "calculado" && <FormulaConfig form={form} updateForm={updateForm} />}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Field label="Agregação"><Select value={form.agregacao_tipo} onValueChange={(value) => updateForm("agregacao_tipo", value)}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none" className="text-xs">Nenhuma</SelectItem><SelectItem value="sum" className="text-xs">Soma</SelectItem><SelectItem value="avg" className="text-xs">Média</SelectItem><SelectItem value="min" className="text-xs">Mínimo</SelectItem><SelectItem value="max" className="text-xs">Máximo</SelectItem></SelectContent></Select></Field>
            <Field label="Campo Base"><Input value={form.agregacao_campo_base} onChange={(e) => updateForm("agregacao_campo_base", toSnakeCase(e.target.value))} placeholder="opcional" className="h-8 text-xs" /></Field>
            <div className="md:col-span-2 border rounded-md bg-white px-3 py-2 text-xs text-slate-600">
              <div className="font-semibold mb-1">Preview</div>
              <div className="border rounded bg-slate-50 px-2 py-1 uppercase">{form.label || "Nome do campo"}: {form.tipo === "calculado" ? "Calculado automaticamente" : form.placeholder || "Valor do campo"}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end">
            {[["obrigatorio", "Obrigatório"], ["read_only", "Bloqueado"], ["visivel_form", "Formulário"], ["visivel_tabela", "Tabela"], ["visivel_relatorio", "Relatório"], ["ordenavel", "Ordenável"], ["filtravel", "Filtrável"]].map(([field, label]) => (
              <label key={field} className="h-8 px-2 border rounded-md bg-white flex items-center justify-between gap-2 text-xs text-slate-700">
                {label}<Switch checked={!!form[field]} onCheckedChange={(checked) => updateForm(field, checked)} className="scale-75" />
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            {editingId && <Button type="button" variant="outline" size="sm" onClick={resetForm} className="h-7 text-xs"><X className="w-3.5 h-3.5" /> Cancelar edição</Button>}
            <Button type="submit" size="sm" disabled={saveMutation.isPending} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-3.5 h-3.5" /> {editingId ? "Atualizar Campo" : "Criar Campo"}
            </Button>
          </div>
        </form>

        <div className="flex-1 overflow-auto border rounded-lg">
          <div className="grid grid-cols-[1fr_130px_95px_260px_85px] gap-2 px-3 py-2 bg-slate-100 border-b text-xs font-semibold text-slate-700">
            <span>Campo</span><span>Chave</span><span>Tipo</span><span>Uso</span><span>Ações</span>
          </div>
          {isLoading ? <div className="p-4 text-xs text-slate-500">Carregando...</div> : campos.length === 0 ? <div className="p-4 text-xs text-slate-400 text-center">Nenhum campo criado.</div> : campos.map((campo) => (
            <div key={campo.id || campo.field_id} className="grid grid-cols-[1fr_130px_95px_260px_85px] gap-2 px-3 py-2 border-b text-xs items-center">
              <span className="font-medium text-slate-800">{campo.label}</span>
              <span className="font-mono text-slate-500 truncate">{campo.field_name}</span>
              <span>{campo.tipo}</span>
              <div className="flex flex-wrap gap-1">
                {campo.visivel_form && <Badge variant="outline" className="text-[10px]">Form</Badge>}
                {campo.visivel_tabela && <Badge variant="outline" className="text-[10px]">Tabela</Badge>}
                {campo.visivel_relatorio && <Badge variant="outline" className="text-[10px]">Rel.</Badge>}
                {(campo.options_source_entity || campo.relation_entity) && <Badge variant="secondary" className="text-[10px]">Relacional</Badge>}
                {(campo.agregacao_tipo || campo.agregacao) && <Badge variant="secondary" className="text-[10px]">Agreg.</Badge>}
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

function AdvancedSelectConfig({ form, updateForm }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-2 p-2 border rounded-lg bg-white">
      <Field label="Opções manuais" className="md:col-span-2"><Textarea value={form.options_text} onChange={(e) => updateForm("options_text", e.target.value)} placeholder={"OPÇÃO 1\nOPÇÃO 2\nOPÇÃO 3"} className="text-xs uppercase min-h-20" /></Field>
      <Field label="Entidade dinâmica"><Input value={form.options_source_entity} onChange={(e) => updateForm("options_source_entity", e.target.value)} placeholder="EX: Fornecedor" className="h-8 text-xs" /></Field>
      <Field label="Campo Label"><Input value={form.options_label_field} onChange={(e) => updateForm("options_label_field", e.target.value)} placeholder="nome" className="h-8 text-xs" /></Field>
      <Field label="Campo Valor"><Input value={form.options_value_field} onChange={(e) => updateForm("options_value_field", e.target.value)} placeholder="id" className="h-8 text-xs" /></Field>
    </div>
  );
}

function RelationConfig({ form, updateForm }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-2 border rounded-lg bg-white">
      <Field label="Entidade Relacionada"><Input value={form.relation_entity} onChange={(e) => updateForm("relation_entity", e.target.value)} placeholder="EX: Fornecedor" className="h-8 text-xs" /></Field>
      <Field label="Campo de Exibição"><Input value={form.relation_display_field} onChange={(e) => updateForm("relation_display_field", e.target.value)} placeholder="nome" className="h-8 text-xs" /></Field>
      <div className="text-[11px] text-slate-500 flex items-end">Salva o ID e exibe o campo escolhido, mantendo compatibilidade com PostgreSQL.</div>
    </div>
  );
}

function FormulaConfig({ form, updateForm }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 p-2 border rounded-lg bg-white">
      <Field label="Fórmula" className="md:col-span-2"><Input value={form.formula} onChange={(e) => updateForm("formula", e.target.value)} placeholder="quantidade * peso_medio" className="h-8 text-xs" /></Field>
      <Field label="Campos Dependentes"><Input value={form.campos_dependentes_text} onChange={(e) => updateForm("campos_dependentes_text", e.target.value)} placeholder="quantidade, peso_medio" className="h-8 text-xs" /></Field>
    </div>
  );
}