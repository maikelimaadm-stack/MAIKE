import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreVertical, Search, ArrowUpDown, ArrowUp, ArrowDown, Loader2, GripVertical } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { PESAGEM_TABLE_COLUMNS } from "@/config/pesagensConfig";

const ITEMS_PER_PAGE = 50;

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  const num = typeof numero === "string" ? parseFloat(numero) : numero;
  if (Number.isNaN(num)) return "0,00";
  return num.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const formatarData = (dataString) => {
  if (!dataString) return "-";
  const date = new Date(dataString);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "dd/MM/yyyy", { locale: ptBR });
};

function getColumnValue(row, column) {
  return row[column.accessor] ?? "";
}

function formatColumnValue(value, column) {
  if (column.format === "date") return formatarData(value);
  if (column.format === "number") return formatarNumero(value);
  return value || "-";
}

function renderConfiguredCell(column, row) {
  const value = formatColumnValue(getColumnValue(row, column), column);
  const alignClass = column.align === "right" ? "text-right font-mono" : "";
  const strongClass = column.strong ? "font-semibold" : "";
  const uppercaseClass = column.uppercase ? "uppercase" : "";
  const truncateClass = column.truncate ? "max-w-xs truncate" : "";

  return (
    <TableCell key={column.id} className={`text-xs border-r border-slate-200 ${alignClass} ${strongClass} ${uppercaseClass} ${truncateClass}`}>
      {value}
    </TableCell>
  );
}

