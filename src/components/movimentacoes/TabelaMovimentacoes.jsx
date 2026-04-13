import React, { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, MoreVertical, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Download, GripVertical } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { getLocalEstoque, getLabelOperacao } from "./utils/movimentacaoUtils";

const COLUNAS_DISPONIVEIS = [
  { id: "numero", label: "Nº", default: true, sortable: true },
  { id: "data", label: "Data/Hora", default: true, sortable: true },
  { id: "tipo", label: "Tipo", default: true, sortable: true },
  { id: "tipo_detalhado", label: "Tipo Detalhado", default: true, sortable: false },
  { id: "produto", label: "Produto", default: true, sortable: true },
  { id: "quantidade", label: "Quantidade", default: true, sortable: true },
  { id: "unidade", label: "UN", default: true, sortable: false },
  { id: "valor_unitario", label: "Vlr Unit.", default: true, sortable: false },
  { id: "valor_total", label: "Vlr Total", default: true, sortable: false },
  { id: "fornecedor", label: "Fornecedor/Cliente", default: true, sortable: true },
  { id: "local_estoque", label: "Local Estoque", default: true, sortable: false },
  { id: "status", label: "Status", default: true, sortable: true },
  { id: "numero_documento", label: "Nº Documento", default: false, sortable: false },
  { id: "cfop", label: "CFOP", default: false, sortable: false },
  { id: "centro_custo", label: "Centro de Custo", default: false, sortable: false },
  { id: "motivo", label: "Motivo", default: false, sortable: false },
  { id: "observacoes", label: "Observações", default: false, sortable: false },
  { id: "responsavel", label: "Responsável", default: false, sortable: false },
];

const ITEMS_PER_PAGE = 50;

