import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { MoreVertical, Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical, Loader2 } from "lucide-react";
import { getLocalEstoque, getLabelOperacao } from "./utils/movimentacaoUtils";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true, width: 25 },
  { id: "acoes", label: "Ações", default: true, fixo: true, width: 25 },
  { id: "numero", label: "Nº", default: true, sortable: true, align: "left", width: 90 },
  { id: "data", label: "Data/Hora", default: true, sortable: true, align: "left", width: 150 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, align: "left", width: 120 },
  { id: "tipo_detalhado", label: "Tipo Detalhado", default: true, sortable: true, align: "left", width: 160 },
  { id: "produto", label: "Produto", default: true, sortable: true, align: "left", width: 180 },
  { id: "quantidade", label: "Quantidade", default: true, sortable: true, align: "right", width: 120 },
  { id: "unidade", label: "UN", default: true, sortable: true, align: "left", width: 90 },
  { id: "valor_unitario", label: "Vlr Unit.", default: true, sortable: true, align: "right", width: 120 },
  { id: "valor_total", label: "Vlr Total", default: true, sortable: true, align: "right", width: 130 },
  { id: "fornecedor", label: "Fornecedor/Cliente", default: true, sortable: true, align: "left", width: 180 },
  { id: "local_estoque", label: "Local Estoque", default: true, sortable: true, align: "left", width: 180 },
  { id: "status", label: "Status", default: true, sortable: true, align: "left", width: 110 },
  { id: "numero_documento", label: "Nº Documento", default: false, sortable: true, align: "left", width: 130 },
  { id: "cfop", label: "CFOP", default: false, sortable: true, align: "left", width: 100 },
  { id: "centro_custo", label: "Centro de Custo", default: false, sortable: true, align: "left", width: 160 },
  { id: "motivo", label: "Motivo", default: false, sortable: true, align: "left", width: 170 },
  { id: "observacoes", label: "Observações", default: false, sortable: true, align: "left", width: 220 },
  { id: "responsavel", label: "Responsável", default: false, sortable: true, align: "left", width: 160 },
  { id: "total_itens", label: "Itens", default: true, sortable: true, align: "center", width: 70 },
  { id: "parcela_seq", label: "Seq.", default: false, sortable: true, align: "center", width: 70 },
];

const DEFAULT_VISIBLE_COLUMNS = COLUNAS_DISPONIVEIS.filter((c) => c.default).map((c) => c.id);
const COLUMN_WIDTHS_KEY = "colunas_largura_movimentacoes_estoque";
const MIN_COLUMN_WIDTH = 80;

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

// Na visualização "principais", ocultar colunas de detalhe individual de produto
const COLUNAS_OCULTAS_PRINCIPAIS = ["produto", "quantidade", "unidade", "valor_unitario"];

