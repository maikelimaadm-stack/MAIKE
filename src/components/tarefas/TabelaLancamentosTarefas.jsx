import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import TarefaDetalhesDialog from "@/components/tarefas/TarefaDetalhesDialog";
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, Filter, X } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const PRIORIDADE_CORES = {
  Baixa: "bg-blue-300 text-black hover:bg-blue-300",
  Média: "bg-yellow-300 text-black hover:bg-yellow-300",
  Alta: "bg-red-400 text-black hover:bg-red-400",
  Concluida: "bg-slate-300 text-black hover:bg-slate-300"
};

const STATUS_CORES = {
  Pendente: "bg-yellow-300 text-black hover:bg-yellow-300",
  "Em Andamento": "bg-blue-300 text-black hover:bg-blue-300",
  Concluída: "bg-emerald-300 text-black hover:bg-emerald-300",
  Cancelada: "bg-slate-300 text-black hover:bg-slate-300"
};

const COLUNAS_DISPONIVEIS = [
{ id: "selecao", label: "Seleção", default: true, fixo: true },
{ id: "acoes", label: "Ações", default: true, fixo: true },
{ id: "titulo", label: "Tarefa", default: true, sortable: true, align: "left" },
{ id: "descricao", label: "Descrição", default: true, sortable: false, align: "left" },
{ id: "prioridade", label: "Prioridade", default: true, sortable: true, align: "left" },
{ id: "status", label: "Status", default: true, sortable: true, align: "left" },
{ id: "grupo_atividade_nome", label: "Grupo", default: true, sortable: true, align: "left" },
{ id: "tipo", label: "Tipo Base", default: true, sortable: true, align: "left" },
{ id: "tipo_tarefa_nome", label: "Tipo de Tarefa", default: true, sortable: true, align: "left" },
{ id: "setor_nome", label: "Fazenda", default: true, sortable: true, align: "left" },
{ id: "area_nome", label: "Área", default: true, sortable: true, align: "left" },
{ id: "solicitante", label: "Solicitante", default: true, sortable: true, align: "left" },
{ id: "responsavel", label: "Responsável", default: true, sortable: true, align: "left" },
{ id: "data_pedido", label: "Data Pedido", default: true, sortable: true, align: "left" },
{ id: "data_prevista", label: "Prazo", default: true, sortable: true, align: "left" },
{ id: "data_conclusao", label: "Conclusão", default: true, sortable: true, align: "left" },
{ id: "observacoes", label: "Observações", default: true, sortable: false, align: "left" },
{ id: "observacoes_conclusao", label: "Obs. Conclusão", default: true, sortable: false, align: "left" }];

const DEFAULT_VISIBLE_COLUMNS = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);


