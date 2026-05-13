import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import bebedouroRepository from "@/repositories/bebedouroRepository";
import { toast } from "sonner";

const FL = ({ label, required, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">{label}{required && <span className="text-red-500 ml-0.5">*</span>}</label>
    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">{children}</div>
  </div>
);

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
      queryClient.invalidateQueries({ queryKey: ["bebedouro-sanidade-all", empresaId] });
      toast.success("Avaliação sanitária registrada.");
      onSaved?.();
    }
  });

  const boolFields = [["presenca_algas", "Presença de algas"], ["presenca_barro", "Presença de barro"], ["presenca_contaminacao", "Presença de contaminação"], ["necessita_limpeza", "Necessita limpeza"], ["necessita_tratamento", "Necessita tratamento"]];

  return (
    <div className="bg-card text-card-foreground rounded-xl border shadow-sm border-slate-300">
      <div className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
        <div className="text-sm font-semibold text-slate-900">Sanidade da Água</div>
        <div className="text-[11px] text-slate-500">{bebedouro.nome}</div>
      </div>
      <div className="p-1">
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-0.5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
            <FL label="Data" required><Input type="date" required value={form.data_avaliacao} onChange={(e) => setForm({ ...form, data_avaliacao: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
            <FL label="Nível de risco" required><Select value={form.nivel_risco} onValueChange={(value) => setForm({ ...form, nivel_risco: value })}><SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger><SelectContent>{["Baixo", "Médio", "Alto"].map((item) => <SelectItem key={item} value={item} className="text-xs">{item}</SelectItem>)}</SelectContent></Select></FL>
            <FL label="Cor da água"><Input value={form.cor_agua} onChange={(e) => setForm({ ...form, cor_agua: e.target.value })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
            <FL label="Odor"><Input value={form.odor} onChange={(e) => setForm({ ...form, odor: e.target.value })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
            <FL label="Turbidez"><Input value={form.turbidez} onChange={(e) => setForm({ ...form, turbidez: e.target.value })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 rounded-lg border border-slate-200 p-2">
            {boolFields.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><Checkbox checked={form[key]} onCheckedChange={(checked) => setForm({ ...form, [key]: Boolean(checked) })} />{label}</label>)}
          </div>
          <FL label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={3} className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
          <div className="flex justify-end gap-1 pt-1 border-t"><Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancelar</Button><Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">Salvar</Button></div>
        </form>
      </div>
    </div>
  );
}