export default function TabelaMovimentacoes({
  movimentacoes = [],
  onEdit,
  onCancel,
  isLoading,
  showConfigColunas,
  setShowConfigColunas,
  modoVisualizacao = "principais",
  allMovimentacoes = [],
}) {
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "data", direction: "desc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const [isCancelingBulk, setIsCancelingBulk] = useState(false);
  const [cancelProgress, setCancelProgress] = useState({ current: 0, total: 0 });
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const [columnWidths, setColumnWidths] = useState(() => {
    const defaults = Object.fromEntries(COLUNAS_DISPONIVEIS.map((c) => [c.id, c.width || 160]));
    const saved = localStorage.getItem(COLUMN_WIDTHS_KEY);
    if (!saved) return defaults;
    try {
      return { ...defaults, ...JSON.parse(saved) };
    } catch {
      return defaults;
    }
  });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const allIds = COLUNAS_DISPONIVEIS.map((c) => c.id);
    const saved = localStorage.getItem("colunas_ordem_movimentacoes");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Adicionar novas colunas que não existiam no saved
        const missing = allIds.filter(id => !parsed.includes(id));
        return [...parsed, ...missing];
      } catch {
        return allIds;
      }
    }
    return allIds;
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem("colunas_movimentacoes");
    if (saved) {
      try {
        return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE_COLUMNS]));
      } catch {
        return DEFAULT_VISIBLE_COLUMNS;
      }
    }
    return DEFAULT_VISIBLE_COLUMNS;
  });

  const lastTapRef = useRef({ id: null, time: 0 });
  const scrollContainerRef = useRef(null);
  const tableRef = useRef(null);
  const dragRef = useRef(null);
  const [resizeColumnId, setResizeColumnId] = useState(null);

  useEffect(() => {
    localStorage.setItem(COLUMN_WIDTHS_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    setSelectedItems((prev) => prev.filter((id) => movimentacoes.some((item) => item.id === id)));
  }, [movimentacoes]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      if (e.cancelable) e.preventDefault();
      const clientX = e.touches?.[0]?.clientX ?? e.clientX;
      const { columnId, startX, startWidth } = dragRef.current;
      setColumnWidths((prev) => ({
        ...prev,
        [columnId]: Math.max(MIN_COLUMN_WIDTH, startWidth + (clientX - startX)),
      }));
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

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem
      .map((id) => COLUNAS_DISPONIVEIS.find((c) => c.id === id))
      .filter((c) => c && colunasVisiveis.includes(c.id))
      .filter((c) => modoVisualizacao !== "principais" || !COLUNAS_OCULTAS_PRINCIPAIS.includes(c.id));
  }, [colunasOrdem, colunasVisiveis, modoVisualizacao]);

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem("colunas_movimentacoes", JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem("colunas_ordem_movimentacoes", JSON.stringify(items));
  };

  const toggleResizeMode = (colunaId) => {
    if (colunaId === "selecao" || colunaId === "acoes") return;
    setResizeColumnId((prev) => (prev === colunaId ? null : colunaId));
  };

  const startDragResize = (e, colunaId) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = e.touches?.[0]?.clientX ?? e.clientX;
    dragRef.current = { columnId: colunaId, startX: clientX, startWidth: columnWidths[colunaId] || 160 };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const getFieldValue = (item, colunaId) => {
    switch (colunaId) {
      case "numero":
        return String(item.numero_movimentacao || "");
      case "data":
        return formatarData(item.data_movimentacao);
      case "tipo":
        return item.tipo_movimentacao || "";
      case "tipo_detalhado":
        return getLabelOperacao(item.tipo_detalhado);
      case "produto":
        return item.produto_nome || "";
      case "quantidade":
        return formatarNumero(item.quantidade);
      case "unidade":
        return item.unidade_medida || "";
      case "valor_unitario":
        return formatarMoeda(item.valor_unitario);
      case "valor_total":
        return formatarMoeda(item.valor_total);
      case "fornecedor":
        return item.fornecedor_nome || item.cliente_nome || "";
      case "local_estoque":
        return getLocalEstoque(item) || "";
      case "status":
        return item.status || "";
      case "numero_documento":
        return item.numero_documento || "";
      case "cfop":
        return item.cfop || "";
      case "centro_custo":
        return item.centro_custo_nome || "";
      case "motivo":
        return item.motivo_movimentacao || "";
      case "observacoes":
        return item.observacoes || "";
      case "responsavel":
        return item.usuario_responsavel || "";
      case "total_itens":
        return String(item.total_movimentacoes_grupo || 1);
      case "parcela_seq":
        return item.numero_movimentacao_seq ? `${item.numero_movimentacao_seq}/${item.total_movimentacoes_grupo || 1}` : "1/1";
      default:
        return "";
    }
  };

  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).forEach((col) => {
      opts[col.id] = [...new Set(movimentacoes.map((item) => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
    });
    return opts;
  }, [movimentacoes]);

  const hasActiveFilter = (colunaId) => (filtrosColunas[colunaId] || []).length > 0;
  const getValoresFiltro = (colunaId) => filtrosColunas[colunaId] || [];
  const setValoresFiltro = (colunaId, values) => setFiltrosColunas((prev) => ({ ...prev, [colunaId]: values }));
  const clearColumnFilter = (colunaId) => setValoresFiltro(colunaId, []);

  const movimentacoesFiltradas = useMemo(() => {
    return movimentacoes.filter((item) => {
      return COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).every((col) => {
        const filtro = filtrosColunas[col.id] || [];
        if (filtro.length === 0) return true;
        const val = getFieldValue(item, col.id);
        return filtro.includes(val);
      });
    });
  }, [movimentacoes, filtrosColunas]);

  const movimentacoesOrdenadas = useMemo(() => {
    const sorted = [...movimentacoesFiltradas];
    sorted.sort((a, b) => {
      const numericColumns = ["numero", "quantidade", "valor_unitario", "valor_total"];
      if (numericColumns.includes(sortConfig.key)) {
        const aNum = sortConfig.key === "numero" ? Number(a.numero_movimentacao || 0) : Number(a[sortConfig.key] || 0);
        const bNum = sortConfig.key === "numero" ? Number(b.numero_movimentacao || 0) : Number(b[sortConfig.key] || 0);
        if (aNum < bNum) return sortConfig.direction === "asc" ? -1 : 1;
        if (aNum > bNum) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      }

      if (sortConfig.key === "data") {
        const aDate = new Date(a.data_movimentacao).getTime();
        const bDate = new Date(b.data_movimentacao).getTime();
        if (aDate < bDate) return sortConfig.direction === "asc" ? -1 : 1;
        if (aDate > bDate) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      }

      const aVal = getFieldValue(a, sortConfig.key).toLowerCase();
      const bVal = getFieldValue(b, sortConfig.key).toLowerCase();
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [movimentacoesFiltradas, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const toggleSelectAll = () => {
    const registrosAtivos = movimentacoesFiltradas.filter((item) => item.status === "Ativa");
    if (selectedItems.length === registrosAtivos.length && registrosAtivos.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(registrosAtivos.map((item) => item.id));
  };

  const handleRowTouch = (item, event) => {
    const now = Date.now();
    if (lastTapRef.current.id === item.id && now - lastTapRef.current.time < 300) {
      event.preventDefault();
      onEdit(item);
    }
    lastTapRef.current = { id: item.id, time: now };
  };

  const handleBulkCancel = async () => {
    if (!selectedItems.length) return;
    if (!window.confirm(`⚠️ ATENÇÃO: Você está prestes a cancelar ${selectedItems.length} movimentação(ões) selecionada(s). Esta ação não pode ser desfeita. Deseja continuar?`)) return;

    setIsCancelingBulk(true);
    setCancelProgress({ current: 0, total: selectedItems.length });

    let canceled = 0;
    for (const id of selectedItems) {
      try {
        await onCancel(id, true);
      } catch (e) {
        console.error('Erro ao cancelar:', e);
      }
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

  const renderCell = (item, colunaId) => {
    switch (colunaId) {
      case "numero":
        return item.numero_movimentacao || "-";
      case "data":
        return formatarData(item.data_movimentacao);
      case "tipo":
        return <Badge variant="outline" className={`${getBadgeTipo(item.tipo_movimentacao)} text-xs`}>{item.tipo_movimentacao}</Badge>;
      case "tipo_detalhado":
        return getLabelOperacao(item.tipo_detalhado);
      case "produto":
        return item.produto_nome || "-";
      case "quantidade":
        return formatarNumero(item.quantidade);
      case "unidade":
        return item.unidade_medida || "-";
      case "valor_unitario":
        return formatarMoeda(item.valor_unitario);
      case "valor_total":
        return formatarMoeda(item.valor_total);
      case "fornecedor":
        return item.fornecedor_nome || item.cliente_nome || "-";
      case "local_estoque":
        return getLocalEstoque(item) || "-";
      case "status":
        return <Badge variant="outline" className={`text-xs ${item.status === "Ativa" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-red-100 text-red-800 border-red-300"}`}>{item.status}</Badge>;
      case "numero_documento":
        return item.numero_documento || "-";
      case "cfop":
        return item.cfop || "-";
      case "centro_custo":
        return item.centro_custo_nome || "-";
      case "motivo":
        return item.motivo_movimentacao || "-";
      case "observacoes":
        return item.observacoes || "-";
      case "responsavel":
        return item.usuario_responsavel || "-";
      case "total_itens":
        return item.total_movimentacoes_grupo > 1 ? (
          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-300">{item.total_movimentacoes_grupo} itens</Badge>
        ) : "1";
      case "parcela_seq":
        return item.numero_movimentacao_seq ? `${item.numero_movimentacao_seq}/${item.total_movimentacoes_grupo || 1}` : "1/1";
      default:
        return "-";
    }
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
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { handleSort(colunaId); setMenuFiltroAberto(null); }}>
              <ArrowDownAZ className="w-4 h-4 mr-2" /> Classificar do Menor para o Maior
            </button>
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { setSortConfig({ key: colunaId, direction: "desc" }); setMenuFiltroAberto(null); }}>
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
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => { setMenuFiltroAberto(null); setBuscaFiltroMenu(""); setFiltroTemp({ colunaId: null, valores: [] }); }}>
                Cancelar
              </Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setValoresFiltro(colunaId, filtroTemp.valores); setMenuFiltroAberto(null); setBuscaFiltroMenu(""); setFiltroTemp({ colunaId: null, valores: [] }); }}>
                OK
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <>
      <div className="space-y-1 overflow-hidden">
        <div className="flex justify-between items-center px-1 gap-2 flex-wrap">
          <div className="text-xs text-slate-500">
            {movimentacoesFiltradas.length} de {movimentacoes.length} registros
          </div>
          <div className="flex gap-2 flex-wrap">
            {selectedItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selectedItems.length})</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleBulkCancel} className="text-xs text-red-600">Cancelar Selecionadas</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0 overflow-hidden">
            <div className="relative overflow-hidden">
              <div ref={scrollContainerRef} className="relative w-full overflow-auto max-h-[calc(100dvh-240px)] md:max-h-[calc(100dvh-150px)]" style={{ overscrollBehavior: "none", WebkitOverflowScrolling: "touch" }}>
                <Table ref={tableRef} className={`w-full ${isMobile ? "min-w-[980px]" : "min-w-[1200px]"} border-separate border-spacing-0 table-fixed`}>
                  <TableHeader className="bg-white">
                    <TableRow className="sticky top-0 z-40 bg-white">
                      {colunasOrdenadas.map((coluna) => {
                        const width = columnWidths[coluna.id] || coluna.width || 160;
                        const isResizing = resizeColumnId === coluna.id;

                        if (coluna.id === "selecao") {
                          return (
                            <TableHead key="selecao" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200">
                              <div className="flex items-center justify-center w-full h-full">
                                <Checkbox checked={selectedItems.length === movimentacoesFiltradas.filter((item) => item.status === "Ativa").length && movimentacoesFiltradas.filter((item) => item.status === "Ativa").length > 0} onCheckedChange={toggleSelectAll} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
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
                            <div className="inline-flex items-center justify-center gap-1 h-full w-full whitespace-nowrap overflow-hidden text-ellipsis">
                              {coluna.label}
                            </div>

                            {filterControl && (
                              <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                {filterControl}
                                <button
                                  type="button"
                                  className={`h-4 w-4 flex items-center justify-center rounded ${isResizing ? "text-emerald-600 bg-emerald-100" : "text-slate-300 hover:text-slate-500"}`}
                                  onClick={(e) => { e.stopPropagation(); toggleResizeMode(coluna.id); }}
                                  onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); toggleResizeMode(coluna.id); }}
                                  title="Redimensionar coluna"
                                >
                                  <GripVertical className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            )}

                            {isResizing && (
                              <div className="absolute top-0 -right-0 h-full w-5 z-50 flex items-center justify-center cursor-col-resize bg-lime-800"
                                onMouseDown={(e) => startDragResize(e, coluna.id)}
                                onTouchStart={(e) => startDragResize(e, coluna.id)}
                                onClick={(e) => { e.stopPropagation(); setResizeColumnId(null); }}
                                onDoubleClick={(e) => e.stopPropagation()}
                                onTouchEnd={(e) => e.stopPropagation()}
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
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Carregando movimentações...</TableCell>
                      </TableRow>
                    ) : movimentacoesOrdenadas.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colunasOrdenadas.length} className="text-center py-8 text-xs text-slate-400 border border-gray-300">Nenhuma movimentação encontrada</TableCell>
                      </TableRow>
                    ) : (
                      movimentacoesOrdenadas.map((item) => {
                        const bloqueadoDireto = item.bloqueado_exclusao_estoque || (item.exclusao_somente_em && item.exclusao_somente_em !== "estoque") || ["suplementacao", "transferencia_enviada", "transferencia_recebida"].includes(item.tipo_detalhado);
                        return (
                          <TableRow key={item.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100" onDoubleClick={() => onEdit(item)} onTouchEnd={(event) => handleRowTouch(item, event)}>
                            {colunasOrdenadas.map((coluna) => {
                              const width = columnWidths[coluna.id] || coluna.width || 160;

                              if (coluna.id === "selecao") {
                                return (
                                  <TableCell key={`${item.id}-selecao`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-muted-foreground font-medium text-center align-middle px-0 h-7 border-r border-b border-gray-300" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-center w-full h-full">
                                      <Checkbox checked={selectedItems.includes(item.id)} onCheckedChange={(checked) => setSelectedItems((prev) => checked ? [...prev, item.id] : prev.filter((id) => id !== item.id))} disabled={item.status !== "Ativa"} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                                    </div>
                                  </TableCell>
                                );
                              }

                              if (coluna.id === "acoes") {
                                return (
                                  <TableCell key={`${item.id}-acoes`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-muted-foreground font-medium text-center align-middle px-0 h-7 border-r border-b border-gray-300" onClick={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-center w-full h-full">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6">
                                            <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
                                          <DropdownMenuItem onClick={() => onEdit(item)} disabled={item.status === "Cancelada" || bloqueadoDireto} className="text-xs">Editar</DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem onClick={() => onCancel(item.id)} disabled={item.status === "Cancelada" || bloqueadoDireto} className="text-xs text-red-600">Cancelar</DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </TableCell>
                                );
                              }

                              const numericCols = ["quantidade", "valor_unitario", "valor_total"];
                              return (
                                <TableCell key={`${item.id}-${coluna.id}`} style={{ width, minWidth: width, maxWidth: width }} className={`px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words ${numericCols.includes(coluna.id) ? "text-right font-mono" : ""}`}>
                                  {renderCell(item, coluna.id)}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <ConfiguracaoColunasMapaDialog
        open={showConfigColunas}
        onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS}
        colunasVisiveis={colunasVisiveis}
        colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna}
        handleDragEnd={handleDragEnd}
        droppableId="colunas-movimentacoes-estoque"
      />

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