export default function TabelaLancamentosTarefas({
  tarefas,
  grupos,
  onDelete,
  getIconePrioridade,
  normalizeTaskPriority,
  showConfigColunas,
  setShowConfigColunas
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("__TODOS__");
  const [filtroPrioridade, setFiltroPrioridade] = useState("__TODOS__");
  const [filtroGrupo, setFiltroGrupo] = useState("__TODOS__");
  const [filtroTipoTarefa, setFiltroTipoTarefa] = useState("__TODOS__");
  const [filtroArea, setFiltroArea] = useState("__TODOS__");
  const [filtroSetor, setFiltroSetor] = useState("__TODOS__");
  const [filtroTitulo, setFiltroTitulo] = useState("");
  const [filtroDescricao, setFiltroDescricao] = useState("");
  const [filtroResponsavel, setFiltroResponsavel] = useState("");
  const [filtroSolicitante, setFiltroSolicitante] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "titulo", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [detalheTarefa, setDetalheTarefa] = useState(null);
  const lastTapRef = useRef({ id: null, time: 0 });
  const [filtrosVisivel, setFiltrosVisivel] = useState(false);

  const toggleFiltros = () => {
    setFiltrosVisivel((prev) => !prev);
  };

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_gestao_tarefas");
    if (saved) {
      try {return JSON.parse(saved);} catch {return COLUNAS_DISPONIVEIS.map((c) => c.id);}
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_gestao_tarefas");
    if (saved) {
      try {return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE_COLUMNS]));} catch {return DEFAULT_VISIBLE_COLUMNS;}
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => tarefas.some((item) => item.id === id)));
  }, [tarefas]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, filtroStatus, filtroPrioridade, filtroGrupo, filtroTipoTarefa, filtroArea, filtroSetor, filtroTitulo, filtroDescricao, filtroResponsavel, filtroSolicitante, itemsPerPage]);

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId) ?
    colunasVisiveis.filter((id) => id !== colunaId) :
    [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem("colunas_visiveis_gestao_tarefas", JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_gestao_tarefas", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem.
    map((id) => COLUNAS_DISPONIVEIS.find((coluna) => coluna.id === id)).
    filter((coluna) => coluna && colunasVisiveis.includes(coluna.id));
  }, [colunasOrdem, colunasVisiveis]);

  const setores = useMemo(() => [...new Set(tarefas.map((item) => item.setor_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })), [tarefas]);
  const tiposTarefa = useMemo(() => [...new Set(tarefas.map((item) => item.tipo_tarefa_nome || item.tipo).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })), [tarefas]);
  const areas = useMemo(() => [...new Set(tarefas.map((item) => item.area_nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })), [tarefas]);

  const abrirDetalhe = (tarefa) => setDetalheTarefa(tarefa);

  const handleRowTouch = (tarefa, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === tarefa.id && now - lastTapRef.current.time < 300) {
      event.preventDefault();
      abrirDetalhe(tarefa);
    }
    lastTapRef.current = { id: tarefa.id, time: now };
  };

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((tarefa) => {
      const termo = searchTerm.toLowerCase();
      const prioridade = normalizeTaskPriority(tarefa.prioridade);
      const matchSearch =
      !termo ||
      [
      tarefa.titulo,
      tarefa.descricao,
      tarefa.tipo,
      tarefa.tipo_tarefa_nome,
      tarefa.grupo_atividade_nome,
      tarefa.area_nome,
      tarefa.responsavel,
      tarefa.solicitante,
      tarefa.setor_nome,
      tarefa.observacoes,
      tarefa.observacoes_conclusao].
      some((value) => String(value || "").toLowerCase().includes(termo));
      const matchStatus = filtroStatus === "__TODOS__" || tarefa.status === filtroStatus;
      const matchPrioridade = filtroPrioridade === "__TODOS__" || prioridade === filtroPrioridade;
      const matchGrupo = filtroGrupo === "__TODOS__" || tarefa.grupo_atividade_nome === filtroGrupo;
      const matchTipoTarefa = filtroTipoTarefa === "__TODOS__" || (tarefa.tipo_tarefa_nome || tarefa.tipo) === filtroTipoTarefa;
      const matchArea = filtroArea === "__TODOS__" || tarefa.area_nome === filtroArea;
      const matchSetor = filtroSetor === "__TODOS__" || tarefa.setor_nome === filtroSetor;
      const matchTitulo = !filtroTitulo || String(tarefa.titulo || "").toLowerCase().includes(filtroTitulo.toLowerCase());
      const matchDescricao = !filtroDescricao || String(tarefa.descricao || "").toLowerCase().includes(filtroDescricao.toLowerCase());
      const matchResponsavel = !filtroResponsavel || String(tarefa.responsavel || "").toLowerCase().includes(filtroResponsavel.toLowerCase());
      const matchSolicitante = !filtroSolicitante || String(tarefa.solicitante || "").toLowerCase().includes(filtroSolicitante.toLowerCase());
      return matchSearch && matchStatus && matchPrioridade && matchGrupo && matchTipoTarefa && matchArea && matchSetor && matchTitulo && matchDescricao && matchResponsavel && matchSolicitante;
    });
  }, [tarefas, searchTerm, filtroStatus, filtroPrioridade, filtroGrupo, filtroTipoTarefa, filtroArea, filtroSetor, filtroTitulo, filtroDescricao, filtroResponsavel, filtroSolicitante, normalizeTaskPriority]);

  const tarefasOrdenadas = useMemo(() => {
    const sorted = [...tarefasFiltradas];
    sorted.sort((a, b) => {
      const resolve = (item) => {
        if (sortConfig.key === "prioridade") return String(normalizeTaskPriority(item.prioridade) || "").toLowerCase();
        if (sortConfig.key === "tipo_tarefa_nome") return String(item.tipo_tarefa_nome || item.tipo || "").toLowerCase();
        return String(item[sortConfig.key] || "").toLowerCase();
      };
      const aVal = resolve(a);
      const bVal = resolve(b);
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [tarefasFiltradas, sortConfig, normalizeTaskPriority]);

  const totalPages = Math.max(1, Math.ceil(tarefasOrdenadas.length / itemsPerPage));
  const tarefasPaginadas = tarefasOrdenadas.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleSort = (key) => {
    setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  };

  const SortIcon = ({ column }) => {
    if (sortConfig.key !== column) return <ArrowUpDown className="w-3 h-3 ml-1 text-slate-300" />;
    return sortConfig.direction === "asc" ?
    <ArrowUp className="w-3 h-3 ml-1 text-slate-300" /> :
    <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(tarefasFiltradas.map((item) => item.id));
  };
  const formatarData = (data) => {
    if (!data) return "-";
    const d = new Date(data + "T00:00:00");
    return d.toLocaleDateString("pt-BR");
  };
  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroStatus("__TODOS__");
    setFiltroPrioridade("__TODOS__");
    setFiltroGrupo("__TODOS__");
    setFiltroTipoTarefa("__TODOS__");
    setFiltroArea("__TODOS__");
    setFiltroSetor("__TODOS__");
    setFiltroTitulo("");
    setFiltroDescricao("");
    setFiltroResponsavel("");
    setFiltroSolicitante("");
  };

  const renderCell = (tarefa, colunaId) => {
    const prioridade = normalizeTaskPriority(tarefa.prioridade);
    const prioridadeClassName = tarefa.status === "Concluída" ? PRIORIDADE_CORES.Concluida : PRIORIDADE_CORES[prioridade] || PRIORIDADE_CORES.Baixa;
    if (colunaId === "titulo") return tarefa.titulo || "-";
    if (colunaId === "descricao") return tarefa.descricao || "-";
    if (colunaId === "prioridade") return <div className="flex items-center gap-2"><Badge className={`text-[10px] ${prioridadeClassName}`}>{prioridade || "-"}</Badge></div>;
    if (colunaId === "status") return <Badge className={`text-[10px] ${STATUS_CORES[tarefa.status] || STATUS_CORES.Pendente}`}>{tarefa.status || "-"}</Badge>;
    if (colunaId === "grupo_atividade_nome") return tarefa.grupo_atividade_nome || "-";
    if (colunaId === "tipo") return tarefa.tipo || "-";
    if (colunaId === "tipo_tarefa_nome") return tarefa.tipo_tarefa_nome || tarefa.tipo || "-";
    if (colunaId === "setor_nome") return tarefa.setor_nome || "-";
    if (colunaId === "area_nome") return tarefa.area_nome || "-";
    if (colunaId === "responsavel") return tarefa.responsavel || "-";
    if (colunaId === "data_pedido") return formatarData(tarefa.data_pedido);
    if (colunaId === "data_prevista") return formatarData(tarefa.data_prevista);
    if (colunaId === "data_conclusao") return formatarData(tarefa.data_conclusao);
    if (colunaId === "solicitante") return tarefa.solicitante || "-";
    if (colunaId === "observacoes") return tarefa.observacoes || "-";
    if (colunaId === "observacoes_conclusao") return tarefa.observacoes_conclusao || "-";
    return "-";
  };

  return (
    <div className="space-y-1">
<Card>
  {/* HEADER COM BOTÃO */}
  <div className="bg-slate-50 pr-1 pl-1 flex items-center justify-between border-b">
    <span className="text-sm font-semibold text-slate-900">
      Filtros
    </span>

    <Button
            variant="ghost"
            size="sm"
            onClick={toggleFiltros} className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:bg-accent hover:text-accent-foreground rounded-md px-1 h-6 text-xs">
            
            
      {filtrosVisivel ? 'Ocultar' : 'Mostrar'}
    </Button>
  </div>

  {/* CONTEÚDO CONTROLADO */}
  {filtrosVisivel &&
        <CardContent className="p-1">
      <div className="grid grid-cols-2 md:grid-cols-8 gap-1">
        <div className="md:col-span-0 space-y-0">
          <Label className="text-xs">Buscar</Label>
          <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar tarefa, tipo, área..."
                className="flex min-w-[130px] max-w-[180px] w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm h-7 text-xs" />
              
        </div>

        <div className="min-w-[130px] max-w-[180px] w-full">
          <Label className="text-xs">Status</Label>
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__TODOS__">Todos</SelectItem>
              <SelectItem value="Pendente">Pendente</SelectItem>
              <SelectItem value="Em Andamento">Em Andamento</SelectItem>
              <SelectItem value="Concluída">Concluída</SelectItem>
              <SelectItem value="Cancelada">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* (mantive seu resto igual, só compactei visual) */}

        <div className="min-w-[130px] max-w-[180px] w-full">
          <Label className="text-xs">Grupo</Label>
          <Select value={filtroGrupo} onValueChange={setFiltroGrupo}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__TODOS__">Todos</SelectItem>
              {grupos.map((grupo) =>
                  <SelectItem key={grupo} value={grupo}>{grupo}</SelectItem>
                  )}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[130px] max-w-[180px] w-full">
          <Label className="text-xs">Tipo de tarefa</Label>
          <Select value={filtroTipoTarefa} onValueChange={setFiltroTipoTarefa}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__TODOS__">Todos</SelectItem>
              {tiposTarefa.map((tipo) =>
                  <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                  )}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[130px] max-w-[180px] w-full">
          <Label className="text-xs">Área</Label>
          <Select value={filtroArea} onValueChange={setFiltroArea}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__TODOS__">Todas</SelectItem>
              {areas.map((area) =>
                  <SelectItem key={area} value={area}>{area}</SelectItem>
                  )}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-[130px] max-w-[180px] w-full">
          <Label className="text-xs">Fazenda</Label>
          <Select value={filtroSetor} onValueChange={setFiltroSetor}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__TODOS__">Todos</SelectItem>
              {setores.map((setor) =>
                  <SelectItem key={setor} value={setor}>{setor}</SelectItem>
                  )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-between items-center mt-1 gap-2 flex-wrap">
        <div className="text-xs text-slate-500">
          {tarefasFiltradas.length} de {tarefas.length} registros
        </div>

        <div className="flex gap-2 flex-wrap">
          {selectedItems.length > 0 &&
              <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Ações ({selectedItems.length})
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent>
                <DropdownMenuLabel className="text-xs">
                  Ações em Lote
                </DropdownMenuLabel>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                    onClick={() => onDelete(selectedItems)}
                    className="text-xs text-red-600">
                    
                  Excluir Selecionados
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                    onClick={() => setSelectedItems([])}
                    className="text-xs">
                    
                  Limpar Seleção
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
              }

          <Button
                variant="outline"
                size="sm"
                onClick={limparFiltros}
                className="h-7 text-xs gap-1 px-2">
                <X className="w-3 h-3" />
            Limpar Filtros
          </Button>
        </div>
      </div>
    </CardContent>
        }
</Card>

      <Card>
        <CardContent className="p-0">
          <div className="relative w-full overflow-auto max-h-[calc(100vh-220px)]">
            <Table className="w-full min-w-[900px] border-separate border-spacing-0">
              <TableHeader className="bg-white">
                <TableRow className="sticky top-0 z-30 bg-white">
                  {colunasOrdenadas.map((coluna) => {
                    if (coluna.id === "selecao") return <TableHead key="selecao" className="sticky top-0 left-0 z-40 h-10 p-0 bg-white text-muted-foreground font-medium text-center w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0 border-r border-b border-gray-200 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gray-200"><Checkbox checked={selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0} onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 shadow-lg\nfocus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400\ndisabled:cursor-not-allowed disabled:opacity-70\ndata-[state=checked]:bg-primary\ndata-[state=checked]:text-primary-foreground" /></TableHead>;
                    if (coluna.id === "acoes") return <TableHead key="acoes" className="sticky top-0 left-0 z-40 h-10 p-0 bg-white text-muted-foreground font-medium text-center w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0 border-r border-b border-gray-200 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gray-200"></TableHead>;
                    const isRight = coluna.align === "right";
                    const filterControl = coluna.id === "titulo" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56 p-2"><Input value={filtroTitulo} onChange={(e) => setFiltroTitulo(e.target.value)} placeholder="Filtrar tarefa" className="h-7 text-[10px]" /></DropdownMenuContent></DropdownMenu> : coluna.id === "descricao" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56 p-2"><Input value={filtroDescricao} onChange={(e) => setFiltroDescricao(e.target.value)} placeholder="Filtrar descrição" className="h-7 text-[10px]" /></DropdownMenuContent></DropdownMenu> : coluna.id === "prioridade" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48 p-2"><Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}><SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="__TODOS__">Todos</SelectItem><SelectItem value="Baixa">Baixa</SelectItem><SelectItem value="Média">Média</SelectItem><SelectItem value="Alta">Alta</SelectItem></SelectContent></Select></DropdownMenuContent></DropdownMenu> : coluna.id === "status" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52 p-2"><Select value={filtroStatus} onValueChange={setFiltroStatus}><SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="__TODOS__">Todos</SelectItem><SelectItem value="Pendente">Pendente</SelectItem><SelectItem value="Em Andamento">Em Andamento</SelectItem><SelectItem value="Concluída">Concluída</SelectItem><SelectItem value="Cancelada">Cancelada</SelectItem></SelectContent></Select></DropdownMenuContent></DropdownMenu> : coluna.id === "grupo_atividade_nome" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56 p-2"><Select value={filtroGrupo} onValueChange={setFiltroGrupo}><SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="__TODOS__">Todos</SelectItem>{grupos.map((grupo) => <SelectItem key={grupo} value={grupo}>{grupo}</SelectItem>)}</SelectContent></Select></DropdownMenuContent></DropdownMenu> : coluna.id === "tipo_tarefa_nome" || coluna.id === "tipo" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56 p-2"><Select value={filtroTipoTarefa} onValueChange={setFiltroTipoTarefa}><SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="__TODOS__">Todos</SelectItem>{tiposTarefa.map((tipo) => <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>)}</SelectContent></Select></DropdownMenuContent></DropdownMenu> : coluna.id === "setor_nome" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56 p-2"><Select value={filtroSetor} onValueChange={setFiltroSetor}><SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="__TODOS__">Todos</SelectItem>{setores.map((setor) => <SelectItem key={setor} value={setor}>{setor}</SelectItem>)}</SelectContent></Select></DropdownMenuContent></DropdownMenu> : coluna.id === "area_nome" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56 p-2"><Select value={filtroArea} onValueChange={setFiltroArea}><SelectTrigger className="h-7 text-[10px]"><SelectValue placeholder="Todos" /></SelectTrigger><SelectContent><SelectItem value="__TODOS__">Todos</SelectItem>{areas.map((area) => <SelectItem key={area} value={area}>{area}</SelectItem>)}</SelectContent></Select></DropdownMenuContent></DropdownMenu> : coluna.id === "responsavel" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56 p-2"><Input value={filtroResponsavel} onChange={(e) => setFiltroResponsavel(e.target.value)} placeholder="Filtrar responsável" className="h-7 text-[10px]" /></DropdownMenuContent></DropdownMenu> : coluna.id === "solicitante" ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-300 hover:text-slate-400"><Filter className="w-2 h-2" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56 p-2"><Input value={filtroSolicitante} onChange={(e) => setFiltroSolicitante(e.target.value)} placeholder="Filtrar solicitante" className="h-7 text-[10px]" /></DropdownMenuContent></DropdownMenu> : null;
                    return <TableHead key={coluna.id} className="sticky top-0 h-10 relative align-middle text-gray-900 px-6 pr-6 text-xs font-medium text-center border-r border-b border-gray-200 bg-white min-w-[160px] z-30 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-gray-200" onClick={() => coluna.sortable && handleSort(coluna.id)}><div className="inline-flex items-center justify-center gap-1 h-full w-full">{coluna.label} {coluna.sortable && <SortIcon column={coluna.id} />}</div>{filterControl ? <div className="absolute right-1 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>{filterControl}{(coluna.id === "titulo" && filtroTitulo) || (coluna.id === "descricao" && filtroDescricao) || (coluna.id === "prioridade" && filtroPrioridade !== "__TODOS__") || (coluna.id === "status" && filtroStatus !== "__TODOS__") || (coluna.id === "grupo_atividade_nome" && filtroGrupo !== "__TODOS__") || ((coluna.id === "tipo_tarefa_nome" || coluna.id === "tipo") && filtroTipoTarefa !== "__TODOS__") || (coluna.id === "setor_nome" && filtroSetor !== "__TODOS__") || (coluna.id === "area_nome" && filtroArea !== "__TODOS__") || (coluna.id === "responsavel" && filtroResponsavel) || (coluna.id === "solicitante" && filtroSolicitante) ? <Button variant="ghost" size="icon" className="h-3 w-3 min-w-3 p-0 text-slate-400 hover:text-slate-600" onClick={(e) => {e.stopPropagation();if (coluna.id === "titulo") setFiltroTitulo("");if (coluna.id === "descricao") setFiltroDescricao("");if (coluna.id === "prioridade") setFiltroPrioridade("__TODOS__");if (coluna.id === "status") setFiltroStatus("__TODOS__");if (coluna.id === "grupo_atividade_nome") setFiltroGrupo("__TODOS__");if (coluna.id === "tipo_tarefa_nome" || coluna.id === "tipo") setFiltroTipoTarefa("__TODOS__");if (coluna.id === "setor_nome") setFiltroSetor("__TODOS__");if (coluna.id === "area_nome") setFiltroArea("__TODOS__");if (coluna.id === "responsavel") setFiltroResponsavel("");if (coluna.id === "solicitante") setFiltroSolicitante("");}}><X className="w-2 h-2" /></Button> : null}</div> : null}</TableHead>;
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tarefasPaginadas.length === 0 ?
                <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhuma tarefa encontrada</TableCell></TableRow> :
                tarefasPaginadas.map((tarefa) =>
                <TableRow
                  key={tarefa.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100 hover:text-gray-1000"

                  onDoubleClick={() => abrirDetalhe(tarefa)}
                  onTouchEnd={(event) => handleRowTouch(tarefa, event)}>
                    {colunasOrdenadas.map((coluna) => {
                    if (coluna.id === "selecao") return <TableCell key={`${tarefa.id}-selecao`} className="p-0 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0" onClick={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}><Checkbox checked={selectedItems.includes(tarefa.id)} onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, tarefa.id] : prev.filter((id) => id !== tarefa.id))} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 shadow-lg\nfocus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400\ndisabled:cursor-not-allowed disabled:opacity-70\ndata-[state=checked]:bg-primary\ndata-[state=checked]:text-primary-foreground" /></TableCell>;
                    if (coluna.id === "acoes") return <TableCell key={`${tarefa.id}-acoes`} className="p-0 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0" onClick={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem asChild className="text-xs"><Link to={createPageUrl(`LancamentoTarefaForm?id=${tarefa.id}`)}>Editar</Link></DropdownMenuItem><DropdownMenuItem onClick={() => onDelete(tarefa.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>;
                    return <TableCell key={`${tarefa.id}-${coluna.id}`} className="p-2 text-gray-700 text-xs align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] px-2 h-7 border border-gray-300">{renderCell(tarefa, coluna.id)}</TableCell>;
                  })}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between p-1 border-t">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Itens por página:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => {setItemsPerPage(Number(v));setCurrentPage(1);}}>
                <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)} className="h-7 text-xs">Anterior</Button>
              <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="h-7 text-xs">Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ConfiguracaoColunasMapaDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd}
        droppableId="colunas-gestao-tarefas" />

      <TarefaDetalhesDialog
        open={!!detalheTarefa}
        onOpenChange={(open) => !open && setDetalheTarefa(null)}
        tarefa={detalheTarefa}
        onSaved={(updated) => setDetalheTarefa(updated)} />
      
      
    </div>);

}