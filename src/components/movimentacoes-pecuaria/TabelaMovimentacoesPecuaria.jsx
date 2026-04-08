import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { MoreVertical, Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical } from "lucide-react";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true, width: 25 },
  { id: "acoes", label: "Ações", default: true, fixo: true, width: 25 },
  { id: "numero", label: "Nº", default: true, sortable: true, align: "left", width: 60 },
  { id: "data", label: "Data", default: true, sortable: true, align: "left", width: 100 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, align: "left", width: 80 },
  { id: "motivo", label: "Motivo", default: true, sortable: true, align: "left", width: 120 },
  { id: "quantidade", label: "Quantidade", default: true, sortable: true, align: "right", width: 100 },
  { id: "categoria", label: "Categoria", default: true, sortable: true, align: "left", width: 140 },
  { id: "categoria_nova", label: "Cat. Nova", default: false, sortable: true, align: "left", width: 140 },
  { id: "marca", label: "Marca", default: true, sortable: true, align: "left", width: 120 },
  { id: "sexo", label: "Sexo", default: false, sortable: true, align: "left", width: 80 },
  { id: "peso_medio", label: "Peso Médio", default: false, sortable: true, align: "right", width: 110 },
  { id: "peso_total", label: "Peso Total", default: false, sortable: true, align: "right", width: 110 },
  { id: "area", label: "Área", default: true, sortable: true, align: "left", width: 140 },
  { id: "valor_unitario", label: "Vlr. Unit.", default: false, sortable: true, align: "right", width: 110 },
  { id: "valor_total", label: "Vlr. Total", default: false, sortable: true, align: "right", width: 110 },
  { id: "fornecedor", label: "Fornec./Comprador", default: false, sortable: true, align: "left", width: 160 },
  { id: "nota_fiscal", label: "Nota Fiscal", default: false, sortable: true, align: "left", width: 110 },
  { id: "gta", label: "GTA", default: false, sortable: true, align: "left", width: 100 },
  { id: "causa_morte", label: "Causa Morte", default: false, sortable: true, align: "left", width: 130 },
  { id: "destino_abate", label: "Frigorífico", default: false, sortable: true, align: "left", width: 130 },
  { id: "transferencia_origem", label: "Transf. Origem", default: false, sortable: true, align: "left", width: 140 },
  { id: "transferencia_destino", label: "Transf. Destino", default: false, sortable: true, align: "left", width: 140 },
  { id: "observacoes", label: "Observações", default: false, sortable: true, align: "left", width: 200 },
  { id: "responsavel", label: "Responsável", default: false, sortable: true, align: "left", width: 160 },
];

const DEFAULT_VISIBLE = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
const WIDTHS_KEY = "colunas_largura_mov_pecuaria";
const VISIBLE_KEY = "colunas_visiveis_mov_pecuaria";
const ORDER_KEY = "colunas_ordem_mov_pecuaria";
const MIN_COL = 60;

