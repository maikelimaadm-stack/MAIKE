import React, { useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ConfiguracaoColunasMapaDialog from "@/components/mapa/ConfiguracaoColunasMapaDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Edit, Trash2, Eye, ArrowUpDown, ArrowUp, ArrowDown, XCircle, CheckCircle, GripVertical, Download, MoreVertical, Calendar, Edit2, Layers, X, Package, Filter, ArrowDownAZ, ArrowUpZA } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0";
  const num = typeof numero === 'number' ? numero : parseFloat(String(numero).replace(/\./g, '').replace(',', '.'));
  if (isNaN(num)) return "0";
  return num.toLocaleString('pt-BR');
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString + 'T00:00:00');
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
  } catch { return '-'; }
};

const calcularDias = (dataVencimento) => {
  if (!dataVencimento) return '-';
  try {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const venc = new Date(dataVencimento + 'T00:00:00');
    if (isNaN(venc.getTime())) return '-';
    venc.setHours(0, 0, 0, 0);
    const diff = Math.floor((venc - hoje) / (1000 * 60 * 60 * 24));
    if (diff > 0) return `${diff}d`;
    if (diff < 0) return `${Math.abs(diff)}d vencido`;
    return 'Hoje';
  } catch { return '-'; }
};

const getBadgeStyle = (status) => {
  const styles = {
    'Pendente': 'bg-slate-100 text-slate-700',
    'Pago Parcial': 'bg-slate-100 text-slate-700',
    'Pago': 'bg-slate-100 text-slate-700',
    'Vencido': 'bg-slate-100 text-slate-700',
    'Cancelado': 'bg-slate-100 text-slate-500',
  };
  return styles[status] || 'bg-slate-100 text-slate-700';
};

const COLUNAS_DISPONIVEIS = [
  { id: 'selecao', label: 'Seleção', default: true, fixo: true, width: 25 },
  { id: 'acoes', label: 'Ações', default: true, fixo: true, width: 25 },
  { id: 'numero', label: 'Nº', default: true, sortable: true, width: 70 },
  { id: 'parcela', label: 'Parcela', default: false, width: 80 },
  { id: 'emissao', label: 'Emissão', default: true, sortable: true, width: 100 },
  { id: 'vencimento', label: 'Vencimento', default: true, sortable: true, width: 100 },
  { id: 'dias', label: 'Dias', default: true, width: 80 },
  { id: 'fornecedor_cliente', label: 'Fornecedor/Cliente', default: true, sortable: true, width: 200 },
  { id: 'tipo_documento', label: 'Tipo Doc', default: true, sortable: true, width: 100 },
  { id: 'documento', label: 'Nº Doc', default: true, width: 100 },
  { id: 'chave_nfe', label: 'Chave NF-e', default: false, width: 140 },
  { id: 'serie', label: 'Série', default: false, width: 70 },
  { id: 'cfop', label: 'CFOP', default: false, width: 80 },
  { id: 'valor_total', label: 'Vlr. Total', default: true, sortable: true, align: 'right', width: 120 },
  { id: 'valor_pago', label: 'Vlr. Pago', default: true, align: 'right', width: 120 },
  { id: 'saldo', label: 'Vlr. Saldo', default: true, sortable: true, align: 'right', width: 120 },
  { id: 'status', label: 'Status', default: true, sortable: true, width: 120 },
  { id: 'safra', label: 'Safra', default: false, sortable: true, width: 100 },
  { id: 'centro_custo', label: 'Centro Custo', default: false, sortable: true, width: 140 },
  { id: 'plano_contas', label: 'Plano Contas', default: false, width: 160 },
  { id: 'grupo', label: 'Grupo', default: false, sortable: true, width: 120 },
  { id: 'forma_pagamento', label: 'Forma Pgto', default: false, sortable: true, width: 120 },
  { id: 'valor_produtos', label: 'Vlr. Produtos', default: false, align: 'right', width: 120 },
  { id: 'valor_frete', label: 'Vlr. Frete', default: false, align: 'right', width: 100 },
  { id: 'valor_seguro', label: 'Vlr. Seguro', default: false, align: 'right', width: 100 },
  { id: 'outras_despesas', label: 'Outras Desp.', default: false, align: 'right', width: 110 },
  { id: 'valor_desconto', label: 'Vlr. Desc.', default: false, align: 'right', width: 100 },
  { id: 'valor_ipi', label: 'IPI', default: false, align: 'right', width: 100 },
  { id: 'valor_icms', label: 'ICMS', default: false, align: 'right', width: 100 },
  { id: 'valor_pis', label: 'PIS', default: false, align: 'right', width: 100 },
  { id: 'valor_cofins', label: 'COFINS', default: false, align: 'right', width: 100 },
  { id: 'base_icms', label: 'Base ICMS', default: false, align: 'right', width: 100 },
];

const DEFAULT_VISIBLE_COLUMNS = COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
const COLUMN_WIDTHS_KEY = "colunas_largura_financeiro";
const MIN_COLUMN_WIDTH = 80;