const formatarNumero = (numero) => {
  if (numero === null || numero === undefined || numero === "") return "0,00";
  const numericValue = typeof numero === "string" ? parseFloat(numero.replace(".", "").replace(",", ".")) : numero;
  if (isNaN(numericValue)) return "0,00";
  return numericValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (valor === null || valor === undefined || valor === "") return "R$ 0,00";
  const numericValue = typeof valor === "string" ? parseFloat(valor.replace(".", "").replace(",", ".")) : valor;
  if (isNaN(numericValue)) return "R$ 0,00";
  return numericValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const formatarData = (dataString) => {
  if (!dataString) return "-";
  const date = new Date(dataString);
  if (isNaN(date.getTime())) return "-";
  return `${date.toLocaleDateString("pt-BR")} ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

export default function TabelaMovimentacoes({ movimentacoes = [], onEdit, onCancel, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [filtros, setFiltros] = useState({ tipo: "all", status: "all" });
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState("asc");
  const [selectedItems, setSelectedItems] = useState([]);
  const [isCancelingBulk, setIsCancelingBulk] = useState(false);
  const [cancelProgress, setCancelProgress] = useState({ current: 0, total: 0 });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_movimentacoes");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
  });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_movimentacoes");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map((c) => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem.map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).filter((c) => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  const opcoesTipo = useMemo(() => [...new Set(movimentacoes.map((mov) => mov.tipo_movimentacao).filter(Boolean))], [movimentacoes]);
  const opcoesStatus = useMemo(() => [...new Set(movimentacoes.map((mov) => mov.status).filter(Boolean))], [movimentacoes]);

  const filteredMovimentacoes = useMemo(() => {
    return movimentacoes.filter((mov) => {
      const searchLower = searchTerm.toLowerCase();
      const matchBusca = !searchTerm || [
        mov.produto_nome,
        mov.produto_codigo,
        mov.tipo_movimentacao,
        mov.tipo_detalhado,
        mov.tipo_documento,
        mov.fornecedor_nome,
        mov.cliente_nome,
        mov.numero_documento,
        mov.chave_documento,
        mov.cfop,
        String(mov.numero_movimentacao || ""),
        mov.centro_custo_nome,
        mov.local_estoque_origem,
        mov.local_estoque_destino,
      ].some((value) => String(value || "").toLowerCase().includes(searchLower));

      const matchTipo = filtros.tipo === "all" || mov.tipo_movimentacao === filtros.tipo;
      const matchStatus = filtros.status === "all" || mov.status === filtros.status;
      return matchBusca && matchTipo && matchStatus;
    });
  }, [movimentacoes, searchTerm, filtros]);

  const sortedMovimentacoes = useMemo(() => {
    const lista = [...filteredMovimentacoes];
    if (!sortField) return lista;

    lista.sort((a, b) => {
      let aValue = "";
      let bValue = "";

      switch (sortField) {
        case "numero":
          aValue = parseInt(a.numero_movimentacao) || 0;
          bValue = parseInt(b.numero_movimentacao) || 0;
          break;
        case "data":
          aValue = new Date(a.data_movimentacao).getTime();
          bValue = new Date(b.data_movimentacao).getTime();
          break;
        case "tipo":
          aValue = a.tipo_movimentacao || "";
          bValue = b.tipo_movimentacao || "";
          break;
        case "produto":
          aValue = a.produto_nome || "";
          bValue = b.produto_nome || "";
          break;
        case "quantidade":
          aValue = Number(a.quantidade || 0);
          bValue = Number(b.quantidade || 0);
          break;
        case "fornecedor":
          aValue = a.fornecedor_nome || a.cliente_nome || "";
          bValue = b.fornecedor_nome || b.cliente_nome || "";
          break;
        case "status":
          aValue = a.status || "";
          bValue = b.status || "";
          break;
        default:
          aValue = "";
          bValue = "";
      }

      if (typeof aValue === "string") {
        aValue = aValue.toLowerCase();
        bValue = String(bValue).toLowerCase();
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return lista;
  }, [filteredMovimentacoes, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedMovimentacoes.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedMovimentacoes = sortedMovimentacoes.slice(startIndex, endIndex);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis((prev) => {
      const novasColunas = prev.includes(colunaId) ? prev.filter((id) => id !== colunaId) : [...prev, colunaId];
      localStorage.setItem("colunas_movimentacoes", JSON.stringify(novasColunas));
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_movimentacoes", JSON.stringify(items));
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDirection("asc");
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const toggleSelectAll = () => {
    const ativasNaPagina = paginatedMovimentacoes.filter((mov) => mov.status === "Ativa");
    if (selectedItems.length === ativasNaPagina.length && ativasNaPagina.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(ativasNaPagina.map((mov) => mov.id));
  };

  const toggleSelectItem = (id, status) => {
    if (status !== "Ativa") return;
    setSelectedItems((prev) => (prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]));
  };

  const handleBulkCancel = async () => {
    if (!selectedItems.length) return;
    if (!window.confirm(`⚠️ ATENÇÃO: Você está prestes a cancelar ${selectedItems.length} movimentação(ões) selecionada(s). Esta ação não pode ser desfeita. Deseja continuar?`)) return;

    setIsCancelingBulk(true);
    setCancelProgress({ current: 0, total: selectedItems.length });

    let canceled = 0;
    for (const id of selectedItems) {
      await onCancel(id, true);
      canceled += 1;
      setCancelProgress({ current: canceled, total: selectedItems.length });
    }

    setTimeout(() => {
      setIsCancelingBulk(false);
      setSelectedItems([]);
    }, 300);
  };

  const cancelProgressPercentage = cancelProgress.total > 0 ? Math.round((cancelProgress.current / cancelProgress.total) * 100) : 0;

  const getBadgeTipo = (tipo) => {
    const config = {
      Entrada: "bg-blue-100 text-blue-800 border-blue-300",
      Saída: "bg-orange-100 text-orange-800 border-orange-300",
      Transferência: "bg-purple-100 text-purple-800 border-purple-300",
      Ajuste: "bg-slate-100 text-slate-800 border-slate-300",
    };
    return config[tipo] || "";
  };

  const renderCellContent = (colunaId, mov) => {
    switch (colunaId) {
      case "numero":
        return mov.numero_movimentacao || "-";
      case "data":
        return formatarData(mov.data_movimentacao);
      case "tipo":
        return <Badge variant="outline" className={`${getBadgeTipo(mov.tipo_movimentacao)} text-xs`}>{mov.tipo_movimentacao}</Badge>;
      case "tipo_detalhado":
        return getLabelOperacao(mov.tipo_detalhado);
      case "produto":
        return mov.produto_nome || "-";
      case "quantidade":
        return formatarNumero(mov.quantidade);
      case "unidade":
        return mov.unidade_medida || "-";
      case "valor_unitario":
        return formatarMoeda(mov.valor_unitario);
      case "valor_total":
        return formatarMoeda(mov.valor_total);
      case "fornecedor":
        return mov.fornecedor_nome || mov.cliente_nome || "-";
      case "local_estoque":
        return getLocalEstoque(mov) || "-";
      case "status":
        return <Badge variant="outline" className={`text-xs ${mov.status === "Ativa" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-red-100 text-red-800 border-red-300"}`}>{mov.status}</Badge>;
      case "numero_documento":
        return mov.numero_documento || "-";
      case "cfop":
        return mov.cfop || "-";
      case "centro_custo":
        return mov.centro_custo_nome || "-";
      case "motivo":
        return mov.motivo_movimentacao || "-";
      case "observacoes":
        return mov.observacoes || "-";
      case "responsavel":
        return mov.usuario_responsavel || "-";
      default:
        return "-";
    }
  };

  const getTextForCell = (colunaId, mov) => {
    const content = renderCellContent(colunaId, mov);
    return typeof content === "string" ? content : String(content?.props?.children || "-");
  };

  const handleExportExcel = (onlySelected = false) => {
    const rows = onlySelected ? sortedMovimentacoes.filter((mov) => selectedItems.includes(mov.id)) : sortedMovimentacoes;
    if (!rows.length) return;

    const visibleCols = colunasOrdenadas;
    const thead = `<tr>${visibleCols.map((c) => `<th>${c.label}</th>`).join("")}</tr>`;
    const tbody = rows.map((mov) => `<tr>${visibleCols.map((c) => `<td>${getTextForCell(c.id, mov)}</td>`).join("")}</tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table>${thead}${tbody}</table></body></html>`;
    const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = onlySelected ? "movimentacoes_selecionadas.xls" : "movimentacoes_filtradas.xls";
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <>
      <div className="space-y-1 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-1">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <Input placeholder="BUSCAR..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-7 text-xs uppercase" />
          </div>

          <Select value={filtros.tipo} onValueChange={(value) => setFiltros((prev) => ({ ...prev, tipo: value }))}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Tipo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos os Tipos</SelectItem>
              {opcoesTipo.map((tipo) => <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filtros.status} onValueChange={(value) => setFiltros((prev) => ({ ...prev, status: value }))}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">Todos os Status</SelectItem>
              {opcoesStatus.map((status) => <SelectItem key={status} value={status} className="text-xs">{status}</SelectItem>)}
            </SelectContent>
          </Select>

          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFiltros({ tipo: "all", status: "all" })}>
            Limpar Filtros
          </Button>

          <div className="flex gap-1 justify-end">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowConfigColunas(true)}>
              Colunas
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="text-xs" onClick={() => handleExportExcel(false)}>Excel - linhas filtradas</DropdownMenuItem>
                <DropdownMenuItem className="text-xs" onClick={() => handleExportExcel(true)} disabled={selectedItems.length === 0}>Excel - selecionadas</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
          <div className="text-xs text-slate-500">{filteredMovimentacoes.length} de {movimentacoes.length} registros</div>
          <div className="flex gap-2 flex-wrap">
            {selectedItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleBulkCancel} className="text-xs text-red-600">Cancelar Todos</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">Limpar</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 border-b">
                    <TableHead className="w-8 text-xs border-r border-slate-200">
                      <Checkbox checked={selectedItems.length === paginatedMovimentacoes.filter((mov) => mov.status === "Ativa").length && paginatedMovimentacoes.filter((mov) => mov.status === "Ativa").length > 0} onCheckedChange={toggleSelectAll} />
                    </TableHead>
                    <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                    {colunasOrdenadas.map((coluna) => (
                      <TableHead key={coluna.id} className={`text-xs border-r border-slate-200 ${coluna.sortable ? "cursor-pointer hover:bg-slate-100" : ""}`} onClick={() => coluna.sortable && handleSort(coluna.id)}>
                        <div className="flex items-center">
                          {coluna.label}
                          {coluna.sortable && getSortIcon(coluna.id)}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <AnimatePresence>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={colunasOrdenadas.length + 2} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                      </TableRow>
                    ) : paginatedMovimentacoes.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colunasOrdenadas.length + 2} className="text-center py-12 text-slate-400 text-xs">Nenhuma movimentação</TableCell>
                      </TableRow>
                    ) : (
                      paginatedMovimentacoes.map((mov) => {
                        const bloqueadoDireto = mov.bloqueado_exclusao_estoque || (mov.exclusao_somente_em && mov.exclusao_somente_em !== "estoque") || ["suplementacao", "transferencia_enviada", "transferencia_recebida"].includes(mov.tipo_detalhado);
                        return (
                          <motion.tr key={mov.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`hover:bg-slate-50 transition-colors border-b ${mov.status === "Cancelada" ? "opacity-50 bg-red-50" : ""}`}>
                            <TableCell className="border-r border-slate-200">
                              <Checkbox checked={selectedItems.includes(mov.id)} onCheckedChange={() => toggleSelectItem(mov.id, mov.status)} disabled={mov.status !== "Ativa"} />
                            </TableCell>
                            <TableCell className="text-center border-r border-slate-200">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuItem onClick={() => onEdit && onEdit(mov)} disabled={mov.status === "Cancelada" || bloqueadoDireto} className="text-xs">Editar</DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => onCancel && onCancel(mov.id)} disabled={mov.status === "Cancelada" || bloqueadoDireto} className="text-xs text-red-600">Cancelar</DropdownMenuItem>
                                  {bloqueadoDireto && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem disabled className="text-xs">Excluir pelo histórico vinculado</DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                            {colunasOrdenadas.map((coluna) => (
                              <TableCell key={`${mov.id}-${coluna.id}`} className={`text-xs border-r border-slate-200 ${["quantidade", "valor_unitario", "valor_total"].includes(coluna.id) ? "text-right font-mono" : ""}`}>
                                {renderCellContent(coluna.id, mov)}
                              </TableCell>
                            ))}
                          </motion.tr>
                        );
                      })
                    )}
                  </AnimatePresence>
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
                <div className="text-xs text-slate-600">Mostrando {startIndex + 1} a {Math.min(endIndex, sortedMovimentacoes.length)} de {sortedMovimentacoes.length} registros</div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))} disabled={safePage === 1} className="h-7 text-xs">Anterior</Button>
                  <span className="text-xs text-slate-600">Página {safePage} de {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))} disabled={safePage === totalPages} className="h-7 text-xs">Próxima</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-3 gap-2">
                {COLUNAS_DISPONIVEIS.map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input type="checkbox" checked={colunasVisiveis.includes(coluna.id)} onChange={() => toggleColuna(coluna.id)} className="rounded" />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="colunas">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((colunaId, index) => {
                        const coluna = COLUNAS_DISPONIVEIS.find((c) => c.id === colunaId);
                        if (!coluna) return null;
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(providedDraggable, snapshot) => (
                              <div ref={providedDraggable.innerRef} {...providedDraggable.draggableProps} {...providedDraggable.dragHandleProps} className={`flex items-center gap-2 p-2 border rounded text-xs ${snapshot.isDragging ? "bg-emerald-50 border-emerald-300" : "bg-white"} ${!colunasVisiveis.includes(colunaId) ? "opacity-50" : ""}`}>
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

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setShowConfigColunas(false)} size="sm" className="h-7 text-xs">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCancelingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-red-600" />
              Cancelando Movimentações
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto cancelamos as movimentações selecionadas...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">{cancelProgress.current} de {cancelProgress.total}</span>
              </div>
              <Progress value={cancelProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-red-600">{cancelProgressPercentage}%</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}