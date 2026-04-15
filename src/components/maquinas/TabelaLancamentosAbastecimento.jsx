import React, { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MoreVertical, Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical } from "lucide-react";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";

const LS_VISIBLE = "colunas_visiveis_abastecimentos";
const LS_ORDER = "colunas_ordem_abastecimentos";
const LS_WIDTHS = "colunas_largura_abastecimentos";
const MIN_COLUMN_WIDTH = 60;

const formatDate = (d) => {
  if (!d) return "-";
  const [y, m, day] = d.split("T")[0].split("-");
  return `${day}/${m}/${y}`;
};

const fmt2 = (v) =>
  v != null && v !== ""
    ? Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "-";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Sel.", default: true, fixo: true, width: 28 },
  { id: "acoes", label: "", default: true, fixo: true, width: 28 },
  { id: "data_abastecimento", label: "Data", default: true, width: 90 },
  { id: "maquina_nome", label: "Ativo", default: true, width: 180 },
  { id: "maquina_identificador", label: "ID Ativo", default: false, width: 100 },
  { id: "maquina_categoria", label: "Categoria", default: false, width: 130 },
  { id: "maquina_tipo_medicao", label: "Tipo Med.", default: true, width: 110 },
  { id: "grupo_atividade_nome", label: "Grupo Atividade", default: true, width: 150 },
  { id: "tipo_servico", label: "Tipo Serviço", default: true, width: 140 },
  { id: "responsavel", label: "Responsável", default: true, width: 130 },
  { id: "local_estoque_nome", label: "Local Estoque", default: false, width: 140 },
  { id: "produto_nome", label: "Produto", default: true, width: 160 },
  { id: "quantidade_litros", label: "Litros", default: true, width: 80, align: "right" },
  { id: "medicao", label: "Medição", default: true, width: 90, align: "right" },
  { id: "medicao_anterior", label: "Med. Anterior", default: true, width: 100, align: "right" },
  { id: "uso_realizado", label: "Uso (H/KM)", default: true, width: 90, align: "right" },
  { id: "consumo_calculado", label: "Consumo", default: true, width: 90, align: "right" },
  { id: "observacoes", label: "Observações", default: false, width: 200 },
];

const DEFAULT_VISIBLE = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
const DEFAULT_ORDER = COLUNAS_DISPONIVEIS.map((c) => c.id);

const loadLS = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};

const SORTABLE = [
  "data_abastecimento", "maquina_nome", "maquina_categoria", "maquina_tipo_medicao",
  "maquina_identificador", "responsavel", "produto_nome", "quantidade_litros",
  "medicao", "medicao_anterior", "uso_realizado", "consumo_calculado",
  "grupo_atividade_nome", "tipo_servico", "local_estoque_nome",
];

