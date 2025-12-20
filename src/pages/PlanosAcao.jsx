import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Save, X, Pencil, Trash2, RefreshCw, Search, Filter, CalendarDays } from "lucide-react";
import { toast } from "sonner";

export default function PlanosAcao() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroPrioridade, setFiltroPrioridade] = useState("");
  const [filtroSolicitante, setFiltroSolicitante] = useState("");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    nome_plano: "",
    status_plano: "Rascunho",
    solicitante_id: "",
    solicitante_nome: "",
    descricao_objetivo: "",
    prioridade: "",
    area_padrao_id: "",
    area_padrao_nome: "",
    data_prevista_inicio: "",
    data_prevista_fim: "",
    observacoes: "",
    anexos: []
  });

  const { data: pessoas = [] } = useQuery({ queryKey: ["contatos"], queryFn: () => base44.entities.Fornecedor.list(), initialData: [] });
  const { data: areas = [] } = useQuery({ queryKey: ["areas-pasto"], queryFn: () => base44.entities.AreaPastagem.list(), initialData: [] });
  const { data: planos = [], isLoading, refetch } = useQuery({ queryKey: ["planos-acao"], queryFn: () => base44.entities.PlanoAcao.list("-updated_date"), initialData: [] });

  const filtered = useMemo(() => {
    return planos.filter(p =>
      (!search || p.nome_plano?.toLowerCase().includes(search.toLowerCase())) &&
      (!filtroStatus || p.status_plano === filtroStatus) &&
      (!filtroPrioridade || p.prioridade === filtroPrioridade) &&
      (!filtroSolicitante || p.solicitante_id === filtroSolicitante) &&
      (!dataIni || (p.data_prevista_inicio && p.data_prevista_inicio >= dataIni)) &&
      (!dataFim || (p.data_prevista_fim && p.data_prevista_fim <= dataFim))
    );
  }, [planos, search, filtroStatus, filtroPrioridade, filtroSolicitante, dataIni, dataFim]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.PlanoAcao.create(data),
    onSuccess: () => { toast.success("Salvo!"); queryClient.invalidateQueries({ queryKey: ["planos-acao"] }); setShowForm(false); setEditing(null); resetForm(); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PlanoAcao.update(id, data),
    onSuccess: () => { toast.success("Atualizado!"); queryClient.invalidateQueries({ queryKey: ["planos-acao"] }); setShowForm(false); setEditing(null); resetForm(); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.PlanoAcao.delete(id),
    onSuccess: () => { toast.success("Excluído!"); queryClient.invalidateQueries({ queryKey: ["planos-acao"] }); },
  });

  function resetForm(){ setForm({ nome_plano: "", status_plano: "Rascunho", solicitante_id: "", solicitante_nome: "", descricao_objetivo: "", prioridade: "", area_padrao_id: "", area_padrao_nome: "", data_prevista_inicio: "", data_prevista_fim: "", observacoes: "", anexos: [] }); }

  const onSubmit = () => {
    if (!form.nome_plano?.trim()) { toast.error("Informe o nome do plano"); return; }
    if (!form.solicitante_id) { toast.error("Selecione o solicitante"); return; }
    const pessoa = pessoas.find(p => p.id === form.solicitante_id);
    const area = areas.find(a => a.id === form.area_padrao_id);
    const data = { ...form, solicitante_nome: pessoa?.nome || "", area_padrao_nome: area?.nome || "" };
    if (editing) updateMutation.mutate({ id: editing.id, data }); else createMutation.mutate(data);
  };

  return (
    <div className="p-4 space-y-3">
      {/* Filtros */}
      <Card>
        <CardContent className="p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar plano..." className="h-8 text-xs pl-8" />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {['Rascunho','Ativo','Concluído','Cancelado'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Prioridade</Label>
            <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todas</SelectItem>
                {['Baixa','Média','Alta'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Solicitante</Label>
            <Select value={filtroSolicitante} onValueChange={setFiltroSolicitante}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {pessoas.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Prevista Início</Label>
            <Input type="date" value={dataIni} onChange={(e)=>setDataIni(e.target.value)} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs">Prevista Fim</Label>
            <Input type="date" value={dataFim} onChange={(e)=>setDataFim(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="flex items-end gap-2 md:col-span-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setSearch(""); setFiltroStatus(""); setFiltroPrioridade(""); setFiltroSolicitante(""); setDataIni(""); setDataFim("");}}><Filter className="w-3.5 h-3.5 mr-1"/>Limpar</Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={refetch}><RefreshCw className="w-3.5 h-3.5 mr-1"/>Atualizar</Button>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={()=>{ setShowForm(true); setEditing(null); resetForm(); }}><Plus className="w-3.5 h-3.5 mr-1"/>Novo</Button>
          </div>
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardContent className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">Nome do Plano *</Label>
              <Input value={form.nome_plano} onChange={(e)=>setForm(f=>({...f,nome_plano:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status *</Label>
              <Select value={form.status_plano} onValueChange={(v)=>setForm(f=>({...f,status_plano:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue/></SelectTrigger>
                <SelectContent>
                  {['Rascunho','Ativo','Concluído','Cancelado'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Solicitante *</Label>
              <Select value={form.solicitante_id} onValueChange={(v)=>setForm(f=>({...f,solicitante_id:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>
                  {pessoas.map(p => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">Descrição/Objetivo</Label>
              <Input value={form.descricao_objetivo} onChange={(e)=>setForm(f=>({...f,descricao_objetivo:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prioridade</Label>
              <Select value={form.prioridade || ""} onValueChange={(v)=>setForm(f=>({...f,prioridade:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>
                  {['Baixa','Média','Alta'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Área padrão</Label>
              <Select value={form.area_padrao_id || ""} onValueChange={(v)=>setForm(f=>({...f,area_padrao_id:v}))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione"/></SelectTrigger>
                <SelectContent>
                  {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prevista Início</Label>
              <Input type="date" value={form.data_prevista_inicio || ""} onChange={(e)=>setForm(f=>({...f,data_prevista_inicio:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prevista Fim</Label>
              <Input type="date" value={form.data_prevista_fim || ""} onChange={(e)=>setForm(f=>({...f,data_prevista_fim:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">Observações</Label>
              <Input value={form.observacoes} onChange={(e)=>setForm(f=>({...f,observacoes:e.target.value}))} className="h-8 text-xs" />
            </div>
            <div className="flex items-center gap-2 lg:col-span-2 justify-end">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{ setShowForm(false); setEditing(null); resetForm(); }}><X className="w-3.5 h-3.5 mr-1"/>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={onSubmit}><Save className="w-3.5 h-3.5 mr-1"/>Salvar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black">Plano</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Status</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Prioridade</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Solicitante</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Prev. Início</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Prev. Fim</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-xs py-1 border border-gray-300 text-center">Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-xs py-1 border border-gray-300 text-center">Nenhum registro</TableCell></TableRow>
                ) : (
                  filtered.map(p => (
                    <TableRow key={p.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{p.nome_plano}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.status_plano}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.prioridade || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.solicitante_nome || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.data_prevista_inicio || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{p.data_prevista_fim || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{ setEditing(p); setForm({ ...p }); setShowForm(true); }}><Pencil className="w-3.5 h-3.5 mr-1"/>Editar</Button>
                          <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>{ if(confirm('Excluir plano?')) deleteMutation.mutate(p.id); }}><Trash2 className="w-3.5 h-3.5 mr-1"/>Excluir</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}