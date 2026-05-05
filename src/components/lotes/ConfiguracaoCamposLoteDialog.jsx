import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import loteRepository from "@/core/repositories/loteRepository";

const TIPOS_CAMPO = [
  { value: "text", label: "Texto" },
  { value: "number", label: "Número" },
  { value: "date", label: "Data" },
  { value: "select", label: "Seleção" },
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

const initialForm = {
  label: "",
  field_name: "",
  placeholder: "",
  descricao: "",
  tipo: "text",
  col_span: 6,
  obrigatorio: false,
  read_only: false,
  visivel_form: true,
  visivel_tabela: true,
  visivel_relatorio: true,
  ordenavel: true,
  filtravel: true,
  alinhamento: "left",
  agregacao: "none",
  options_text: "",
  options_source: ""
};

export default function ConfiguracaoCamposLoteDialog({ open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initialForm);

  const { data: campos = [], isLoading } = useQuery({
    queryKey: ["lote-campos-personalizados"],
    queryFn: () => loteRepository.listCamposPersonalizados(),
    enabled: open,
    initialData: []
  });

  const createMutation = useMutation({
    mutationFn: () => loteRepository.createCampoPersonalizado({
      ...form,
      field_name: toSnakeCase(form.field_name || form.label),
      options: form.tipo === "select" ? parseOptions(form.options_text) : [],
      agregacao: form.agregacao === "none" ? undefined : form.agregacao
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lote-campos-personalizados"] });
      setForm(initialForm);
      toast.success("Campo criado no LayoutCampo!");
    }
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    const fieldName = toSnakeCase(form.field_name || form.label);
    if (!form.label.trim() || !fieldName) {
      toast.error("Informe o nome do campo.");
      return;
    }
    createMutation.mutate();
  };

  const updateForm = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      ...(field === "label" && !prev.field_name ? { field_name: toSnakeCase(value) } : {})
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Campos do Lote - LayoutCampo</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="border rounded-lg p-3 bg-slate-50 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs uppercase text-slate-600">Label</label>
              <Input value={form.label} onChange={(e) => updateForm("label", e.target.value)} placeholder="EX: ESCORE CORPORAL" className="h-8 text-xs uppercase" />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-slate-600">Chave</label>
              <Input value={form.field_name} onChange={(e) => updateForm("field_name", toSnakeCase(e.target.value))} placeholder="escore_corporal" className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-slate-600">Tipo</label>
              <Select value={form.tipo} onValueChange={(value) => updateForm("tipo", value)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS_CAMPO.map((tipo) => <SelectItem key={tipo.value} value={tipo.value} className="text-xs">{tipo.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-slate-600">Alinhamento</label>
              <Select value={form.alinhamento} onValueChange={(value) => updateForm("alinhamento", value)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="left" className="text-xs">Esquerda</SelectItem>
                  <SelectItem value="center" className="text-xs">Centro</SelectItem>
                  <SelectItem value="right" className="text-xs">Direita</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs uppercase text-slate-600">Agregação</label>
              <Select value={form.agregacao} onValueChange={(value) => updateForm("agregacao", value)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-xs">Nenhuma</SelectItem>
                  <SelectItem value="sum" className="text-xs">Soma</SelectItem>
                  <SelectItem value="avg" className="text-xs">Média</SelectItem>
                  <SelectItem value="min" className="text-xs">Mínimo</SelectItem>
                  <SelectItem value="max" className="text-xs">Máximo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-xs uppercase text-slate-600">Placeholder</label>
              <Input value={form.placeholder} onChange={(e) => updateForm("placeholder", e.target.value)} placeholder="TEXTO DE AJUDA" className="h-8 text-xs uppercase" />
            </div>
            <div className="md:col-span-2 space-y-1">
              <label className="text-xs uppercase text-slate-600">Descrição</label>
              <Input value={form.descricao} onChange={(e) => updateForm("descricao", e.target.value)} placeholder="DESCRIÇÃO DO CAMPO" className="h-8 text-xs uppercase" />
            </div>
          </div>

          {form.tipo === "select" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs uppercase text-slate-600">Opções - uma por linha</label>
                <Textarea value={form.options_text} onChange={(e) => updateForm("options_text", e.target.value)} placeholder={"OPÇÃO 1\nOPÇÃO 2\nOPÇÃO 3"} className="text-xs uppercase min-h-20" />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase text-slate-600">Fonte dinâmica</label>
                <Input value={form.options_source} onChange={(e) => updateForm("options_source", e.target.value)} placeholder="EX: Fornecedor" className="h-8 text-xs" />
                <p className="text-[11px] text-slate-500">Informe o nome da entidade para salvar o ID e exibir o nome amigável.</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-8 gap-2 items-end">
            <div className="space-y-1">
              <label className="text-xs uppercase text-slate-600">Colunas</label>
              <Input type="number" min="1" max="12" value={form.col_span} onChange={(e) => updateForm("col_span", Number(e.target.value) || 6)} className="h-8 text-xs" />
            </div>
            {[
              ["obrigatorio", "Obrigatório"],
              ["read_only", "Bloqueado"],
              ["visivel_form", "Formulário"],
              ["visivel_tabela", "Tabela"],
              ["visivel_relatorio", "Relatório"],
              ["ordenavel", "Ordenável"],
              ["filtravel", "Filtrável"]
            ].map(([field, label]) => (
              <label key={field} className="h-8 px-2 border rounded-md bg-white flex items-center justify-between gap-2 text-xs text-slate-700">
                {label}<Switch checked={form[field]} onCheckedChange={(checked) => updateForm(field, checked)} className="scale-75" />
              </label>
            ))}
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={createMutation.isPending} className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="w-3.5 h-3.5" /> Criar Campo
            </Button>
          </div>
        </form>

        <div className="flex-1 overflow-auto border rounded-lg">
          <div className="grid grid-cols-[1fr_130px_90px_220px] gap-2 px-3 py-2 bg-slate-100 border-b text-xs font-semibold text-slate-700">
            <span>Campo</span><span>Chave</span><span>Tipo</span><span>Uso</span>
          </div>
          {isLoading ? <div className="p-4 text-xs text-slate-500">Carregando...</div> : campos.length === 0 ? <div className="p-4 text-xs text-slate-400 text-center">Nenhum campo criado.</div> : campos.map((campo) => (
            <div key={campo.id || campo.field_id} className="grid grid-cols-[1fr_130px_90px_220px] gap-2 px-3 py-2 border-b text-xs items-center">
              <span className="font-medium text-slate-800">{campo.label}</span>
              <span className="font-mono text-slate-500">{campo.field_name}</span>
              <span>{campo.tipo}</span>
              <div className="flex flex-wrap gap-1">
                {campo.visivel_form && <Badge variant="outline" className="text-[10px]">Form</Badge>}
                {campo.visivel_tabela && <Badge variant="outline" className="text-[10px]">Tabela</Badge>}
                {campo.visivel_relatorio && <Badge variant="outline" className="text-[10px]">Rel.</Badge>}
                {campo.tipo === "select" && <Badge variant="secondary" className="text-[10px]">{campo.options?.length || 0} opções</Badge>}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}