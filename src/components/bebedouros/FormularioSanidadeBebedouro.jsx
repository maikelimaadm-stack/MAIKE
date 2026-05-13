import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import bebedouroRepository from "@/repositories/bebedouroRepository";
import { toast } from "sonner";

export default function FormularioSanidadeBebedouro({ bebedouro, onSaved, onCancel }) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ data_avaliacao: new Date().toISOString().split("T")[0], cor_agua: "", odor: "", turbidez: "", nivel_risco: "Baixo", observacoes: "", presenca_algas: false, presenca_barro: false, presenca_contaminacao: false, necessita_limpeza: false, necessita_tratamento: false });

  const mutation = useMutation({
    mutationFn: async () => {
      const user = await base44.auth.me();
      return bebedouroRepository.createSanidade({
        empresa_id: empresaId,
        bebedouro_id: bebedouro.id,
        bebedouro_nome: bebedouro.nome,
        data_avaliacao: form.data_avaliacao,
        responsavel: user?.full_name || user?.email || "",
        ...form,
        cor_agua: form.cor_agua?.toUpperCase(),
        odor: form.odor?.toUpperCase(),
        turbidez: form.turbidez?.toUpperCase(),
        observacoes: form.observacoes?.toUpperCase()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebedouro-sanidade", empresaId, bebedouro.id] });
      toast.success("Avaliação sanitária registrada.");
      onSaved?.();
    }
  });

  const boolFields = [
    ["presenca_algas", "Presença de algas"],
    ["presenca_barro", "Presença de barro"],
    ["presenca_contaminacao", "Presença de contaminação"],
    ["necessita_limpeza", "Necessita limpeza"],
    ["necessita_tratamento", "Necessita tratamento"]
  ];

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Data"><Input type="date" required value={form.data_avaliacao} onChange={(e) => setForm({ ...form, data_avaliacao: e.target.value })} className="h-8 text-xs" /></Field>
        <Field label="Nível de risco"><Select value={form.nivel_risco} onValueChange={(value) => setForm({ ...form, nivel_risco: value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{["Baixo", "Médio", "Alto"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Cor da água"><Input value={form.cor_agua} onChange={(e) => setForm({ ...form, cor_agua: e.target.value })} className="h-8 text-xs uppercase" /></Field>
        <Field label="Odor"><Input value={form.odor} onChange={(e) => setForm({ ...form, odor: e.target.value })} className="h-8 text-xs uppercase" /></Field>
        <Field label="Turbidez"><Input value={form.turbidez} onChange={(e) => setForm({ ...form, turbidez: e.target.value })} className="h-8 text-xs uppercase" /></Field>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1 rounded-lg border border-slate-200 p-2">
        {boolFields.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><Checkbox checked={form[key]} onCheckedChange={(checked) => setForm({ ...form, [key]: Boolean(checked) })} />{label}</label>)}
      </div>
      <Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={3} className="text-xs uppercase" /></Field>
      <div className="flex justify-end gap-2 border-t pt-2"><Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>Cancelar</Button><Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">Salvar</Button></div>
    </form>
  );
}

function Field({ label, children }) {
  return <div className="space-y-1"><Label className="text-xs text-slate-600">{label}</Label>{children}</div>;
}