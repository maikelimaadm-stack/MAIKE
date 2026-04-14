import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { MoreVertical, Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical } from "lucide-react";

const COLUNAS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true, width: 25 },
  { id: "acoes", label: "Ações", default: true, fixo: true, width: 25 },
  { id: "numero", label: "Nº", default: true, sortable: true, width: 70 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 300 },
  { id: "descricao", label: "Descrição", default: true, sortable: true, width: 300 },
  { id: "ativo", label: "Ativo", default: true, sortable: true, align: "center", width: 80 },
];

const DEFAULT_VIS = COLUNAS.filter(c => c.default).map(c => c.id);
const STORAGE = "colunas_marcas_v1";

function getFieldValue(item, id) {
  if (id === "numero") return item.numero_marca || "";
  if (id === "nome") return item.nome || "";
  if (id === "descricao") return item.descricao || "";
  if (id === "ativo") return item.ativo !== false ? "Ativo" : "Inativo";
  return "";
}

export default function TabelaMarcas({ marcas = [], onEdit, onDelete, isLoading, showConfigColunas, setShowConfigColunas }) {
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const lastTapRef = useRef({ id: null, time: 0 });
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const [columnWidths, setColumnWidths] = useState(() => {
    const defs = Object.fromEntries(COLUNAS.map(c => [c.id, c.width || 160]));
    const saved = localStorage.getItem(`${STORAGE}_largura`);
    if (!saved) return defs;
    try { return { ...defs, ...JSON.parse(saved) }; } catch { return defs; }
  });
  const dragRef = useRef(null);
  const [resizeColumnId, setResizeColumnId] = useState(null);

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE}_ordem`);
    if (saved) try { return JSON.parse(saved); } catch {}
    return COLUNAS.map(c => c.id);
  });
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE}_visiveis`);
    if (saved) try { return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VIS.filter(id => COLUNAS.find(c => c.id === id)?.fixo)])); } catch {}
    return DEFAULT_VIS;
  });

  useEffect(() => { localStorage.setItem(`${STORAGE}_largura`, JSON.stringify(columnWidths)); }, [columnWidths]);

  useEffect(() => {
    const onMove = (e) => { if (!dragRef.current) return; if (e.cancelable) e.preventDefault(); const x = e.touches?.[0]?.clientX ?? e.clientX; const { columnId, startX, startWidth } = dragRef.current; setColumnWidths(p => ({ ...p, [columnId]: Math.max(80, startWidth + (x - startX)) })); };
    const onUp = () => { if (!dragRef.current) return; dragRef.current = null; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp); window.addEventListener("touchmove", onMove, { passive: false }); window.addEventListener("touchend", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); window.removeEventListener("touchmove", onMove); window.removeEventListener("touchend", onUp); };
  }, []);

  const startDragResize = (e, id) => { e.preventDefault(); e.stopPropagation(); const x = e.touches?.[0]?.clientX ?? e.clientX; dragRef.current = { columnId: id, startX: x, startWidth: columnWidths[id] || 160 }; document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none"; };

  useEffect(() => { setSelectedItems(p => p.filter(id => marcas.some(m => m.id === id))); }, [marcas]);

  const filtrados = useMemo(() => marcas.filter(m => COLUNAS.filter(c => !c.fixo).every(col => { const f = filtrosColunas[col.id] || []; if (!f.length) return true; return f.includes(getFieldValue(m, col.id)); })), [marcas, filtrosColunas]);
  const ordenados = useMemo(() => {
    const s = [...filtrados];
    s.sort((a, b) => { let av = getFieldValue(a, sortConfig.key).toLowerCase(), bv = getFieldValue(b, sortConfig.key).toLowerCase(); if (av < bv) return sortConfig.direction === "asc" ? -1 : 1; if (av > bv) return sortConfig.direction === "asc" ? 1 : -1; return 0; });
    return s;
  }, [filtrados, sortConfig]);

  const colunasOrdenadas = useMemo(() => colunasOrdem.map(id => COLUNAS.find(c => c.id === id)).filter(c => c && colunasVisiveis.includes(c.id)), [colunasOrdem, colunasVisiveis]);
  const toggleColuna = (id) => { const n = colunasVisiveis.includes(id) ? colunasVisiveis.filter(i => i !== id) : [...colunasVisiveis, id]; setColunasVisiveis(n); localStorage.setItem(`${STORAGE}_visiveis`, JSON.stringify(n)); };
  const handleDragEnd = (r) => { if (!r.destination) return; const items = Array.from(colunasOrdem); const [x] = items.splice(r.source.index, 1); items.splice(r.destination.index, 0, x); setColunasOrdem(items); localStorage.setItem(`${STORAGE}_ordem`, JSON.stringify(items)); };
  const handleSort = (k) => setSortConfig(p => ({ key: k, direction: p.key === k && p.direction === "asc" ? "desc" : "asc" }));
  const toggleSelectAll = () => { if (selectedItems.length === ordenados.length && ordenados.length > 0) setSelectedItems([]); else setSelectedItems(ordenados.map(r => r.id)); };
  const handleRowTouch = (item, event) => { const now = Date.now(); if (lastTapRef.current.id === item.id && now - lastTapRef.current.time < 300) { event.preventDefault(); onEdit(item); } lastTapRef.current = { id: item.id, time: now }; };

  const hasActiveFilter = (id) => (filtrosColunas[id] || []).length > 0;
  const columnOptions = useMemo(() => { const o = {}; COLUNAS.filter(c => !c.fixo).forEach(c => { o[c.id] = [...new Set(marcas.map(m => getFieldValue(m, c.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")); }); return o; }, [marcas]);

  const renderFilterControl = (colunaId) => {
    const options = columnOptions[colunaId] || [];
    const valoresSelecionados = filtroTemp.colunaId === colunaId ? filtroTemp.valores : (filtrosColunas[colunaId] || []);
    const filtered = options.filter(o => String(o).toLowerCase().includes(buscaFiltroMenu.toLowerCase()));
    const allSel = filtered.length > 0 && filtered.every(o => valoresSelecionados.includes(o));
    return (
      <Popover open={menuFiltroAberto === colunaId} onOpenChange={(open) => { setMenuFiltroAberto(open ? colunaId : null); setBuscaFiltroMenu(""); setFiltroTemp(open ? { colunaId, valores: [...(filtrosColunas[colunaId] || [])] } : { colunaId: null, valores: [] }); }}>
        <PopoverTrigger asChild><Button variant="ghost" size="icon" className={`h-3 w-3 min-w-3 p-0 ${hasActiveFilter(colunaId) ? "text-emerald-600" : "text-slate-300 hover:text-slate-400"}`}><Filter className="w-2 h-2" /></Button></PopoverTrigger>
        <PopoverContent align="end" side="bottom" sideOffset={4} className="w-[310px] p-0 z-[9999]">
          <div className="p-1 space-y-0.5 border-b">
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { handleSort(colunaId); setMenuFiltroAberto(null); }}><ArrowDownAZ className="w-4 h-4 mr-2" /> Menor para Maior</button>
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { setSortConfig({ key: colunaId, direction: "desc" }); setMenuFiltroAberto(null); }}><ArrowUpZA className="w-4 h-4 mr-2" /> Maior para Menor</button>
            <button type="button" className={`flex items-center w-full px-2 h-8 text-xs rounded ${hasActiveFilter(colunaId) ? 'hover:bg-slate-100' : 'text-slate-300 cursor-not-allowed'}`} disabled={!hasActiveFilter(colunaId)} onClick={() => { setFiltrosColunas(p => ({ ...p, [colunaId]: [] })); setMenuFiltroAberto(null); }}><X className="w-4 h-4 mr-2" /> Limpar Filtro</button>
          </div>
          <div className="p-2 space-y-2">
            <Input value={buscaFiltroMenu} onChange={(e) => setBuscaFiltroMenu(e.target.value)} placeholder="PESQUISAR" className="h-8 text-xs uppercase" />
            <div className="border border-slate-300 rounded-sm max-h-64 overflow-y-auto p-1 bg-white">
              <label className="flex h-8 items-center gap-2 px-2 py-0 text-xs text-slate-700 border-b border-slate-200">
                <Checkbox checked={allSel} onCheckedChange={(checked) => setFiltroTemp(p => { const rest = p.valores.filter(v => !filtered.includes(v)); return { ...p, valores: checked ? [...new Set([...rest, ...filtered])] : rest }; })} className="h-3.5 w-3.5 shrink-0" />
                <span>(Selecionar Tudo)</span>
              </label>
              {filtered.map(opt => (
                <label key={opt} className="flex h-6 items-center gap-2 px-2 py-0 text-xs text-slate-700 hover:bg-slate-50">
                  <Checkbox checked={valoresSelecionados.includes(opt)} onCheckedChange={(checked) => setFiltroTemp(p => ({ ...p, valores: checked ? [...p.valores, opt] : p.valores.filter(i => i !== opt) }))} className="h-3.5 w-3.5 shrink-0" />
                  <span>{opt}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setMenuFiltroAberto(null)}>Cancelar</Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setFiltrosColunas(p => ({ ...p, [colunaId]: filtroTemp.valores })); setMenuFiltroAberto(null); }}>OK</Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  const renderCell = (item, id) => {
    if (id === "numero") return <span className="font-mono">{item.numero_marca || "-"}</span>;
    if (id === "nome") return <span className="uppercase">{item.nome || "-"}</span>;
    if (id === "descricao") return item.descricao || "-";
    if (id === "ativo") return item.ativo !== false ? <Badge className="text-[10px] bg-emerald-100 text-emerald-700">Ativo</Badge> : <Badge className="text-[10px] bg-slate-100 text-slate-500">Inativo</Badge>;
    return "-";
  };

  return (
    <>
      <div className="space-y-1 overflow-hidden">
        <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
          <div className="text-xs text-slate-500">{filtrados.length} de {marcas.length} registros</div>
          {selectedItems.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setBulkDeleteConfirm(true)} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">Limpar Seleção</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <Card className="overflow-hidden">
          <CardContent className="p-0 overflow-hidden">
            <div className="relative w-full overflow-auto max-h-[calc(100dvh-240px)] md:max-h-[calc(100dvh-150px)]" style={{ overscrollBehavior: 'none' }}>
              <Table className={`w-full ${isMobile ? "min-w-[500px]" : "min-w-[800px]"} border-separate border-spacing-0 table-fixed`}>
                <TableHeader className="bg-white">
                  <TableRow className="sticky top-0 z-40 bg-white">
                    {colunasOrdenadas.map(col => {
                      const w = columnWidths[col.id] || col.width || 160;
                      const isRes = resizeColumnId === col.id;
                      if (col.id === "selecao") return <TableHead key="selecao" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-center align-middle border-r border-b border-gray-200"><div className="flex items-center justify-center w-full h-full"><Checkbox checked={selectedItems.length === ordenados.length && ordenados.length > 0} onCheckedChange={toggleSelectAll} className="h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" /></div></TableHead>;
                      if (col.id === "acoes") return <TableHead key="acoes" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-center align-middle border-r border-b border-gray-200" />;
                      return (
                        <TableHead key={col.id} style={{ width: w, minWidth: w, maxWidth: w }} className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7">
                          <div className="inline-flex items-center justify-center gap-1 h-full w-full">{col.label}</div>
                          <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            {renderFilterControl(col.id)}
                            <button type="button" className={`h-4 w-4 flex items-center justify-center rounded ${isRes ? 'text-emerald-600 bg-emerald-100' : 'text-slate-300 hover:text-slate-500'}`} onClick={e => { e.stopPropagation(); setResizeColumnId(p => p === col.id ? null : col.id); }}><GripVertical className="w-2.5 h-2.5" /></button>
                          </div>
                          {isRes && <div className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-800" onMouseDown={e => startDragResize(e, col.id)} onTouchStart={e => startDragResize(e, col.id)} onClick={e => { e.stopPropagation(); setResizeColumnId(null); }}><GripVertical className="w-3.5 h-3.5 text-white" /></div>}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Carregando...</TableCell></TableRow>
                  : ordenados.length === 0 ? <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhuma marca encontrada</TableCell></TableRow>
                  : ordenados.map(item => (
                    <TableRow key={item.id} className="hover:bg-gray-100 border-b" onDoubleClick={() => onEdit(item)} onTouchEnd={(e) => handleRowTouch(item, e)}>
                      {colunasOrdenadas.map(col => {
                        const w = columnWidths[col.id] || col.width || 160;
                        if (col.id === "selecao") return <TableCell key={`${item.id}-s`} style={{ width: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={e => e.stopPropagation()}><div className="flex items-center justify-center"><Checkbox checked={selectedItems.includes(item.id)} onCheckedChange={c => setSelectedItems(p => c ? [...p, item.id] : p.filter(i => i !== item.id))} className="rounded-full h-4 w-4 border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" /></div></TableCell>;
                        if (col.id === "acoes") return <TableCell key={`${item.id}-a`} style={{ width: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={e => e.stopPropagation()}><div className="flex items-center justify-center"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onClick={() => onEdit(item)} className="text-xs">Editar</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setDeleteConfirm(item)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></TableCell>;
                        return <TableCell key={`${item.id}-${col.id}`} style={{ width: w }} className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 ${col.align === "center" ? "text-center" : ""}`}>{renderCell(item, col.id)}</TableCell>;
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
      <ConfiguracaoColunasMapaDialog open={showConfigColunas} onOpenChange={setShowConfigColunas} colunasDisponiveis={COLUNAS} colunasVisiveis={colunasVisiveis} colunasOrdem={colunasOrdem} toggleColuna={toggleColuna} handleDragEnd={handleDragEnd} droppableId="colunas-marcas" />
      <ConfirmDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)} title="Confirmar exclusão" description="Deseja excluir esta marca?" onConfirm={() => { onDelete(deleteConfirm.id); setDeleteConfirm(null); }} confirmText="Excluir" cancelText="Cancelar" variant="destructive" />
      <ConfirmDialog open={bulkDeleteConfirm} onOpenChange={() => setBulkDeleteConfirm(false)} title="Confirmar exclusão" description={`Deseja excluir ${selectedItems.length} marca(s)?`} onConfirm={() => { onDelete(selectedItems); setBulkDeleteConfirm(false); setSelectedItems([]); }} confirmText="Excluir" cancelText="Cancelar" variant="destructive" />
    </>
  );
}