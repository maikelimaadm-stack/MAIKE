import React, { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Settings, MoreVertical, Layers, Plus, Trash2, Edit2 } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function TiposTarefa() {
  const [search, setSearch] = useState("");
  const [filtroGrupo, setFiltroGrupo] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState("");
  const [colunas, setColunas] = useState({ tipo: true, grupo: true, ativo: true, criado: true, atualizado: true, acoes: true });
  useEffect(() => { try { const s = localStorage.getItem('tipos_tarefa_colunas'); if (s) { const saved = JSON.parse(s); setColunas(c=>({...c, ...saved, acoes: true})); } } catch {} }, []);
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
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-1">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Tipos de Tarefa</h1>
          <p className="text-xs text-slate-600">Modelos e regras para lançamentos</p>
        </div>
        <div className="flex gap-2">
          <Link to={createPageUrl("TipoTarefaForm")}>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-3.5 h-3.5 mr-1"/> Novo
            </Button>
          </Link>
        </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">Tipos ({filtered.length})</div>
                <div className="flex gap-2">
                  {selected.length > 0 && (
                    <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={excluirSelecionados}>
                      <Trash2 className="w-3.5 h-3.5 mr-1"/> Excluir Selecionados
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="overflow-auto">
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
                  {colunas.acoes && <TableHead className="text-xs font-bold py-1 border border-black w-40">Ações</TableHead>}
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
                        <TableCell className="text-xs py-1 border border-gray-300 w-40">
                          <div className="flex flex-wrap gap-1">
                            <Link to={createPageUrl(`TipoTarefaForm?id=${t.id}`)}>
                              <Button variant="outline" size="sm" className="h-8 text-xs">
                                <Edit2 className="w-3.5 h-3.5 mr-1"/> Editar
                              </Button>
                            </Link>
                            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>excluir(t.id)}>
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