import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { Plus, Save, X, Pencil, Trash2, RefreshCw, Search, Filter, Columns } from "lucide-react";
import { toast } from "sonner";

export default function TiposTarefa() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ nome_tipo: "", grupo_atividade_id: "", ativo: true, descricao: "", exige_area: false, pode_ter_produto: false, pode_ter_maquina: false, pode_ter_implemento: false });

  // Visibilidade de colunas (persistida)
  const [colunas, setColunas] = useState({ tipo: true, grupo: true, ativo: true, criado: true, atualizado: true, acoes: true });
  useEffect(() => {
    try { const saved = localStorage.getItem('tipos_tarefa_colunas'); if (saved) setColunas(c => ({ ...c, ...JSON.parse(saved) })); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('tipos_tarefa_colunas', JSON.stringify(colunas)); } catch {}
  }, [colunas]);

  const { data: grupos = [] } = useQuery({ queryKey: ["grupos-atividades"], queryFn: () => base44.entities.GrupoAtividade.list(), initialData: [] });
  const { data: tipos = [], isLoading, refetch } = useQuery({ queryKey: ["tipos-tarefa"], queryFn: () => base44.entities.TipoTarefa.list("-updated_date"), initialData: [] });

  const filtered = useMemo(() => {
    const termo = search.toLowerCase();
    return tipos.filter(t =>
      (!termo || t.nome_tipo?.toLowerCase().includes(termo)) &&
      (!filtroGrupo || t.grupo_atividade_id === filtroGrupo) &&
      (!filtroAtivo || String(!!t.ativo) === filtroAtivo)
    );
  }, [tipos, search, filtroGrupo, filtroAtivo]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.TipoTarefa.create(data),
    onSuccess: () => { toast.success("Salvo!"); queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] }); setShowForm(false); setEditing(null); setForm({ nome_tipo: "", grupo_atividade_id: "", ativo: true, descricao: "", exige_area: false, pode_ter_produto: false, pode_ter_maquina: false, pode_ter_implemento: false }); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.TipoTarefa.update(id, data),
    onSuccess: () => { toast.success("Atualizado!"); queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] }); setShowForm(false); setEditing(null); setForm({ nome_tipo: "", grupo_atividade_id: "", ativo: true, descricao: "", exige_area: false, pode_ter_produto: false, pode_ter_maquina: false, pode_ter_implemento: false }); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.TipoTarefa.delete(id),
    onSuccess: () => { toast.success("Excluído!"); queryClient.invalidateQueries({ queryKey: ["tipos-tarefa"] }); },
  });

  const onSubmit = () => {
    if (!form.nome_tipo?.trim()) { toast.error("Informe o tipo"); return; }
    if (!form.grupo_atividade_id) { toast.error("Selecione o grupo"); return; }
    // preencher nome do grupo (cache)
    const g = grupos.find(x => x.id === form.grupo_atividade_id);
    const data = { ...form, grupo_atividade_nome: g?.nome_grupo || "" };
    if (editing) updateMutation.mutate({ id: editing.id, data }); else createMutation.mutate(data);
  };

  return (
    <div className="p-4 space-y-3">
      {/* Filtros */}
      <Card>
        <CardContent className="p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar tipo..." className="h-8 text-xs pl-8" />
          </div>
          <div>
            <Label className="text-xs">Grupo</Label>
            <Select value={filtroGrupo} onValueChange={setFiltroGrupo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.nome_grupo}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Ativo</Label>
            <Select value={filtroAtivo} onValueChange={setFiltroAtivo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                <SelectItem value="true">Sim</SelectItem>
                <SelectItem value="false">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2 md:col-span-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setSearch(""); setFiltroGrupo(""); setFiltroAtivo("");}}><Filter className="w-3.5 h-3.5 mr-1"/>Limpar</Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={refetch}><RefreshCw className="w-3.5 h-3.5 mr-1"/>Atualizar</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs"><Columns className="w-3.5 h-3.5 mr-1"/>Colunas</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuCheckboxItem checked={colunas.tipo} onCheckedChange={(v)=>setColunas(c=>({...c,tipo:!!v}))}>Tipo</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.grupo} onCheckedChange={(v)=>setColunas(c=>({...c,grupo:!!v}))}>Grupo</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.ativo} onCheckedChange={(v)=>setColunas(c=>({...c,ativo:!!v}))}>Ativo</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.criado} onCheckedChange={(v)=>setColunas(c=>({...c,criado:!!v}))}>Criado em</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.atualizado} onCheckedChange={(v)=>setColunas(c=>({...c,atualizado:!!v}))}>Atualizado em</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.acoes} onCheckedChange={(v)=>setColunas(c=>({...c,acoes:!!v}))}>Ações</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={()=>{setShowForm(true); setEditing(null); setForm({ nome_tipo: "", grupo_atividade_id: "", ativo: true, descricao: "", exige_area: false, pode_ter_produto: false, pode_ter_maquina: false, pode_ter_implemento: false });}}><Plus className="w-3.5 h-3.5 mr-1"/>Novo</Button>
          </div>
        </CardContent>
      </Card>

      {showForm && (
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

            <div className="grid grid-cols-2 gap-3 lg:col-span-2">
              <div className="space-y-1">
                <Label className="text-xs">Exige área?</Label>
                <Select value={String(form.exige_area)} onValueChange={(v)=>setForm(f=>({...f,exige_area:v==="true"}))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pode ter produto?</Label>
                <Select value={String(form.pode_ter_produto)} onValueChange={(v)=>setForm(f=>({...f,pode_ter_produto:v==="true"}))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pode ter máquina?</Label>
                <Select value={String(form.pode_ter_maquina)} onValueChange={(v)=>setForm(f=>({...f,pode_ter_maquina:v==="true"}))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pode ter implemento?</Label>
                <Select value={String(form.pode_ter_implemento)} onValueChange={(v)=>setForm(f=>({...f,pode_ter_implemento:v==="true"}))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Sim</SelectItem>
                    <SelectItem value="false">Não</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 lg:col-span-2 justify-end">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setShowForm(false); setEditing(null);}}><X className="w-3.5 h-3.5 mr-1"/>Cancelar</Button>
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
                  <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Grupo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Ativo</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Criado em</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Atualizado em</TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-xs py-1 border border-gray-300 text-center">Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-xs py-1 border border-gray-300 text-center">Nenhum registro</TableCell></TableRow>
                ) : (
                  filtered.map(t => (
                    <TableRow key={t.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300">{t.nome_tipo}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{t.grupo_atividade_nome || grupos.find(g=>g.id===t.grupo_atividade_id)?.nome_grupo || '-'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{t.ativo ? 'Sim' : 'Não'}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{new Date(t.created_date).toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">{new Date(t.updated_date).toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <div className="flex gap-1">
                          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setEditing(t); setForm({ nome_tipo: t.nome_tipo||'', grupo_atividade_id: t.grupo_atividade_id||'', ativo: !!t.ativo, descricao: t.descricao||'', exige_area: !!t.exige_area, pode_ter_produto: !!t.pode_ter_produto, pode_ter_maquina: !!t.pode_ter_maquina, pode_ter_implemento: !!t.pode_ter_implemento }); setShowForm(true);}}><Pencil className="w-3.5 h-3.5 mr-1"/>Editar</Button>
                          <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>{ if(confirm('Excluir?')) deleteMutation.mutate(t.id); }}><Trash2 className="w-3.5 h-3.5 mr-1"/>Excluir</Button>
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