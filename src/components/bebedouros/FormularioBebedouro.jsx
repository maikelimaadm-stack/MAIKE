import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import bebedouroRepository from "@/repositories/bebedouroRepository";
import { BEBEDOURO_ORIGENS_AGUA, BEBEDOURO_PERIODICIDADES, BEBEDOURO_STATUS, BEBEDOURO_TIPOS } from "@/services/bebedouroService";
import { toast } from "sonner";

export default function FormularioBebedouro({ coordenadas, pontoReferencia, areas = [], onCancel, onSaved }) {
  const empresaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const areaInicial = useMemo(() => areas.find((area) => area.id === pontoReferencia?.area_vinculada_id) || null, [areas, pontoReferencia]);
  const [form, setForm] = useState({
    nome: pontoReferencia?.nome || "",
    codigo_interno: pontoReferencia?.sigla || "",
    pasto_id: pontoReferencia?.area_vinculada_id || "",
    setor_id: pontoReferencia?.setor_id || areaInicial?.setor_id || "",
    tipo: "Bebedouro australiano",
    capacidade_litros: "",
    origem_agua: "Poço",
    status: "Ativo",
    periodicidade_limpeza: "Mensal",
    periodicidade_inspecao: "Semanal",
    observacoes: pontoReferencia?.observacoes || ""
  });

  useEffect(() => {
    const area = areas.find((item) => item.id === form.pasto_id);
    if (area?.setor_id && form.setor_id !== area.setor_id) setForm((prev) => ({ ...prev, setor_id: area.setor_id }));
  }, [form.pasto_id, form.setor_id, areas]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const area = areas.find((item) => item.id === form.pasto_id);
      const payload = {
        empresa_id: empresaId,
        ponto_referencia_id: pontoReferencia?.id || null,
        nome: form.nome.toUpperCase(),
        codigo_interno: form.codigo_interno.toUpperCase(),
        pasto_id: form.pasto_id || null,
        pasto_nome: area?.nome || null,
        setor_id: form.setor_id || area?.setor_id || null,
        setor_nome: area?.setor_nome || null,
        tipo: form.tipo,
        capacidade_litros: form.capacidade_litros ? Number(form.capacidade_litros) : null,
        origem_agua: form.origem_agua,
        coordenadas: coordenadas || pontoReferencia?.coordenadas || null,
        status: form.status,
        periodicidade_limpeza: form.periodicidade_limpeza,
        periodicidade_inspecao: form.periodicidade_inspecao,
        observacoes: form.observacoes?.toUpperCase(),
        ativo: true
      };
      return bebedouroRepository.createBebedouro(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bebedouros", empresaId] });
      toast.success("Bebedouro cadastrado com sucesso.");
      onSaved?.();
    }
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }} className="space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <Field label="Nome"><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="h-8 text-xs uppercase" /></Field>
        <Field label="Código interno"><Input value={form.codigo_interno} onChange={(e) => setForm({ ...form, codigo_interno: e.target.value })} className="h-8 text-xs uppercase" /></Field>
        <Field label="Pasto vinculado"><Select value={form.pasto_id || "__none__"} onValueChange={(value) => setForm({ ...form, pasto_id: value === "__none__" ? "" : value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">Sem pasto</SelectItem>{areas.map((area) => <SelectItem key={area.id} value={area.id}>{area.nome}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Tipo"><Select value={form.tipo} onValueChange={(value) => setForm({ ...form, tipo: value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_TIPOS.map((tipo) => <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Capacidade (litros)"><Input type="number" value={form.capacidade_litros} onChange={(e) => setForm({ ...form, capacidade_litros: e.target.value })} className="h-8 text-xs" /></Field>
        <Field label="Origem da água"><Select value={form.origem_agua} onValueChange={(value) => setForm({ ...form, origem_agua: value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_ORIGENS_AGUA.map((origem) => <SelectItem key={origem} value={origem}>{origem}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Status"><Select value={form.status} onValueChange={(value) => setForm({ ...form, status: value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_STATUS.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Limpeza"><Select value={form.periodicidade_limpeza} onValueChange={(value) => setForm({ ...form, periodicidade_limpeza: value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_PERIODICIDADES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="Inspeção"><Select value={form.periodicidade_inspecao} onValueChange={(value) => setForm({ ...form, periodicidade_inspecao: value })}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{BEBEDOURO_PERIODICIDADES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
      </div>
      <Field label="Observações"><Textarea value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} className="text-xs uppercase" rows={3} /></Field>
      <div className="flex justify-end gap-2 border-t pt-2">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={saveMutation.isPending}>Salvar Bebedouro</Button>
      </div>
    </form>
  );
}

function Field({ label, children }) {
  return <div className="space-y-1"><Label className="text-xs text-slate-600">{label}</Label>{children}</div>;
}