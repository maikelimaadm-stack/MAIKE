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
{ id: "nome", label: "Nome", default: true, sortable: true, align: "left", width: 180 },
{ id: "sigla", label: "Sigla", default: true, sortable: true, align: "left", width: 100 },
{ id: "sexo", label: "Sexo", default: true, sortable: true, align: "left", width: 100 },
{ id: "raca", label: "Raça", default: true, sortable: true, align: "left", width: 140 },
{ id: "idade", label: "Faixa Idade", default: true, sortable: true, align: "left", width: 140 },
{ id: "especie", label: "Espécie", default: false, sortable: true, align: "left", width: 120 },
{ id: "categoria_oficial", label: "Categoria Oficial", default: true, sortable: true, align: "left", width: 180 },
{ id: "ganho_anual", label: "Ganho Anual (kg)", default: false, sortable: true, align: "right", width: 140 },
{ id: "gmd_jan", label: "GMD Jan", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_fev", label: "GMD Fev", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_mar", label: "GMD Mar", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_abr", label: "GMD Abr", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_mai", label: "GMD Mai", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_jun", label: "GMD Jun", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_jul", label: "GMD Jul", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_ago", label: "GMD Ago", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_set", label: "GMD Set", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_out", label: "GMD Out", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_nov", label: "GMD Nov", default: false, sortable: true, align: "right", width: 100 },
{ id: "gmd_dez", label: "GMD Dez", default: false, sortable: true, align: "right", width: 100 }];


const DEFAULT_VISIBLE_COLUMNS = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
const COLUMN_WIDTHS_KEY = "colunas_largura_categorias_manejo";
const MIN_COLUMN_WIDTH = 80;

