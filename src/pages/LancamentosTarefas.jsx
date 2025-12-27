import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, Settings, MoreVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
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
    status: true, urgencia: true, grupo: true, tipo: true, area: true, responsavel: true, dataIni: true, dataFim: true, atrasada: true
  });
  const COLUNAS_DISPONIVEIS = [
  { id: 'status', label: 'Status' },
  { id: 'urgencia', label: 'Urgência/Nível' },
  { id: 'grupo', label: 'Grupo' },
  { id: 'tipo', label: 'Tipo' },
  { id: 'area', label: 'Área' },
  { id: 'responsavel', label: 'Responsável' },
  { id: 'dataIni', label: 'Data inicial' },
  { id: 'dataFim', label: 'Data final' },
  { id: 'atrasada', label: 'Atrasada?' }];

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    try {
      const saved = localStorage.getItem('lanc_tarefas_colunas_ordem');
      return saved ? JSON.parse(saved) : COLUNAS_DISPONIVEIS.map((c) => c.id);
    } catch {return COLUNAS_DISPONIVEIS.map((c) => c.id);}
  });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [sortField, setSortField] = useState('dataIni');
  const [sortDirection, setSortDirection] = useState('asc');

  const [selecionados, setSelecionados] = useState([]);

  const { data: grupos = [] } = useQuery({ queryKey: ["grupos-atividades"], queryFn: () => base44.entities.GrupoAtividade.list(), initialData: [] });
  const { data: tipos = [] } = useQuery({ queryKey: ["tipos-tarefa"], queryFn: () => base44.entities.TipoTarefa.list(), initialData: [] });
  const { data: areas = [] } = useQuery({ queryKey: ["areas-pasto"], queryFn: () => base44.entities.AreaPastagem.list(), initialData: [] });
  const { data: pessoas = [] } = useQuery({ queryKey: ["contatos"], queryFn: () => base44.entities.Fornecedor.list(), initialData: [] });
  const { data: lancs = [], isLoading, refetch } = useQuery({ queryKey: ["lancamentos-tarefa"], queryFn: () => base44.entities.LancamentoTarefa.list("-updated_date"), initialData: [] });

  const filtered = useMemo(() => {
    const termo = (search || '').toLowerCase();
    return lancs.filter((l) => !termo ||
    (l.nome_tipo_tarefa || '').toLowerCase().includes(termo) ||
    (l.grupo_atividade_nome || '').toLowerCase().includes(termo) ||
    (l.responsavel_nome || '').toLowerCase().includes(termo) ||
    (l.status_tarefa || '').toLowerCase().includes(termo)
    );
  }, [lancs, search]);

  const handleSort = (field) => {
    if (sortField === field) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');else
    {setSortField(field);setSortDirection('asc');}
  };
  const getValueForSort = (l, field) => {
    switch (field) {
      case 'status':return (l.status_tarefa || '').toLowerCase();
      case 'urgencia':return `${l.urgencia || ''} ${l.nivel_urgencia || ''}`.toLowerCase();
      case 'grupo':return (l.grupo_atividade_nome || '').toLowerCase();
      case 'tipo':return (l.nome_tipo_tarefa || '').toLowerCase();
      case 'area':return (l.area_pasto_nome || '').toLowerCase();
      case 'responsavel':return (l.responsavel_nome || '').toLowerCase();
      case 'dataIni':return l.data_inicial || '';
      case 'dataFim':return l.data_final || '';
      case 'atrasada':return l.atrasada ? 1 : 0;
      default:return '';
    }
  };
  const lancamentosOrdenados = [...filtered].sort((a, b) => {
    const av = getValueForSort(a, sortField);
    const bv = getValueForSort(b, sortField);
    if (av < bv) return sortDirection === 'asc' ? -1 : 1;
    if (av > bv) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });
  const allIds = lancamentosOrdenados.map((l) => l.id);
  const todosMarcados = selecionados.length > 0 && selecionados.length === allIds.length;
  const alternarTodos = (checked) => setSelecionados(checked ? allIds : []);
  const alternarUm = (id, checked) => setSelecionados((prev) => checked ? [...prev, id] : prev.filter((x) => x !== id));

  const excluir = async (id) => {if (!confirm('Excluir lançamento?')) return;await base44.entities.LancamentoTarefa.delete(id);await refetch();};
  const duplicar = async (l) => {const copy = { ...l };delete copy.id;delete copy.created_date;delete copy.updated_date;delete copy.created_by;copy.status_tarefa = "Planejada";await base44.entities.LancamentoTarefa.create(copy);await refetch();};

  const limparFiltros = () => {setSearch("");setPeriodoIni("");setPeriodoFim("");setFStatus("");setFGrupo("");setFTipo("");setFArea("");setFResp("");setFUrgencia("");setFNivel("");};

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 mb-1">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Lançamentos de Tarefas</h1>
          <p className="text-xs text-slate-600">Gestão e controle de tarefas</p>
        </div>
        <div className="flex gap-2">
          <Link to={createPageUrl("LancamentoTarefaForm")}>
            <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">Lançar Tarefa</Button>
          </Link>
        </div>
      </div>





      <Card>
        <CardContent className="p-0">
          <div className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">Lançamentos ({filtered.length})</div>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." className="h-8 text-xs pl-8" />
                </div>
                <Button variant="outline" size="sm" className="bg-background pl-2 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-8" onClick={() => setShowConfigColunas(true)}>
                  <Settings className="w-3.5 h-3.5 mr-1" /> 
                </Button>              </div>
            </div>
          </div>

          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-bold py-1 border border-black w-8">
                    <Checkbox checked={todosMarcados} onCheckedChange={(v) => alternarTodos(!!v)} />
                  </TableHead>
                  <TableHead className="text-xs font-bold py-1 border border-black text-center w-8"></TableHead>
                  {colunasOrdem.filter((id) => colunas[id]).map((id) =>
                  <TableHead
                    key={id}
                    className="text-xs font-bold py-1 border border-black cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort(id)}>

                      {COLUNAS_DISPONIVEIS.find((c) => c.id === id)?.label}
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ?
                <TableRow><TableCell colSpan={100} className="text-xs py-1 border border-gray-300 text-center">Carregando...</TableCell></TableRow> :
                filtered.length === 0 ?
                <TableRow><TableCell colSpan={100} className="text-xs py-1 border border-gray-300 text-center">Nenhum registro</TableCell></TableRow> :

                lancamentosOrdenados.map((l) =>
                <TableRow key={l.id} className="hover:bg-slate-50 transition-colors border-b">
                      <TableCell className="text-xs py-1 border border-gray-300">
                        <Checkbox checked={selecionados.includes(l.id)} onCheckedChange={(v) => alternarUm(l.id, !!v)} />
                      </TableCell>
                      <TableCell className="text-center text-xs py-1 border border-gray-300">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem asChild className="text-xs">
                              <Link to={createPageUrl(`LancamentoTarefaForm?id=${l.id}`)}>Editar</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => duplicar(l)} className="text-xs">Duplicar</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => excluir(l.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                      {colunasOrdem.filter((id) => colunas[id]).map((id) =>
                  <React.Fragment key={id}>
                          {id === 'status' && <TableCell className="text-xs py-1 border border-gray-300">{l.status_tarefa}</TableCell>}
                          {id === 'urgencia' && <TableCell className="text-xs py-1 border border-gray-300">{l.urgencia} / {l.nivel_urgencia}</TableCell>}
                          {id === 'grupo' && <TableCell className="text-xs py-1 border border-gray-300">{l.grupo_atividade_nome}</TableCell>}
                          {id === 'tipo' && <TableCell className="text-xs py-1 border border-gray-300">{l.nome_tipo_tarefa}</TableCell>}
                          {id === 'area' && <TableCell className="text-xs py-1 border border-gray-300">{l.area_pasto_nome || '-'}</TableCell>}
                          {id === 'responsavel' && <TableCell className="text-xs py-1 border border-gray-300">{l.responsavel_nome}</TableCell>}
                          {id === 'dataIni' && <TableCell className="text-xs py-1 border border-gray-300">{l.data_inicial}</TableCell>}
                          {id === 'dataFim' && <TableCell className="text-xs py-1 border border-gray-300">{l.data_final}</TableCell>}
                          {id === 'atrasada' && <TableCell className="text-xs py-1 border border-gray-300">{l.atrasada ? 'Sim' : 'Não'}</TableCell>}
                        </React.Fragment>
                  )}
                      
                    </TableRow>
                )
                }
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {COLUNAS_DISPONIVEIS.map((col) =>
                <label key={col.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                    type="checkbox"
                    checked={!!colunas[col.id]}
                    onChange={() => setColunas((prev) => ({ ...prev, [col.id]: !prev[col.id] }))} />

                    <span>{col.label}</span>
                  </label>
                )}
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={(result) => {
                if (!result.destination) return;
                const items = Array.from(colunasOrdem);
                const [reordered] = items.splice(result.source.index, 1);
                items.splice(result.destination.index, 0, reordered);
                setColunasOrdem(items);
                try {localStorage.setItem('lanc_tarefas_colunas_ordem', JSON.stringify(items));} catch {}
              }}>
                <Droppable droppableId="colunas">
                  {(provided) =>
                  <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((id, idx) => {
                      const col = COLUNAS_DISPONIVEIS.find((c) => c.id === id);
                      if (!col) return null;
                      return (
                        <Draggable key={id} draggableId={id} index={idx}>
                            {(prov, snapshot) =>
                          <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps} className={`flex items-center gap-2 p-2 border rounded text-xs ${snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'} ${!colunas[id] ? 'opacity-50' : ''}`}>
                                <span className="flex-1">{col.label}</span>
                                {colunas[id] && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Visível</span>}
                              </div>
                          }
                          </Draggable>);

                    })}
                      {provided.placeholder}
                    </div>
                  }
                </Droppable>
              </DragDropContext>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>);

}