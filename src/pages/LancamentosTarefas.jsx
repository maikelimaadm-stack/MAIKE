import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, Settings, MoreVertical, Trash2, Edit2, Copy } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function LancamentosTarefas() {
  const [search, setSearch] = useState("");
  const [periodoIni, setPeriodoIni] = useState("");
  const [periodoFim, setPeriodoFim] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fGrupo, setFGrupo] = useState("");
  const [fTipo, setFTipo] = useState("");
  const [fArea, setFArea] = useState("");
  const [fResp, setFResp] = useState("");
  const [fUrgencia, setFUrgencia] = useState("");
  const [fNivel, setFNivel] = useState("");

  const [colunas, setColunas] = useState({
    status: true, urgencia: true, grupo: true, tipo: true, area: true, responsavel: true, dataIni: true, dataFim: true, atrasada: true, acoes: true,
  });

  const [selecionados, setSelecionados] = useState([]);

  const { data: grupos = [] } = useQuery({ queryKey: ["grupos-atividades"], queryFn: () => base44.entities.GrupoAtividade.list(), initialData: [] });
  const { data: tipos = [] } = useQuery({ queryKey: ["tipos-tarefa"], queryFn: () => base44.entities.TipoTarefa.list(), initialData: [] });
  const { data: areas = [] } = useQuery({ queryKey: ["areas-pasto"], queryFn: () => base44.entities.AreaPastagem.list(), initialData: [] });
  const { data: pessoas = [] } = useQuery({ queryKey: ["contatos"], queryFn: () => base44.entities.Fornecedor.list(), initialData: [] });
  const { data: lancs = [], isLoading, refetch } = useQuery({ queryKey: ["lancamentos-tarefa"], queryFn: () => base44.entities.LancamentoTarefa.list("-updated_date"), initialData: [] });

  const filtered = useMemo(() => {
    const termo = (search || '').toLowerCase();
    return lancs.filter(l => !termo ||
      (l.nome_tipo_tarefa || '').toLowerCase().includes(termo) ||
      (l.grupo_atividade_nome || '').toLowerCase().includes(termo) ||
      (l.responsavel_nome || '').toLowerCase().includes(termo) ||
      (l.status_tarefa || '').toLowerCase().includes(termo)
    );
  }, [lancs, search]);

  const allIds = filtered.map(l => l.id);
  const todosMarcados = selecionados.length > 0 && selecionados.length === allIds.length;
  const alternarTodos = (checked) => setSelecionados(checked ? allIds : []);
  const alternarUm = (id, checked) => setSelecionados(prev => checked ? [...prev, id] : prev.filter(x => x !== id));

  const excluir = async (id) => { if (!confirm('Excluir lançamento?')) return; await base44.entities.LancamentoTarefa.delete(id); await refetch(); };
  const duplicar = async (l) => { const copy = { ...l }; delete copy.id; delete copy.created_date; delete copy.updated_date; delete copy.created_by; copy.status_tarefa = "Planejada"; await base44.entities.LancamentoTarefa.create(copy); await refetch(); };

  const limparFiltros = () => { setSearch(""); setPeriodoIni(""); setPeriodoFim(""); setFStatus(""); setFGrupo(""); setFTipo(""); setFArea(""); setFResp(""); setFUrgencia(""); setFNivel(""); };

  return (
    <div className="p-4 space-y-3">
      <div className="mb-2">
        <Card>
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-900">Lançamentos de Tarefas</div>
              <div className="text-xs text-slate-500">Gestão e controle de tarefas</div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Buscar..." value={search} onChange={(e)=>setSearch(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    <Settings className="w-3.5 h-3.5 mr-1" /> Colunas
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {Object.keys(colunas).map(key => (
                    <DropdownMenuCheckboxItem key={key} checked={colunas[key]} onCheckedChange={(v)=>setColunas(c=>({...c,[key]:!!v}))}>{key}</DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Link to={createPageUrl("LancamentoTarefaForm")}>
                <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Lançar Tarefa
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>



      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b">
                  <TableHead className="w-8 text-xs border-r border-slate-200">
                    <Checkbox checked={todosMarcados} onCheckedChange={(v)=>alternarTodos(!!v)} />
                  </TableHead>
                  <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                  {colunas.status && <TableHead className="text-xs border-r border-slate-200">Status</TableHead>}
                  {colunas.urgencia && <TableHead className="text-xs border-r border-slate-200">Urgência/Nível</TableHead>}
                  {colunas.grupo && <TableHead className="text-xs border-r border-slate-200">Grupo</TableHead>}
                  {colunas.tipo && <TableHead className="text-xs border-r border-slate-200">Tipo</TableHead>}
                  {colunas.area && <TableHead className="text-xs border-r border-slate-200">Área</TableHead>}
                  {colunas.responsavel && <TableHead className="text-xs border-r border-slate-200">Responsável</TableHead>}
                  {colunas.dataIni && <TableHead className="text-xs border-r border-slate-200">Data inicial</TableHead>}
                  {colunas.dataFim && <TableHead className="text-xs border-r border-slate-200">Data final</TableHead>}
                  {colunas.atrasada && <TableHead className="text-xs border-r border-slate-200">Atrasada?</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={100} className="text-xs py-1 border border-gray-300 text-center">Carregando...</TableCell></TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={100} className="text-xs py-1 border border-gray-300 text-center">Nenhum registro</TableCell></TableRow>
                ) : (
                  filtered.map(l => (
                    <TableRow key={l.id} className="hover:bg-gray-50">
                      <TableCell className="text-xs py-1 border border-gray-300 w-8">
                        <Checkbox checked={selecionados.includes(l.id)} onCheckedChange={(v)=>alternarUm(l.id, !!v)} />
                      </TableCell>
                      {colunas.status && <TableCell className="text-xs py-1 border border-gray-300">{l.status_tarefa}</TableCell>}
                      {colunas.urgencia && <TableCell className="text-xs py-1 border border-gray-300">{l.urgencia} / {l.nivel_urgencia}</TableCell>}
                      {colunas.grupo && <TableCell className="text-xs py-1 border border-gray-300">{l.grupo_atividade_nome}</TableCell>}
                      {colunas.tipo && <TableCell className="text-xs py-1 border border-gray-300">{l.nome_tipo_tarefa}</TableCell>}
                      {colunas.area && <TableCell className="text-xs py-1 border border-gray-300">{l.area_pasto_nome || '-'}</TableCell>}
                      {colunas.responsavel && <TableCell className="text-xs py-1 border border-gray-300">{l.responsavel_nome}</TableCell>}
                      {colunas.dataIni && <TableCell className="text-xs py-1 border border-gray-300">{l.data_inicial}</TableCell>}
                      {colunas.dataFim && <TableCell className="text-xs py-1 border border-gray-300">{l.data_final}</TableCell>}
                      {colunas.atrasada && <TableCell className="text-xs py-1 border border-gray-300">{l.atrasada ? 'Sim' : 'Não'}</TableCell>}
                      {colunas.acoes && (
                        <TableCell className="text-xs py-1 border border-gray-300 w-[260px]">
                          <div className="flex flex-wrap gap-1">
                            <Link to={createPageUrl(`LancamentoTarefaForm?id=${l.id}`)}>
                              <Button variant="outline" size="sm" className="h-8 text-xs">
                                <Edit2 className="w-3.5 h-3.5 mr-1" /> Editar
                              </Button>
                            </Link>
                            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={()=>duplicar(l)}>
                              <Copy className="w-3.5 h-3.5 mr-1" /> Duplicar
                            </Button>
                            <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={()=>excluir(l.id)}>
                              <Trash2 className="w-3.5 h-3.5 mr-1" /> Excluir
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