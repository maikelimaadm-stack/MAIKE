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

const FL = ({ label, required, children }) => (
  <div>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
      {children}
    </div>
  </div>
);

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
      queryClient.invalidateQueries({ queryKey: ["bebedouro-historico-all", empresaId] });
      toast.success("Lançamento registrado.");
      onSaved?.();
    }
  });

  return (
    <div className="bg-card text-card-foreground rounded-xl border shadow-sm border-slate-300">
      <div className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
        <div className="text-sm font-semibold text-slate-900">Lançamento do Bebedouro</div>
        <div className="text-[11px] text-slate-500">{bebedouro.nome}</div>
      </div>
      <div className="p-1">
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="space-y-0.5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
            <FL label="Data" required><Input type="date" value={form.data_lancamento} onChange={(e) => setForm({ ...form, data_lancamento: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" required /></FL>
            <FL label="Hora"><Input type="time" value={form.hora_lancamento} onChange={(e) => setForm({ ...form, hora_lancamento: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
            <FL label="Tipo" required><Select value={form.tipo_lancamento} onValueChange={(value) => setForm({ ...form, tipo_lancamento: value })}><SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_HISTORICO_TIPOS.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}</SelectContent></Select></FL>
            <FL label="Status" required><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}><SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_HISTORICO_STATUS.map((status) => <SelectItem key={status} value={status} className="text-xs">{status}</SelectItem>)}</SelectContent></Select></FL>
            <FL label="Produto utilizado"><Input value={form.produto_utilizado} onChange={(e) => setForm({ ...form, produto_utilizado: e.target.value })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
            <FL label="Quantidade"><Input type="number" step="0.01" value={form.quantidade_utilizada} onChange={(e) => setForm({ ...form, quantidade_utilizada: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
            <FL label="Custo"><Input type="number" step="0.01" value={form.custo} onChange={(e) => setForm({ ...form, custo: e.target.value })} className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
          </div>
          <FL label="Descrição detalhada"><Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={3} className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" /></FL>
          <div className="flex justify-end gap-1 pt-1 border-t">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={onCancel}>Cancelar</Button>
            <Button type="submit" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white">Salvar</Button>
          </div>
        </form>
      </div>
    </div>
  );
}