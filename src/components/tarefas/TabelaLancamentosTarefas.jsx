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
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";

const PRIORIDADE_CORES = {
  Baixa: "bg-blue-100 text-blue-700",
  Média: "bg-orange-100 text-orange-700",
  Alta: "bg-red-100 text-red-700",
  Concluida: "bg-slate-100 text-slate-500"
};

const STATUS_CORES = {
  Pendente: "bg-yellow-100 text-yellow-700",
  "Em Andamento": "bg-blue-100 text-blue-700",
  Concluída: "bg-emerald-100 text-emerald-700",
  Cancelada: "bg-slate-100 text-slate-500"
};

const COLUNAS_DISPONIVEIS = [
{ id: "selecao", label: "Seleção", default: true, fixo: true },
{ id: "acoes", label: "Ações", default: true, fixo: true },
{ id: "titulo", label: "Tarefa", default: true, sortable: true, align: "left" },
{ id: "descricao", label: "Descrição", default: true, sortable: false, align: "left" },
{ id: "status", label: "Status", default: true, sortable: true, align: "left" },
{ id: "prioridade", label: "Prioridade", default: true, sortable: true, align: "left" },
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
  const [sortConfig, setSortConfig] = useState({ key: "titulo", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [detalheTarefa, setDetalheTarefa] = useState(null);
  const lastTapRef = useRef({ id: null, time: 0 });
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
  }, [searchTerm, filtroStatus, filtroPrioridade, filtroGrupo, filtroTipoTarefa, filtroArea, filtroSetor, itemsPerPage]);

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

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((tarefa) => {
      const termo = searchTerm.toLowerCase();
      const prioridade = normalizeTaskPriority(tarefa.prioridade);
      const matchSearch =
      !termo ||
      [tarefa.titulo, tarefa.tipo_tarefa_nome, tarefa.grupo_atividade_nome, tarefa.area_nome, tarefa.responsavel, tarefa.solicitante, tarefa.setor_nome].
      some((value) => String(value || "").toLowerCase().includes(termo));
      const matchStatus = filtroStatus === "__TODOS__" || tarefa.status === filtroStatus;
      const matchPrioridade = filtroPrioridade === "__TODOS__" || prioridade === filtroPrioridade;
      const matchGrupo = filtroGrupo === "__TODOS__" || tarefa.grupo_atividade_nome === filtroGrupo;
      const matchSetor = filtroSetor === "__TODOS__" || tarefa.setor_nome === filtroSetor;
      return matchSearch && matchStatus && matchPrioridade && matchGrupo && matchSetor;
    });
  }, [tarefas, searchTerm, filtroStatus, filtroPrioridade, filtroGrupo, filtroSetor, normalizeTaskPriority]);

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
    if (sortConfig.key !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortConfig.direction === "asc" ?
    <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" /> :
    <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(tarefasFiltradas.map((item) => item.id));
  };

  const limparFiltros = () => {
    setSearchTerm("");
    setFiltroStatus("__TODOS__");
    setFiltroPrioridade("__TODOS__");
    setFiltroGrupo("__TODOS__");
    setFiltroSetor("__TODOS__");
  };

  const renderCell = (tarefa, colunaId) => {
    const prioridade = normalizeTaskPriority(tarefa.prioridade);
    if (colunaId === "titulo") return tarefa.titulo || "-";
    if (colunaId === "status") return <Badge className={`text-[10px] ${STATUS_CORES[tarefa.status] || STATUS_CORES.Pendente}`}>{tarefa.status || "-"}</Badge>;
    if (colunaId === "prioridade") return <div className="flex items-center gap-2"><Badge className={`text-[10px] ${PRIORIDADE_CORES[prioridade] || PRIORIDADE_CORES.Baixa}`}>{prioridade || "-"}</Badge></div>;
    if (colunaId === "grupo_atividade_nome") return tarefa.grupo_atividade_nome || "-";
    if (colunaId === "tipo_tarefa_nome") return tarefa.tipo_tarefa_nome || tarefa.tipo || "-";
    if (colunaId === "area_nome") return tarefa.area_nome || "-";
    if (colunaId === "responsavel") return tarefa.responsavel || "-";
    if (colunaId === "data_prevista") return tarefa.data_prevista || "-";
    if (colunaId === "solicitante") return tarefa.solicitante || "-";
    if (colunaId === "observacoes") return tarefa.observacoes || "-";
    return "-";
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-1">
            <div className="md:col-span-2 space-y-1">
              <Label className="text-xs">Buscar</Label>
              <Input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Buscar tarefa, grupo, área..." className="h-8 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__TODOS__" className="text-xs">Todos</SelectItem>
                  <SelectItem value="Pendente" className="text-xs">Pendente</SelectItem>
                  <SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem>
                  <SelectItem value="Concluída" className="text-xs">Concluída</SelectItem>
                  <SelectItem value="Cancelada" className="text-xs">Cancelada</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Prioridade</Label>
              <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__TODOS__" className="text-xs">Todas</SelectItem>
                  <SelectItem value="Baixa" className="text-xs">Baixa</SelectItem>
                  <SelectItem value="Média" className="text-xs">Média</SelectItem>
                  <SelectItem value="Alta" className="text-xs">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Grupo</Label>
              <Select value={filtroGrupo} onValueChange={setFiltroGrupo}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__TODOS__" className="text-xs">Todos</SelectItem>
                  {grupos.map((grupo) => <SelectItem key={grupo} value={grupo} className="text-xs">{grupo}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Setor</Label>
              <Select value={filtroSetor} onValueChange={setFiltroSetor}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__TODOS__" className="text-xs">Todos</SelectItem>
                  {setores.map((setor) => <SelectItem key={setor} value={setor} className="text-xs">{setor}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-between items-center mt-2 gap-2 flex-wrap">
            <div className="text-xs text-slate-500">{tarefasFiltradas.length} de {tarefas.length} registros</div>
            <div className="flex gap-2 flex-wrap">
              {selectedItems.length > 0 &&
              <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onDelete(selectedItems)} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">Limpar Seleção</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
              <Button variant="outline" size="sm" onClick={limparFiltros} className="h-7 text-xs">Limpar Filtros</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow className="bg-white border-b">
                  {colunasOrdenadas.map((coluna) => {
                    if (coluna.id === "selecao") return <TableHead key="selecao" className="text-xs py-2 px-2"><Checkbox checked={selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0} onCheckedChange={toggleSelectAll} /></TableHead>;
                    if (coluna.id === "acoes") return <TableHead key="acoes" className="text-xs py-2 px-2"></TableHead>;
                    const isRight = coluna.align === "right";
                    return <TableHead key={coluna.id} className={`text-xs py-2 px-3 ${coluna.sortable ? "cursor-pointer hover:bg-gray-50" : ""} ${isRight ? "text-right" : ""}`} onClick={() => coluna.sortable && handleSort(coluna.id)}><div className={`flex items-center gap-1 ${isRight ? "justify-end" : ""}`}>{coluna.label} {coluna.sortable && <SortIcon column={coluna.id} />}</div></TableHead>;
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tarefasPaginadas.length === 0 ?
                <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhuma tarefa encontrada</TableCell></TableRow> :
                tarefasPaginadas.map((tarefa) =>
                <TableRow key={tarefa.id} className="hover:bg-gray-50 border-b">
                    {colunasOrdenadas.map((coluna) => {
                    if (coluna.id === "selecao") return <TableCell key={`${tarefa.id}-selecao`} className="text-xs py-2 px-2"><Checkbox checked={selectedItems.includes(tarefa.id)} onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, tarefa.id] : prev.filter((id) => id !== tarefa.id))} /></TableCell>;
                    if (coluna.id === "acoes") return <TableCell key={`${tarefa.id}-acoes`} className="text-xs py-2 px-2 text-center"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem asChild className="text-xs"><Link to={createPageUrl(`LancamentoTarefaForm?id=${tarefa.id}`)}>Editar</Link></DropdownMenuItem><DropdownMenuItem onClick={() => onDelete(tarefa.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>;
                    return <TableCell key={`${tarefa.id}-${coluna.id}`} className={`text-xs py-2 px-3 ${coluna.align === "right" ? "text-right font-mono" : ""}`}>{renderCell(tarefa, coluna.id)}</TableCell>;
                  })}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between p-3 border-t">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Itens por página:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => {setItemsPerPage(Number(v));setCurrentPage(1);}}>
                <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
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
      
    </div>);

}