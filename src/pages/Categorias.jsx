import React, { useState, useEffect, useMemo, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Settings, MoreVertical, Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";

const getNextCategoryNumber = async () => {
  try {
    const all = await base44.entities.Categoria.list();
    const numeros = all.map(c => parseInt(c.numero_categoria) || 0).filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch { return 1; }
};

const COLUNAS_DISPONIVEIS = [
  { id: 'selecao', label: 'Seleção', default: true, fixo: true, width: 25 },
  { id: 'acoes', label: 'Ações', default: true, fixo: true, width: 25 },
  { id: 'numero', label: 'Nº', default: true, sortable: true, align: 'left', width: 60 },
  { id: 'nome', label: 'Nome', default: true, sortable: true, align: 'left', width: 220 },
  { id: 'subcategoria', label: 'Subcategoria', default: true, sortable: true, align: 'left', width: 180 },
  { id: 'descricao', label: 'Descrição', default: true, sortable: false, align: 'left', width: 250 },
];

const DEFAULT_VISIBLE = COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
const STORAGE_PREFIX = "colunas_categorias";
const WIDTHS_KEY = `${STORAGE_PREFIX}_largura`;
const MIN_COL_W = 60;

const FL = ({ label, required, error, children, dataField }) => (
  <div data-field={dataField}>
    <label className="text-[12px] text-slate-500 pl-1 leading-none">
      {label}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
    <div className={`rounded-md border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} focus-within:border-emerald-500 transition-colors`}>
      {children}
    </div>
  </div>
);

function getFieldValue(item, colId) {
  if (colId === "numero") return item.numero_categoria || "";
  if (colId === "nome") return item.nome || "";
  if (colId === "subcategoria") return item.subcategoria || "";
  if (colId === "descricao") return item.descricao || "";
  return "";
}

export default function Categorias() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState({ nome: "", subcategoria: "", descricao: "" });
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteState, setDeleteState] = useState({ open: false, ids: [] });
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "nome", direction: "asc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const [errors, setErrors] = useState({});
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

  const queryClient = useQueryClient();

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  useEffect(() => {
    const numerarExistentes = async () => {
      const semNumero = categorias.filter(c => !c.numero_categoria);
      if (semNumero.length > 0) {
        for (const cat of semNumero) {
          try {
            const num = await getNextCategoryNumber();
            await base44.entities.Categoria.update(cat.id, { numero_categoria: String(num) });
          } catch (error) { console.error(error); }
        }
        queryClient.invalidateQueries({ queryKey: ['categorias'] });
      }
    };
    if (categorias.length > 0) numerarExistentes();
  }, [categorias, queryClient]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const num = await getNextCategoryNumber();
      return base44.entities.Categoria.create({ ...data, numero_categoria: String(num) });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['categorias'] }); setShowForm(false); setEditing(null); toast.success('Categoria cadastrada!'); },
    onError: (err) => toast.error(err.message || 'Erro ao cadastrar.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Categoria.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['categorias'] }); setShowForm(false); setEditing(null); toast.success('Categoria atualizada!'); },
    onError: (err) => toast.error(err.message || 'Erro ao atualizar.'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ids) => {
      const todosProdutos = await base44.entities.Produto.list();
      for (const id of ids) {
        const cat = categorias.find(c => c.id === id);
        if (todosProdutos.some(p => p.categoria === cat?.nome)) throw new Error(`❌ Categoria "${cat?.nome}" possui produtos vinculados!`);
        await base44.entities.Categoria.delete(id);
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['categorias'] }); toast.success('Categoria(s) excluída(s)!'); setSelectedItems([]); },
    onError: (err) => toast.error(err.message || 'Erro ao excluir.'),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!formData.nome?.trim()) nextErrors.nome = true;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) { toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS."); return; }

    const data = { nome: formData.nome.toUpperCase(), subcategoria: formData.subcategoria?.toUpperCase() || undefined, descricao: formData.descricao?.toUpperCase() || undefined };
    if (editing) updateMutation.mutate({ id: editing.id, data });
    else createMutation.mutate(data);
  };

  const handleEdit = (item) => { setEditing(item); setFormData({ nome: item.nome || "", subcategoria: item.subcategoria || "", descricao: item.descricao || "" }); setShowForm(true); };
  const handleRequestDelete = (id) => { const ids = Array.isArray(id) ? id : [id]; setDeleteState({ open: true, ids }); };
  const handleConfirmDelete = () => { deleteMutation.mutate(deleteState.ids); setDeleteState({ open: false, ids: [] }); };

  const sortedData = useMemo(() => {
    let filtered = categorias.filter(c => {
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
  }, [categorias, filtrosColunas, sortConfig]);

  useEffect(() => { setSelectedItems(prev => prev.filter(id => categorias.some(c => c.id === id))); }, [categorias]);

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

  const colunasOrdenadas = useMemo(() => colunasOrdem.map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id)).filter(c => c && colunasVisiveis.includes(c.id)), [colunasOrdem, colunasVisiveis]);

  const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc" }));
  const toggleSelectAll = () => { if (selectedItems.length === sortedData.length && sortedData.length > 0) { setSelectedItems([]); return; } setSelectedItems(sortedData.map(r => r.id)); };

  const handleRowTouch = (item, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === item.id && now - lastTapRef.current.time < 300) { event.preventDefault(); handleEdit(item); }
    lastTapRef.current = { id: item.id, time: now };
  };

  const hasActiveFilter = (colunaId) => (filtrosColunas[colunaId] || []).length > 0;
  const getValoresFiltro = (colunaId) => filtrosColunas[colunaId] || [];
  const setValoresFiltro = (colunaId, values) => setFiltrosColunas(prev => ({ ...prev, [colunaId]: values }));
  const clearColumnFilter = (colunaId) => setValoresFiltro(colunaId, []);

  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter(c => !c.fixo).forEach(col => {
      opts[col.id] = [...new Set(categorias.map(item => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
    });
    return opts;
  }, [categorias]);

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
        <PopoverTrigger asChild><Button variant="ghost" size="icon" className={buttonClass}><Filter className="w-2 h-2" /></Button></PopoverTrigger>
        <PopoverContent align="end" side="bottom" sideOffset={4} className="w-[310px] p-0 z-[9999]">
          <div className="p-1 space-y-0.5 border-b">
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { handleSort(colunaId); setMenuFiltroAberto(null); }}><ArrowDownAZ className="w-4 h-4 mr-2" /> Classificar do Menor para o Maior</button>
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { setSortConfig({ key: colunaId, direction: "desc" }); setMenuFiltroAberto(null); }}><ArrowUpZA className="w-4 h-4 mr-2" /> Classificar do Maior para o Menor</button>
            <button type="button" className={`flex items-center w-full px-2 h-8 text-xs rounded ${hasActiveFilter(colunaId) ? 'hover:bg-slate-100 text-slate-700' : 'text-slate-300 cursor-not-allowed'}`} disabled={!hasActiveFilter(colunaId)} onClick={() => { clearColumnFilter(colunaId); setMenuFiltroAberto(null); }}><X className="w-4 h-4 mr-2" /> Limpar Filtro de "{columnLabel}"</button>
          </div>
          <div className="p-2 space-y-2">
            <Input value={buscaFiltroMenu} onChange={(e) => setBuscaFiltroMenu(e.target.value)} placeholder="PESQUISAR" className="h-8 text-xs uppercase" />
            <div className="border border-slate-300 rounded-sm max-h-64 overflow-y-auto p-1 bg-white">
              <label className="flex h-8 items-center gap-2 px-2 py-0 text-xs text-slate-700 border-b border-slate-200 whitespace-nowrap overflow-hidden">
                <Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => { setFiltroTemp(prev => { const rest = prev.valores.filter(v => !filteredOptions.includes(v)); return { ...prev, valores: checked ? [...new Set([...rest, ...filteredOptions])] : rest }; }); }} className="h-3.5 w-3.5 shrink-0" />
                <span className="block flex-1 overflow-hidden text-ellipsis whitespace-nowrap">(Selecionar Tudo)</span>
              </label>
              {filteredOptions.map(option => (
                <label key={option} className="flex h-6 items-center gap-2 px-2 py-0 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap overflow-hidden">
                  <Checkbox checked={valoresSelecionados.includes(option)} onCheckedChange={(checked) => { setFiltroTemp(prev => ({ ...prev, valores: checked ? [...prev.valores, option] : prev.valores.filter(i => i !== option) })); }} className="h-3.5 w-3.5 shrink-0" />
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

  const renderCell = (item, colId) => {
    if (colId === "numero") return item.numero_categoria || "-";
    if (colId === "nome") return <span className="uppercase font-medium">{item.nome || "-"}</span>;
    if (colId === "subcategoria") return item.subcategoria || "-";
    if (colId === "descricao") return item.descricao || "-";
    return "-";
  };

  return (
    <div className="p-1 md:p-1 space-y-1">
      {!showForm && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
          <div><h1 className="font-bold text-slate-800">Categorias</h1></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7"><Settings className="w-4 h-4" /></Button>
            <Button onClick={() => { setShowForm(true); setEditing(null); setFormData({ nome: "", subcategoria: "", descricao: "" }); setErrors({}); }} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Adicionar</Button>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {showForm ? (
          <motion.div key="form" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm border-slate-300">
              <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
                <CardTitle className="text-sm font-semibold text-slate-700">{editing ? 'Editar Categoria' : 'Nova Categoria'}</CardTitle>
              </CardHeader>
              <CardContent className="p-1">
                <form onSubmit={handleSubmit} className="space-y-0.5">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-1">
                    <FL label="Nome" required error={errors.nome} dataField="nome">
                      <Input value={formData.nome} onChange={(e) => { setErrors(p => ({ ...p, nome: false })); setFormData(p => ({ ...p, nome: e.target.value })); }} placeholder="NOME DA CATEGORIA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
                    </FL>
                    <FL label="Subcategoria" dataField="subcategoria">
                      <Input value={formData.subcategoria} onChange={(e) => setFormData(p => ({ ...p, subcategoria: e.target.value }))} placeholder="SUBCATEGORIA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
                    </FL>
                    <FL label="Descrição" dataField="descricao">
                      <Input value={formData.descricao} onChange={(e) => setFormData(p => ({ ...p, descricao: e.target.value }))} placeholder="DESCRIÇÃO" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
                    </FL>
                  </div>
                  <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }} size="sm" className="h-7 text-xs px-3">Cancelar</Button>
                    <Button type="submit" size="sm" className="h-7 text-xs px-3 bg-emerald-600 hover:bg-emerald-700 text-white">{editing ? 'Atualizar' : 'Salvar'}</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <div key="table" className="space-y-1 overflow-hidden">
            <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
              <div className="text-xs text-slate-500">{sortedData.length} de {categorias.length} registros</div>
              <div className="flex gap-2 flex-wrap">
                {selectedItems.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button></DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleRequestDelete(selectedItems)} className="text-xs text-red-600">Excluir Selecionados</DropdownMenuItem>
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
                    <Table ref={tableRef} className={`w-full ${isMobile ? "min-w-[500px]" : "min-w-[700px]"} border-separate border-spacing-0 table-fixed`}>
                      <TableHeader className="bg-white">
                        <TableRow className="sticky top-0 z-40 bg-white">
                          {colunasOrdenadas.map(coluna => {
                            const width = columnWidths[coluna.id] || coluna.width || 160;
                            const isResizing = resizeColumnId === coluna.id;
                            if (coluna.id === "selecao") return (
                              <TableHead key="selecao" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200">
                                <div className="flex items-center justify-center w-full h-full"><Checkbox checked={selectedItems.length === sortedData.length && sortedData.length > 0} onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" /></div>
                              </TableHead>
                            );
                            if (coluna.id === "acoes") return <TableHead key="acoes" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200" />;
                            const filterControl = renderFilterControl(coluna.id);
                            return (
                              <TableHead key={coluna.id} style={{ width, minWidth: width, maxWidth: width }} className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7">
                                <div className="inline-flex items-center justify-center gap-1 h-full w-full whitespace-nowrap overflow-hidden text-ellipsis">{coluna.label}</div>
                                {filterControl && (
                                  <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                    {filterControl}
                                    <button type="button" className={`h-4 w-4 flex items-center justify-center rounded ${isResizing ? 'text-emerald-600 bg-emerald-100' : 'text-slate-300 hover:text-slate-500'}`} onClick={e => { e.stopPropagation(); toggleResizeMode(coluna.id); }} onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); toggleResizeMode(coluna.id); }} title="Redimensionar coluna"><GripVertical className="w-2.5 h-2.5" /></button>
                                  </div>
                                )}
                                {isResizing && (
                                  <div className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-800" onMouseDown={e => startDragResize(e, coluna.id)} onTouchStart={e => startDragResize(e, coluna.id)} onClick={e => { e.stopPropagation(); setResizeColumnId(null); }}><GripVertical className="w-3.5 h-3.5 text-white" /></div>
                                )}
                              </TableHead>
                            );
                          })}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedData.length === 0 ? (
                          <TableRow><TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhuma categoria encontrada</TableCell></TableRow>
                        ) : sortedData.map(item => (
                          <TableRow key={item.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100" onDoubleClick={() => handleEdit(item)} onTouchEnd={(event) => handleRowTouch(item, event)}>
                            {colunasOrdenadas.map(coluna => {
                              const width = columnWidths[coluna.id] || coluna.width || 160;
                              if (coluna.id === "selecao") return (
                                <TableCell key={`${item.id}-sel`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
                                  <div className="flex items-center justify-center w-full h-full"><Checkbox checked={selectedItems.includes(item.id)} onCheckedChange={(checked) => setSelectedItems(prev => checked ? [...prev, item.id] : prev.filter(id => id !== item.id))} className="rounded-full h-4 w-4 border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" /></div>
                                </TableCell>
                              );
                              if (coluna.id === "acoes") return (
                                <TableCell key={`${item.id}-act`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-center align-middle h-7 border-r border-b border-gray-300" onClick={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>
                                  <div className="flex items-center justify-center w-full h-full">
                                    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button></DropdownMenuTrigger>
                                      <DropdownMenuContent align="start"><DropdownMenuItem onClick={() => handleEdit(item)} className="text-xs">Editar</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => handleRequestDelete(item.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem></DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </TableCell>
                              );
                              const align = coluna.align === "right" ? "text-right" : coluna.align === "center" ? "text-center" : "text-left";
                              return (
                                <TableCell key={`${item.id}-${coluna.id}`} style={{ width, minWidth: width, maxWidth: width }} className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words ${align}`}>
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
          </div>
        )}
      </AnimatePresence>

      <ConfiguracaoColunasMapaDialog open={showConfigColunas} onOpenChange={setShowConfigColunas} colunasDisponiveis={COLUNAS_DISPONIVEIS} colunasVisiveis={colunasVisiveis} colunasOrdem={colunasOrdem} toggleColuna={toggleColuna} handleDragEnd={handleDragEnd} droppableId="colunas-categorias" />
      <ConfirmDialog open={deleteState.open} onOpenChange={(open) => setDeleteState(prev => ({ ...prev, open }))} title="Confirmar exclusão" description={deleteState.ids.length > 1 ? `Deseja excluir ${deleteState.ids.length} categorias selecionadas?` : "Deseja excluir esta categoria?"} confirmText="Excluir" cancelText="Cancelar" variant="destructive" onConfirm={handleConfirmDelete} />
    </div>
  );
}