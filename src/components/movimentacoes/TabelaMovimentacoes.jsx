import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { Filter, X, ArrowDownAZ, ArrowUpZA, GripVertical, MoreVertical } from "lucide-react";
import { getLocalEstoque, getLabelOperacao } from "./utils/movimentacaoUtils";
import { compareByCreation, compareDisplayNumbers, formatDatePtBr, getMovementDisplayNumber, getMovementGroupNumber, getMovementSortValue } from "./utils/movimentacaoDisplayUtils";

const COLUNAS_DISPONIVEIS = [
  { id: "selecao", label: "Seleção", default: true, fixo: true, width: 25 },
  { id: "acoes", label: "Ações", default: true, fixo: true, width: 25 },
  { id: "numero", label: "Nº", default: true, sortable: true, align: "left", width: 90 },
  { id: "data", label: "Data", default: true, sortable: true, align: "left", width: 110 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, align: "left", width: 110 },
  { id: "tipo_detalhado", label: "Operação", default: true, sortable: true, align: "left", width: 150 },
  { id: "produto", label: "Produto", default: true, sortable: true, align: "left", width: 180 },
  { id: "quantidade", label: "Quantidade", default: true, sortable: true, align: "right", width: 120 },
  { id: "unidade", label: "UN", default: true, sortable: true, align: "left", width: 80 },
  { id: "valor_unitario", label: "Vlr Unit.", default: true, sortable: true, align: "right", width: 120 },
  { id: "valor_total", label: "Vlr Total", default: true, sortable: true, align: "right", width: 130 },
  { id: "cliente_fornecedor", label: "Cliente/Fornecedor", default: true, sortable: true, align: "left", width: 220 },
  { id: "local_origem", label: "Local Origem", default: true, sortable: true, align: "left", width: 170 },
  { id: "local_destino", label: "Local Destino", default: true, sortable: true, align: "left", width: 170 },
  { id: "local_estoque", label: "Resumo Local", default: false, sortable: true, align: "left", width: 190 },
  { id: "numero_documento", label: "Nº Documento", default: true, sortable: true, align: "left", width: 130 },
  { id: "tipo_documento", label: "Tipo Documento", default: true, sortable: true, align: "left", width: 150 },
  { id: "motivo", label: "Motivo", default: true, sortable: true, align: "left", width: 170 },
  { id: "lotes", label: "Lotes/Notas", default: true, sortable: false, align: "left", width: 180 },
  { id: "centro_custo", label: "Centro de Custo", default: false, sortable: true, align: "left", width: 160 },
  { id: "observacoes", label: "Observações", default: false, sortable: true, align: "left", width: 220 },
  { id: "responsavel", label: "Responsável", default: false, sortable: true, align: "left", width: 160 },
  { id: "status", label: "Status", default: true, sortable: true, align: "left", width: 110 },
  { id: "total_itens", label: "Itens", default: true, sortable: true, align: "center", width: 70 },
  { id: "parcela_seq", label: "Seq.", default: false, sortable: true, align: "center", width: 70 },
];

const DEFAULT_VISIBLE_COLUMNS_PRINCIPAIS = ["selecao", "acoes", "numero", "data", "tipo", "tipo_detalhado", "cliente_fornecedor", "local_origem", "local_destino", "numero_documento", "tipo_documento", "motivo", "status", "total_itens"];
const DEFAULT_VISIBLE_COLUMNS_MOVIMENTACOES = ["selecao", "numero", "data", "tipo", "tipo_detalhado", "produto", "quantidade", "unidade", "valor_unitario", "valor_total", "cliente_fornecedor", "local_origem", "local_destino", "numero_documento", "tipo_documento", "motivo", "lotes", "status"];
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


// Na visualização "principais", ocultar colunas de detalhe individual de produto
const COLUNAS_OCULTAS_PRINCIPAIS = ["produto", "quantidade", "unidade", "valor_unitario", "parcela_seq"];

