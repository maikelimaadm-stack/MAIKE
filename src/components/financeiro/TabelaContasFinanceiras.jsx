import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { MoreVertical, Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical } from "lucide-react";

const escaparCsv = (valor) => `"${String(valor ?? "").replaceAll('"', '""')}"`;

const TIPO_LABELS = { Banco: "BANCO", Caixa: "CAIXA", CarteiraDigital: "CARTEIRA DIGITAL" };

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true, width: 25 },
  { id: "acoes", label: "Ações", default: true, fixo: true, width: 25 },
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left", width: 220 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, align: "left", width: 130 },
  { id: "banco", label: "Banco", default: true, sortable: true, align: "left", width: 160 },
  { id: "agencia", label: "Agência", default: false, sortable: true, align: "left", width: 100 },
  { id: "conta", label: "Conta", default: false, sortable: true, align: "left", width: 120 },
  { id: "saldo_inicial", label: "Saldo Inicial", default: false, sortable: true, align: "right", width: 120 },
  { id: "saldo_atual", label: "Saldo Atual", default: true, sortable: true, align: "right", width: 130 },
  { id: "moeda", label: "Moeda", default: false, sortable: true, align: "center", width: 70 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
  { id: "permite_negativo", label: "Permite Negativo", default: false, sortable: true, align: "center", width: 120 },
  { id: "descricao", label: "Descrição", default: false, sortable: false, align: "left", width: 220 },
];

const DEFAULT_VISIBLE = COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
const STORAGE_PREFIX = "colunas_contas_financeiras";
const WIDTHS_KEY = `${STORAGE_PREFIX}_largura`;
const MIN_COL_W = 80;

