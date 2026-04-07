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
import TarefaDetalhesDialog from "@/components/tarefas/TarefaDetalhesDialog";
import { MoreVertical, Filter, X } from "lucide-react";
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
  { id: "descricao", label: "Descrição", default: true, sortable: true, align: "left" },
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
  { id: "observacoes", label: "Observações", default: true, sortable: true, align: "left" },
  { id: "observacoes_conclusao", label: "Obs. Conclusão", default: true, sortable: true, align: "left" }
];

const DEFAULT_VISIBLE_COLUMNS = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
const COLUNAS_COM_FILTRO = ["titulo", "descricao", "prioridade", "status", "grupo_atividade_nome", "tipo", "tipo_tarefa_nome", "setor_nome", "area_nome", "solicitante", "responsavel"];

export default function TabelaLancamentosTarefas({
  tarefas,
  onDelete,
  normalizeTaskPriority
}) {
  const [sortConfig, setSortConfig] = useState({ key: "titulo", direction: "asc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [selectedItems, setSelectedItems] = useState([]);
  const [detalheTarefa, setDetalheTarefa] = useState(null);
  const [columnFilters, setColumnFilters] = useState({});
  const lastTapRef = useRef({ id: null, time: 0 });

  const colunasOrdenadas = useMemo(() => {
    return COLUNAS_DISPONIVEIS.filter((coluna) => DEFAULT_VISIBLE_COLUMNS.includes(coluna.id));
  }, []);

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => tarefas.some((item) => item.id === id)));
  }, [tarefas]);

  useEffect(() => {
    setCurrentPage(1);
  }, [columnFilters, sortConfig, itemsPerPage]);

  const abrirDetalhe = (tarefa) => setDetalheTarefa(tarefa);

  const handleRowTouch = (tarefa, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === tarefa.id && now - lastTapRef.current.time < 300) {
      event.preventDefault();
      abrirDetalhe(tarefa);
    }
    lastTapRef.current = { id: tarefa.id, time: now };
  };

  const formatarData = (data) => {
    if (!data) return "-";
    const valor = data.includes("T") ? data : `${data}T00:00:00`;
    return new Date(valor).toLocaleDateString("pt-BR");
  };

  const getColumnValue = (tarefa, colunaId) => {
    if (colunaId === "prioridade") return normalizeTaskPriority(tarefa.prioridade) || "-";
    if (colunaId === "tipo_tarefa_nome") return tarefa.tipo_tarefa_nome || tarefa.tipo || "-";
    if (colunaId === "data_pedido") return formatarData(tarefa.data_pedido);
    if (colunaId === "data_prevista") return formatarData(tarefa.data_prevista);
    if (colunaId === "data_conclusao") return formatarData(tarefa.data_conclusao);
    return String(tarefa[colunaId] || "-");
  };

  const getColumnOptions = (colunaId) => {
    return [...new Set(tarefas.map((tarefa) => getColumnValue(tarefa, colunaId)).filter(Boolean))]
      .sort((a, b) => String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" }));
  };

  const handleSort = (key, direction) => {
    setSortConfig({ key, direction });
  };

  const updateSearchFilter = (colunaId, value) => {
    setColumnFilters((prev) => ({
      ...prev,
      [colunaId]: {
        selectedValues: prev[colunaId]?.selectedValues,
        searchText: value
      }
    }));
  };

  const toggleFilterValue = (colunaId, value) => {
    setColumnFilters((prev) => {
      const currentValues = prev[colunaId]?.selectedValues || [];
      const selectedValues = currentValues.includes(value)
        ? currentValues.filter((item) => item !== value)
        : [...currentValues, value];

      return {
        ...prev,
        [colunaId]: {
          searchText: prev[colunaId]?.searchText || "",
          selectedValues
        }
      };
    });
  };

  const toggleAllFilterValues = (colunaId, values) => {
    setColumnFilters((prev) => {
      const currentValues = prev[colunaId]?.selectedValues || [];
      const allSelected = values.length > 0 && values.every((value) => currentValues.includes(value));

      return {
        ...prev,
        [colunaId]: {
          searchText: prev[colunaId]?.searchText || "",
          selectedValues: allSelected ? [] : values
        }
      };
    });
  };

  const clearColumnFilter = (colunaId) => {
    setColumnFilters((prev) => ({
      ...prev,
      [colunaId]: {
        searchText: "",
        selectedValues: []
      }
    }));
  };

  const hasActiveFilter = (colunaId) => {
    const filter = columnFilters[colunaId];
    return Boolean(filter?.searchText || filter?.selectedValues?.length);
  };

  const tarefasFiltradas = useMemo(() => {
    return tarefas.filter((tarefa) => {
      return COLUNAS_COM_FILTRO.every((colunaId) => {
        const filter = columnFilters[colunaId];
        if (!filter) return true;

        const value = getColumnValue(tarefa, colunaId);
        const normalizedValue = String(value || "").toLowerCase();
        const matchesSearch = !filter.searchText || normalizedValue.includes(filter.searchText.toLowerCase());
        const matchesSelected = !filter.selectedValues?.length || filter.selectedValues.includes(value);

        return matchesSearch && matchesSelected;
      });
    });
  }, [tarefas, columnFilters, normalizeTaskPriority]);

  const tarefasOrdenadas = useMemo(() => {
    const sorted = [...tarefasFiltradas];
    sorted.sort((a, b) => {
      const aVal = String(getColumnValue(a, sortConfig.key) || "").toLowerCase();
      const bVal = String(getColumnValue(b, sortConfig.key) || "").toLowerCase();
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [tarefasFiltradas, sortConfig, normalizeTaskPriority]);

  const totalPages = Math.max(1, Math.ceil(tarefasOrdenadas.length / itemsPerPage));
  const tarefasPaginadas = tarefasOrdenadas.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const toggleSelectAll = () => {
    if (selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(tarefasFiltradas.map((item) => item.id));
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

  const renderFilterMenu = (coluna) => {
    const values = getColumnOptions(coluna.id);
    const filter = columnFilters[coluna.id] || { searchText: "", selectedValues: [] };
    const filteredValues = values.filter((value) => String(value).toLowerCase().includes(filter.searchText.toLowerCase()));
    const allSelected = filteredValues.length > 0 && filteredValues.every((value) => filter.selectedValues?.includes(value));

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className={`h-4 w-4 min-w-4 p-0 ${hasActiveFilter(coluna.id) ? "text-emerald-600" : "text-slate-300 hover:text-slate-500"}`}>
            <Filter className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 p-0">
          <div className="p-1">
            <DropdownMenuItem className="text-xs" onClick={() => handleSort(coluna.id, "asc")}>
              Classificar do Menor para o Maior
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs" onClick={() => handleSort(coluna.id, "desc")}>
              Classificar do Maior para o Menor
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-xs" onClick={() => clearColumnFilter(coluna.id)}>
              Limpar Filtro de "{coluna.label}"
            </DropdownMenuItem>
          </div>

          <div className="border-t p-2 space-y-2">
            <Input
              value={filter.searchText}
              onChange={(e) => updateSearchFilter(coluna.id, e.target.value)}
              placeholder="Pesquisar"
              className="h-7 text-xs"
            />

            <div className="border rounded-md max-h-56 overflow-auto p-2 space-y-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox checked={allSelected} onCheckedChange={() => toggleAllFilterValues(coluna.id, filteredValues)} />
                <span>(Selecionar Tudo)</span>
              </label>

              {filteredValues.map((value) => (
                <label key={value} className="flex items-center gap-2 text-xs cursor-pointer">
                  <Checkbox
                    checked={filter.selectedValues?.includes(value)}
                    onCheckedChange={() => toggleFilterValue(coluna.id, value)}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="space-y-1">
      <Card>
        <CardContent className="p-0">
          <div className="relative w-full overflow-auto max-h-[calc(100vh-220px)]">
            <Table className="w-full min-w-[900px] border-collapse">
              <TableHeader className="bg-white border-b border-gray-200">
                <TableRow className="sticky top-0 z-30 bg-white">
                  {colunasOrdenadas.map((coluna) => {
                    if (coluna.id === "selecao") {
                      return (
                        <TableHead key="selecao" className="sticky top-0 left-0 z-40 h-10 p-0 bg-white text-muted-foreground font-medium text-center w-10 min-w-[25px] max-w-[25px] align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-0 px-0 border-b border-gray-200">
                          <Checkbox
                            checked={selectedItems.length === tarefasFiltradas.length && tarefasFiltradas.length > 0}
                            onCheckedChange={toggleSelectAll}
                            className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 shadow-lg data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                          />
                        </TableHead>
                      );
                    }

                    if (coluna.id === "acoes") {
                      return <TableHead key="acoes" className="sticky top-0 left-0 z-40 h-10 p-0 bg-white text-muted-foreground font-medium text-center w-10 min-w-[25px] max-w-[25px] align-middle px-0 border-b border-r border-gray-200"></TableHead>;
                    }

                    return (
                      <TableHead key={coluna.id} className="sticky top-0 h-10 relative align-middle text-gray-900 px-6 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white min-w-[160px] z-30">
                        <div className="inline-flex items-center justify-center h-full w-full">{coluna.label}</div>
                        {COLUNAS_COM_FILTRO.includes(coluna.id) && (
                          <div className="absolute right-1 top-1/2 -translate-y-1/2 z-20 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {renderFilterMenu(coluna)}
                            {hasActiveFilter(coluna.id) && (
                              <Button variant="ghost" size="icon" className="h-4 w-4 min-w-4 p-0 text-slate-400 hover:text-slate-600" onClick={() => clearColumnFilter(coluna.id)}>
                                <X className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>

              <TableBody className="[&_tr:first-child_td]:border-t-0">
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
                      className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100 hover:text-gray-1000"
                      onDoubleClick={() => abrirDetalhe(tarefa)}
                      onTouchEnd={(event) => handleRowTouch(tarefa, event)}
                    >
                      {colunasOrdenadas.map((coluna) => {
                        if (coluna.id === "selecao") {
                          return (
                            <TableCell key={`${tarefa.id}-selecao`} className="p-0 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 w-10 min-w-[25px] max-w-[25px] align-middle px-0" onClick={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>
                              <Checkbox
                                checked={selectedItems.includes(tarefa.id)}
                                onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, tarefa.id] : prev.filter((id) => id !== tarefa.id))}
                                className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 shadow-lg data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                              />
                            </TableCell>
                          );
                        }

                        if (coluna.id === "acoes") {
                          return (
                            <TableCell key={`${tarefa.id}-acoes`} className="p-0 bg-white text-muted-foreground font-medium text-center sticky left-0 z-10 w-10 min-w-[25px] max-w-[25px] align-middle px-0" onClick={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>
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
                                  <DropdownMenuItem onClick={() => onDelete(tarefa.id)} className="text-xs text-red-600">
                                    Excluir
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          );
                        }

                        return (
                          <TableCell key={`${tarefa.id}-${coluna.id}`} className="p-2 text-gray-700 text-xs align-middle px-2 h-7 border border-gray-300 border-t-0">
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

      <TarefaDetalhesDialog
        open={!!detalheTarefa}
        onOpenChange={(open) => !open && setDetalheTarefa(null)}
        tarefa={detalheTarefa}
        onSaved={(updated) => setDetalheTarefa(updated)}
      />
    </div>
  );
}