export default function TabelaLancamentosAbastecimento({
  abastecimentos = [],
  selecionados = [],
  onSelecionadosChange,
  onEdit,
  onDelete,
  showConfigColunas,
  setShowConfigColunas,
}) {
  const tableRef = useRef(null);
  const dragRef = useRef(null);

  const [colunasVisiveis, setColunasVisiveis] = useState(() => loadLS(LS_VISIBLE, DEFAULT_VISIBLE));
  const [colunasOrdem, setColunasOrdem] = useState(() => loadLS(LS_ORDER, DEFAULT_ORDER));
  const [columnWidths, setColumnWidths] = useState(() => {
    const defaults = Object.fromEntries(COLUNAS_DISPONIVEIS.map((c) => [c.id, c.width || 120]));
    const saved = loadLS(LS_WIDTHS, null);
    return saved ? { ...defaults, ...saved } : defaults;
  });
  const [resizeColumnId, setResizeColumnId] = useState(null);

  // Filtros por coluna (estilo Excel)
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });

  // Ordenação
  const [sortCol, setSortCol] = useState("data_abastecimento");
  const [sortDir, setSortDir] = useState("desc");

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  // Resize listeners
  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      if (e.cancelable) e.preventDefault();
      const clientX = e.touches?.[0]?.clientX ?? e.clientX;
      const { columnId, startX, startWidth } = dragRef.current;
      setColumnWidths((prev) => {
        const next = { ...prev, [columnId]: Math.max(MIN_COLUMN_WIDTH, startWidth + (clientX - startX)) };
        localStorage.setItem(LS_WIDTHS, JSON.stringify(next));
        return next;
      });
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  const startDragResize = (e, colunaId) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    dragRef.current = { columnId: colunaId, startX: clientX, startWidth: columnWidths[colunaId] || 120 };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const colunasOrdenadas = useMemo(() =>
    colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id))
      .filter((c) => c && colunasVisiveis.includes(c.id)),
    [colunasOrdem, colunasVisiveis]
  );

  const toggleColuna = useCallback((id) => {
    setColunasVisiveis((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      localStorage.setItem(LS_VISIBLE, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleDragEnd = useCallback((result) => {
    if (!result.destination) return;
    setColunasOrdem((prev) => {
      const next = [...prev];
      const [removed] = next.splice(result.source.index, 1);
      next.splice(result.destination.index, 0, removed);
      localStorage.setItem(LS_ORDER, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  };

  // Valor de célula para filtro/ordenação
  const getFieldValue = (item, colunaId) => {
    switch (colunaId) {
      case "data_abastecimento": return formatDate(item.data_abastecimento);
      case "quantidade_litros": return item.quantidade_litros != null ? fmt2(item.quantidade_litros) : "-";
      case "medicao": return item.medicao != null ? fmt2(item.medicao) : "-";
      case "medicao_anterior": return item.medicao_anterior != null ? fmt2(item.medicao_anterior) : "-";
      case "uso_realizado": return item.uso_realizado != null ? fmt2(item.uso_realizado) : "-";
      case "consumo_calculado": return item.consumo_calculado != null ? fmt2(item.consumo_calculado) : "NÃO CONF.";
      default: return (item[colunaId] || "-").toString().toUpperCase();
    }
  };

  // Opções únicas por coluna para o menu de filtro
  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).forEach((col) => {
      opts[col.id] = [...new Set(abastecimentos.map((item) => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" })
      );
    });
    return opts;
  }, [abastecimentos]);

  const hasActiveFilter = (colunaId) => (filtrosColunas[colunaId] || []).length > 0;
  const getValoresFiltro = (colunaId) => filtrosColunas[colunaId] || [];
  const setValoresFiltro = (colunaId, values) => setFiltrosColunas((prev) => ({ ...prev, [colunaId]: values }));
  const clearColumnFilter = (colunaId) => setValoresFiltro(colunaId, []);
  const clearAllFilters = () => setFiltrosColunas({});
  const hasAnyFilter = Object.values(filtrosColunas).some((v) => v.length > 0);

  const dadosFiltrados = useMemo(() => {
    return abastecimentos.filter((item) => {
      return COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).every((col) => {
        const filtro = filtrosColunas[col.id] || [];
        if (filtro.length === 0) return true;
        const val = getFieldValue(item, col.id);
        return filtro.includes(val);
      });
    });
  }, [abastecimentos, filtrosColunas]);

  const dadosOrdenados = useMemo(() => {
    const sorted = [...dadosFiltrados];
    sorted.sort((a, b) => {
      let va = a[sortCol] ?? "";
      let vb = b[sortCol] ?? "";
      if (sortCol === "data_abastecimento") { va = va || ""; vb = vb || ""; }
      else if (["quantidade_litros", "medicao", "medicao_anterior", "uso_realizado", "consumo_calculado"].includes(sortCol)) {
        va = Number(va) || 0; vb = Number(vb) || 0;
        return sortDir === "asc" ? va - vb : vb - va;
      }
      if (typeof va === "string") va = va.toLowerCase();
      if (typeof vb === "string") vb = vb.toLowerCase();
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [dadosFiltrados, sortCol, sortDir]);

  const toggleSelectAll = () => {
    if (selecionados.length === dadosFiltrados.length && dadosFiltrados.length > 0) onSelecionadosChange([]);
    else onSelecionadosChange(dadosFiltrados.map((m) => m.id));
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
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className={buttonClass}>
            <Filter className="w-2 h-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" sideOffset={4} className="w-[310px] p-0 z-[9999]">
          <div className="p-1 space-y-0.5 border-b">
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded"
              onClick={() => { handleSort(colunaId); setSortDir("asc"); setMenuFiltroAberto(null); }}>
              <ArrowDownAZ className="w-4 h-4 mr-2" /> Classificar do Menor para o Maior
            </button>
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded"
              onClick={() => { setSortCol(colunaId); setSortDir("desc"); setMenuFiltroAberto(null); }}>
              <ArrowUpZA className="w-4 h-4 mr-2" /> Classificar do Maior para o Menor
            </button>
            <button
              type="button"
              className={`flex items-center w-full px-2 h-8 text-xs rounded ${hasActiveFilter(colunaId) ? "hover:bg-slate-100 text-slate-700" : "text-slate-300 cursor-not-allowed"}`}
              disabled={!hasActiveFilter(colunaId)}
              onClick={() => { clearColumnFilter(colunaId); setMenuFiltroAberto(null); }}
            >
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
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="block flex-1 overflow-hidden text-ellipsis whitespace-nowrap">(Selecionar Tudo)</span>
              </label>
              {filteredOptions.map((option) => (
                <label key={option} className="flex h-6 items-center gap-2 px-2 py-0 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap overflow-hidden">
                  <Checkbox
                    checked={valoresSelecionados.includes(option)}
                    onCheckedChange={(checked) => {
                      setFiltroTemp((prev) => ({
                        ...prev,
                        valores: checked ? [...prev.valores, option] : prev.valores.filter((i) => i !== option),
                      }));
                    }}
                    className="h-3.5 w-3.5 shrink-0"
                  />
                  <span className="block flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{option}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs"
                onClick={() => { setMenuFiltroAberto(null); setBuscaFiltroMenu(""); setFiltroTemp({ colunaId: null, valores: [] }); }}>
                Cancelar
              </Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => { setValoresFiltro(colunaId, filtroTemp.valores); setMenuFiltroAberto(null); setBuscaFiltroMenu(""); setFiltroTemp({ colunaId: null, valores: [] }); }}>
                OK
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const renderCell = (item, colunaId) => {
    switch (colunaId) {
      case "data_abastecimento": return formatDate(item.data_abastecimento);
      case "quantidade_litros": return fmt2(item.quantidade_litros);
      case "medicao": return fmt2(item.medicao);
      case "medicao_anterior": return item.medicao_anterior != null ? fmt2(item.medicao_anterior) : "-";
      case "uso_realizado": return item.uso_realizado != null ? fmt2(item.uso_realizado) : "-";
      case "consumo_calculado":
        if (item.consumo_calculado == null) return <span className="text-amber-500 text-xs">NÃO CONF.</span>;
        return <span className="font-semibold text-emerald-700">{fmt2(item.consumo_calculado)}</span>;
      default: return (item[colunaId] || "-").toString().toUpperCase();
    }
  };

  return (
    <div className="space-y-1 overflow-hidden">
      {/* Barra de info e limpar filtros */}
      <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
        <div className="text-xs text-slate-500">
          {dadosFiltrados.length} de {abastecimentos.length} registros
        </div>
        <div className="flex gap-2 flex-wrap">
          {hasAnyFilter && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearAllFilters}>
              <X className="w-3 h-3 mr-1" /> Limpar Filtros
            </Button>
          )}
          {selecionados.length > 0 && (
            <span className="text-xs text-slate-500 self-center">{selecionados.length} selecionado(s)</span>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-hidden">
          <div className="relative overflow-hidden">
            <div
              className="relative w-full overflow-auto max-h-[calc(100dvh-220px)] md:max-h-[calc(100dvh-160px)]"
              style={{ overscrollBehavior: "none", WebkitOverflowScrolling: "touch" }}
            >
              <Table
                ref={tableRef}
                className={`w-full ${isMobile ? "min-w-[1100px]" : "min-w-[1300px]"} border-separate border-spacing-0 table-fixed`}
              >
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white">
                    {colunasOrdenadas.map((coluna) => {
                      const width = columnWidths[coluna.id] || coluna.width || 120;
                      const isResizing = resizeColumnId === coluna.id;

                      if (coluna.id === "selecao") return (
                        <TableHead key="selecao" style={{ width: coluna.width, minWidth: coluna.width, maxWidth: coluna.width }}
                          className="sticky top-0 z-40 h-7 p-0 bg-white text-center border-r border-b border-gray-200">
                          <div className="flex items-center justify-center w-full h-full">
                            <Checkbox checked={selecionados.length === dadosFiltrados.length && dadosFiltrados.length > 0}
                              onCheckedChange={toggleSelectAll}
                              className="peer shrink-0 shadow h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                          </div>
                        </TableHead>
                      );

                      if (coluna.id === "acoes") return (
                        <TableHead key="acoes" style={{ width: coluna.width, minWidth: coluna.width, maxWidth: coluna.width }}
                          className="sticky top-0 z-40 h-7 p-0 bg-white border-r border-b border-gray-200" />
                      );

                      const sortable = SORTABLE.includes(coluna.id);
                      const filterControl = !coluna.fixo ? renderFilterControl(coluna.id) : null;

                      return (
                        <TableHead
                          key={coluna.id}
                          style={{ width, minWidth: width, maxWidth: width }}
                          className={`sticky top-0 z-40 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-normal break-words overflow-hidden h-7 ${coluna.align === "right" ? "text-right" : "text-left"}`}
                        >
                          <div className={`inline-flex items-center h-full w-full overflow-hidden ${coluna.align === "right" ? "justify-end" : "justify-start"}`}>
                            <span className="truncate">{coluna.label}</span>
                          </div>

                          {filterControl && (
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}>
                              {filterControl}
                              <button
                                type="button"
                                className={`h-4 w-4 flex items-center justify-center rounded ${isResizing ? "text-emerald-600 bg-emerald-100" : "text-slate-300 hover:text-slate-500"}`}
                                onClick={(e) => { e.stopPropagation(); setResizeColumnId((prev) => prev === coluna.id ? null : coluna.id); }}
                                onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setResizeColumnId((prev) => prev === coluna.id ? null : coluna.id); }}
                                title="Redimensionar coluna"
                              >
                                <GripVertical className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )}

                          {isResizing && (
                            <div
                              className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-800"
                              onMouseDown={(e) => startDragResize(e, coluna.id)}
                              onTouchStart={(e) => startDragResize(e, coluna.id)}
                              onClick={(e) => { e.stopPropagation(); setResizeColumnId(null); }}
                            >
                              <GripVertical className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {dadosOrdenados.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">
                        Nenhum lançamento encontrado
                      </TableCell>
                    </TableRow>
                  ) : dadosOrdenados.map((item) => (
                    <TableRow key={item.id} className="transition-colors border-b hover:bg-gray-100" onDoubleClick={() => onEdit(item)}>
                      {colunasOrdenadas.map((coluna) => {
                        const width = columnWidths[coluna.id] || coluna.width || 120;

                        if (coluna.id === "selecao") return (
                          <TableCell key={`${item.id}-selecao`} style={{ width: coluna.width, minWidth: coluna.width, maxWidth: coluna.width }}
                            className="p-0 text-center px-0 h-7 border-r border-b border-gray-200"
                            onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center w-full h-full">
                              <Checkbox
                                checked={selecionados.includes(item.id)}
                                onCheckedChange={(checked) => onSelecionadosChange(checked ? [...selecionados, item.id] : selecionados.filter((id) => id !== item.id))}
                                className="peer shrink-0 shadow h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
                              />
                            </div>
                          </TableCell>
                        );

                        if (coluna.id === "acoes") return (
                          <TableCell key={`${item.id}-acoes`} style={{ width: coluna.width, minWidth: coluna.width, maxWidth: coluna.width }}
                            className="p-0 text-center px-0 h-7 border-r border-b border-gray-200">
                            <div className="flex items-center justify-center w-full h-full">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6">
                                    <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start">
                                  <DropdownMenuLabel className="text-xs">Ações</DropdownMenuLabel>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => onEdit(item)} className="text-xs">Editar</DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => onDelete(item)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        );

                        const numericCols = ["quantidade_litros", "medicao", "medicao_anterior", "uso_realizado", "consumo_calculado"];
                        return (
                          <TableCell
                            key={`${item.id}-${coluna.id}`}
                            style={{ width, minWidth: width, maxWidth: width }}
                            className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-200 whitespace-normal break-words overflow-hidden ${coluna.align === "right" || numericCols.includes(coluna.id) ? "text-right font-mono" : "uppercase"}`}
                          >
                            {renderCell(item, coluna.id)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
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
        droppableId="colunas-abastecimentos"
      />
    </div>
  );
}