const formatarNumero = (n) => {
  if (!n && n !== 0) return "0,00";
  const v = typeof n === "string" ? parseFloat(n.replace(".", "").replace(",", ".")) : n;
  if (isNaN(v)) return "0,00";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarData = (d) => {
  if (!d) return "-";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
};



const getFieldValue = (mov, colId) => {
  switch (colId) {
    case "numero": return mov.numero_movimentacao || "";
    case "data": return formatarData(mov.data_movimentacao);
    case "tipo": return mov.tipo || "";
    case "motivo": return mov.motivo || "";
    case "quantidade": return String(mov.quantidade_animais || 0);
    case "categoria": return mov.categoria_animal || "";
    case "categoria_nova": return mov.categoria_nova || "";
    case "marca": return mov.marca || "";
    case "sexo": return mov.sexo || "";
    case "peso_medio": return mov.peso_medio ? formatarNumero(mov.peso_medio) : "";
    case "peso_total": return mov.peso_total ? formatarNumero(mov.peso_total) : "";
    case "area": return (mov.tipo === "Entrada" ? mov.area_destino_nome : mov.area_origem_nome) || "";
    case "valor_unitario": return mov.valor_unitario ? `R$ ${mov.valor_unitario.toFixed(2)}` : "";
    case "valor_total": return mov.valor_total ? `R$ ${mov.valor_total.toFixed(2)}` : "";
    case "fornecedor": return mov.fornecedor_origem || mov.destino_venda || "";
    case "nota_fiscal": return mov.nota_fiscal || "";
    case "gta": return mov.gta || "";
    case "causa_morte": return mov.causa_morte || "";
    case "destino_abate": return mov.destino_abate || "";
    case "transferencia_origem": return mov.transferencia_origem || "";
    case "transferencia_destino": return mov.transferencia_destino || "";
    case "observacoes": return mov.observacoes || "";
    case "responsavel": return mov.created_by || "";
    default: return "";
  }
};

const getSortValue = (mov, key) => {
  const numFields = ["quantidade", "peso_medio", "peso_total", "valor_unitario", "valor_total"];
  if (key === "numero") return parseInt(mov.numero_movimentacao) || 0;
  if (key === "data") return new Date(mov.data_movimentacao).getTime() || 0;
  if (numFields.includes(key)) {
    const map = { quantidade: "quantidade_animais", peso_medio: "peso_medio", peso_total: "peso_total", valor_unitario: "valor_unitario", valor_total: "valor_total" };
    return Number(mov[map[key]] || 0);
  }
  return getFieldValue(mov, key).toLowerCase();
};

export default function TabelaMovimentacoesPecuaria({
  movimentacoes = [],
  onEditCompleto,
  onEditRapido,
  onDuplicar,
  onDelete,
  showConfigColunas,
  setShowConfigColunas,
}) {
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "data", direction: "desc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const [columnWidths, setColumnWidths] = useState(() => {
    const defaults = Object.fromEntries(COLUNAS_DISPONIVEIS.map((c) => [c.id, c.width || 160]));
    const saved = localStorage.getItem(WIDTHS_KEY);
    if (!saved) return defaults;
    try { return { ...defaults, ...JSON.parse(saved) }; } catch { return defaults; }
  });

  const scrollContainerRef = useRef(null);
  const tableRef = useRef(null);
  const [resizeColumnId, setResizeColumnId] = useState(null);
  const dragRef = useRef(null);
  const lastTapRef = useRef({ id: null, time: 0 });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem(ORDER_KEY);
    if (saved) { try { return JSON.parse(saved); } catch { /* fallback */ } }
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem(VISIBLE_KEY);
    if (saved) { try { return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE])); } catch { /* fallback */ } }
    return DEFAULT_VISIBLE;
  });

  useEffect(() => { localStorage.setItem(WIDTHS_KEY, JSON.stringify(columnWidths)); }, [columnWidths]);

  // Resize
  const toggleResizeMode = (cId) => { if (cId === "selecao" || cId === "acoes") return; setResizeColumnId((p) => p === cId ? null : cId); };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      if (e.cancelable) e.preventDefault();
      const clientX = e.touches?.[0]?.clientX ?? e.clientX;
      const { columnId, startX, startWidth } = dragRef.current;
      setColumnWidths((p) => ({ ...p, [columnId]: Math.max(MIN_COL, startWidth + (clientX - startX)) }));
    };
    const onUp = () => { if (!dragRef.current) return; dragRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, []);

  const startDragResize = (e, cId) => {
    e.preventDefault(); e.stopPropagation();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    dragRef.current = { columnId: cId, startX: clientX, startWidth: columnWidths[cId] || 160 };
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  };

  useEffect(() => { setSelectedItems((p) => p.filter((id) => movimentacoes.some((m) => m.id === id))); }, [movimentacoes]);

  const toggleColuna = (cId) => {
    const novas = colunasVisiveis.includes(cId) ? colunasVisiveis.filter((id) => id !== cId) : [...colunasVisiveis, cId];
    setColunasVisiveis(novas);
    localStorage.setItem(VISIBLE_KEY, JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem(ORDER_KEY, JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem.map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).filter((c) => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  // Filter logic
  const hasActiveFilter = (cId) => (filtrosColunas[cId] || []).length > 0;
  const getValoresFiltro = (cId) => filtrosColunas[cId] || [];
  const setValoresFiltro = (cId, values) => setFiltrosColunas((p) => ({ ...p, [cId]: values }));
  const clearColumnFilter = (cId) => setValoresFiltro(cId, []);

  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).forEach((col) => {
      opts[col.id] = [...new Set(movimentacoes.map((m) => getFieldValue(m, col.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
    });
    return opts;
  }, [movimentacoes]);

  const movFiltradas = useMemo(() => {
    return movimentacoes.filter((m) => {
      return COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).every((col) => {
        const filtro = filtrosColunas[col.id] || [];
        if (filtro.length === 0) return true;
        return filtro.includes(getFieldValue(m, col.id));
      });
    });
  }, [movimentacoes, filtrosColunas]);

  const movOrdenadas = useMemo(() => {
    const sorted = [...movFiltradas];
    sorted.sort((a, b) => {
      const aV = getSortValue(a, sortConfig.key);
      const bV = getSortValue(b, sortConfig.key);
      if (aV < bV) return sortConfig.direction === "asc" ? -1 : 1;
      if (aV > bV) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [movFiltradas, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(movOrdenadas.length / itemsPerPage));
  const paginadas = movOrdenadas.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  useEffect(() => { setCurrentPage(1); }, [filtrosColunas, movimentacoes]);

  const handleSort = (key) => setSortConfig((p) => ({ key, direction: p.key === key && p.direction === "asc" ? "desc" : "asc" }));

  const toggleSelectAll = () => {
    if (selectedItems.length === paginadas.length && paginadas.length > 0) { setSelectedItems([]); return; }
    setSelectedItems(paginadas.map((m) => m.id));
  };

  const handleExcluirSelecionados = () => { selectedItems.forEach((id) => onDelete(id)); setSelectedItems([]); };

  const handleRowTouch = (item, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === item.id && now - lastTapRef.current.time < 300) { event.preventDefault(); onEditCompleto(item); }
    lastTapRef.current = { id: item.id, time: now };
  };

  const renderCell = (mov, colunaId) => {
    const val = getFieldValue(mov, colunaId);
    return val || "-";
  };

  return (
    <div className="space-y-1 overflow-hidden">
      <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
        <div className="text-xs text-slate-500">{movFiltradas.length} de {movimentacoes.length} registros</div>
        <div className="flex gap-2 flex-wrap">
          {selectedItems.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleExcluirSelecionados} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-hidden">
          <div className="relative overflow-hidden">
            <div ref={scrollContainerRef} className="relative w-full overflow-auto max-h-[calc(100dvh-240px)] md:max-h-[calc(100dvh-150px)]" style={{ overscrollBehavior: "none", WebkitOverflowScrolling: "touch" }}>
              <Table ref={tableRef} className={`w-full ${isMobile ? "min-w-[720px]" : "min-w-[900px]"} border-separate border-spacing-0 table-fixed`}>
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white">
                    {colunasOrdenadas.map((coluna) => {
                      const width = columnWidths[coluna.id] || coluna.width || 160;
                      const isResizing = resizeColumnId === coluna.id;

                      if (coluna.id === "selecao") {
                        return (
                          <TableHead key="selecao" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200">
                            <div className="flex items-center justify-center w-full h-full">
                              <Checkbox checked={selectedItems.length === paginadas.length && paginadas.length > 0} onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                            </div>
                          </TableHead>
                        );
                      }
                      if (coluna.id === "acoes") {
                        return <TableHead key="acoes" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200" />;
                      }

                      const filterCtrl = renderFilterControl(coluna.id);

                      return (
                        <TableHead key={coluna.id} style={{ width, minWidth: width, maxWidth: width }} className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7">
                          <div className="inline-flex items-center justify-center gap-1 h-full w-full whitespace-nowrap overflow-hidden text-ellipsis">{coluna.label}</div>
                          {filterCtrl && (
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              {filterCtrl}
                              <button type="button" className={`h-4 w-4 flex items-center justify-center rounded ${isResizing ? "text-emerald-600 bg-emerald-100" : "text-slate-300 hover:text-slate-500"}`} onClick={(e) => { e.stopPropagation(); toggleResizeMode(coluna.id); }} onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); toggleResizeMode(coluna.id); }} title="Redimensionar coluna">
                                <GripVertical className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )}
                          {isResizing && (
                            <div className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-800" onMouseDown={(e) => startDragResize(e, coluna.id)} onTouchStart={(e) => startDragResize(e, coluna.id)} onClick={(e) => { e.stopPropagation(); setResizeColumnId(null); }} onDoubleClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
                              <GripVertical className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginadas.length === 0 ? (
                    <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhuma movimentação encontrada</TableCell></TableRow>
                  ) : paginadas.map((mov) => (
                    <TableRow key={mov.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100" onDoubleClick={() => onEditCompleto(mov)} onTouchEnd={(e) => handleRowTouch(mov, e)}>
                      {colunasOrdenadas.map((coluna) => {
                        const width = columnWidths[coluna.id] || coluna.width || 160;

                        if (coluna.id === "selecao") {
                          return (
                            <TableCell key={`${mov.id}-sel`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center w-full h-full">
                                <Checkbox checked={selectedItems.includes(mov.id)} onCheckedChange={(ch) => setSelectedItems((p) => ch ? [...p, mov.id] : p.filter((i) => i !== mov.id))} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                              </div>
                            </TableCell>
                          );
                        }
                        if (coluna.id === "acoes") {
                          return (
                            <TableCell key={`${mov.id}-act`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-center w-full h-full">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger>
                                  <DropdownMenuContent align="start">
                                    <DropdownMenuItem onClick={() => onEditCompleto(mov)} className="text-xs">Editar Completo</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => onEditRapido(mov)} className="text-xs">Editar Rápido</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => onDuplicar(mov)} className="text-xs">Duplicar</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => onDelete(mov.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </TableCell>
                          );
                        }

                        const isRight = ["quantidade", "peso_medio", "peso_total", "valor_unitario", "valor_total"].includes(coluna.id);
                        return (
                          <TableCell key={`${mov.id}-${coluna.id}`} style={{ width, minWidth: width, maxWidth: width }} className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words ${isRight ? "text-right font-mono" : ""}`}>
                            {renderCell(mov, coluna.id)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 border-t">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Itens por página:</span>
              <Select value={String(itemsPerPage)} onValueChange={(v) => { setItemsPerPage(Number(v)); setCurrentPage(1); }}>
                <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{[25, 50, 100, 200].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} className="h-7 text-xs">Anterior</Button>
              <span className="text-xs text-slate-600">Página {currentPage} de {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="h-7 text-xs">Próxima</Button>
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
        droppableId="colunas-mov-pecuaria"
      />
    </div>
  );
}