export default function TabelaCategoriasManejo({
  categorias = [],
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
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  // Per-column filters stored in a single object
  const [filtrosColunas, setFiltrosColunas] = useState({});

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
    const saved = localStorage.getItem("colunas_ordem_categorias_manejo");
    if (saved) {try {return JSON.parse(saved);} catch {/* fallback */}}
    return COLUNAS_DISPONIVEIS.map((c) => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_visiveis_categorias_manejo");
    if (saved) {try {return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE_COLUMNS]));} catch {/* fallback */}}
    return DEFAULT_VISIBLE_COLUMNS;
  });

  useEffect(() => {localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));}, [columnWidths]);

  // Resize logic
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

  useEffect(() => {setSelectedItems((prev) => prev.filter((id) => categorias.some((c) => c.id === id)));}, [categorias]);

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId) ? colunasVisiveis.filter((id) => id !== colunaId) : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem("colunas_visiveis_categorias_manejo", JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_categorias_manejo", JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem.map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id)).filter((c) => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  // Extract unique values per column for filter options
  const getFieldValue = (item, colunaId) => {
    if (colunaId === "nome") return item.nome || "";
    if (colunaId === "sigla") return item.sigla || "";
    if (colunaId === "sexo") return item.sexo || "";
    if (colunaId === "raca") return item.raca || "";
    if (colunaId === "idade") {
      if (!item.idade_minima_meses && !item.idade_maxima_meses) return "";
      return `${item.idade_minima_meses || 0} - ${item.idade_maxima_meses || "∞"} meses`;
    }
    if (colunaId === "especie") return item.especie || "";
    if (colunaId === "categoria_oficial") return item.categoria_oficial || "";
    if (colunaId === "ganho_anual") return item.ganho_peso_anual_kg != null ? String(item.ganho_peso_anual_kg) : "";
    const gmdMap = { gmd_jan: "gmd_janeiro", gmd_fev: "gmd_fevereiro", gmd_mar: "gmd_marco", gmd_abr: "gmd_abril", gmd_mai: "gmd_maio", gmd_jun: "gmd_junho", gmd_jul: "gmd_julho", gmd_ago: "gmd_agosto", gmd_set: "gmd_setembro", gmd_out: "gmd_outubro", gmd_nov: "gmd_novembro", gmd_dez: "gmd_dezembro" };
    if (gmdMap[colunaId]) return item[gmdMap[colunaId]] != null ? String(item[gmdMap[colunaId]]) : "";
    return "";
  };

  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).forEach((col) => {
      opts[col.id] = [...new Set(categorias.map((item) => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
    });
    return opts;
  }, [categorias]);

  // Filter logic
  const hasActiveFilter = (colunaId) => (filtrosColunas[colunaId] || []).length > 0;
  const getValoresFiltro = (colunaId) => filtrosColunas[colunaId] || [];
  const setValoresFiltro = (colunaId, values) => setFiltrosColunas((prev) => ({ ...prev, [colunaId]: values }));
  const clearColumnFilter = (colunaId) => setValoresFiltro(colunaId, []);

  const categoriasFiltradas = useMemo(() => {
    return categorias.filter((item) => {
      return COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).every((col) => {
        const filtro = filtrosColunas[col.id] || [];
        if (filtro.length === 0) return true;
        const val = getFieldValue(item, col.id);
        return filtro.includes(val);
      });
    });
  }, [categorias, filtrosColunas]);

  const categoriasOrdenadas = useMemo(() => {
    const sorted = [...categoriasFiltradas];
    sorted.sort((a, b) => {
      const resolveNumeric = (item) => {
        if (sortConfig.key === "ganho_anual") return Number(item.ganho_peso_anual_kg || 0);
        if (sortConfig.key === "idade") return Number(item.idade_minima_meses || 0);
        const gmdMap = { gmd_jan: "gmd_janeiro", gmd_fev: "gmd_fevereiro", gmd_mar: "gmd_marco", gmd_abr: "gmd_abril", gmd_mai: "gmd_maio", gmd_jun: "gmd_junho", gmd_jul: "gmd_julho", gmd_ago: "gmd_agosto", gmd_set: "gmd_setembro", gmd_out: "gmd_outubro", gmd_nov: "gmd_novembro", gmd_dez: "gmd_dezembro" };
        if (gmdMap[sortConfig.key]) return Number(item[gmdMap[sortConfig.key]] || 0);
        return null;
      };
      const aNum = resolveNumeric(a);
      if (aNum !== null) {
        const bNum = resolveNumeric(b);
        if (aNum < bNum) return sortConfig.direction === "asc" ? -1 : 1;
        if (aNum > bNum) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      }
      const aVal = getFieldValue(a, sortConfig.key).toLowerCase();
      const bVal = getFieldValue(b, sortConfig.key).toLowerCase();
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [categoriasFiltradas, sortConfig]);

  const handleSort = (key) => setSortConfig((prev) => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));

  const toggleSelectAll = () => {
    if (selectedItems.length === categoriasFiltradas.length && categoriasFiltradas.length > 0) {setSelectedItems([]);return;}
    setSelectedItems(categoriasFiltradas.map((c) => c.id));
  };

  const handleExcluirSelecionados = () => {selectedItems.forEach((id) => onDelete(id));setSelectedItems([]);};

  const handleRowTouch = (item, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === item.id && now - lastTapRef.current.time < 300) {event.preventDefault();onEdit(item);}
    lastTapRef.current = { id: item.id, time: now };
  };

  const renderCell = (item, colunaId) => {
    if (colunaId === "nome") return item.nome || "-";
    if (colunaId === "sigla") return item.sigla || "-";
    if (colunaId === "sexo") return item.sexo || "-";
    if (colunaId === "raca") return item.raca || "-";
    if (colunaId === "idade") {
      if (!item.idade_minima_meses && !item.idade_maxima_meses) return "-";
      return `${item.idade_minima_meses || 0} - ${item.idade_maxima_meses || "∞"} meses`;
    }
    if (colunaId === "especie") return item.especie || "-";
    if (colunaId === "categoria_oficial") return item.categoria_oficial || "-";
    if (colunaId === "ganho_anual") return item.ganho_peso_anual_kg ?? "-";
    if (colunaId === "gmd_jan") return item.gmd_janeiro ?? "-";
    if (colunaId === "gmd_fev") return item.gmd_fevereiro ?? "-";
    if (colunaId === "gmd_mar") return item.gmd_marco ?? "-";
    if (colunaId === "gmd_abr") return item.gmd_abril ?? "-";
    if (colunaId === "gmd_mai") return item.gmd_maio ?? "-";
    if (colunaId === "gmd_jun") return item.gmd_junho ?? "-";
    if (colunaId === "gmd_jul") return item.gmd_julho ?? "-";
    if (colunaId === "gmd_ago") return item.gmd_agosto ?? "-";
    if (colunaId === "gmd_set") return item.gmd_setembro ?? "-";
    if (colunaId === "gmd_out") return item.gmd_outubro ?? "-";
    if (colunaId === "gmd_nov") return item.gmd_novembro ?? "-";
    if (colunaId === "gmd_dez") return item.gmd_dezembro ?? "-";
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
          {categoriasFiltradas.length} de {categorias.length} registros
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
                <DropdownMenuItem onClick={handleExcluirSelecionados} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
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
                              <Checkbox checked={selectedItems.length === categoriasFiltradas.length && categoriasFiltradas.length > 0} onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                            </div>
                          </TableHead>);

                      }

                      if (coluna.id === "acoes") {
                        return (
                          <TableHead key="acoes" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200" />);

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
                          <div className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-800 "

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
                  {categoriasOrdenadas.length === 0 ?
                  <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                        Nenhuma categoria encontrada
                      </TableCell>
                    </TableRow> :

                  categoriasOrdenadas.map((item) =>
                  <TableRow
                    key={item.id}
                    className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100"
                    onDoubleClick={() => onEdit(item)}
                    onTouchEnd={(event) => handleRowTouch(item, event)}>
                    
                        {colunasOrdenadas.map((coluna) => {
                      const width = columnWidths[coluna.id] || coluna.width || 160;

                      if (coluna.id === "selecao") {
                        return (
                          <TableCell
                            key={`${item.id}-selecao`}
                            style={{ width: 25, minWidth: 25, maxWidth: 25 }}
                            className="p-0 text-muted-foreground font-medium text-center align-middle px-0 h-7 border-r border-b border-gray-300"
                            onClick={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}>
                            
                                <div className="flex items-center justify-center w-full h-full">
                                  <Checkbox checked={selectedItems.includes(item.id)} onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, item.id] : prev.filter((id) => id !== item.id))} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                                </div>
                              </TableCell>);

                      }

                      if (coluna.id === "acoes") {
                        return (
                          <TableCell
                            key={`${item.id}-acoes`}
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
                                      <DropdownMenuItem onClick={() => onEdit(item)} className="text-xs">Editar</DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => onDelete(item.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>);

                      }

                      return (
                        <TableCell
                          key={`${item.id}-${coluna.id}`}
                          style={{ width, minWidth: width, maxWidth: width }}
                          className="px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words">
                          
                              {renderCell(item, coluna.id)}
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
        droppableId="colunas-categorias-manejo" />
      
    </div>);

}