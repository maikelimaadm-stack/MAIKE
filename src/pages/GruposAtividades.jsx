import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Save, X, Pencil, Trash2, RefreshCw, Search, Columns, Layers } from "lucide-react";
import { toast } from "sonner";

export default function GruposAtividades() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ nome_grupo: "", ativo: true, descricao: "", cor_icone: "", observacoes: "" });

  // Visibilidade de colunas (persistida)
  const [colunas, setColunas] = useState({ nome: true, ativo: true, criado: true, atualizado: true, acoes: true });
  useEffect(() => {
    try { const saved = localStorage.getItem('grupos_atividades_colunas'); if (saved) setColunas(c => ({ ...c, ...JSON.parse(saved) })); } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('grupos_atividades_colunas', JSON.stringify(colunas)); } catch {}
  }, [colunas]);

  // Seleção de linhas
  const [selectedItems, setSelectedItems] = useState([]);
  const toggleSelectAll = (checked) => {
    setSelectedItems(checked ? filtered.map(g => g.id) : []);
  };
  const toggleOne = (id, checked) => {
    setSelectedItems(prev => checked ? [...prev, id] : prev.filter(x => x !== id));
  };
  const handleDeleteSelected = async () => {
    if (selectedItems.length === 0) return;
    if (!confirm(`Excluir ${selectedItems.length} registro(s)?`)) return;
    for (const id of selectedItems) {
      await base44.entities.GrupoAtividade.delete(id);
    }
    toast.success('Registros excluídos!');
    setSelectedItems([]);
    queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] });
  };

  const { data: grupos = [], isLoading, refetch } = useQuery({
    queryKey: ["grupos-atividades"],
    queryFn: async () => base44.entities.GrupoAtividade.list("-updated_date"),
    initialData: []
  });

  const filtered = useMemo(() => {
    const termo = search.toLowerCase();
    return grupos.filter(g => !termo || g.nome_grupo?.toLowerCase().includes(termo));
  }, [grupos, search]);

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.GrupoAtividade.create(data),
    onSuccess: () => { toast.success("Salvo!"); queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] }); setShowForm(false); setEditing(null); setForm({ nome_grupo: "", ativo: true, descricao: "", cor_icone: "", observacoes: "" }); },
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.GrupoAtividade.update(id, data),
    onSuccess: () => { toast.success("Atualizado!"); queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] }); setShowForm(false); setEditing(null); setForm({ nome_grupo: "", ativo: true, descricao: "", cor_icone: "", observacoes: "" }); },
  });
  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.GrupoAtividade.delete(id),
    onSuccess: () => { toast.success("Excluído!"); queryClient.invalidateQueries({ queryKey: ["grupos-atividades"] }); },
  });

  const onSubmit = () => {
    if (!form.nome_grupo?.trim()) { toast.error("Informe o nome"); return; }
    const dup = grupos.find(g => g.nome_grupo?.toLowerCase() === form.nome_grupo.trim().toLowerCase() && g.id !== editing?.id);
    if (dup) { toast.error("Nome já existente"); return; }
    if (editing) updateMutation.mutate({ id: editing.id, data: form }); else createMutation.mutate(form);
  };

  return (
    <div className="p-4 space-y-3">
      <Card>
        <CardContent className="p-3 grid grid-cols-2 md:grid-cols-6 gap-2">
          <div className="md:col-span-2 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar grupo..." className="h-8 text-xs pl-8" />
          </div>
          <div className="md:col-span-4 flex items-end gap-2 justify-end">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setSearch("")}>Limpar</Button>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={refetch}><RefreshCw className="w-3.5 h-3.5 mr-1"/>Atualizar</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs"><Columns className="w-3.5 h-3.5 mr-1"/>Colunas</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuCheckboxItem checked={colunas.nome} onCheckedChange={(v)=>setColunas(c=>({...c,nome:!!v}))}>Nome</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.ativo} onCheckedChange={(v)=>setColunas(c=>({...c,ativo:!!v}))}>Ativo</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.criado} onCheckedChange={(v)=>setColunas(c=>({...c,criado:!!v}))}>Criado em</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.atualizado} onCheckedChange={(v)=>setColunas(c=>({...c,atualizado:!!v}))}>Atualizado em</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={colunas.acoes} onCheckedChange={(v)=>setColunas(c=>({...c,acoes:!!v}))}>Ações</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {selectedItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                    <Layers className="w-3.5 h-3.5"/> Ações ({selectedItems.length})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-xs text-red-600" onClick={handleDeleteSelected}>Excluir Selecionados</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            <Button onClick={() => { setShowForm(true); setEditing(null); setForm({ nome_grupo: "", ativo: true, descricao: "", cor_icone: "", observacoes: "" }); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"><Plus className="w-3.5 h-3.5 mr-1"/>Novo</Button>
          </div>
        </CardContent>
      </Card>

      {showForm && (
        <Card>
          <CardContent className="p-3 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Nome do grupo *</Label>
              <Input value={form.nome_grupo} onChange={(e)=>setForm(f=>({...f,nome_grupo:e.target.value}))} className="h-8 text-xs" />
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
            <div className="space-y-1">
              <Label className="text-xs">Cor/Ícone</Label>
              <Input value={form.cor_icone} onChange={(e)=>setForm(f=>({...f,cor_icone:e.target.value}))} className="h-8 text-xs" placeholder="ex: indigo-600 ou icon-name" />
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs">Observações</Label>
              <Input value={form.observacoes} onChange={(e)=>setForm(f=>({...f,observacoes:e.target.value}))} className="h-8 text-xs" />
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
                  <TableHead className="text-xs font-bold py-1 border border-black w-8">
                    <Checkbox 
                      checked={selectedItems.length === filtered.length && filtered.length > 0}
                      onCheckedChange={(v)=>toggleSelectAll(!!v)}
                    />
                  </TableHead>
                  {colunas.nome && <TableHead className="text-xs font-bold py-1 border border-black">Nome</TableHead>}
                  {colunas.ativo && <TableHead className="text-xs font-bold py-1 border border-black">Ativo</TableHead>}
                  {colunas.criado && <TableHead className="text-xs font-bold py-1 border border-black">Criado em</TableHead>}
                  {colunas.atualizado && <TableHead className="text-xs font-bold py-1 border border-black">Atualizado em</TableHead>}
                  {colunas.acoes && <TableHead className="text-xs font-bold py-1 border border-black">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell className="text-xs py-1 border border-gray-300 text-center" colSpan={5}>Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell className="text-xs py-1 border border-gray-300 text-center" colSpan={5}>Nenhum registro</TableCell></TableRow>
                ) : (
                  filtered.map(g => (
                    <TableRow key={g.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300 w-8">
                        <Checkbox 
                          checked={selectedItems.includes(g.id)}
                          onCheckedChange={(v)=>toggleOne(g.id, !!v)}
                        />
                      </TableCell>
                      {colunas.nome && <TableCell className="text-xs py-1 border border-gray-300">{g.nome_grupo}</TableCell>}
                      {colunas.ativo && <TableCell className="text-xs py-1 border border-gray-300">{g.ativo ? 'Sim' : 'Não'}</TableCell>}
                      {colunas.criado && <TableCell className="text-xs py-1 border border-gray-300">{new Date(g.created_date).toLocaleString('pt-BR')}</TableCell>}
                      {colunas.atualizado && <TableCell className="text-xs py-1 border border-gray-300">{new Date(g.updated_date).toLocaleString('pt-BR')}</TableCell>}
                      {colunas.acoes && (
                        <TableCell className="text-xs py-1 border border-gray-300">
                          <div className="flex gap-1">
                            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setEditing(g); setForm({ nome_grupo: g.nome_grupo||'', ativo: !!g.ativo, descricao: g.descricao||'', cor_icone: g.cor_icone||'', observacoes: g.observacoes||'' }); setShowForm(true);}}><Pencil className="w-3.5 h-3.5 mr-1"/>Editar</Button>
                            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>{ if(confirm('Excluir?')) deleteMutation.mutate(g.id); }}><Trash2 className="w-3.5 h-3.5 mr-1"/>Excluir</Button>
                          </div>
                        </TableCell>
                      )}
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