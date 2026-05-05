import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const initialForm = {
  label: "",
  field_name: "",
  tipo: "text",
  col_span: 6,
  obrigatorio: false,
  visivel_formulario: true,
  visivel_tabela: true,
  visivel_relatorio: true
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
      field_name: toSnakeCase(form.field_name || form.label)
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lote-campos-personalizados"] });
      setForm(initialForm);
      toast.success("Campo personalizado criado!");
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
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Campos Personalizados do Lote</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="border rounded-lg p-3 bg-slate-50 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
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
                <SelectContent>
                  {TIPOS_CAMPO.map((tipo) => <SelectItem key={tipo.value} value={tipo.value} className="text-xs">{tipo.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
            <div className="space-y-1">
              <label className="text-xs uppercase text-slate-600">Colunas</label>
              <Input type="number" min="1" max="12" value={form.col_span} onChange={(e) => updateForm("col_span", Number(e.target.value) || 6)} className="h-8 text-xs" />
            </div>
            {[
              ["obrigatorio", "Obrigatório"],
              ["visivel_formulario", "Formulário"],
              ["visivel_tabela", "Tabela"],
              ["visivel_relatorio", "Relatório"]
            ].map(([field, label]) => (
              <label key={field} className="h-8 px-2 border rounded-md bg-white flex items-center justify-between gap-2 text-xs text-slate-700">
                {label}
                <Switch checked={form[field]} onCheckedChange={(checked) => updateForm(field, checked)} className="scale-75" />
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
          <div className="grid grid-cols-[1fr_130px_100px_170px] gap-2 px-3 py-2 bg-slate-100 border-b text-xs font-semibold text-slate-700">
            <span>Campo</span><span>Chave</span><span>Tipo</span><span>Visibilidade</span>
          </div>
          {isLoading ? (
            <div className="p-4 text-xs text-slate-500">Carregando...</div>
          ) : campos.length === 0 ? (
            <div className="p-4 text-xs text-slate-400 text-center">Nenhum campo personalizado criado.</div>
          ) : campos.map((campo) => (
            <div key={campo.id || campo.field_id} className="grid grid-cols-[1fr_130px_100px_170px] gap-2 px-3 py-2 border-b text-xs items-center">
              <span className="font-medium text-slate-800">{campo.label}</span>
              <span className="font-mono text-slate-500">{campo.field_name}</span>
              <span>{campo.tipo}</span>
              <div className="flex flex-wrap gap-1">
                {campo.metadata?.visivel_formulario && <Badge variant="outline" className="text-[10px]">Form</Badge>}
                {campo.metadata?.visivel_tabela && <Badge variant="outline" className="text-[10px]">Tabela</Badge>}
                {campo.metadata?.visivel_relatorio && <Badge variant="outline" className="text-[10px]">Rel.</Badge>}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}