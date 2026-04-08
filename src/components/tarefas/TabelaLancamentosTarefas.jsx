import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import TarefaDetalhesDialog from "@/components/tarefas/TarefaDetalhesDialog";
import { MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, X } from "lucide-react";
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
  { id: "titulo", label: "Tarefa", default: true, sortable: true, align: "left", filterable: "text" },
  { id: "descricao", label: "Descrição", default: true, sortable: false, align: "left" },
  { id: "prioridade", label: "Prioridade", default: true, sortable: true, align: "left", filterable: "select", options: ["Baixa", "Média", "Alta"] },
  { id: "status", label: "Status", default: true, sortable: true, align: "left", filterable: "select", options: ["Pendente", "Em Andamento", "Concluída", "Cancelada"] },
  { id: "grupo_atividade_nome", label: "Grupo", default: true, sortable: true, align: "left", filterable: "dynamic" },
  { id: "tipo", label: "Tipo Base", default: true, sortable: true, align: "left", filterable: "dynamic" },
  { id: "tipo_tarefa_nome", label: "Tipo de Tarefa", default: true, sortable: true, align: "left", filterable: "dynamic" },
  { id: "setor_nome", label: "Fazenda", default: true, sortable: true, align: "left", filterable: "dynamic" },
  { id: "area_nome", label: "Área", default: true, sortable: true, align: "left", filterable: "dynamic" },
  { id: "solicitante", label: "Solicitante", default: true, sortable: true, align: "left", filterable: "dynamic" },
  { id: "responsavel", label: "Responsável", default: true, sortable: true, align: "left", filterable: "dynamic" },
  { id: "data_pedido", label: "Data Pedido", default: true, sortable: true, align: "left" },
  { id: "data_prevista", label: "Prazo", default: true, sortable: true, align: "left" },
  { id: "data_conclusao", label: "Conclusão", default: true, sortable: true, align: "left" },
  { id: "observacoes", label: "Observações", default: true, sortable: false, align: "left" },
  { id: "observacoes_conclusao", label: "Obs. Conclusão", default: true, sortable: false, align: "left" }
];

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
  const [columnFilters, setColumnFilters] = useState({});
  const [sortConfig, setSortConfig] = useState({ key: "titulo", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [detalheTarefa, setDetalheTarefa] = useState(null);
  const lastTapRef = useRef({ id: null, time: 0 });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_gestao_tarefas");
    if (saved) {
      try { return JSON.parse(saved); } catch { return COLUNAS_DISPONIVEIS.map((c) => c.id); }
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_gestao_tarefas");
    if (saved) {
      try { return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE_COLUMNS])); } catch { return DEFAULT_VISIBLE_COLUMNS; }
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => tarefas.some((item) => item.id === id)));
  }, [tarefas]);

  useEffect(() => {
    setCurrentPage(1);
  }, [columnFilters, itemsPerPage]);

  const setColumnFilter = (colId, value) => {
    setColumnFilters((prev) => {
      const next = { ...prev };
      if (!value || value === "__TODOS__") {
        delete next[colId];
      } else {
        next[colId] = value;
      }
      return next;
    });
  };

  const hasActiveFilters = Object.keys(columnFilters).length > 0;

  const limparFiltros = () => {
    setColumnFilters({});
  };

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];
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
    return colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((coluna) => coluna.id === id))
      .filter((coluna) => coluna && colunasVisiveis.includes(coluna.id));
  }, [colunasOrdem, colunasVisiveis]);

  // Compute dynamic options for filterable="dynamic" columns
  const dynamicOptions = useMemo(() => {
    const opts = {};
    const extractUnique = (key, transform) => {
      return [...new Set(tarefas.map((t) => transform ? transform(t) : t[key]).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }));
    };
    opts.grupo_atividade_nome = extractUnique("grupo_atividade_nome");
    opts.tipo = extractUnique("tipo");
    opts.tipo_tarefa_nome = extractUnique(null, (t) => t.tipo_tarefa_nome || t.tipo);
    opts.setor_nome = extractUnique("setor_nome");
    opts.area_nome = extractUnique("area_nome");
    opts.solicitante = extractUnique("solicitante");
    opts.responsavel = extractUnique("responsavel");
    return opts;
  }, [tarefas]);

  const abrirDetalhe = (tarefa) => setDetalheTarefa(tarefa);

  const handleRowTouch = (tarefa, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === tarefa.id && now - lastTapRef.current.time < 300) {
      event.preventDefault();
      abrirDetalhe(tarefa);
    }
    lastTapRef.current = { id: tarefa.id, time: now };
  };

  const getFieldValue = (tarefa, colId) => {
    if (colId === "prioridade") return normalizeTaskPriority(tarefa.prioridade) || "";
    if (colId === "tipo_tarefa_nome") return tarefa.tipo_tarefa_nome || tarefa.tipo || "";
    return tarefa[colId] || "";
  };

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((tarefa) => {
      for (const [colId, filterVal] of Object.entries(columnFilters)) {
        const colDef = COLUNAS_DISPONIVEIS.find((c) => c.id === colId);
        if (!colDef) continue;
        const val = getFieldValue(tarefa, colId);
        if (colDef.filterable === "text") {
          if (!String(val).toLowerCase().includes(filterVal.toLowerCase())) return false;
        } else {
          if (String(val) !== String(filterVal)) return false;
        }
      }
      return true;
    });
  }, [tarefas, columnFilters, normalizeTaskPriority]);

  const tarefasOrdenadas = useMemo(() => {
    const sorted = [...tarefasFiltradas];
    sorted.sort((a, b) => {
      const aVal = String(getFieldValue(a, sortConfig.key)).toLowerCase();
      const bVal = String(getFieldValue(b, sortConfig.key)).toLowerCase();
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
    return sortConfig.direction === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-emerald-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-emerald-600" />;
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

  const renderHeaderFilter = (coluna) => {
    if (!coluna.filterable) return null;
    const currentVal = columnFilters[coluna.id] || "";

    if (coluna.filterable === "text") {
      return (
        <Input
          value={currentVal}
          onChange={(e) => setColumnFilter(coluna.id, e.target.value)}
          placeholder="Filtrar..."
          className="h-6 text-[10px] w-full min-w-[80px] mt-1 px-1 bg-white"
          onClick={(e) => e.stopPropagation()}
        />
      );
    }

    const options = coluna.options || dynamicOptions[coluna.id] || [];
    return (
      <Select
        value={currentVal || "__TODOS__"}
        onValueChange={(v) => setColumnFilter(coluna.id, v)}
      >
        <SelectTrigger
          className="h-6 text-[10px] w-full min-w-[80px] mt-1 px-1 bg-white"
          onClick={(e) => e.stopPropagation()}
        >
          <SelectValue placeholder="Todos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__TODOS__">Todos</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <div className="space-y-1">
      {/* Barra de ações compacta */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-slate-500">
          {tarefasFiltradas.length} de {tarefas.length} registros
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedItems.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  Ações ({selectedItems.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onDelete(selectedItems)} className="text-xs text-red-600">
                  Excluir Selecionados
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">
                  Limpar Seleção
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={limparFiltros} className="h-7 text-xs gap-1">
              <X className="w-3 h-3" /> Limpar Filtros
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[600px] relative">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white shadow-sm">
                {/* Row 1: Labels + Sort */}
                <TableRow className="border-b">
                  {colunasOrdenadas.map((coluna) => {
                    if (coluna.id === "selecao") return (
                      <TableHead key="selecao" className="p-0 bg-white text-center w-10 min-w-[25px] max-w-[25px] align-top">
                        <Checkbox
                          checked={selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0}
                          onCheckedChange={toggleSelectAll}
                          className="h-4 w-4 rounded-full border-2 border-gray-400"
                        />
                      </TableHead>
                    );
                    if (coluna.id === "acoes") return (
                      <TableHead key="acoes" className="p-0 bg-white text-center w-10 min-w-[25px] max-w-[25px] align-top"></TableHead>
                    );
                    return (
                      <TableHead
                        key={coluna.id}
                        className="bg-white px-1 text-xs font-medium text-gray-900 text-center border border-gray-300 align-top"
                      >
                        <div
                          className="inline-flex items-center gap-1 cursor-pointer select-none"
                          onClick={() => coluna.sortable && handleSort(coluna.id)}
                        >
                          {coluna.label}
                          {coluna.sortable && <SortIcon column={coluna.id} />}
                        </div>
                        {renderHeaderFilter(coluna)}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tarefasPaginadas.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                      Nenhuma tarefa encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  tarefasPaginadas.map((tarefa) => (
                    <TableRow
                      key={tarefa.id}
                      className="border-b hover:bg-gray-100 transition-colors"
                      onDoubleClick={() => abrirDetalhe(tarefa)}
                      onTouchEnd={(event) => handleRowTouch(tarefa, event)}
                    >
                      {colunasOrdenadas.map((coluna) => {
                        if (coluna.id === "selecao") return (
                          <TableCell key={`${tarefa.id}-selecao`} className="p-0 bg-white text-center w-10 min-w-[25px] max-w-[25px]" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selectedItems.includes(tarefa.id)}
                              onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, tarefa.id] : prev.filter((id) => id !== tarefa.id))}
                              className="h-4 w-4 rounded-full border-2 border-gray-400"
                            />
                          </TableCell>
                        );
                        if (coluna.id === "acoes") return (
                          <TableCell key={`${tarefa.id}-acoes`} className="p-0 bg-white text-center w-10 min-w-[25px] max-w-[25px]" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6">
                                  <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem asChild className="text-xs">
                                  <Link to={createPageUrl(`LancamentoTarefaForm?id=${tarefa.id}`)}>Editar</Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onDelete(tarefa.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        );
                        return (
                          <TableCell key={`${tarefa.id}-${coluna.id}`} className="p-2 text-gray-700 text-xs h-7 border border-gray-300">
                            {renderCell(tarefa, coluna.id)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between p-1 border-t">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Itens por página:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
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
        droppableId="colunas-gestao-tarefas"
      />

      <TarefaDetalhesDialog
        open={!!detalheTarefa}
        onOpenChange={(open) => !open && setDetalheTarefa(null)}
        tarefa={detalheTarefa}
        onSaved={(updated) => setDetalheTarefa(updated)}
      />
    </div>
  );
}