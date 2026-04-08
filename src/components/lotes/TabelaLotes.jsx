import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger } from
"@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { MoreVertical, Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical } from "lucide-react";

const COLUNAS_DISPONIVEIS = [
{ id: "selecao", label: "Seleção", default: true, fixo: true, width: 25 },
{ id: "acoes", label: "Ações", default: true, fixo: true, width: 25 },
{ id: "codigo", label: "Código", default: true, sortable: true, align: "left", width: 100 },
{ id: "nome", label: "Nome", default: true, sortable: true, align: "left", width: 200 },
{ id: "cabecas", label: "Cabeças", default: true, sortable: true, align: "right", width: 100 },
{ id: "categoria", label: "Categoria", default: true, sortable: true, align: "left", width: 160 },
{ id: "sexo", label: "Sexo", default: true, sortable: true, align: "left", width: 100 },
{ id: "peso", label: "Peso Médio", default: true, sortable: true, align: "right", width: 120 },
{ id: "area", label: "Área Entrada", default: true, sortable: true, align: "left", width: 160 },
{ id: "motivo", label: "Motivo", default: true, sortable: true, align: "left", width: 140 },
{ id: "data", label: "Data Entrada", default: true, sortable: true, align: "left", width: 120 },
{ id: "status", label: "Status", default: true, sortable: true, align: "left", width: 100 },
{ id: "valor", label: "Valor Total", default: false, sortable: true, align: "right", width: 140 },
{ id: "fornecedor", label: "Fornecedor", default: false, sortable: true, align: "left", width: 160 },
{ id: "observacoes", label: "Observações", default: false, sortable: false, align: "left", width: 220 }];


const DEFAULT_VISIBLE_COLUMNS = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
const COLUMN_WIDTHS_KEY = "colunas_largura_cadastro_lotes";
const MIN_COLUMN_WIDTH = 80;

const formatarData = (data) => {
  if (!data) return "-";
  const [ano, mes, dia] = String(data).split("T")[0].split("-");
  if (!ano || !mes || !dia) return "-";
  return `${dia}/${mes}/${ano}`;
};