function formatCurrency(val) {
  const n = Number(val);
  if (isNaN(n)) return "-";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function getFieldValue(item, colId) {
  if (colId === "nome") return item.nome || "";
  if (colId === "tipo") return TIPO_LABELS[item.tipo] || item.tipo || "";
  if (colId === "banco") return item.banco || "";
  if (colId === "agencia") return item.agencia || "";
  if (colId === "conta") return item.conta || "";
  if (colId === "saldo_inicial") return formatCurrency(item.saldo_inicial);
  if (colId === "saldo_atual") return formatCurrency(item.saldo_atual);
  if (colId === "moeda") return item.moeda || "BRL";
  if (colId === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
  if (colId === "permite_negativo") return item.permite_negativo ? "Sim" : "Não";
  if (colId === "descricao") return item.descricao || "";
  return "";
}

export default function TabelaContasFinanceiras({ contas = [], onEdit, onDelete, showConfigColunas, setShowConfigColunas }) {
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const [columnWidths, setColumnWidths] = useState(() => {
    const defaults = Object.fromEntries(COLUNAS_DISPONIVEIS.map(c => [c.id, c.width || 160]));
    const saved = localStorage.getItem(WIDTHS_KEY);
    if (!saved) return defaults;
    try { return { ...defaults, ...JSON.parse(saved) }; } catch { return defaults; }
  });

  const lastTapRef = useRef({ id: null, time: 0 });
  const scrollContainerRef = useRef(null);
  const tableRef = useRef(null);
  const [resizeColumnId, setResizeColumnId] = useState(null);
  const dragRef = useRef(null);

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}_ordem`);
    if (saved) try { return JSON.parse(saved); } catch { /* */ }
    return COLUNAS_DISPONIVEIS.map(c => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}_visiveis`);
    if (saved) try { return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE])); } catch { /* */ }
    return DEFAULT_VISIBLE;
  });

  useEffect(() => { localStorage.setItem(WIDTHS_KEY, JSON.stringify(columnWidths)); }, [columnWidths]);

  const toggleResizeMode = (colunaId) => {
    if (colunaId === "selecao" || colunaId === "acoes") return;
    setResizeColumnId(prev => prev === colunaId ? null : colunaId);
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      if (e.cancelable) e.preventDefault();
      const clientX = e.touches?.[0]?.clientX ?? e.clientX;
      const { columnId, startX, startWidth } = dragRef.current;
      setColumnWidths(prev => ({ ...prev, [columnId]: Math.max(MIN_COL_W, startWidth + (clientX - startX)) }));
    };
    const onUp = () => { if (!dragRef.current) return; dragRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, []);

  const startDragResize = (e, colunaId) => {
    e.preventDefault(); e.stopPropagation();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    dragRef.current = { columnId: colunaId, startX: clientX, startWidth: columnWidths[colunaId] || 160 };
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  };

  const sortedContas = useMemo(() => {
    let filtered = contas.filter(c => {
      return COLUNAS_DISPONIVEIS.filter(col => !col.fixo).every(col => {
        const f = filtrosColunas[col.id] || [];
        if (f.length === 0) return true;
        return f.includes(getFieldValue(c, col.id));
      });
    });
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        const va = getFieldValue(a, sortConfig.key);
        const vb = getFieldValue(b, sortConfig.key);
        const cmp = va.localeCompare(vb, "pt-BR", { numeric: true, sensitivity: "base" });
        return sortConfig.direction === "asc" ? cmp : -cmp;
      });
    }
    return filtered;
  }, [contas, filtrosColunas, sortConfig]);

  useEffect(() => { setSelectedItems(prev => prev.filter(id => contas.some(c => c.id === id))); }, [contas]);

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId) ? colunasVisiveis.filter(id => id !== colunaId) : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem(`${STORAGE_PREFIX}_visiveis`, JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem(`${STORAGE_PREFIX}_ordem`, JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem.map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id)).filter(c => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  const toggleSelectAll = () => {
    if (selectedItems.length === sortedContas.length && sortedContas.length > 0) { setSelectedItems([]); return; }
    setSelectedItems(sortedContas.map(r => r.id));
  };

  const handleRowTouch = (item, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === item.id && now - lastTapRef.current.time < 300) { event.preventDefault(); onEdit(item); }
    lastTapRef.current = { id: item.id, time: now };
  };

  const hasActiveFilter = (colunaId) => (filtrosColunas[colunaId] || []).length > 0;
  const getValoresFiltro = (colunaId) => filtrosColunas[colunaId] || [];
  const setValoresFiltro = (colunaId, values) => setFiltrosColunas(prev => ({ ...prev, [colunaId]: values }));
  const clearColumnFilter = (colunaId) => setValoresFiltro(colunaId, []);

  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter(c => !c.fixo).forEach(col => {
      opts[col.id] = [...new Set(contas.map(item => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
    });
    return opts;
  }, [contas]);

  const exportarTabela = () => {
    const colunasExportaveis = colunasOrdenadas.filter((coluna) => !coluna.fixo);
    const contasSelecionadas = sortedContas.filter((item) => selectedItems.includes(item.id));
    const header = colunasExportaveis.map((coluna) => escaparCsv(coluna.label)).join(';');
    const rows = contasSelecionadas.map((item) => (
      colunasExportaveis.map((coluna) => escaparCsv(getFieldValue(item, coluna.id))).join(';')
    ));
    const csv = [header, ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `contas_financeiras_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const renderCell = (item, colId) => {
    if (colId === "nome") return <span className={`uppercase ${item.ativo === false ? 'text-slate-400 line-through' : ''}`}>{item.nome || "-"}</span>;
    if (colId === "tipo") {
      const colors = { Banco: "border-blue-300 text-blue-700", Caixa: "border-amber-300 text-amber-700", CarteiraDigital: "border-violet-300 text-violet-700" };
      return <Badge variant="outline" className={`text-[10px] ${colors[item.tipo] || ""}`}>{TIPO_LABELS[item.tipo] || item.tipo}</Badge>;
    }
    if (colId === "banco") return item.banco || "-";
    if (colId === "agencia") return item.agencia || "-";
    if (colId === "conta") return item.conta || "-";
    if (colId === "saldo_inicial") return <span className="font-mono">{formatCurrency(item.saldo_inicial)}</span>;
    if (colId === "saldo_atual") {
      const val = Number(item.saldo_atual) || 0;
      return <span className={`font-mono font-semibold ${val < 0 ? "text-red-600" : "text-emerald-700"}`}>{formatCurrency(val)}</span>;
    }
    if (colId === "moeda") return item.moeda || "BRL";
    if (colId === "ativo") return item.ativo !== false ? <Badge className="text-[10px] bg-emerald-100 text-emerald-700">Ativo</Badge> : <Badge className="text-[10px] bg-slate-100 text-slate-500">Inativo</Badge>;
    if (colId === "permite_negativo") return item.permite_negativo ? <span className="text-amber-600 font-medium">Sim</span> : <span className="text-slate-400">Não</span>;
    if (colId === "descricao") return item.descricao || "-";
    return "-";
  };

  const renderFilterControl = (colunaId) => {
    const buttonClass = `h-3 w-3 min-w-3 p-0 ${hasActiveFilter(colunaId) ? "text-emerald-600" : "text-slate-300 hover:text-slate-400"}`;
    const columnLabel = COLUNAS_DISPONIVEIS.find(c => c.id === colunaId)?.label || colunaId;
    const options = columnOptions[colunaId] || [];
    const valoresSelecionados = filtroTemp.colunaId === colunaId ? filtroTemp.valores : getValoresFiltro(colunaId);
    const filteredOptions = options.filter(o => String(o).toLowerCase().includes(buscaFiltroMenu.toLowerCase()));
    const allVisibleSelected = filteredOptions.length > 0 && filteredOptions.every(o => valoresSelecionados.includes(o));

    return (
      <Popover open={menuFiltroAberto === colunaId} onOpenChange={(open) => {
        setMenuFiltroAberto(open ? colunaId : null);
        setBuscaFiltroMenu("");
        setFiltroTemp(open ? { colunaId, valores: [...getValoresFiltro(colunaId)] } : { colunaId: null, valores: [] });
      }}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="bottom" sideOffset={4} className="w-[310px] p-0 z-[9999]">
          <div className="p-1 space-y-0.5 border-b">
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { handleSort(colunaId); setMenuFiltroAberto(null); }}>
              <ArrowDownAZ className="w-4 h-4 mr-2" /> Classificar do Menor para o Maior
            </button>
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { setSortConfig({ key: colunaId, direction: "desc" }); setMenuFiltroAberto(null); }}>
              <ArrowUpZA className="w-4 h-4 mr-2" /> Classificar do Maior para o Menor
            </button>
            <button type="button" className={`flex items-center w-full px-2 h-8 text-xs rounded ${hasActiveFilter(colunaId) ? 'hover:bg-slate-100 text-slate-700' : 'text-slate-300 cursor-not-allowed'}`} disabled={!hasActiveFilter(colunaId)} onClick={() => { clearColumnFilter(colunaId); setMenuFiltroAberto(null); }}>
              <X className="w-4 h-4 mr-2" /> Limpar Filtro de "{columnLabel}"
            </button>
          </div>
          <div className="p-2 space-y-2">
            <Input value={buscaFiltroMenu} onChange={(e) => setBuscaFiltroMenu(e.target.value)} placeholder="PESQUISAR" className="h-8 text-xs uppercase" />
            <div className="border border-slate-300 rounded-sm max-h-64 overflow-y-auto p-1 bg-white">
              <label className="flex h-8 items-center gap-2 px-2 py-0 text-xs text-slate-700 border-b border-slate-200 whitespace-nowrap overflow-hidden">
                <Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => {
                  setFiltroTemp(prev => {
                    const restantes = prev.valores.filter(v => !filteredOptions.includes(v));
                    return { ...prev, valores: checked ? [...new Set([...restantes, ...filteredOptions])] : restantes };
                  });
                }} className="h-3.5 w-3.5 shrink-0" />
                <span className="block flex-1 overflow-hidden text-ellipsis whitespace-nowrap">(Selecionar Tudo)</span>
              </label>
              {filteredOptions.map(option => (
                <label key={option} className="flex h-6 items-center gap-2 px-2 py-0 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap overflow-hidden">
                  <Checkbox checked={valoresSelecionados.includes(option)} onCheckedChange={(checked) => {
                    setFiltroTemp(prev => ({ ...prev, valores: checked ? [...prev.valores, option] : prev.valores.filter(i => i !== option) }));
                  }} className="h-3.5 w-3.5 shrink-0" />
                  <span className="block flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{option}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setMenuFiltroAberto(null); setBuscaFiltroMenu(""); setFiltroTemp({ colunaId: null, valores: [] }); }}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setValoresFiltro(colunaId, filtroTemp.valores); setMenuFiltroAberto(null); setBuscaFiltroMenu(""); setFiltroTemp({ colunaId: null, valores: [] }); }}>OK</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className="space-y-1 overflow-hidden">
      <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
        <div className="text-xs text-slate-500">{sortedContas.length} de {contas.length} registros</div>
        <div className="flex gap-2 flex-wrap">
          {selectedItems.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={exportarTabela} className="text-xs">Exportar Selecionados</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { selectedItems.forEach(id => onDelete(id)); setSelectedItems([]); }} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">Limpar Seleção</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-hidden">
          <div className="relative overflow-hidden">
            <div ref={scrollContainerRef} className="relative w-full overflow-auto max-h-[calc(100dvh-240px)] md:max-h-[calc(100dvh-150px)]" style={{ overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch' }}>
              <Table ref={tableRef} className={`w-full ${isMobile ? "min-w-[720px]" : "min-w-[900px]"} border-separate border-spacing-0 table-fixed`}>
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white">
                    {colunasOrdenadas.map(coluna => {
                      const width = columnWidths[coluna.id] || coluna.width || 160;
                      const isResizing = resizeColumnId === coluna.id;

                      if (coluna.id === "selecao") {
                        return (
                          <TableHead key="selecao" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200">
                            <div className="flex items-center justify-center w-full h-full">
                              <Checkbox checked={selectedItems.length === sortedContas.length && sortedContas.length > 0} onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                            </div>
                          </TableHead>
                        );
                      }
                      if (coluna.id === "acoes") {
                        return <TableHead key="acoes" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200" />;
                      }

                      const filterControl = renderFilterControl(coluna.id);
                      return (
                        <TableHead key={coluna.id} style={{ width, minWidth: width, maxWidth: width }} className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7">
                          <div className="inline-flex items-center justify-center gap-1 h-full w-full whitespace-nowrap overflow-hidden text-ellipsis">{coluna.label}</div>
                          {filterControl && (
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              {filterControl}
                              <button type="button" className={`h-4 w-4 flex items-center justify-center rounded ${isResizing ? 'text-emerald-600 bg-emerald-100' : 'text-slate-300 hover:text-slate-500'}`} onClick={e => { e.stopPropagation(); toggleResizeMode(coluna.id); }} onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); toggleResizeMode(coluna.id); }} title="Redimensionar coluna">
                                <GripVertical className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          )}
                          {isResizing && (
                            <div className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-800" onMouseDown={e => startDragResize(e, coluna.id)} onTouchStart={e => startDragResize(e, coluna.id)} onClick={e => { e.stopPropagation(); setResizeColumnId(null); }} onDoubleClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
                              <GripVertical className="w-3.5 h-3.5 text-white" />
                            </div>
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedContas.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhuma conta financeira encontrada</TableCell>
                    </TableRow>
                  ) : (
                    sortedContas.map(item => (
                      <TableRow key={item.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100" onDoubleClick={() => onEdit(item)} onTouchEnd={(event) => handleRowTouch(item, event)}>
                        {colunasOrdenadas.map(coluna => {
                          const width = columnWidths[coluna.id] || coluna.width || 160;
                          if (coluna.id === "selecao") {
                            return (
                              <TableCell key={`${item.id}-sel`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
                                <div className="flex items-center justify-center w-full h-full">
                                  <Checkbox checked={selectedItems.includes(item.id)} onCheckedChange={(checked) => setSelectedItems(prev => checked ? [...prev, item.id] : prev.filter(id => id !== item.id))} className="rounded-full h-4 w-4 border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                                </div>
                              </TableCell>
                            );
                          }
                          if (coluna.id === "acoes") {
                            return (
                              <TableCell key={`${item.id}-act`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
                                <div className="flex items-center justify-center w-full h-full">
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                      <DropdownMenuItem onClick={() => onEdit(item)} className="text-xs">Editar</DropdownMenuItem>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => onDelete(item.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>
                            );
                          }
                          const align = coluna.align === "right" ? "text-right" : coluna.align === "center" ? "text-center" : "text-left";
                          return (
                            <TableCell key={`${item.id}-${coluna.id}`} style={{ width, minWidth: width, maxWidth: width }} className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words ${align}`}>
                              {renderCell(item, coluna.id)}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))
                  )}
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
        droppableId="colunas-contas-financeiras"
      />
    </div>
  );
}