// Extract field value for filtering
const getFieldValue = (lancamento, colunaId) => {
  switch (colunaId) {
    case 'numero': return lancamento.numero_lancamento || '';
    case 'parcela': return (lancamento.numero_parcela && lancamento.total_parcelas) ? `${lancamento.numero_parcela}/${lancamento.total_parcelas}` : '';
    case 'emissao': return formatarData(lancamento.data_emissao);
    case 'vencimento': return formatarData(lancamento.data_vencimento);
    case 'dias': return '';
    case 'fornecedor_cliente': return lancamento.fornecedor_nome || lancamento.cliente_nome || '';
    case 'tipo_documento': return lancamento.tipo_documento || '';
    case 'documento': return lancamento.numero_documento || '';
    case 'chave_nfe': return lancamento.chave_nfe || '';
    case 'serie': return lancamento.serie_documento || '';
    case 'cfop': return lancamento.cfop || '';
    case 'valor_total': return lancamento.valor_total != null ? String(lancamento.valor_total) : '';
    case 'valor_pago': return lancamento.valor_pago != null ? String(lancamento.valor_pago) : '';
    case 'saldo': { const s = (lancamento.valor_total || 0) - (lancamento.valor_pago || 0); return String(s); }
    case 'status': return lancamento.status || '';
    case 'safra': return lancamento.safra_nome || '';
    case 'centro_custo': return lancamento.centro_custo_nome || '';
    case 'plano_contas': return lancamento.plano_contas_nome || '';
    case 'grupo': return lancamento.grupo_nome || '';
    case 'forma_pagamento': return lancamento.forma_pagamento_nome || '';
    default: return '';
  }
};