export default function TabelaPesagens({ pesagens = [], onEdit, onDelete, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const [selectedItems, setSelectedItems] = useState([]);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_pesagens");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return PESAGEM_TABLE_COLUMNS.filter((column) => column.default).map((column) => column.id);
      }
    }
    return PESAGEM_TABLE_COLUMNS.filter((column) => column.default).map((column) => column.id);
  });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_pesagens");
    const base = PESAGEM_TABLE_COLUMNS.map((column) => column.id);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) || [];
        return [...parsed, ...base.filter((id) => !parsed.includes(id))];
      } catch {
        return base;
      }
    }
    return base;
  });

  const colunasOrdenadas = colunasOrdem
    .map((id) => PESAGEM_TABLE_COLUMNS.find((column) => column.id === id))
    .filter((column) => column && colunasVisiveis.includes(column.id));

  const toggleColuna = (colunaId) => {
    setColunasVisiveis((prev) => {
      const novasColunas = prev.includes(colunaId) ? prev.filter((id) => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem("colunas_pesagens", JSON.stringify(novasColunas));
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_pesagens", JSON.stringify(items));
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const filteredPesagens = pesagens.filter((pesagem) => {
    const searchLower = searchTerm.toLowerCase();
    return PESAGEM_TABLE_COLUMNS.some((column) => String(getColumnValue(pesagem, column)).toLowerCase().includes(searchLower));
  });

  const sortedPesagens = [...filteredPesagens].sort((a, b) => {
    if (!sortField) return 0;
    const column = PESAGEM_TABLE_COLUMNS.find((item) => item.id === sortField);
    if (!column) return 0;

    let aValue = getColumnValue(a, column);
    let bValue = getColumnValue(b, column);

    if (column.format === "date") {
      aValue = new Date(aValue).getTime() || 0;
      bValue = new Date(bValue).getTime() || 0;
    }

    if (typeof aValue === "string") {
      aValue = aValue.toLowerCase();
      bValue = String(bValue).toLowerCase();
    }

    if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
    if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedPesagens.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedPesagens = sortedPesagens.slice(startIndex, endIndex);

  const toggleSelectAll = () => {
    if (selectedItems.length === paginatedPesagens.length && paginatedPesagens.length > 0) setSelectedItems([]);
    else setSelectedItems(paginatedPesagens.map((pesagem) => pesagem.id));
  };

  const toggleSelectItem = (id) => {
    setSelectedItems((prev) => (prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]));
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} registro(s) selecionado(s). Esta ação não pode ser desfeita. Deseja continuar?`)) return;

    setIsDeletingBulk(true);
    setDeleteProgress({ current: 0, total: selectedItems.length });

    let deleted = 0;
    for (const id of selectedItems) {
      await onDelete(id, true);
      deleted += 1;
      setDeleteProgress({ current: deleted, total: selectedItems.length });
    }

    setTimeout(() => {
      setIsDeletingBulk(false);
      setSelectedItems([]);
    }, 500);
  };

  const handleBulkPrint = () => {
    selectedItems.forEach((id) => {
      const pesagem = pesagens.find((item) => item.id === id);
      if (pesagem) onPrint(pesagem);
    });
  };

  const deleteProgressPercentage = deleteProgress.total > 0 ? Math.round((deleteProgress.current / deleteProgress.total) * 100) : 0;

  return (
    <>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
            <CardTitle className="text-sm font-semibold text-slate-900">Pesagens ({pesagens.length})</CardTitle>
            <div className="flex gap-2 items-center flex-wrap">
              {selectedItems.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 rounded px-2 py-1">
                  <span className="text-xs font-semibold text-slate-800">{selectedItems.length} selecionado(s)</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5"><MoreVertical className="w-4 h-4 text-slate-700" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleBulkPrint} className="text-xs">Imprimir Todos</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleBulkDelete} className="text-xs text-red-600">Excluir Todos</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">Limpar</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} className="pl-9 h-8 w-full md:w-48 text-xs" />
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowConfigColunas(true)}>Colunas</Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b">
                  <TableHead className="w-8 text-xs border-r border-slate-200"><Checkbox checked={selectedItems.length === paginatedPesagens.length && paginatedPesagens.length > 0} onCheckedChange={toggleSelectAll} /></TableHead>
                  <TableHead className="text-xs text-center w-8 border-r border-slate-200" />
                  {colunasOrdenadas.map((coluna) => (
                    <TableHead key={coluna.id} data-column-id={coluna.id} className={`text-xs border-r border-slate-200 ${coluna.sortable ? "cursor-pointer hover:bg-slate-100" : ""}`} onClick={() => coluna.sortable && handleSort(coluna.id)}>
                      <div className="flex items-center">{coluna.label}{coluna.sortable && getSortIcon(coluna.id)}</div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell></TableRow>
                  ) : paginatedPesagens.length === 0 ? (
                    <TableRow><TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhuma pesagem</TableCell></TableRow>
                  ) : (
                    paginatedPesagens.map((pesagem) => (
                      <motion.tr key={pesagem.id} data-row-id={pesagem.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hover:bg-slate-50 transition-colors border-b">
                        <TableCell className="border-r border-slate-200"><Checkbox checked={selectedItems.includes(pesagem.id)} onCheckedChange={() => toggleSelectItem(pesagem.id)} /></TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => onEdit(pesagem)} className="text-xs">Editar</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onPrint(pesagem)} className="text-xs">Imprimir</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onDelete(pesagem.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        {colunasOrdenadas.map((coluna) => renderConfiguredCell(coluna, pesagem))}
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <div className="text-xs text-slate-600">Mostrando {startIndex + 1} a {Math.min(endIndex, sortedPesagens.length)} de {sortedPesagens.length} registros</div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={currentPage === 1} className="h-7 text-xs">Anterior</Button>
                <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="h-7 text-xs">Próxima</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader><DialogTitle className="text-sm">Configurar Colunas</DialogTitle></DialogHeader>
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
                {PESAGEM_TABLE_COLUMNS.map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <Checkbox checked={colunasVisiveis.includes(coluna.id)} onCheckedChange={() => toggleColuna(coluna.id)} />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="colunas-pesagens">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((colunaId, index) => {
                        const coluna = PESAGEM_TABLE_COLUMNS.find((item) => item.id === colunaId);
                        if (!coluna) return null;
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(dragProvided, snapshot) => (
                              <div ref={dragProvided.innerRef} {...dragProvided.draggableProps} {...dragProvided.dragHandleProps} data-column-id={colunaId} className={`flex items-center gap-2 p-2 border rounded text-xs ${snapshot.isDragging ? "bg-emerald-50 border-emerald-300" : "bg-white"} ${!colunasVisiveis.includes(colunaId) ? "opacity-50" : ""}`}>
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasVisiveis.includes(colunaId) && <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">Visível</Badge>}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t"><Button variant="outline" onClick={() => setShowConfigColunas(false)} size="sm" className="h-7 text-xs">Fechar</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeletingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Loader2 className="w-5 h-5 animate-spin text-red-600" />Excluindo Registros</DialogTitle>
            <DialogDescription>Aguarde enquanto excluímos os registros selecionados...</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm"><span className="text-slate-600">Progresso</span><span className="font-semibold text-slate-900">{deleteProgress.current} de {deleteProgress.total}</span></div>
              <Progress value={deleteProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-red-600">{deleteProgressPercentage}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}