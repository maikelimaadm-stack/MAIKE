import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Settings, MoreVertical, Plus, Trash2, Edit2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function GruposAtividades() {
  const [search, setSearch] = useState("");
  const [colunas, setColunas] = useState({ nome: true, ativo: true, criado: true, atualizado: true, acoes: true });
  useEffect(() => { try { const s = localStorage.getItem('grupos_atividades_colunas'); if (s) { const saved = JSON.parse(s); setColunas(c=>({...c, ...saved, acoes: true})); } } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('grupos_atividades_colunas', JSON.stringify(colunas)); } catch {} }, [colunas]);
  const [selected, setSelected] = useState([]);

  const { data: grupos = [], isLoading, refetch } = useQuery({ queryKey: ["grupos-atividades"], queryFn: () => base44.entities.GrupoAtividade.list("-updated_date"), initialData: [] });

  const filtered = useMemo(() => {
    const termo = search.toLowerCase();
    return grupos.filter(g => !termo || g.nome_grupo?.toLowerCase().includes(termo));
  }, [grupos, search]);

  const toggleAll = (v) => setSelected(v ? filtered.map(g=>g.id) : []);
  const toggleOne = (id, v) => setSelected(prev => v ? [...prev, id] : prev.filter(x=>x!==id));

  const excluir = async (id) => { if (!confirm('Excluir?')) return; await base44.entities.GrupoAtividade.delete(id); await refetch(); };
  const excluirSelecionados = async () => { if (!confirm(`Excluir ${selected.length} registro(s)?`)) return; for (const id of selected) await base44.entities.GrupoAtividade.delete(id); setSelected([]); await refetch(); };

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Grupos de Atividades</h1>
          <p className="text-xs text-slate-600">Cadastro e organização dos grupos de tarefas</p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs">
                <Settings className="w-3.5 h-3.5 mr-1" /> Colunas
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuCheckboxItem checked={colunas.nome} onCheckedChange={(v)=>setColunas(c=>({...c,nome:!!v}))}>Nome</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={colunas.ativo} onCheckedChange={(v)=>setColunas(c=>({...c,ativo:!!v}))}>Ativo</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={colunas.criado} onCheckedChange={(v)=>setColunas(c=>({...c,criado:!!v}))}>Criado em</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={colunas.atualizado} onCheckedChange={(v)=>setColunas(c=>({...c,atualizado:!!v}))}>Atualizado em</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={colunas.acoes} onCheckedChange={(v)=>setColunas(c=>({...c,acoes:!!v}))}>Ações</DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Link to={createPageUrl("GrupoAtividadeForm")}> 
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5 mr-1" /> Novo
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar grupo..." className="h-8 text-xs pl-8" />
            </div>
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs text-slate-500">{filtered.length} de {grupos.length} registros</div>
            <div className="flex gap-2">
              {selected.length > 0 && (
                <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={excluirSelecionados}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Excluir Selecionados
                </Button>
              )}
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>setSearch("")}>Limpar Filtros</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black w-8">
                    <Checkbox checked={selected.length === filtered.length && filtered.length>0} onCheckedChange={(v)=>toggleAll(!!v)} />
                  </TableHead>
                  {colunas.nome && <TableHead className="text-xs font-bold py-1 border border-black">Nome</TableHead>}
                  {colunas.ativo && <TableHead className="text-xs font-bold py-1 border border-black">Ativo</TableHead>}
                  {colunas.criado && <TableHead className="text-xs font-bold py-1 border border-black">Criado em</TableHead>}
                  {colunas.atualizado && <TableHead className="text-xs font-bold py-1 border border-black">Atualizado em</TableHead>}
                  {colunas.acoes && <TableHead className="text-xs font-bold py-1 border border-black w-40">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-xs py-1 border border-gray-300 text-center">Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-xs py-1 border border-gray-300 text-center">Nenhum registro</TableCell></TableRow>
                ) : (
                  filtered.map(g => (
                    <TableRow key={g.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300 w-8">
                        <Checkbox checked={selected.includes(g.id)} onCheckedChange={(v)=>toggleOne(g.id, !!v)} />
                      </TableCell>
                      {colunas.nome && <TableCell className="text-xs py-1 border border-gray-300">{g.nome_grupo}</TableCell>}
                      {colunas.ativo && <TableCell className="text-xs py-1 border border-gray-300">{g.ativo ? 'Sim' : 'Não'}</TableCell>}
                      {colunas.criado && <TableCell className="text-xs py-1 border border-gray-300">{new Date(g.created_date).toLocaleString('pt-BR')}</TableCell>}
                      {colunas.atualizado && <TableCell className="text-xs py-1 border border-gray-300">{new Date(g.updated_date).toLocaleString('pt-BR')}</TableCell>}
                      {colunas.acoes && (
                        <TableCell className="text-xs py-1 border border-gray-300 w-40">
                          <div className="flex flex-wrap gap-1">
                            <Link to={createPageUrl(`GrupoAtividadeForm?id=${g.id}`)}>
                              <Button variant="outline" size="sm" className="h-8 text-xs">
                                <Edit2 className="w-3.5 h-3.5 mr-1"/> Editar
                              </Button>
                            </Link>
                            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>excluir(g.id)}>
                              <Trash2 className="w-3.5 h-3.5 mr-1"/> Excluir
                            </Button>
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