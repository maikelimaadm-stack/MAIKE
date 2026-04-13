import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { MoreVertical, Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical } from "lucide-react";

const CAT_LABELS = { Fiscal: "FISCAL", Financeiro: "FINANCEIRO", Contratual: "CONTRATUAL", Interno: "INTERNO", Outros: "OUTROS" };
const MOV_LABELS = { Entrada: "ENTRADA", Saida: "SAÍDA", Ambos: "AMBOS" };

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true, width: 25 },
  { id: "acoes", label: "Ações", default: true, fixo: true, width: 25 },
  { id: "nome", label: "Nome", default: true, sortable: true, align: "left", width: 220 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, align: "left", width: 80 },
  { id: "categoria", label: "Categoria", default: true, sortable: true, align: "left", width: 120 },
  { id: "tipo_movimento", label: "Movimento", default: true, sortable: true, align: "left", width: 110 },
  { id: "exige_num", label: "Exige Nº Doc", default: true, sortable: true, align: "center", width: 100 },
  { id: "exige_anexo", label: "Exige Anexo", default: true, sortable: true, align: "center", width: 100 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
  { id: "descricao", label: "Descrição", default: false, sortable: false, align: "left", width: 220 },
];

const DEFAULT_VISIBLE = COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
const STORAGE_PREFIX = "colunas_tipos_documento";
const WIDTHS_KEY = `${STORAGE_PREFIX}_largura`;
const MIN_COL_W = 80;

