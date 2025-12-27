import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";


export default function TipoTarefaForm() {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState({ nome_tipo: "", grupo_atividade_id: "", ativo: true, descricao: "", exige_area: false, pode_ter_produto: false, pode_ter_maquina: false, pode_ter_implemento: false });
  const { data: grupos = [] } = useQuery({ queryKey: ["grupos-atividades"], queryFn: () => base44.entities.GrupoAtividade.list(), initialData: [] });

  useEffect(() => {
    const load = async () => {
      if (!isEdit) return;
      const all = await base44.entities.TipoTarefa.list();
      const item = all.find(x => x.id === id);
      if (item) setForm({ ...form, ...item });
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const salvar = async () => {
    if (!form.nome_tipo?.trim() || !form.grupo_atividade_id) return;
    const g = grupos.find(x => x.id === form.grupo_atividade_id);
    const data = { ...form, grupo_atividade_nome: g?.nome_grupo || "" };
    if (isEdit) await base44.entities.TipoTarefa.update(id, data); else await base44.entities.TipoTarefa.create(data);
    navigate(createPageUrl("TiposTarefa"));
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between bg-white rounded px-3 py-2 border-b">
        <h1 className="text-lg font-bold text-slate-900">{isEdit ? "Editar" : "Novo"} Tipo de Tarefa</h1>
      </div>

      <Card>
        <CardContent className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Tipo de Tarefa *</Label>
            <Input value={form.nome_tipo} onChange={(e)=>setForm(f=>({...f,nome_tipo:e.target.value}))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Grupo *</Label>
            <Select value={form.grupo_atividade_id} onValueChange={(v)=>setForm(f=>({...f,grupo_atividade_id:v}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
              <SelectContent>
                {grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.nome_grupo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ativo</Label>
            <Select value={String(form.ativo)} onValueChange={(v)=>setForm(f=>({...f,ativo:v==="true"}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Sim</SelectItem>
                <SelectItem value="false">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">Descrição</Label>
            <Input value={form.descricao} onChange={(e)=>setForm(f=>({...f,descricao:e.target.value}))} className="h-8 text-xs" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 pt-3">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>navigate(createPageUrl("TiposTarefa"))}>Cancelar</Button>
        <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={salvar}>Salvar</Button>
      </div>
    </div>
  );
}