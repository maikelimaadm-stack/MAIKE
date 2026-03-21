import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";



export default function GrupoAtividadeForm() {
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  

  const [form, setForm] = useState({ nome_grupo: "", ativo: true, descricao: "", observacoes: "" });

  useEffect(() => {
    const load = async () => {
      if (!isEdit) return;
      const all = await base44.entities.GrupoAtividade.list();
      const item = all.find(x => x.id === id);
      if (item) setForm({ ...form, ...item });
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const salvar = async () => {
    if (!form.nome_grupo?.trim()) return;
    if (isEdit) await base44.entities.GrupoAtividade.update(id, form); else await base44.entities.GrupoAtividade.create(form);
    navigate(createPageUrl("GruposAtividades"));
  };

  return (
    <div className="p-4 md:p-6 space-y-3">
      <div className="bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <h1 className="text-lg font-bold text-slate-900">{isEdit ? "Editar" : "Novo"} Grupo</h1>
        <p className="text-xs text-slate-600">Cadastro e organização dos grupos de tarefas</p>
      </div>

      <Card className="rounded-xl border bg-card text-card-foreground shadow-sm">
        <CardHeader className="bg-emerald-50 border-b border-emerald-200 py-2 px-3">
          <CardTitle className="text-sm font-bold text-emerald-900">{isEdit ? "Editar Grupo de Atividades" : "Novo Grupo de Atividades"}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs uppercase">Nome do grupo *</Label>
            <Input value={form.nome_grupo} onChange={(e)=>setForm(f=>({...f,nome_grupo:e.target.value}))} className="h-8 text-xs uppercase" placeholder="NOME DO GRUPO" style={{ textTransform: "uppercase" }} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs uppercase">Ativo</Label>
            <Select value={String(form.ativo)} onValueChange={(v)=>setForm(f=>({...f,ativo:v==="true"}))}>
              <SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true" className="text-xs uppercase">Sim</SelectItem>
                <SelectItem value="false" className="text-xs uppercase">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs uppercase">Descrição</Label>
            <Textarea value={form.descricao} onChange={(e)=>setForm(f=>({...f,descricao:e.target.value}))} className="text-xs uppercase min-h-[96px]" placeholder="DESCRIÇÃO DO GRUPO" style={{ textTransform: "uppercase" }} />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs uppercase">Observações</Label>
            <Textarea value={form.observacoes} onChange={(e)=>setForm(f=>({...f,observacoes:e.target.value}))} className="text-xs uppercase min-h-[96px]" placeholder="OBSERVAÇÕES GERAIS" style={{ textTransform: "uppercase" }} />
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-3 border-t">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>navigate(createPageUrl("GruposAtividades"))}>Cancelar</Button>
        <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={salvar}>Salvar</Button>
      </div>
    </div>
  );
}