function getFieldValue(item, colId) {
  if (colId === "nome") return item.nome || "";
  if (colId === "sigla") return item.sigla || "";
  if (colId === "categoria") return CAT_LABELS[item.categoria] || item.categoria || "";
  if (colId === "tipo_movimento") return MOV_LABELS[item.tipo_movimento] || item.tipo_movimento || "";
  if (colId === "exige_num") return item.exige_numero_documento !== false ? "Sim" : "Não";
  if (colId === "exige_anexo") return item.exige_anexo ? "Sim" : "Não";
  if (colId === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
  if (colId === "descricao") return item.descricao || "";
  return "";
}

export default function TabelaTiposDocumento({ tipos = [], onEdit, onDelete, showConfigColunas, setShowConfigColunas }) {
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const [columnWidths, setColumnWidths] = useState(() => { const d = Object.fromEntries(COLUNAS_DISPONIVEIS.map(c => [c.id, c.width || 160])); const s = localStorage.getItem(WIDTHS_KEY); if (!s) return d; try { return { ...d, ...JSON.parse(s) }; } catch { return d; } });
  const lastTapRef = useRef({ id: null, time: 0 });
  const scrollContainerRef = useRef(null);
  const tableRef = useRef(null);
  const [resizeColumnId, setResizeColumnId] = useState(null);
  const dragRef = useRef(null);
  const [colunasOrdem, setColunasOrdem] = useState(() => { const s = localStorage.getItem(`${STORAGE_PREFIX}_ordem`); if (s) try { return JSON.parse(s); } catch {} return COLUNAS_DISPONIVEIS.map(c => c.id); });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => { const s = localStorage.getItem(`${STORAGE_PREFIX}_visiveis`); if (s) try { return Array.from(new Set([...JSON.parse(s), ...DEFAULT_VISIBLE])); } catch {} return DEFAULT_VISIBLE; });

  useEffect(() => { localStorage.setItem(WIDTHS_KEY, JSON.stringify(columnWidths)); }, [columnWidths]);
  const toggleResizeMode = (colunaId) => { if (colunaId === "selecao" || colunaId === "acoes") return; setResizeColumnId(prev => prev === colunaId ? null : colunaId); };

  useEffect(() => {
    const onMove = (e) => { if (!dragRef.current) return; if (e.cancelable) e.preventDefault(); const cx = e.touches?.[0]?.clientX ?? e.clientX; const { columnId, startX, startWidth } = dragRef.current; setColumnWidths(prev => ({ ...prev, [columnId]: Math.max(MIN_COL_W, startWidth + (cx - startX)) })); };
    const onUp = () => { if (!dragRef.current) return; dragRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp); window.addEventListener("touchmove", onMove, { passive: false }); window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, []);

  const startDragResize = (e, colunaId) => { e.preventDefault(); e.stopPropagation(); const cx = e.touches?.[0]?.clientX ?? e.clientX; dragRef.current = { columnId: colunaId, startX: cx, startWidth: columnWidths[colunaId] || 160 }; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; };

  const sortedTipos = useMemo(() => {
    let filtered = tipos.filter(t => COLUNAS_DISPONIVEIS.filter(col => !col.fixo).every(col => { const f = filtrosColunas[col.id] || []; if (f.length === 0) return true; return f.includes(getFieldValue(t, col.id)); }));
    if (sortConfig.key) filtered.sort((a, b) => { const va = getFieldValue(a, sortConfig.key); const vb = getFieldValue(b, sortConfig.key); const cmp = va.localeCompare(vb, "pt-BR", { numeric: true, sensitivity: "base" }); return sortConfig.direction === "asc" ? cmp : -cmp; });
    return filtered;
  }, [tipos, filtrosColunas, sortConfig]);

  useEffect(() => { setSelectedItems(prev => prev.filter(id => tipos.some(t => t.id === id))); }, [tipos]);
  const toggleColuna = (colunaId) => { const n = colunasVisiveis.includes(colunaId) ? colunasVisiveis.filter(id => id !== colunaId) : [...colunasVisiveis, colunaId]; setColunasVisiveis(n); localStorage.setItem(`${STORAGE_PREFIX}_visiveis`, JSON.stringify(n)); };
  const handleDragEnd = (result) => { if (!result.destination) return; const items = Array.from(colunasOrdem); const [r] = items.splice(result.source.index, 1); items.splice(result.destination.index, 0, r); setColunasOrdem(items); localStorage.setItem(`${STORAGE_PREFIX}_ordem`, JSON.stringify(items)); };
  const colunasOrdenadas = useMemo(() => colunasOrdem.map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id)).filter(c => c && colunasVisiveis.includes(c.id)), [colunasOrdem, colunasVisiveis]);
  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  const toggleSelectAll = () => { if (selectedItems.length === sortedTipos.length && sortedTipos.length > 0) { setSelectedItems([]); return; } setSelectedItems(sortedTipos.map(r => r.id)); };
  const handleRowTouch = (item, event) => { const now = Date.now(); if (lastTapRef.current.id === item.id && now - lastTapRef.current.time < 300) { event.preventDefault(); onEdit(item); } lastTapRef.current = { id: item.id, time: now }; };
  const hasActiveFilter = (colunaId) => (filtrosColunas[colunaId] || []).length > 0;
  const getValoresFiltro = (colunaId) => filtrosColunas[colunaId] || [];
  const setValoresFiltro = (colunaId, values) => setFiltrosColunas(prev => ({ ...prev, [colunaId]: values }));

  const columnOptions = useMemo(() => { const o = {}; COLUNAS_DISPONIVEIS.filter(c => !c.fixo).forEach(col => { o[col.id] = [...new Set(tipos.map(item => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" })); }); return o; }, [tipos]);

  const renderCell = (item, colId) => {
    if (colId === "nome") return <span className={`uppercase ${item.ativo === false ? 'text-slate-400 line-through' : ''}`}>{item.nome || "-"}</span>;
    if (colId === "sigla") return <span className="font-mono font-semibold">{item.sigla || "-"}</span>;
    if (colId === "categoria") { const colors = { Fiscal: "border-blue-300 text-blue-700", Financeiro: "border-emerald-300 text-emerald-700", Contratual: "border-violet-300 text-violet-700", Interno: "border-amber-300 text-amber-700", Outros: "border-slate-300 text-slate-600" }; return <Badge variant="outline" className={`text-[10px] ${colors[item.categoria] || ""}`}>{CAT_LABELS[item.categoria] || item.categoria}</Badge>; }
    if (colId === "tipo_movimento") { const colors = { Entrada: "border-emerald-300 text-emerald-700", Saida: "border-red-300 text-red-700", Ambos: "border-blue-300 text-blue-700" }; return <Badge variant="outline" className={`text-[10px] ${colors[item.tipo_movimento] || ""}`}>{MOV_LABELS[item.tipo_movimento] || item.tipo_movimento}</Badge>; }
    if (colId === "exige_num") return item.exige_numero_documento !== false ? <Badge className="text-[10px] bg-blue-100 text-blue-700">Sim</Badge> : <span className="text-slate-400">Não</span>;
    if (colId === "exige_anexo") return item.exige_anexo ? <Badge className="text-[10px] bg-amber-100 text-amber-700">Sim</Badge> : <span className="text-slate-400">Não</span>;
    if (colId === "ativo") return item.ativo !== false ? <Badge className="text-[10px] bg-emerald-100 text-emerald-700">Ativo</Badge> : <Badge className="text-[10px] bg-slate-100 text-slate-500">Inativo</Badge>;
    if (colId === "descricao") return item.descricao || "-";
    return "-";
  };

  const renderFilterControl = (colunaId) => {
    const btnCls = `h-3 w-3 min-w-3 p-0 ${hasActiveFilter(colunaId) ? "text-emerald-600" : "text-slate-300 hover:text-slate-400"}`;
    const options = columnOptions[colunaId] || [];
    const vals = filtroTemp.colunaId === colunaId ? filtroTemp.valores : getValoresFiltro(colunaId);
    const filteredOpts = options.filter(o => String(o).toLowerCase().includes(buscaFiltroMenu.toLowerCase()));
    const allSel = filteredOpts.length > 0 && filteredOpts.every(o => vals.includes(o));
    return (
      <Popover open={menuFiltroAberto === colunaId} onOpenChange={(open) => { setMenuFiltroAberto(open ? colunaId : null); setBuscaFiltroMenu(""); setFiltroTemp(open ? { colunaId, valores: [...getValoresFiltro(colunaId)] } : { colunaId: null, valores: [] }); }}>
        <PopoverTrigger asChild><Button variant="ghost" size="icon" className={btnCls}><Filter className="w-2 h-2" /></Button></PopoverTrigger>
        <PopoverContent align="end" side="bottom" sideOffset={4} className="w-[310px] p-0 z-[9999]">
          <div className="p-1 space-y-0.5 border-b">
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { handleSort(colunaId); setMenuFiltroAberto(null); }}><ArrowDownAZ className="w-4 h-4 mr-2" /> Menor → Maior</button>
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { setSortConfig({ key: colunaId, direction: "desc" }); setMenuFiltroAberto(null); }}><ArrowUpZA className="w-4 h-4 mr-2" /> Maior → Menor</button>
            <button type="button" className={`flex items-center w-full px-2 h-8 text-xs rounded ${hasActiveFilter(colunaId) ? 'hover:bg-slate-100 text-slate-700' : 'text-slate-300 cursor-not-allowed'}`} disabled={!hasActiveFilter(colunaId)} onClick={() => { setValoresFiltro(colunaId, []); setMenuFiltroAberto(null); }}><X className="w-4 h-4 mr-2" /> Limpar Filtro</button>
          </div>
          <div className="p-2 space-y-2">
            <Input value={buscaFiltroMenu} onChange={(e) => setBuscaFiltroMenu(e.target.value)} placeholder="PESQUISAR" className="h-8 text-xs uppercase" />
            <div className="border border-slate-300 rounded-sm max-h-64 overflow-y-auto p-1 bg-white">
              <label className="flex h-8 items-center gap-2 px-2 py-0 text-xs text-slate-700 border-b border-slate-200">
                <Checkbox checked={allSel} onCheckedChange={(checked) => { setFiltroTemp(prev => { const rest = prev.valores.filter(v => !filteredOpts.includes(v)); return { ...prev, valores: checked ? [...new Set([...rest, ...filteredOpts])] : rest }; }); }} className="h-3.5 w-3.5 shrink-0" /><span>(Selecionar Tudo)</span>
              </label>
              {filteredOpts.map(option => (
                <label key={option} className="flex h-6 items-center gap-2 px-2 py-0 text-xs text-slate-700 hover:bg-slate-50">
                  <Checkbox checked={vals.includes(option)} onCheckedChange={(checked) => { setFiltroTemp(prev => ({ ...prev, valores: checked ? [...prev.valores, option] : prev.valores.filter(i => i !== option) })); }} className="h-3.5 w-3.5 shrink-0" /><span>{option}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMenuFiltroAberto(null)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setValoresFiltro(colunaId, filtroTemp.valores); setMenuFiltroAberto(null); }}>OK</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <div className="space-y-1 overflow-hidden">
      <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
        <div className="text-xs text-slate-500">{sortedTipos.length} de {tipos.length} registros</div>
        {selectedItems.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel><DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { selectedItems.forEach(id => onDelete(id)); setSelectedItems([]); }} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
              <DropdownMenuSeparator /><DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">Limpar Seleção</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Card className="overflow-hidden">
        <CardContent className="p-0 overflow-hidden">
          <div ref={scrollContainerRef} className="relative w-full overflow-auto max-h-[calc(100dvh-240px)] md:max-h-[calc(100dvh-150px)]" style={{ overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch' }}>
            <Table ref={tableRef} className={`w-full ${isMobile ? "min-w-[720px]" : "min-w-[900px]"} border-separate border-spacing-0 table-fixed`}>
              <TableHeader className="bg-white">
                <TableRow className="sticky top-0 z-40 bg-white">
                  {colunasOrdenadas.map(coluna => {
                    const width = columnWidths[coluna.id] || coluna.width || 160;
                    const isResizing = resizeColumnId === coluna.id;
                    if (coluna.id === "selecao") return <TableHead key="selecao" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-center align-middle border-r border-b border-gray-200"><div className="flex items-center justify-center w-full h-full"><Checkbox checked={selectedItems.length === sortedTipos.length && sortedTipos.length > 0} onCheckedChange={toggleSelectAll} className="h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" /></div></TableHead>;
                    if (coluna.id === "acoes") return <TableHead key="acoes" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-center align-middle border-r border-b border-gray-200" />;
                    const fc = renderFilterControl(coluna.id);
                    return (
                      <TableHead key={coluna.id} style={{ width, minWidth: width, maxWidth: width }} className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7">
                        <div className="inline-flex items-center justify-center gap-1 h-full w-full whitespace-nowrap overflow-hidden text-ellipsis">{coluna.label}</div>
                        {fc && <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1" onClick={e => e.stopPropagation()}>{fc}<button type="button" className={`h-4 w-4 flex items-center justify-center rounded ${isResizing ? 'text-emerald-600 bg-emerald-100' : 'text-slate-300 hover:text-slate-500'}`} onClick={e => { e.stopPropagation(); toggleResizeMode(coluna.id); }}><GripVertical className="w-2.5 h-2.5" /></button></div>}
                        {isResizing && <div className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-800" onMouseDown={e => startDragResize(e, coluna.id)} onTouchStart={e => startDragResize(e, coluna.id)} onClick={e => { e.stopPropagation(); setResizeColumnId(null); }}><GripVertical className="w-3.5 h-3.5 text-white" /></div>}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTipos.length === 0 ? (
                  <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhum tipo de documento encontrado</TableCell></TableRow>
                ) : sortedTipos.map(item => (
                  <TableRow key={item.id} className="transition-colors border-b hover:bg-gray-100" onDoubleClick={() => onEdit(item)} onTouchEnd={(event) => handleRowTouch(item, event)}>
                    {colunasOrdenadas.map(coluna => {
                      const width = columnWidths[coluna.id] || coluna.width || 160;
                      if (coluna.id === "selecao") return <TableCell key={`${item.id}-sel`} style={{ width: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={e => e.stopPropagation()}><div className="flex items-center justify-center w-full h-full"><Checkbox checked={selectedItems.includes(item.id)} onCheckedChange={(checked) => setSelectedItems(prev => checked ? [...prev, item.id] : prev.filter(id => id !== item.id))} className="rounded-full h-4 w-4 border-2 border-gray-400 data-[state=checked]:bg-primary" /></div></TableCell>;
                      if (coluna.id === "acoes") return <TableCell key={`${item.id}-act`} style={{ width: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={e => e.stopPropagation()}><div className="flex items-center justify-center w-full h-full"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => onEdit(item)} className="text-xs">Editar</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => onDelete(item.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></TableCell>;
                      const align = coluna.align === "right" ? "text-right" : coluna.align === "center" ? "text-center" : "text-left";
                      return <TableCell key={`${item.id}-${coluna.id}`} style={{ width, minWidth: width, maxWidth: width }} className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words ${align}`}>{renderCell(item, coluna.id)}</TableCell>;
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <ConfiguracaoColunasMapaDialog open={showConfigColunas} onOpenChange={setShowConfigColunas} colunasDisponiveis={COLUNAS_DISPONIVEIS} colunasVisiveis={colunasVisiveis} colunasOrdem={colunasOrdem} toggleColuna={toggleColuna} handleDragEnd={handleDragEnd} droppableId="colunas-tipos-documento" />
    </div>
  );
}