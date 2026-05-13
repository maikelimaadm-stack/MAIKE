import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import bebedouroRepository from "@/repositories/bebedouroRepository";
import { BEBEDOURO_HISTORICO_STATUS, BEBEDOURO_HISTORICO_TIPOS } from "@/services/bebedouroService";
import { toast } from "sonner";

export default function FormularioLancamentoBebedouro({ bebedouro, onSaved, onCancel }) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const hoje = new Date().toISOString().split("T")[0];
  const agora = new Date().toTimeString().slice(0, 5);
  const [form, setForm] = useState({ data_lancamento: hoje, hora_lancamento: agora, tipo_lancamento: "Inspeção", status: "Concluído", descricao: "", produto_utilizado: "", quantidade_utilizada: "", custo: "" });

  const mutation = useMutation({
    mutationFn: async () => {
      const user = await base44.auth.me();
      return bebedouroRepository.createHistorico({
        empresa_id: empresaId,
        bebedouro_id: bebedouro.id,
        bebedouro_nome: bebedouro.nome,
        data_lancamento: form.data_lancamento,
        hora_lancamento: form.hora_lancamento,
        responsavel: user?.full_name || user?.email || "",
        tipo_lancamento: form.tipo_lancamento,
        descricao: form.descricao?.toUpperCase(),
        produto_utilizado: form.produto_utilizado?.toUpperCase(),
        quantidade_utilizada: form.quantidade_utilizada ? Number(form.quantidade_utilizada) : null,
        custo: form.custo ? Number(form.custo) : null,
        status: form.status
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebedouro-historico", empresaId, bebedouro.id] });
      toast.success("Lançamento registrado.");
      onSaved?.();
    }
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Data"><Input type="date" value={form.data_lancamento} onChange={(e) => setForm({ ...form, data_lancamento: e.target.value })} className="h-8 text-xs" required /></Field>
        <Field label="Hora"><Input type="time" value={form.hora_lancamento} onChange={(e) => setForm({ ...form, hora_lancamento: e.target.value })} className="h-8 text-xs" /></Field>
        <Field label="Tipo"><Select value={form.tipo_lancamento} onValueChange={(value) => setForm({ ...form, tipo_lancamento: value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_HISTORICO_TIPOS.map((tipo) => <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Status"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_HISTORICO_STATUS.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Produto utilizado"><Input value={form.produto_utilizado} onChange={(e) => setForm({ ...form, produto_utilizado: e.target.value })} className="h-8 text-xs uppercase" /></Field>
        <Field label="Quantidade"><Input type="number" step="0.01" value={form.quantidade_utilizada} onChange={(e) => setForm({ ...form, quantidade_utilizada: e.target.value })} className="h-8 text-xs" /></Field>
        <Field label="Custo"><Input type="number" step="0.01" value={form.custo} onChange={(e) => setForm({ ...form, custo: e.target.value })} className="h-8 text-xs" /></Field>
      </div>
      <Field label="Descrição detalhada"><Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={4} className="text-xs uppercase" /></Field>
      <div className="flex justify-end gap-2 border-t pt-2"><Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>Cancelar</Button><Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">Salvar</Button></div>
    </form>
  );
}

function Field({ label, children }) {
  return <div className="space-y-1"><Label className="text-xs text-slate-600">{label}</Label>{children}</div>;
}