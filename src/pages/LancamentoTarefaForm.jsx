import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPageUrl } from "@/utils";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";

export default function LancamentoTarefaForm() {
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get("id");
  const isEdit = Boolean(id);

  const emptyForm = {
    tipo_tarefa_id: "",
    grupo_atividade_id: "",
    data_inicial: "",
    data_final: "",
    area_pasto_id: "",
    responsavel_id: "",
    urgencia: "Não urgente",
    nivel_urgencia: "Baixo",
    prazo_definido: true,
    descricao_instrucoes: "",
    localizacao_adicional: "",
    status_tarefa: "Planejada",
    observacoes: "",
    atrasada: false
  };

  const [form, setForm] = useState(emptyForm);

  const { data: grupos = [] } = useQuery({ queryKey: ["grupos-atividades"], queryFn: () => base44.entities.GrupoAtividade.list(), initialData: [] });
  const { data: tipos = [] } = useQuery({ queryKey: ["tipos-tarefa"], queryFn: () => base44.entities.TipoTarefa.list(), initialData: [] });
  const { data: areas = [] } = useQuery({ queryKey: ["areas-pasto"], queryFn: () => base44.entities.AreaPastagem.list(), initialData: [] });
  const { data: pessoas = [] } = useQuery({ queryKey: ["contatos"], queryFn: () => base44.entities.Fornecedor.list(), initialData: [] });

  useEffect(() => {
    const load = async () => {
      if (!isEdit) return;
      const all = await base44.entities.LancamentoTarefa.list();
      const item = all.find(x => x.id === id);
      if (item) setForm({ ...emptyForm, ...item });
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const createMutation = useMutation({
    mutationFn: async (payload) => base44.entities.LancamentoTarefa.create(payload),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["lancamentos-tarefa"] });
      window.location.href = createPageUrl("LancamentosTarefas");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.LancamentoTarefa.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lancamentos-tarefa"] });
      window.location.href = createPageUrl("LancamentosTarefas");
    },
  });

  const handleSave = () => {
    if (!form.tipo_tarefa_id) return;
    if (!form.data_inicial || !form.data_final) return;
    const tipo = tipos.find(t => t.id === form.tipo_tarefa_id);
    const grupo = grupos.find(g => g.id === tipo?.grupo_atividade_id);
    const area = areas.find(a => a.id === form.area_pasto_id);
    const resp = pessoas.find(p => p.id === form.responsavel_id && (p.tipos||[]).includes("Funcionario"));
    const payload = {
      ...form,
      nome_tipo_tarefa: tipo?.nome_tipo || "",
      grupo_atividade_id: tipo?.grupo_atividade_id || "",
      grupo_atividade_nome: grupo?.nome_grupo || "",
      area_pasto_nome: area?.nome || "",
      responsavel_nome: resp?.nome || "",
    };
    if (isEdit) updateMutation.mutate({ id, data: payload }); else createMutation.mutate(payload);
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between bg-white rounded px-3 py-2 border-b">
        <h1 className="text-lg font-bold text-slate-900">{isEdit ? "Editar" : "Lançar"} Tarefa</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { window.location.href = createPageUrl("LancamentosTarefas"); }}>Cancelar</Button>
          <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleSave}>Salvar</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs">Tipo de Tarefa *</label>
            <Select value={form.tipo_tarefa_id} onValueChange={(v)=>setForm(f=>({...f,tipo_tarefa_id:v}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
              <SelectContent>
                {tipos.map(t => <SelectItem key={t.id} value={t.id}>{t.nome_tipo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs">Grupo de Atividades</label>
            <Input value={grupos.find(g => g.id === (tipos.find(t=>t.id===form.tipo_tarefa_id)?.grupo_atividade_id))?.nome_grupo || ""} disabled className="h-8 text-xs" />
          </div>

          <div className="space-y-1">
            <label className="text-xs">Área/Pasto</label>
            <Select value={form.area_pasto_id} onValueChange={(v)=>setForm(f=>({...f,area_pasto_id:v}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
              <SelectContent>
                {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs">Data inicial *</label>
            <Input type="date" value={form.data_inicial} onChange={(e)=>setForm(f=>({...f,data_inicial:e.target.value}))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs">Data final *</label>
            <Input type="date" value={form.data_final} onChange={(e)=>setForm(f=>({...f,data_final:e.target.value}))} className="h-8 text-xs" />
          </div>

          <div className="space-y-1">
            <label className="text-xs">Responsável (Funcionário) *</label>
            <Select value={form.responsavel_id} onValueChange={(v)=>setForm(f=>({...f,responsavel_id:v}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
              <SelectContent>
                {pessoas.filter(p => (p.tipos||[]).includes("Funcionario")).map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs">Urgência *</label>
            <Select value={form.urgencia} onValueChange={(v)=>setForm(f=>({...f,urgencia:v}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
              <SelectContent>
                {["Não urgente","Urgente"].map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs">Nível de urgência *</label>
            <Select value={form.nivel_urgencia} onValueChange={(v)=>setForm(f=>({...f,nivel_urgencia:v}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
              <SelectContent>
                {["Baixo","Médio","Alto","Crítico"].map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 lg:col-span-2">
            <label className="text-xs">Descrição/Instruções</label>
            <Input value={form.descricao_instrucoes} onChange={(e)=>setForm(f=>({...f,descricao_instrucoes:e.target.value}))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <label className="text-xs">Localização adicional</label>
            <Input value={form.localizacao_adicional} onChange={(e)=>setForm(f=>({...f,localizacao_adicional:e.target.value}))} className="h-8 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs">Status</label>
            <Select value={form.status_tarefa} onValueChange={(v)=>setForm(f=>({...f,status_tarefa:v}))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
              <SelectContent>
                {["Planejada","Em andamento","Concluída","Cancelada","Atrasada"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 lg:col-span-2">
            <label className="text-xs">Observações</label>
            <Input value={form.observacoes} onChange={(e)=>setForm(f=>({...f,observacoes:e.target.value}))} className="h-8 text-xs" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}