export default function TabelaFinanceiro({ lancamentos, tipo, onEdit, onDelete, onBaixa, onCancelarBaixa, isLoading, fornecedores, produtos, safras, centrosCusto, planosContas, gruposFinanceiros, onUpdateLote, showConfigColunas, setShowConfigColunas }) {
  const [sortField, setSortField] = useState("vencimento");
  const [sortDirection, setSortDirection] = useState("asc");
  const [detalhesAberto, setDetalhesAberto] = useState(null);
  const [produtosDialog, setProdutosDialog] = useState(null);
  // showConfigColunas is now controlled by parent via props (same pattern as TabelaCategoriasManejo)
  const [selecionados, setSelecionados] = useState([]);
  const [parcelasDialog, setParcelasDialog] = useState(null);
  const [showEditarLote, setShowEditarLote] = useState(false);
  const [edicaoLote, setEdicaoLote] = useState({ safra_id: "", centro_custo_id: "", plano_contas_id: "", grupo_id: "", observacoes: "" });

  // Per-column filters
  const [filtrosColunas, setFiltrosColunas] = useState({});
  const [menuFiltroAberto, setMenuFiltroAberto] = useState(null);
  const [buscaFiltroMenu, setBuscaFiltroMenu] = useState("");
  const [filtroTemp, setFiltroTemp] = useState({ colunaId: null, valores: [] });

  // Resize state
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const scrollContainerRef = useRef(null);
  const tableRef = useRef(null);
  const [resizeColumnId, setResizeColumnId] = useState(null);
  const dragRef = useRef(null);

  const [columnWidths, setColumnWidths] = useState(() => {
    const defaults = Object.fromEntries(COLUNAS_DISPONIVEIS.map(c => [c.id, c.width || 160]));
    const saved = localStorage.getItem(`${COLUMN_WIDTHS_KEY}_${tipo.toLowerCase()}`);
    if (!saved) return defaults;
    try { return { ...defaults, ...JSON.parse(saved) }; } catch { return defaults; }
  });

  useEffect(() => { localStorage.setItem(`${COLUMN_WIDTHS_KEY}_${tipo.toLowerCase()}`, JSON.stringify(columnWidths)); }, [columnWidths]);

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem(`colunas_ordem_financeiro_${tipo.toLowerCase()}`);
    if (saved) { try { return JSON.parse(saved); } catch { /* fallback */ } }
    return COLUNAS_DISPONIVEIS.map(c => c.id);
  });

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem(`colunas_tabela_financeiro_${tipo.toLowerCase()}`);
    if (saved) { try { return Array.from(new Set([...JSON.parse(saved), ...DEFAULT_VISIBLE_COLUMNS])); } catch { /* fallback */ } }
    return DEFAULT_VISIBLE_COLUMNS;
  });

  const toggleColuna = (colunaId) => {
    const novas = colunasVisiveis.includes(colunaId) ? colunasVisiveis.filter(id => id !== colunaId) : [...colunasVisiveis, colunaId];
    setColunasVisiveis(novas);
    localStorage.setItem(`colunas_tabela_financeiro_${tipo.toLowerCase()}`, JSON.stringify(novas));
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(colunasOrdem);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);
    setColunasOrdem(items);
    localStorage.setItem(`colunas_ordem_financeiro_${tipo.toLowerCase()}`, JSON.stringify(items));
  };

  const colunasOrdenadas = useMemo(() => {
    return colunasOrdem.map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id)).filter(c => c && colunasVisiveis.includes(c.id));
  }, [colunasOrdem, colunasVisiveis]);

  // --- Resize logic (same as TabelaCategoriasManejo) ---
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
      setColumnWidths(prev => ({ ...prev, [columnId]: Math.max(MIN_COLUMN_WIDTH, startWidth + (clientX - startX)) }));
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

  // --- Sort ---
  const handleSort = (field) => {
    if (sortField === field) { setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc'); }
    else { setSortField(field); setSortDirection('asc'); }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  // --- Selection ---
  const handleSelecionarTodos = () => {
    if (selecionados.length === lancamentosOrdenados.length && lancamentosOrdenados.length > 0) setSelecionados([]);
    else setSelecionados(lancamentosOrdenados.map(l => l.id));
  };

  const handleToggleSelecao = (id) => {
    setSelecionados(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  // --- Batch actions ---
  const handleEditarEmLote = () => { if (selecionados.length === 0) { toast.error('Selecione ao menos um lançamento!'); return; } setShowEditarLote(true); };

  const handleConfirmarEdicaoLote = async () => {
    const dadosParaAtualizar = {};
    if (edicaoLote.safra_id) { const s = safras?.find(s => s.id === edicaoLote.safra_id); dadosParaAtualizar.safra_id = edicaoLote.safra_id; dadosParaAtualizar.safra_nome = s ? `${s.ano_inicio}/${s.ano_fim}` : undefined; }
    if (edicaoLote.centro_custo_id) { const c = centrosCusto?.find(c => c.id === edicaoLote.centro_custo_id); dadosParaAtualizar.centro_custo_id = edicaoLote.centro_custo_id; dadosParaAtualizar.centro_custo_nome = c?.nome; }
    if (edicaoLote.plano_contas_id) { const p = planosContas?.find(p => p.id === edicaoLote.plano_contas_id); dadosParaAtualizar.plano_contas_id = edicaoLote.plano_contas_id; dadosParaAtualizar.plano_contas_nome = p ? `${p.codigo} - ${p.descricao}` : undefined; }
    if (edicaoLote.grupo_id) { const g = gruposFinanceiros?.find(g => g.id === edicaoLote.grupo_id); dadosParaAtualizar.grupo_id = edicaoLote.grupo_id; dadosParaAtualizar.grupo_nome = g?.descricao; }
    if (edicaoLote.observacoes) dadosParaAtualizar.observacoes = edicaoLote.observacoes.toUpperCase();
    if (Object.keys(dadosParaAtualizar).length === 0) { toast.error('Preencha ao menos um campo!'); return; }
    if (window.confirm(`Confirma a edição de ${selecionados.length} lançamento(s)?`)) {
      await onUpdateLote(selecionados, dadosParaAtualizar);
      setShowEditarLote(false); setEdicaoLote({ safra_id: "", centro_custo_id: "", plano_contas_id: "", grupo_id: "", observacoes: "" }); setSelecionados([]);
      toast.success(`${selecionados.length} lançamento(s) atualizado(s)!`);
    }
  };

  const handleExcluirEmMassa = async () => {
    if (selecionados.length === 0) { toast.error('Selecione ao menos um lançamento!'); return; }
    if (window.confirm(`⚠️ Confirma a exclusão de ${selecionados.length} lançamento(s)?`)) {
      let excluidos = 0;
      for (const id of selecionados) { try { await onDelete(id, true); excluidos++; } catch (error) { console.error('Erro:', error); } }
      setSelecionados([]); toast.success(`${excluidos} lançamento(s) excluído(s)!`);
    }
  };

  const handleExportarSelecionados = () => {
    if (selecionados.length === 0) { toast.error('Selecione ao menos um lançamento!'); return; }
    const sel = lancamentos.filter(l => selecionados.includes(l.id));
    const csvRows = [['Nº', 'Emissão', 'Vencimento', 'Fornecedor/Cliente', 'Tipo Doc', 'Nº Doc', 'Valor Total', 'Valor Pago', 'Saldo', 'Status'].join(';')];
    sel.forEach(l => { csvRows.push([l.numero_lancamento || '', formatarData(l.data_emissao), formatarData(l.data_vencimento), l.fornecedor_nome || l.cliente_nome || '', l.tipo_documento || '', l.numero_documento || '', l.valor_total || 0, l.valor_pago || 0, (l.valor_total || 0) - (l.valor_pago || 0), l.status || ''].join(';')); });
    const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `lancamentos_selecionados_${new Date().toISOString().split('T')[0]}.csv`; link.click();
    toast.success(`${selecionados.length} lançamento(s) exportado(s)!`);
  };

  // --- Filter logic ---
  const hasActiveFilter = (colunaId) => (filtrosColunas[colunaId] || []).length > 0;
  const getValoresFiltro = (colunaId) => filtrosColunas[colunaId] || [];
  const setValoresFiltro = (colunaId, values) => setFiltrosColunas(prev => ({ ...prev, [colunaId]: values }));
  const clearColumnFilter = (colunaId) => setValoresFiltro(colunaId, []);

  const columnOptions = useMemo(() => {
    const opts = {};
    COLUNAS_DISPONIVEIS.filter(c => !c.fixo).forEach(col => {
      opts[col.id] = [...new Set(lancamentos.map(item => getFieldValue(item, col.id)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }));
    });
    return opts;
  }, [lancamentos]);

  const lancamentosFiltrados = useMemo(() => {
    return lancamentos.filter(item => {
      return COLUNAS_DISPONIVEIS.filter(c => !c.fixo).every(col => {
        const filtro = filtrosColunas[col.id] || [];
        if (filtro.length === 0) return true;
        const val = getFieldValue(item, col.id);
        return filtro.includes(val);
      });
    });
  }, [lancamentos, filtrosColunas]);

  const lancamentosOrdenados = useMemo(() => {
    const sorted = [...lancamentosFiltrados];
    sorted.sort((a, b) => {
      let aValue, bValue;
      switch (sortField) {
        case 'numero': aValue = parseInt(a?.numero_lancamento) || 0; bValue = parseInt(b?.numero_lancamento) || 0; break;
        case 'emissao': aValue = new Date(a?.data_emissao).getTime(); bValue = new Date(b?.data_emissao).getTime(); break;
        case 'vencimento': aValue = new Date(a?.data_vencimento).getTime(); bValue = new Date(b?.data_vencimento).getTime(); break;
        case 'fornecedor_cliente': aValue = (a?.fornecedor_nome || a?.cliente_nome || '').toLowerCase(); bValue = (b?.fornecedor_nome || b?.cliente_nome || '').toLowerCase(); break;
        case 'valor_total': aValue = a?.valor_total || 0; bValue = b?.valor_total || 0; break;
        case 'saldo': aValue = (a?.valor_total || 0) - (a?.valor_pago || 0); bValue = (b?.valor_total || 0) - (b?.valor_pago || 0); break;
        case 'status': aValue = (a?.status || '').toLowerCase(); bValue = (b?.status || '').toLowerCase(); break;
        case 'tipo_documento': aValue = (a?.tipo_documento || '').toLowerCase(); bValue = (b?.tipo_documento || '').toLowerCase(); break;
        case 'safra': aValue = (a?.safra_nome || '').toLowerCase(); bValue = (b?.safra_nome || '').toLowerCase(); break;
        case 'centro_custo': aValue = (a?.centro_custo_nome || '').toLowerCase(); bValue = (b?.centro_custo_nome || '').toLowerCase(); break;
        case 'grupo': aValue = (a?.grupo_nome || '').toLowerCase(); bValue = (b?.grupo_nome || '').toLowerCase(); break;
        case 'forma_pagamento': aValue = (a?.forma_pagamento_nome || '').toLowerCase(); bValue = (b?.forma_pagamento_nome || '').toLowerCase(); break;
        default: return 0;
      }
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [lancamentosFiltrados, sortField, sortDirection]);

  const fornecedorDoLancamento = (lancamento) => fornecedores?.find(f => f.id === lancamento?.fornecedor_id);

  // renderCell returns CONTENT only (no <TableCell> wrapper)
  const renderCell = (lancamento, colunaId) => {
    switch (colunaId) {
      case 'numero': return <span className="font-semibold">{formatarNumero(parseInt(lancamento?.numero_lancamento || 0))}</span>;
      case 'parcela': return lancamento?.numero_parcela && lancamento?.total_parcelas ? <Badge variant="outline" className="bg-slate-100 text-slate-700 text-[10px]">{lancamento.numero_parcela}/{lancamento.total_parcelas}</Badge> : '-';
      case 'emissao': return <span className="text-slate-600">{formatarData(lancamento?.data_emissao)}</span>;
      case 'vencimento': return <span className="text-slate-600">{formatarData(lancamento?.data_vencimento)}</span>;
      case 'dias': return (lancamento?.status === 'Pendente' || lancamento?.status === 'Pago Parcial') ? <span className={`font-medium ${calcularDias(lancamento?.data_vencimento).includes('vencido') ? 'text-red-600' : 'text-slate-600'}`}>{calcularDias(lancamento?.data_vencimento)}</span> : null;
      case 'fornecedor_cliente': return lancamento?.fornecedor_nome || lancamento?.cliente_nome || '-';
      case 'tipo_documento': return <span className="text-slate-600">{lancamento?.tipo_documento || '-'}</span>;
      case 'documento': return <span className="font-mono text-slate-600">{lancamento?.numero_documento || '-'}</span>;
      case 'chave_nfe': return <span className="font-mono text-[10px] text-slate-600" title={lancamento?.chave_nfe}>{lancamento?.chave_nfe || '-'}</span>;
      case 'serie': return <span className="text-slate-600">{lancamento?.serie_documento || '-'}</span>;
      case 'cfop': return <span className="font-mono text-slate-600">{lancamento?.cfop || '-'}</span>;
      case 'valor_total': return <span className="font-mono font-semibold">{formatarMoeda(lancamento?.valor_total || 0)}</span>;
      case 'valor_pago': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_pago || 0)}</span>;
      case 'saldo': return <span className="font-mono font-semibold text-slate-700">{formatarMoeda((lancamento?.valor_total || 0) - (lancamento?.valor_pago || 0))}</span>;
      case 'status': return (
        <div className="flex flex-col gap-1">
          <Badge variant="outline" className={`${getBadgeStyle(lancamento?.status)} text-xs`}>{lancamento?.status}</Badge>
          {lancamento?.parcelas && lancamento.parcelas.length > 0 && (
            <Badge variant="outline" className="bg-slate-100 text-slate-700 text-[10px] cursor-pointer hover:bg-slate-200" onClick={() => setParcelasDialog(lancamento)}>
              <Calendar className="w-2.5 h-2.5 mr-0.5" />{lancamento.parcelas.length} parcela(s)
            </Badge>
          )}
        </div>
      );
      case 'safra': return <span className="text-slate-600">{lancamento?.safra_nome || '-'}</span>;
      case 'centro_custo': return <span className="text-slate-600">{lancamento?.centro_custo_nome || '-'}</span>;
      case 'plano_contas': return <span className="text-slate-600">{lancamento?.plano_contas_nome || '-'}</span>;
      case 'grupo': return <span className="text-slate-600">{lancamento?.grupo_nome || '-'}</span>;
      case 'forma_pagamento': return <span className="text-slate-600">{lancamento?.forma_pagamento_nome || '-'}</span>;
      case 'valor_produtos': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_produtos || 0)}</span>;
      case 'valor_frete': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_frete || 0)}</span>;
      case 'valor_seguro': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_seguro || 0)}</span>;
      case 'outras_despesas': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_outras_despesas || 0)}</span>;
      case 'valor_desconto': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_desconto_total || 0)}</span>;
      case 'valor_ipi': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_ipi || 0)}</span>;
      case 'valor_icms': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_icms || 0)}</span>;
      case 'valor_pis': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_pis || 0)}</span>;
      case 'valor_cofins': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.valor_cofins || 0)}</span>;
      case 'base_icms': return <span className="font-mono text-slate-600">{formatarMoeda(lancamento?.base_calculo_icms || 0)}</span>;
      default: return '-';
    }
  };

  // --- Filter Popover (same pattern as TabelaCategoriasManejo) ---
  const renderFilterControl = (colunaId) => {
    const buttonClass = `h-3 w-3 min-w-3 p-0 ${hasActiveFilter(colunaId) ? "text-emerald-600" : "text-slate-300 hover:text-slate-400"}`;
    const columnLabel = COLUNAS_DISPONIVEIS.find(c => c.id === colunaId)?.label || colunaId;
    const options = columnOptions[colunaId] || [];
    const valoresSelecionados = filtroTemp.colunaId === colunaId ? filtroTemp.valores : getValoresFiltro(colunaId);
    const filteredOptions = options.filter(o => String(o).toLowerCase().includes(buscaFiltroMenu.toLowerCase()));
    const allVisibleSelected = filteredOptions.length > 0 && filteredOptions.every(o => valoresSelecionados.includes(o));

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
            <button type="button" className="flex items-center w-full px-2 h-8 text-xs hover:bg-slate-100 rounded" onClick={() => { setSortField(colunaId); setSortDirection("desc"); setMenuFiltroAberto(null); }}>
              <ArrowUpZA className="w-4 h-4 mr-2" /> Classificar do Maior para o Menor
            </button>
            <button
              type="button"
              className={`flex items-center w-full px-2 h-8 text-xs rounded ${hasActiveFilter(colunaId) ? 'hover:bg-slate-100 text-slate-700' : 'text-slate-300 cursor-not-allowed'}`}
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
                    setFiltroTemp(prev => {
                      const restantes = prev.valores.filter(v => !filteredOptions.includes(v));
                      return { ...prev, valores: checked ? [...new Set([...restantes, ...filteredOptions])] : restantes };
                    });
                  }}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="block flex-1 overflow-hidden text-ellipsis whitespace-nowrap">(Selecionar Tudo)</span>
              </label>
              {filteredOptions.map(option => (
                <label key={option} className="flex h-6 items-center gap-2 px-2 py-0 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap overflow-hidden">
                  <Checkbox
                    checked={valoresSelecionados.includes(option)}
                    onCheckedChange={(checked) => {
                      setFiltroTemp(prev => ({ ...prev, valores: checked ? [...prev.valores, option] : prev.valores.filter(i => i !== option) }));
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
            {lancamentosOrdenados.length} de {lancamentos.length} registros
          </div>
          <div className="flex gap-2 flex-wrap">
            {selecionados.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs">Ações ({selecionados.length})</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleEditarEmLote} className="text-xs"><Edit2 className="w-3.5 h-3.5 mr-2" />Editar Lote</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportarSelecionados} className="text-xs"><Download className="w-3.5 h-3.5 mr-2" />Exportar</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExcluirEmMassa} className="text-xs text-red-600"><Trash2 className="w-3.5 h-3.5 mr-2" />Excluir</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

          </div>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0 overflow-hidden">
            <div className="relative overflow-hidden">
              <div ref={scrollContainerRef} className="relative w-full overflow-auto max-h-[calc(100dvh-240px)] md:max-h-[calc(100dvh-150px)]" style={{ overscrollBehavior: 'none', WebkitOverflowScrolling: 'touch' }}>
                <Table ref={tableRef} className={`w-full ${isMobile ? "min-w-[720px]" : "min-w-[1100px]"} border-separate border-spacing-0 table-fixed`}>
                  <TableHeader className="bg-white">
                    <TableRow className="sticky top-0 z-40 bg-white">
                      {colunasOrdenadas.map((coluna) => {
                        const width = columnWidths[coluna.id] || coluna.width || 160;
                        const isResizing = resizeColumnId === coluna.id;

                        if (coluna.id === 'selecao') {
                          return (
                            <TableHead key="selecao" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200">
                              <div className="flex items-center justify-center w-full h-full">
                                <Checkbox checked={selecionados.length === lancamentosOrdenados.length && lancamentosOrdenados.length > 0} onCheckedChange={handleSelecionarTodos} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                              </div>
                            </TableHead>
                          );
                        }

                        if (coluna.id === 'acoes') {
                          return <TableHead key="acoes" style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="sticky top-0 z-40 h-7 p-0 bg-white text-muted-foreground font-medium text-center align-middle px-0 border-r border-b border-gray-200" />;
                        }

                        const filterControl = renderFilterControl(coluna.id);

                        return (
                          <TableHead
                            key={coluna.id}
                            style={{ width, minWidth: width, maxWidth: width }}
                            className="sticky top-0 z-40 relative align-middle text-gray-900 px-2 pr-7 text-xs font-medium text-center border-r border-b border-gray-200 bg-white whitespace-nowrap h-7"
                          >
                            <div className="inline-flex items-center justify-center gap-1 h-full w-full whitespace-nowrap overflow-hidden text-ellipsis">
                              {coluna.label}
                            </div>

                            {filterControl && (
                              <div className="absolute right-1 top-1/2 -translate-y-1/2 z-50 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                {filterControl}
                                <button
                                  type="button"
                                  className={`h-4 w-4 flex items-center justify-center rounded ${isResizing ? 'text-emerald-600 bg-emerald-100' : 'text-slate-300 hover:text-slate-500'}`}
                                  onClick={(e) => { e.stopPropagation(); toggleResizeMode(coluna.id); }}
                                  onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); toggleResizeMode(coluna.id); }}
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
                        <TableCell colSpan={colunasOrdenadas.length} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                      </TableRow>
                    ) : lancamentosOrdenados.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={colunasOrdenadas.length} className="text-center py-12 text-slate-400 text-xs">Nenhum lançamento</TableCell>
                      </TableRow>
                    ) : (
                      lancamentosOrdenados.map((lancamento) => {
                        if (!lancamento) return null;
                        const temProdutos = lancamento.produtos_lancamento && lancamento.produtos_lancamento.length > 0;

                        return (
                          <TableRow key={lancamento.id} className="data-[state=selected]:bg-muted transition-colors border-b hover:bg-gray-100">
                            {colunasOrdenadas.map((coluna) => {
                              const width = columnWidths[coluna.id] || coluna.width || 160;

                              if (coluna.id === 'selecao') {
                                return (
                                  <TableCell key={`${lancamento.id}-selecao`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-muted-foreground font-medium text-center align-middle px-0 h-7 border-r border-b border-gray-300">
                                    <div className="flex items-center justify-center w-full h-full">
                                      <Checkbox checked={selecionados.includes(lancamento.id)} onCheckedChange={() => handleToggleSelecao(lancamento.id)} className="peer shrink-0 shadow disabled:opacity-50 h-4 w-4 rounded-full border-2 border-gray-400 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground" />
                                    </div>
                                  </TableCell>
                                );
                              }

                              if (coluna.id === 'acoes') {
                                return (
                                  <TableCell key={`${lancamento.id}-acoes`} style={{ width: 25, minWidth: 25, maxWidth: 25 }} className="p-0 text-muted-foreground font-medium text-center align-middle px-0 h-7 border-r border-b border-gray-300">
                                    <div className="flex items-center justify-center w-full h-full">
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="w-3.5 h-3.5 text-slate-600" /></Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
                                          <DropdownMenuItem onClick={() => setDetalhesAberto(lancamento)} className="text-xs"><Eye className="w-3.5 h-3.5 mr-2" />Ver Detalhes</DropdownMenuItem>
                                          {temProdutos && <DropdownMenuItem onClick={() => setProdutosDialog(lancamento)} className="text-xs"><Package className="w-3.5 h-3.5 mr-2" />Ver Produtos ({lancamento.produtos_lancamento.length})</DropdownMenuItem>}
                                          <DropdownMenuItem onClick={() => onEdit(lancamento)} className="text-xs"><Edit className="w-3.5 h-3.5 mr-2" />Editar</DropdownMenuItem>
                                          {lancamento.parcelas && lancamento.parcelas.length > 0 && <DropdownMenuItem onClick={() => setParcelasDialog(lancamento)} className="text-xs"><Calendar className="w-3.5 h-3.5 mr-2" />Ver Parcelas ({lancamento.parcelas.length})</DropdownMenuItem>}
                                          <DropdownMenuSeparator />
                                          {lancamento?.status !== 'Pago' && lancamento?.status !== 'Cancelado' && <DropdownMenuItem onClick={() => onBaixa(lancamento)} className="text-xs"><CheckCircle className="w-3.5 h-3.5 mr-2 text-emerald-600" />Dar Baixa</DropdownMenuItem>}
                                          {lancamento?.status === 'Pago' && onCancelarBaixa && <DropdownMenuItem onClick={() => onCancelarBaixa(lancamento)} className="text-xs"><XCircle className="w-3.5 h-3.5 mr-2 text-orange-600" />Cancelar Baixa</DropdownMenuItem>}
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem onClick={() => onDelete(lancamento.id)} className="text-xs text-red-600"><Trash2 className="w-3.5 h-3.5 mr-2" />Excluir</DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </TableCell>
                                );
                              }

                              return (
                                <TableCell
                                  key={`${lancamento.id}-${coluna.id}`}
                                  style={{ width, minWidth: width, maxWidth: width }}
                                  className="px-2 py-1 text-gray-700 text-xs align-middle border-r border-b border-gray-300 whitespace-normal break-words"
                                >
                                  {renderCell(lancamento, coluna.id)}
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

      {/* Editar em Lote Dialog */}
      <Dialog open={showEditarLote} onOpenChange={setShowEditarLote}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4 text-blue-600" />Editar {selecionados.length} Lançamento(s) em Lote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-2">
              <p className="text-xs text-blue-800">💡 Apenas campos preenchidos serão atualizados. Valores e produtos não podem ser alterados em lote.</p>
            </div>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Safra</Label>
                <Select value={edicaoLote.safra_id} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, safra_id: v })}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Manter atual" /></SelectTrigger><SelectContent><SelectItem value={null} className="text-xs">Não alterar</SelectItem>{safras?.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.ano_inicio}/{s.ano_fim}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Centro de Custo</Label>
                <Select value={edicaoLote.centro_custo_id} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, centro_custo_id: v })}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Manter atual" /></SelectTrigger><SelectContent><SelectItem value={null} className="text-xs">Não alterar</SelectItem>{centrosCusto?.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.nome}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Plano de Contas</Label>
                <Select value={edicaoLote.plano_contas_id} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, plano_contas_id: v })}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Manter atual" /></SelectTrigger><SelectContent><SelectItem value={null} className="text-xs">Não alterar</SelectItem>{planosContas?.map(p => <SelectItem key={p.id} value={p.id} className="text-xs">{p.codigo} - {p.descricao}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Grupo Financeiro</Label>
                <Select value={edicaoLote.grupo_id} onValueChange={(v) => setEdicaoLote({ ...edicaoLote, grupo_id: v })}><SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Manter atual" /></SelectTrigger><SelectContent><SelectItem value={null} className="text-xs">Não alterar</SelectItem>{gruposFinanceiros?.map(g => <SelectItem key={g.id} value={g.id} className="text-xs">{g.codigo} - {g.descricao}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Observações (sobrescrever)</Label>
                <Textarea value={edicaoLote.observacoes} onChange={(e) => setEdicaoLote({ ...edicaoLote, observacoes: e.target.value })} placeholder="NOVA OBSERVAÇÃO..." className="text-xs uppercase" style={{ textTransform: 'uppercase' }} rows={2} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowEditarLote(false)} size="sm" className="h-7 text-xs">Cancelar</Button>
              <Button onClick={handleConfirmarEdicaoLote} size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700">Atualizar {selecionados.length}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfiguracaoColunasMapaDialog
        open={showConfigColunas} onOpenChange={setShowConfigColunas}
        colunasDisponiveis={COLUNAS_DISPONIVEIS} colunasVisiveis={colunasVisiveis} colunasOrdem={colunasOrdem}
        toggleColuna={toggleColuna} handleDragEnd={handleDragEnd} droppableId={`colunas-financeiro-${tipo.toLowerCase()}`}
      />

      {/* Parcelas Dialog */}
      <Dialog open={!!parcelasDialog} onOpenChange={(open) => !open && setParcelasDialog(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle className="text-sm">Parcelas - Lançamento #{parcelasDialog?.numero_lancamento}</DialogTitle></DialogHeader>
          {parcelasDialog && (
            <div className="space-y-3">
              <Card className="shadow-sm border-slate-200"><CardContent className="p-2"><div className="grid grid-cols-2 gap-2 text-xs"><div><strong>Fornecedor/Cliente:</strong> {parcelasDialog.fornecedor_nome || parcelasDialog.cliente_nome || '-'}</div><div><strong>Documento:</strong> {parcelasDialog.numero_documento || '-'}</div><div><strong>Total:</strong> {formatarMoeda(parcelasDialog.valor_total || 0)}</div><div><strong>Pago:</strong> {formatarMoeda(parcelasDialog.valor_pago || 0)}</div><div className="col-span-2"><strong>Saldo:</strong> {formatarMoeda((parcelasDialog.valor_total || 0) - (parcelasDialog.valor_pago || 0))}</div></div></CardContent></Card>
              <div className="border rounded overflow-auto max-h-96">
                <Table>
                  <TableHeader><TableRow className="bg-slate-50"><TableHead className="text-xs">Nº</TableHead><TableHead className="text-xs">Lançamento</TableHead><TableHead className="text-xs">Vencimento</TableHead><TableHead className="text-xs text-right">Valor</TableHead><TableHead className="text-xs text-right">Pago</TableHead><TableHead className="text-xs text-right">Saldo</TableHead><TableHead className="text-xs">Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {parcelasDialog.parcelas?.map((parcela, index) => {
                      const vp = parcela.valor || 0; const vpg = parcela.valor_pago || 0; const sl = vp - vpg; const isPaga = sl <= 0.01;
                      return (
                        <TableRow key={index}>
                          <TableCell className="font-semibold text-xs">{index + 1}/{parcelasDialog.parcelas.length}</TableCell>
                          <TableCell className="text-xs"><div className="flex flex-col"><span className="font-semibold">#{parcela.numero_lancamento || '-'}</span><span className="text-[10px] text-slate-500">{parcela.tipo_documento || '-'}</span></div></TableCell>
                          <TableCell className="text-xs">{formatarData(parcela.data)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatarMoeda(vp)}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-slate-600">{formatarMoeda(vpg)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda(sl)}</TableCell>
                          <TableCell><Badge variant="outline" className={`text-xs ${isPaga ? 'bg-slate-100 text-slate-700' : 'bg-orange-50 text-orange-700 border-orange-300'}`}>{isPaga ? 'Paga' : 'Pendente'}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Produtos Dialog */}
      <Dialog open={!!produtosDialog} onOpenChange={(open) => !open && setProdutosDialog(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Produtos - Lançamento #{produtosDialog?.numero_lancamento}</DialogTitle></DialogHeader>
          {produtosDialog && (
            <div className="space-y-3">
              <Card className="shadow-sm border-slate-200"><CardContent className="p-2"><div className="grid grid-cols-2 gap-2 text-xs"><div><strong>Fornecedor:</strong> {produtosDialog.fornecedor_nome || '-'}</div><div><strong>Documento:</strong> {produtosDialog.numero_documento || '-'}</div><div><strong>Data Emissão:</strong> {formatarData(produtosDialog.data_emissao)}</div><div><strong>Total Nota:</strong> {formatarMoeda(produtosDialog.valor_total || 0)}</div></div></CardContent></Card>
              <div className="border rounded overflow-auto">
                <Table>
                  <TableHeader><TableRow className="bg-slate-50"><TableHead className="text-xs">Produto</TableHead><TableHead className="text-xs text-right">Quantidade</TableHead><TableHead className="text-xs text-center">Unidade</TableHead><TableHead className="text-xs text-right">Vlr. Unit.</TableHead><TableHead className="text-xs text-right">Total</TableHead><TableHead className="text-xs text-right">Desconto</TableHead><TableHead className="text-xs text-right">Líquido</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {produtosDialog.produtos_lancamento?.map((produto, index) => {
                      const vt = produto.valor_total || 0; const dc = produto.desconto_item || 0; const lq = vt - dc;
                      return (
                        <TableRow key={index}>
                          <TableCell className="text-xs font-medium">{produto.produto_nome || '-'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{produto.quantidade?.toFixed(2) || '0.00'}</TableCell>
                          <TableCell className="text-center font-mono text-xs">{produto.unidade || '-'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatarMoeda(produto.valor_unitario || 0)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatarMoeda(vt)}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-red-600">{formatarMoeda(dc)}</TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold text-emerald-700">{formatarMoeda(lq)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-slate-100 border-t-2 font-semibold">
                      <TableCell colSpan={4} className="text-xs">TOTAL</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatarMoeda(produtosDialog.produtos_lancamento?.reduce((s, p) => s + (p.valor_total || 0), 0) || 0)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-red-600">{formatarMoeda(produtosDialog.produtos_lancamento?.reduce((s, p) => s + (p.desconto_item || 0), 0) || 0)}</TableCell>
                      <TableCell className="text-right font-mono text-xs text-emerald-700 font-bold">{formatarMoeda(produtosDialog.produtos_lancamento?.reduce((s, p) => s + ((p.valor_total || 0) - (p.desconto_item || 0)), 0) || 0)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Detalhes Dialog */}
      <Dialog open={!!detalhesAberto} onOpenChange={(open) => !open && setDetalhesAberto(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-sm">Lançamento #{detalhesAberto?.numero_lancamento}</DialogTitle></DialogHeader>
          {detalhesAberto && (
            <div className="space-y-3">
              <Card className="shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">Informações Gerais</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 text-xs"><div><strong>Nº:</strong> {formatarNumero(parseInt(detalhesAberto.numero_lancamento))}</div><div><strong>Tipo:</strong> {detalhesAberto.tipo}</div>{detalhesAberto.numero_parcela && detalhesAberto.total_parcelas && <div><strong>Parcela:</strong> {detalhesAberto.numero_parcela}/{detalhesAberto.total_parcelas}</div>}<div><strong>Emissão:</strong> {formatarData(detalhesAberto.data_emissao)}</div><div><strong>Vencimento:</strong> {formatarData(detalhesAberto.data_vencimento)}</div><div><strong>Tipo Doc:</strong> {detalhesAberto.tipo_documento || '-'}</div><div><strong>Nº Doc:</strong> {detalhesAberto.numero_documento || '-'}</div>{detalhesAberto.chave_nfe && <div className="col-span-2"><strong>Chave NF-e:</strong> <span className="font-mono text-[10px]">{detalhesAberto.chave_nfe}</span></div>}</CardContent></Card>
              {tipo === 'Pagar' && detalhesAberto.fornecedor_id && (
                <Card className="shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">Fornecedor</CardTitle></CardHeader><CardContent className="space-y-1 text-xs">{(() => { const f = fornecedorDoLancamento(detalhesAberto); return f ? <><div><strong>Nome:</strong> {f.nome}</div><div><strong>CPF/CNPJ:</strong> {f.cpf || f.cnpj || '-'}</div></> : <div className="text-slate-500">Não encontrado</div>; })()}</CardContent></Card>
              )}
              <Card className="shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">Valores</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 text-xs"><div><strong>Vlr. Total:</strong> <span className="font-semibold">{formatarMoeda(detalhesAberto.valor_total || 0)}</span></div><div><strong>Vlr. Pago:</strong> <span className="text-slate-600">{formatarMoeda(detalhesAberto.valor_pago || 0)}</span></div><div className="col-span-2"><strong>Vlr. Saldo:</strong> <span className="font-semibold">{formatarMoeda((detalhesAberto.valor_total || 0) - (detalhesAberto.valor_pago || 0))}</span></div></CardContent></Card>
              {detalhesAberto.produtos_lancamento && detalhesAberto.produtos_lancamento.length > 0 && (
                <Card className="shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">Produtos Lançados</CardTitle></CardHeader><CardContent className="p-2"><div className="border rounded overflow-auto max-h-60"><Table><TableHeader><TableRow className="bg-slate-50"><TableHead className="text-xs">Produto</TableHead><TableHead className="text-xs text-right">Qtd</TableHead><TableHead className="text-xs text-center">UN</TableHead><TableHead className="text-xs text-right">Vlr. Unit.</TableHead><TableHead className="text-xs text-right">Total</TableHead></TableRow></TableHeader><TableBody>{detalhesAberto.produtos_lancamento.map((prod, idx) => <TableRow key={idx}><TableCell className="text-xs">{prod.produto_nome || '-'}</TableCell><TableCell className="text-right font-mono text-xs">{prod.quantidade?.toFixed(2) || '0.00'}</TableCell><TableCell className="text-center font-mono text-xs">{prod.unidade || '-'}</TableCell><TableCell className="text-right font-mono text-xs">{formatarMoeda(prod.valor_unitario || 0)}</TableCell><TableCell className="text-right font-mono text-xs font-semibold">{formatarMoeda((prod.valor_total || 0) - (prod.desconto_item || 0))}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card>
              )}
              {detalhesAberto.observacoes && <Card className="shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">Observações</CardTitle></CardHeader><CardContent><p className="text-xs whitespace-pre-wrap bg-slate-50 p-2 rounded">{detalhesAberto.observacoes}</p></CardContent></Card>}
              {detalhesAberto.observacoes_nfe && <Card className="shadow-sm"><CardHeader className="pb-2"><CardTitle className="text-xs font-semibold">Observações NF-e</CardTitle></CardHeader><CardContent><p className="text-xs whitespace-pre-wrap bg-slate-50 p-2 rounded">{detalhesAberto.observacoes_nfe}</p></CardContent></Card>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}