import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
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
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-bold text-slate-900">{isEdit ? "Editar" : "Novo"} Grupo</h1>
      </div>

      <Card>
        <CardContent className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs">Nome do grupo *</Label>
            <Input value={form.nome_grupo} onChange={(e)=>setForm(f=>({...f,nome_grupo:e.target.value}))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Ativo</Label>
            <Select value={String(form.ativo)} onValueChange={(v)=>setForm(f=>({...f,ativo:v==="true"}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true" className="text-xs">Sim</SelectItem>
                <SelectItem value="false" className="text-xs">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">Descrição</Label>
            <Textarea value={form.descricao} onChange={(e)=>setForm(f=>({...f,descricao:e.target.value}))} className="text-xs min-h-[96px]" />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label className="text-xs">Observações</Label>
            <Textarea value={form.observacoes} onChange={(e)=>setForm(f=>({...f,observacoes:e.target.value}))} className="text-xs min-h-[96px]" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 pt-3">
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>navigate(createPageUrl("GruposAtividades"))}>Cancelar</Button>
        <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={salvar}>Salvar</Button>
      </div>
    </div>
  );
}