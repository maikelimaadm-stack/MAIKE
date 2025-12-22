import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Settings, MoreVertical, Layers } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function TiposTarefa() {
  const [search, setSearch] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState("");
  const [colunas, setColunas] = useState({ tipo: true, grupo: true, ativo: true, criado: true, atualizado: true, acoes: true });
  useEffect(() => { try { const s = localStorage.getItem('tipos_tarefa_colunas'); if (s) setColunas(c=>({...c, ...JSON.parse(s)})); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem('tipos_tarefa_colunas', JSON.stringify(colunas)); } catch {} }, [colunas]);
  const [selected, setSelected] = useState([]);

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

  const toggleAll = (v) => setSelected(v ? filtered.map(g=>g.id) : []);
  const toggleOne = (id, v) => setSelected(prev => v ? [...prev, id] : prev.filter(x=>x!==id));

  const excluir = async (id) => { if (!confirm('Excluir?')) return; await base44.entities.TipoTarefa.delete(id); await refetch(); };
  const excluirSelecionados = async () => { if (!confirm(`Excluir ${selected.length} registro(s)?`)) return; for (const id of selected) await base44.entities.TipoTarefa.delete(id); setSelected([]); await refetch(); };

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Tipos de Tarefa</h1>
          <p className="text-xs text-slate-600">Modelos e regras para lançamentos</p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-8 w-8">
                <Settings className="w-4 h-4" />
              </Button>
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
          <Link to={createPageUrl("TipoTarefaForm")}>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">Novo</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Buscar tipo..." className="h-8 text-xs pl-8" />
            </div>
            <Select value={filtroGrupo} onValueChange={setFiltroGrupo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Grupo"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                {grupos.map(g => <SelectItem key={g.id} value={g.id}>{g.nome_grupo}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroAtivo} onValueChange={setFiltroAtivo}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Ativo"/></SelectTrigger>
              <SelectContent>
                <SelectItem value={null}>Todos</SelectItem>
                <SelectItem value="true">Sim</SelectItem>
                <SelectItem value="false">Não</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs text-slate-500">{filtered.length} de {tipos.length} registros</div>
            <div className="flex gap-2">
              {selected.length > 0 && (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={excluirSelecionados}><Layers className="w-3.5 h-3.5 mr-1"/>Excluir Selecionados</Button>
              )}
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>{setSearch(""); setFiltroGrupo(""); setFiltroAtivo("");}}>Limpar Filtros</Button>
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
                  {colunas.tipo && <TableHead className="text-xs font-bold py-1 border border-black">Tipo</TableHead>}
                  {colunas.grupo && <TableHead className="text-xs font-bold py-1 border border-black">Grupo</TableHead>}
                  {colunas.ativo && <TableHead className="text-xs font-bold py-1 border border-black">Ativo</TableHead>}
                  {colunas.criado && <TableHead className="text-xs font-bold py-1 border border-black">Criado em</TableHead>}
                  {colunas.atualizado && <TableHead className="text-xs font-bold py-1 border border-black">Atualizado em</TableHead>}
                  {colunas.acoes && <TableHead className="text-xs font-bold py-1 border border-black w-8"></TableHead>}
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
                      <TableCell className="text-xs py-1 border border-gray-300 w-8">
                        <Checkbox checked={selected.includes(t.id)} onCheckedChange={(v)=>toggleOne(t.id, !!v)} />
                      </TableCell>
                      {colunas.tipo && <TableCell className="text-xs py-1 border border-gray-300">{t.nome_tipo}</TableCell>}
                      {colunas.grupo && <TableCell className="text-xs py-1 border border-gray-300">{t.grupo_atividade_nome || grupos.find(g=>g.id===t.grupo_atividade_id)?.nome_grupo || '-'}</TableCell>}
                      {colunas.ativo && <TableCell className="text-xs py-1 border border-gray-300">{t.ativo ? 'Sim' : 'Não'}</TableCell>}
                      {colunas.criado && <TableCell className="text-xs py-1 border border-gray-300">{new Date(t.created_date).toLocaleString('pt-BR')}</TableCell>}
                      {colunas.atualizado && <TableCell className="text-xs py-1 border border-gray-300">{new Date(t.updated_date).toLocaleString('pt-BR')}</TableCell>}
                      {colunas.acoes && (
                        <TableCell className="text-xs py-1 border border-gray-300 w-8">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-4 h-4"/></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem asChild className="text-xs">
                                <Link to={createPageUrl(`TipoTarefaForm?id=${t.id}`)}>Editar</Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-xs text-red-600" onClick={()=>excluir(t.id)}>Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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