export default function TabelaMovimentacoes({
  movimentacoes = [],
  onEdit,
  onDelete,
  onExportSelected,
  isLoading,
  showConfigColunas,
  setShowConfigColunas,
  modoVisualizacao = "principais",
  allMovimentacoes = [],
}) {
  const [selectedItems, setSelectedItems] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: "numero", direction: "asc" });
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });
  const [filtrosColunas, setFiltrosColunas] = useState({});
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
    const storageKey = modoVisualizacao === "principais" ? "colunas_movimentacoes_principais" : "colunas_movimentacoes_itens";
    const defaults = modoVisualizacao === "principais" ? DEFAULT_VISIBLE_COLUMNS_PRINCIPAIS : DEFAULT_VISIBLE_COLUMNS_MOVIMENTACOES;
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const parsed = JSON.parse(saved).filter((id) => id !== "fornecedor" && id !== "cliente");
        return Array.from(new Set([...parsed, ...defaults]));
      } catch {
        return defaults;
      }
    }
    return defaults;
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
      .filter((c) => modoVisualizacao === "principais" || c.id !== "acoes")
      .filter((c) => modoVisualizacao !== "principais" || !COLUNAS_OCULTAS_PRINCIPAIS.includes(c.id));
  }, [colunasOrdem, colunasVisiveis, modoVisualizacao]);

  const toggleColuna = (colunaId) => {
    const novasBase = colunasVisiveis.includes(colunaId)
      ? colunasVisiveis.filter((id) => id !== colunaId)
      : [...colunasVisiveis, colunaId];
    const novas = novasBase.filter((id) => id !== "fornecedor" && id !== "cliente");
    setColunasVisiveis(novas);
    const storageKey = modoVisualizacao === "principais" ? "colunas_movimentacoes_principais" : "colunas_movimentacoes_itens";
    localStorage.setItem(storageKey, JSON.stringify(novas));
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
    if (colunaId === "selecao" || (modoVisualizacao !== "principais" && colunaId === "acoes")) return;
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

  const getGrupoItens = (item) => {
    if (item.movimentacao_grupo_id) {
      return allMovimentacoes.filter((mov) => mov.movimentacao_grupo_id === item.movimentacao_grupo_id);
    }
    return [item];
  };

  const getNumeroExibicao = (item) => getMovementDisplayNumber(item, modoVisualizacao);

  const getFieldValue = (item, colunaId) => {
    const itensGrupo = modoVisualizacao === "principais" ? getGrupoItens(item) : [item];
    switch (colunaId) {
      case "numero":
        return modoVisualizacao === "movimentacoes"
          ? getMovementDisplayNumber(item, modoVisualizacao)
          : getMovementGroupNumber(item);
      case "data":
        return formatDatePtBr(item.data_movimentacao);
      case "tipo":
        return item.tipo_movimentacao || "";
      case "tipo_detalhado":
        return getLabelOperacao(item.tipo_detalhado);
      case "produto":
        return item.produto_nome || "";
      case "quantidade":
        return modoVisualizacao === "principais"
          ? formatarNumero(itensGrupo.reduce((sum, mov) => sum + (Number(mov.quantidade) || 0), 0))
          : formatarNumero(item.quantidade);
      case "unidade":
        return item.unidade_medida || "";
      case "valor_unitario":
        return formatarMoeda(item.valor_unitario);
      case "valor_total":
        return modoVisualizacao === "principais"
          ? formatarMoeda(itensGrupo.reduce((sum, mov) => sum + (Number(mov.valor_total) || 0), 0))
          : formatarMoeda(item.valor_total);
      case "cliente_fornecedor":
        return item.fornecedor_nome || item.cliente_nome || "";
      case "local_origem":
        return item.local_origem || "";
      case "local_destino":
        return item.local_destino || "";
      case "local_estoque":
        return getLocalEstoque(item) || "";
      case "status":
        return item.status || "";
      case "numero_documento":
        return item.numero_documento || "";
      case "tipo_documento":
        return item.tipo_documento || "";
      case "centro_custo":
        return item.centro_custo_nome || "";
      case "motivo":
        return item.motivo_movimentacao || "";
      case "lotes":
        return item.lotes_consumidos?.length ? `${item.lotes_consumidos.length} lote(s)` : "";
      case "observacoes":
        return item.observacoes || "";
      case "responsavel":
        return item.usuario_responsavel || "";
      case "total_itens":
        return String(getGrupoItens(item).length || 1);
      case "parcela_seq":
        return item.numero_movimentacao_seq && (item.total_movimentacoes_grupo || 1) > 1 ? `${item.numero_movimentacao_seq}/${item.total_movimentacoes_grupo || 1}` : "1x";
      default:
        return "";
    }
  };

  const sortedMovimentacoesForFilters = useMemo(() => {
    return [...movimentacoes].sort((a, b) => {
      const result = compareDisplayNumbers(a, b, modoVisualizacao);
      if (result !== 0) return result;
      return compareByCreation(a, b) * -1;
    });
  }, [movimentacoes, modoVisualizacao]);

  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter((c) => !c.fixo).forEach((col) => {
      opts[col.id] = [...new Set(sortedMovimentacoesForFilters.map((item) => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) => {
        if (col.id === "numero") {
          const [aGroup, aSeq = "0"] = String(a).split("-");
          const [bGroup, bSeq = "0"] = String(b).split("-");
          const groupDiff = (Number(aGroup) || 0) - (Number(bGroup) || 0);
          if (groupDiff !== 0) return groupDiff;
          return (Number(aSeq) || 0) - (Number(bSeq) || 0);
        }
        return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
      });
    });
    return opts;
  }, [sortedMovimentacoesForFilters, modoVisualizacao]);

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
      if (sortConfig.key === "created") {
        const result = compareByCreation(a, b);
        return sortConfig.direction === "asc" ? result * -1 : result;
      }

      if (sortConfig.key === "numero") {
        const result = compareDisplayNumbers(a, b, modoVisualizacao);
        if (result !== 0) return sortConfig.direction === "asc" ? result : result * -1;
        return compareByCreation(a, b);
      }

      const numericColumns = ["quantidade", "valor_unitario", "valor_total"];
      if (numericColumns.includes(sortConfig.key)) {
        const aNum = Number(a[sortConfig.key] || 0);
        const bNum = Number(b[sortConfig.key] || 0);
        if (aNum < bNum) return sortConfig.direction === "asc" ? -1 : 1;
        if (aNum > bNum) return sortConfig.direction === "asc" ? 1 : -1;
        return compareByCreation(a, b);
      }

      if (sortConfig.key === "data") {
        const aDate = getMovementSortValue(a, "data");
        const bDate = getMovementSortValue(b, "data");
        if (aDate < bDate) return sortConfig.direction === "asc" ? -1 : 1;
        if (aDate > bDate) return sortConfig.direction === "asc" ? 1 : -1;
        return compareByCreation(a, b);
      }

      const aVal = getFieldValue(a, sortConfig.key).toLowerCase();
      const bVal = getFieldValue(b, sortConfig.key).toLowerCase();
      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
      return compareByCreation(a, b);
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
    const registrosSelecionaveis = movimentacoesFiltradas.filter((item) => item.status === "Ativa");
    if (selectedItems.length === registrosSelecionaveis.length && registrosSelecionaveis.length > 0) {
      setSelectedItems([]);
      return;
    }
    setSelectedItems(registrosSelecionaveis.map((item) => item.id));
  };

  const handleRowTouch = (item, event) => {
    const now = Date.now();
    if (modoVisualizacao === "principais" && lastTapRef.current.id === item.id && now - lastTapRef.current.time < 300) {
      event.preventDefault();
      onEdit(item);
    }
    lastTapRef.current = { id: item.id, time: now };
  };


  const renderCell = (item, colunaId) => {
    switch (colunaId) {
      case "numero":
        return getNumeroExibicao(item);
      case "data":
        return formatDatePtBr(item.data_movimentacao);
      case "tipo":
        return item.tipo_movimentacao || "-";
      case "tipo_detalhado":
        return getLabelOperacao(item.tipo_detalhado);
      case "produto": {
        if (modoVisualizacao === "principais") {
          const itensGrupo = getGrupoItens(item);
          const totalItens = itensGrupo.length;
          return <span className="text-slate-700 font-medium">{totalItens > 1 ? `${totalItens} produtos` : '1 produto'}</span>;
        }
        return item.produto_nome || "-";
      }
      case "quantidade": {
        if (modoVisualizacao === "principais") {
          const totalQuantidade = getGrupoItens(item).reduce((sum, mov) => sum + (Number(mov.quantidade) || 0), 0);
          return formatarNumero(totalQuantidade);
        }
        return formatarNumero(item.quantidade);
      }
      case "unidade":
        return item.unidade_medida || "-";
      case "valor_unitario":
        return formatarMoeda(item.valor_unitario);
      case "valor_total": {
        if (modoVisualizacao === "principais") {
          const totalValor = getGrupoItens(item).reduce((sum, mov) => sum + (Number(mov.valor_total) || 0), 0);
          return formatarMoeda(totalValor);
        }
        return formatarMoeda(item.valor_total);
      }
      case "cliente_fornecedor":
        return item.fornecedor_nome || item.cliente_nome || "-";
      case "local_origem":
        return item.local_origem || "-";
      case "local_destino":
        return item.local_destino || "-";
      case "local_estoque":
        return getLocalEstoque(item) || "-";
      case "status":
        return item.status || "-";
      case "numero_documento":
        return item.numero_documento || "-";
      case "tipo_documento":
        return item.tipo_documento || "-";
      case "centro_custo":
        return item.centro_custo_nome || "-";
      case "motivo":
        return item.motivo_movimentacao || "-";
      case "lotes":
        return item.lotes_consumidos?.length ? item.lotes_consumidos.map(l => l.numero_documento || 'S/N').join(', ') : "-";
      case "observacoes":
        return item.observacoes || "-";
      case "responsavel":
        return item.usuario_responsavel || "-";
      case "total_itens": {
        const totalItens = getGrupoItens(item).length || 1;
        return `${totalItens} ${totalItens > 1 ? 'itens' : 'item'}`;
      }
      case "parcela_seq":
        return item.numero_movimentacao_seq && (item.total_movimentacoes_grupo || 1) > 1 ? `${item.numero_movimentacao_seq}/${item.total_movimentacoes_grupo || 1}` : "1x";
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
                  <DropdownMenuItem onClick={() => onExportSelected?.(selectedItems)} className="text-xs">Exportar Selecionados</DropdownMenuItem>
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
                        return (
                          <TableRow key={item.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100" onDoubleClick={() => modoVisualizacao === "principais" && onEdit(item)} onTouchEnd={(event) => handleRowTouch(item, event)}>
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
                                  <TableCell key={`${item.id}-acoes`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-muted-foreground font-medium text-center align-middle px-0 h-7 border-r border-b border-gray-300">
                                    <div className="flex items-center justify-center w-full h-full">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6">
                                            <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
                                          <DropdownMenuItem onClick={() => onEdit?.(item)} className="text-xs">Editar</DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem onClick={() => onDelete?.(item.id)} className="text-xs text-red-600">Excluir</DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </TableCell>
                                );
                              }

                              const numericCols = ["quantidade", "valor_unitario", "valor_total"];
                              return (
                                <TableCell key={`${item.id}-${coluna.id}`} style={{ width, minWidth: width, maxWidth: width }} className={`px-2 py-1 text-gray-700 text-xs align-middle text-left border-r border-b border-gray-300 whitespace-normal break-words uppercase ${numericCols.includes(coluna.id) ? "font-mono" : ""}`}>
                                  {coluna.id === "numero" ? getNumeroExibicao(item) : renderCell(item, coluna.id)}
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

    </>
  );
}