const formatarValor = (valor) => {
  if (!valor) return "-";
  return `R$ ${Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
};

export default function TabelaLotes({
  lotes = [],
  areas = [],
  onEdit,
  onDelete,
  showConfigColunas,
  setShowConfigColunas
}) {
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const [columnWidths, setColumnWidths] = useState(() => {
    const defaults = Object.fromEntries(COLUNAS_DISPONIVEIS.map((c) => [c.id, c.width || 160]));
    const saved = localStorage.getItem(COLUMN_WIDTHS_KEY);
    if (!saved) return defaults;
    try {return { ...defaults, ...JSON.parse(saved) };} catch {return defaults;}
  });

  const lastTapRef = useRef({ id: null, time: 0 });
  const scrollContainerRef = useRef(null);
  const tableRef = useRef(null);
  const [resizeColumnId, setResizeColumnId] = useState(null);
  const dragRef = useRef(null);

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem("colunas_ordem_cadastro_lotes");
    if (saved) {try {return JSON.parse(saved);} catch {/* fallback */}}
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_cadastro_lotes");
    if (saved) {try {return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE_COLUMNS]));} catch {/* fallback */}}
    return DEFAULT_VISIBLE_COLUMNS;
  });

  useEffect(() => {localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));}, [columnWidths]);

  const toggleResizeMode = (colunaId) => {
    if (colunaId === "selecao" || colunaId === "acoes") return;
    setResizeColumnId((prev) => prev === colunaId ? null : colunaId);
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      if (e.cancelable) e.preventDefault();
      const clientX = e.touches?.[0]?.clientX ?? e.clientX;
      const { columnId, startX, startWidth } = dragRef.current;
      setColumnWidths((prev) => ({ ...prev, [columnId]: Math.max(MIN_COLUMN_WIDTH, startWidth + (clientX - startX)) }));
    };
    const onUp = () => {if (!dragRef.current) return;dragRef.current = null;document.body.style.cursor = "";document.body.style.userSelect = "";};
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {window.removeEventListener("mousemove", onMove);window.removeEventListener("mouseup", onUp);window.removeEventListener("touchmove", onMove);window.removeEventListener("touchend", onUp);};
  }, []);

  const startDragResize = (e, colunaId) => {
    e.preventDefault();e.stopPropagation();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    dragRef.current = { columnId: colunaId, startX: clientX, startWidth: columnWidths[colunaId] || 160 };
    document.body.style.cursor = "col-resize";document.body.style.userSelect = "none";
  };

  useEffect(() => {setSelectedItems((prev) => prev.filter((id) => lotes.some((l) => l.id === id)));}, [lotes]);

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId) ? colunasVisiveis.filter((id) => id !== colunaId) : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem("colunas_visiveis_cadastro_lotes", JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_cadastro_lotes", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem.map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).filter((c) => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  // Field value extraction for filters
  const getFieldValue = (lote, colunaId) => {
    if (colunaId === "codigo") return String(lote.numero_lote || "");
    if (colunaId === "nome") return lote.nome || "";
    if (colunaId === "cabecas") return String(lote.quantidade_entrada || lote.quantidade_cabecas || "");
    if (colunaId === "categoria") return lote.categoria_entrada || lote.categoria || "";
    if (colunaId === "sexo") return lote.sexo || "";
    if (colunaId === "peso") return lote.peso_entrada_kg || lote.peso_medio_kg ? `${lote.peso_entrada_kg || lote.peso_medio_kg} kg` : "";
    if (colunaId === "area") return lote.area_entrada_nome || "";
    if (colunaId === "motivo") return lote.motivo_entrada || lote.origem || "";
    if (colunaId === "data") return formatarData(lote.data_entrada);
    if (colunaId === "status") return lote.status || "";
    if (colunaId === "valor") return lote.valor_total_compra ? formatarValor(lote.valor_total_compra) : "";
    if (colunaId === "fornecedor") return lote.fornecedor_nome || "";
    if (colunaId === "observacoes") return lote.observacoes || "";
    return "";
  };

  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).forEach((col) => {
      opts[col.id] = [...new Set(lotes.map((item) => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
    });
    return opts;
  }, [lotes]);

  const hasActiveFilter = (colunaId) => (filtrosColunas[colunaId] || []).length > 0;
  const getValoresFiltro = (colunaId) => filtrosColunas[colunaId] || [];
  const setValoresFiltro = (colunaId, values) => setFiltrosColunas((prev) => ({ ...prev, [colunaId]: values }));
  const clearColumnFilter = (colunaId) => setValoresFiltro(colunaId, []);

  const lotesFiltrados = useMemo(() => {
    return lotes.filter((lote) => {
      return COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).every((col) => {
        const filtro = filtrosColunas[col.id] || [];
        if (filtro.length === 0) return true;
        const val = getFieldValue(lote, col.id);
        return filtro.includes(val);
      });
    });
  }, [lotes, filtrosColunas]);

  const lotesOrdenados = useMemo(() => {
    const sorted = [...lotesFiltrados];
    sorted.sort((a, b) => {
      const numericKeys = { codigo: "numero_lote", cabecas: null, peso: null, valor: "valor_total_compra" };
      if (sortConfig.key === "codigo") {
        const aV = Number(a.numero_lote || 0);const bV = Number(b.numero_lote || 0);
        return sortConfig.direction === "asc" ? aV - bV : bV - aV;
      }
      if (sortConfig.key === "cabecas") {
        const aV = Number(a.quantidade_entrada || a.quantidade_cabecas || 0);const bV = Number(b.quantidade_entrada || b.quantidade_cabecas || 0);
        return sortConfig.direction === "asc" ? aV - bV : bV - aV;
      }
      if (sortConfig.key === "peso") {
        const aV = Number(a.peso_entrada_kg || a.peso_medio_kg || 0);const bV = Number(b.peso_entrada_kg || b.peso_medio_kg || 0);
        return sortConfig.direction === "asc" ? aV - bV : bV - aV;
      }
      if (sortConfig.key === "valor") {
        const aV = Number(a.valor_total_compra || 0);const bV = Number(b.valor_total_compra || 0);
        return sortConfig.direction === "asc" ? aV - bV : bV - aV;
      }
      const aVal = getFieldValue(a, sortConfig.key).toLowerCase();
      const bVal = getFieldValue(b, sortConfig.key).toLowerCase();
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [lotesFiltrados, sortConfig]);

  const handleSort = (key) => setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));

  const toggleSelectAll = () => {
    if (selectedItems.length === lotesFiltrados.length && lotesFiltrados.length > 0) {setSelectedItems([]);return;}
    setSelectedItems(lotesFiltrados.map((l) => l.id));
  };

  const handleRowTouch = (lote, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === lote.id && now - lastTapRef.current.time < 300) {event.preventDefault();onEdit(lote);}
    lastTapRef.current = { id: lote.id, time: now };
  };

  const renderCell = (lote, colunaId) => {
    if (colunaId === "codigo") return lote.numero_lote || "-";
    if (colunaId === "nome") return lote.nome || "-";
    if (colunaId === "cabecas") return lote.quantidade_entrada || lote.quantidade_cabecas || "-";
    if (colunaId === "categoria") return lote.categoria_entrada || lote.categoria || "-";
    if (colunaId === "sexo") return lote.sexo || "-";
    if (colunaId === "peso") return lote.peso_entrada_kg || lote.peso_medio_kg ? `${lote.peso_entrada_kg || lote.peso_medio_kg} kg` : "-";
    if (colunaId === "area") return lote.area_entrada_nome || "-";
    if (colunaId === "motivo") return lote.motivo_entrada || lote.origem || "-";
    if (colunaId === "data") return formatarData(lote.data_entrada);
    if (colunaId === "status") return lote.status || "-";
    if (colunaId === "valor") return formatarValor(lote.valor_total_compra);
    if (colunaId === "fornecedor") return lote.fornecedor_nome || "-";
    if (colunaId === "observacoes") return lote.observacoes || "-";
    return "-";
  };

  const renderFilterControl = (colunaId) => {
    const buttonClass = `h-3 w-3 min-w-3 p-0 ${hasActiveFilter(colunaId) ? "text-emerald-600" : "text-slate-300 hover:text-slate-400"}`;
    const columnLabel = COLUNAS_DISPONIVEIS.find((c) => c.id === colunaId)?.label || colunaId;
    const options = columnOptions[colunaId] || [];
    const valoresSelecionados = filtroTemp.colunaId === colunaId ? filtroTemp.valores : getValoresFiltro(colunaId);
    const filteredOptions = options.filter((o) => String(o).toLowerCase().includes(buscaFiltroMenu.toLowerCase()));
    const allVisibleSelected = filteredOptions.length > 0 && filteredOptions.every((o) => valoresSelecionados.includes(o));

    return (
      <Popover
        open={menuFiltroAberto === colunaId}
        onOpenChange={(open) => {
          setMenuFiltroAberto(open ? colunaId : null);
          setBuscaFiltroMenu("");
          setFiltroTemp(open ? { colunaId, valores: [...getValoresFiltro(colunaId)] } : { colunaId: null, valores: [] });
        }}>
        
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className={buttonClass}>
            <Filter className="w-2 h-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" sideOffset={4} className="w-[310px] p-0 z-[9999]">
          <div className="p-1 space-y-0.5 border-b">
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => {handleSort(colunaId);setMenuFiltroAberto(null);}}>
              <ArrowDownAZ className="w-4 h-4 mr-2" /> Classificar do Menor para o Maior
            </button>
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => {setSortConfig({ key: colunaId, direction: "desc" });setMenuFiltroAberto(null);}}>
              <ArrowUpZA className="w-4 h-4 mr-2" /> Classificar do Maior para o Menor
            </button>
            <button
              type="button"
              className={`flex items-center w-full px-2 h-8 text-xs rounded ${hasActiveFilter(colunaId) ? 'hover:bg-slate-100 text-slate-700' : 'text-slate-300 cursor-not-allowed'}`}
              disabled={!hasActiveFilter(colunaId)}
              onClick={() => {clearColumnFilter(colunaId);setMenuFiltroAberto(null);}}>
              
              <X className="w-4 h-4 mr-2" /> Limpar Filtro de "{columnLabel}"
            </button>
          </div>
          <div className="p-2 space-y-2">
            <Input value={buscaFiltroMenu} onChange={(e) => setBuscaFiltroMenu(e.target.value)} placeholder="PESQUISAR" className="h-8 text-xs uppercase" />
            <div className="border border-slate-300 rounded-sm max-h-64 overflow-y-auto p-1 bg-white">
              <label className="flex h-8 items-center gap-2 px-2 py-0 text-xs text-slate-700 border-b border-slate-200 whitespace-nowrap overflow-hidden">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(checked) => {
                    setFiltroTemp((prev) => {
                      const restantes = prev.valores.filter((v) => !filteredOptions.includes(v));
                      return { ...prev, valores: checked ? [...new Set([...restantes, ...filteredOptions])] : restantes };
                    });
                  }}
                  className="h-3.5 w-3.5 shrink-0" />
                
                <span className="block flex-1 overflow-hidden text-ellipsis whitespace-nowrap">(Selecionar Tudo)</span>
              </label>
              {filteredOptions.map((option) =>
              <label key={option} className="flex h-6 items-center gap-2 px-2 py-0 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap overflow-hidden">
                  <Checkbox
                  checked={valoresSelecionados.includes(option)}
                  onCheckedChange={(checked) => {
                    setFiltroTemp((prev) => ({ ...prev, valores: checked ? [...prev.valores, option] : prev.valores.filter((i) => i !== option) }));
                  }}
                  className="h-3.5 w-3.5 shrink-0" />
                
                  <span className="block flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{option}</span>
                </label>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => {setMenuFiltroAberto(null);setBuscaFiltroMenu("");setFiltroTemp({ colunaId: null, valores: [] });}}>
                Cancelar
              </Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => {setValoresFiltro(colunaId, filtroTemp.valores);setMenuFiltroAberto(null);setBuscaFiltroMenu("");setFiltroTemp({ colunaId: null, valores: [] });}}>
                OK
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>);

  };

  return (
    <div className="space-y-1 overflow-hidden">
      {/* Summary bar */}
      <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
        <div className="text-xs text-slate-500">
          {lotesFiltrados.length} de {lotes.length} registros
        </div>
        <div className="flex gap-2 flex-wrap">
          {selectedItems.length > 0 &&
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => {onDelete(selectedItems);setSelectedItems([]);}} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">Limpar Seleção</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-hidden">
          <div className="relative overflow-hidden">
            <div ref={scrollContainerRef} className="relative w-full overflow-auto max-h-[calc(100dvh-240px)] md:max-h-[calc(100dvh-150px)]" style={{ overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch' }}>
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
                              <Checkbox checked={selectedItems.length === lotesFiltrados.length && lotesFiltrados.length > 0} onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                            </div>
                          </TableHead>);

                      }

                      if (coluna.id === "acoes") {
                        return (
                          <TableHead key="acoes" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="[&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px] sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b  border-gray-200" />);

                      }

                      const filterControl = renderFilterControl(coluna.id);

                      return (
                        <TableHead
                          key={coluna.id}
                          style={{ width, minWidth: width, maxWidth: width }}
                          className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7">
                          
                          <div className="inline-flex items-center justify-center gap-1 h-full w-full whitespace-nowrap overflow-hidden text-ellipsis">
                            {coluna.label}
                          </div>

                          {filterControl &&
                          <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              {filterControl}
                              <button
                              type="button"
                              className={`h-4 w-4 flex items-center justify-center rounded ${isResizing ? 'text-emerald-600 bg-emerald-100' : 'text-slate-300 hover:text-slate-500'}`}
                              onClick={(e) => {e.stopPropagation();toggleResizeMode(coluna.id);}}
                              onTouchEnd={(e) => {e.stopPropagation();e.preventDefault();toggleResizeMode(coluna.id);}}
                              title="Redimensionar coluna">
                              
                                <GripVertical className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          }

                          {isResizing &&
                          <div className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-900 bg-opacity-8 "

                          onMouseDown={(e) => startDragResize(e, coluna.id)}
                          onTouchStart={(e) => startDragResize(e, coluna.id)}
                          onClick={(e) => {e.stopPropagation();setResizeColumnId(null);}}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => e.stopPropagation()}>
                            
                              <GripVertical className="w-3.5 h-3.5 text-white" />
                            </div>
                          }
                        </TableHead>);

                    })}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {lotesOrdenados.length === 0 ?
                  <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                        Nenhum lote encontrado
                      </TableCell>
                    </TableRow> :

                  lotesOrdenados.map((lote) =>
                  <TableRow
                    key={lote.id}
                    className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100"
                    onDoubleClick={() => onEdit(lote)}
                    onTouchEnd={(event) => handleRowTouch(lote, event)}>
                    
                        {colunasOrdenadas.map((coluna) => {
                      const width = columnWidths[coluna.id] || coluna.width || 160;

                      if (coluna.id === "selecao") {
                        return (
                          <TableCell
                            key={`${lote.id}-selecao`}
                            style={{ width: 25, minWidth: 25, maxWidth: 25 }}
                            className="p-0 text-muted-foreground font-medium text-center align-middle px-0 h-7 border-r border-b border-gray-300"
                            onClick={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}>
                            
                                <div className="flex items-center justify-center w-full h-full">
                                  <Checkbox checked={selectedItems.includes(lote.id)} onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, lote.id] : prev.filter((id) => id !== lote.id))} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                                </div>
                              </TableCell>);

                      }

                      if (coluna.id === "acoes") {
                        return (
                          <TableCell
                            key={`${lote.id}-acoes`}
                            style={{ width: 25, minWidth: 25, maxWidth: 25 }}
                            className="p-0 text-muted-foreground font-medium text-center align-middle px-0 h-7 border-r border-b border-gray-300"
                            onClick={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}>
                            
                                <div className="flex items-center justify-center w-full h-full">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-6 w-6">
                                        <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                      <DropdownMenuItem onClick={() => onEdit(lote)} className="text-xs">Editar</DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => onDelete(lote.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>);

                      }

                      return (
                        <TableCell
                          key={`${lote.id}-${coluna.id}`}
                          style={{ width, minWidth: width, maxWidth: width }}
                          className="px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words">
                          
                              {renderCell(lote, coluna.id)}
                            </TableCell>);

                    })}
                      </TableRow>
                  )
                  }
                </TableBody>
              </Table>
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
        droppableId="colunas-cadastro-lotes" />
      
    </div>);

}