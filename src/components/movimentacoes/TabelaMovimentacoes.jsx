import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRightLeft, Search, Settings, Edit, Ban, MoreVertical, Loader2, GripVertical, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { toLabel, getLocalEstoque, getLabelOperacao } from './utils/movimentacaoUtils';

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  const numericValue = typeof numero === 'string' ? parseFloat(numero.replace('.', '').replace(',', '.')) : numero;
  if (isNaN(numericValue)) return "0,00";
  return numericValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  const numericValue = typeof valor === 'string' ? parseFloat(valor.replace('.', '').replace(',', '.')) : valor;
  if (isNaN(numericValue)) return "R$ 0,00";
  return numericValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatarData = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR') + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
};

const formatarDataSimples = (dataString) => {
  if (!dataString) return '-';
  try {
    const date = new Date(dataString);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('pt-BR');
  } catch {
    return '-';
  }
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'data', label: 'Data/Hora', default: true, sortable: true },
  { id: 'tipo', label: 'Tipo', default: true, sortable: true },
  { id: 'tipo_detalhado', label: 'Tipo Detalhado', default: true, sortable: false },
  { id: 'tipo_documento', label: 'Tipo Doc', default: false, sortable: false },
  { id: 'numero_documento', label: 'Nº Documento', default: false, sortable: false },
  { id: 'serie_documento', label: 'Série', default: false, sortable: false },
  { id: 'chave_documento', label: 'Chave NF-e', default: false, sortable: false },
  { id: 'data_documento', label: 'Data Doc', default: false, sortable: false },
  { id: 'cfop', label: 'CFOP', default: false, sortable: false },
  { id: 'natureza_operacao', label: 'Natureza Op.', default: false, sortable: false },
  { id: 'produto', label: 'Produto', default: true, sortable: true },
  { id: 'produto_codigo', label: 'Código Prod', default: false, sortable: false },
  { id: 'produto_categoria', label: 'Categoria', default: false, sortable: false },
  { id: 'quantidade', label: 'Quantidade', default: true, sortable: true },
  { id: 'unidade', label: 'UN', default: true, sortable: false },
  { id: 'valor_unitario', label: 'Vlr Unit.', default: true, sortable: false },
  { id: 'valor_total', label: 'Vlr Total', default: true, sortable: false },
  { id: 'custo_medio_antes', label: 'Custo Médio Ant.', default: false, sortable: false },
  { id: 'custo_medio_depois', label: 'Custo Médio Dep.', default: false, sortable: false },
  { id: 'saldo_antes', label: 'Saldo Ant.', default: false, sortable: false },
  { id: 'saldo_depois', label: 'Saldo Dep.', default: false, sortable: false },
  { id: 'fornecedor', label: 'Fornecedor/Cliente', default: true, sortable: true },
  { id: 'local_estoque', label: 'Local Estoque', default: true, sortable: false },
  { id: 'local_origem', label: 'Local Origem', default: false, sortable: false },
  { id: 'local_destino', label: 'Local Destino', default: false, sortable: false },
  { id: 'centro_custo', label: 'Centro de Custo', default: false, sortable: false },
  { id: 'motivo', label: 'Motivo (Ajuste)', default: false, sortable: false },
  { id: 'observacoes', label: 'Observações', default: false, sortable: false },
  { id: 'responsavel', label: 'Responsável', default: false, sortable: false },
  { id: 'status', label: 'Status', default: true, sortable: true },
];

const ITEMS_PER_PAGE = 50;

export default function TabelaMovimentacoes({ movimentacoes = [], onEdit, onCancel, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_movimentacoes');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const [colunasOrdem, setColunasOrdem] = useState(() => {
    const saved = localStorage.getItem('colunas_ordem_movimentacoes');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return COLUNAS_DISPONIVEIS.map(c => c.id);
      }
    }
    return COLUNAS_DISPONIVEIS.map(c => c.id);
  });
  
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedItems, setSelectedItems] = useState([]);
  const [isCancelingBulk, setIsCancelingBulk] = useState(false);
  const [cancelProgress, setCancelProgress] = useState({ current: 0, total: 0 });

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      localStorage.setItem('colunas_movimentacoes', JSON.stringify(novasColunas));
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_movimentacoes', JSON.stringify(items));
  };

  const colunasOrdenadas = colunasOrdem
    .map(id => COLUNAS_DISPONIVEIS.find(c => c.id === id))
    .filter(c => c && colunasVisiveis.includes(c.id));

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1" />
      : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const filteredMovimentacoes = movimentacoes.filter(mov => {
    const searchLower = searchTerm.toLowerCase();
    return (
      mov.produto_nome?.toLowerCase().includes(searchLower) ||
      mov.produto_codigo?.toLowerCase().includes(searchLower) ||
      mov.tipo_movimentacao?.toLowerCase().includes(searchLower) ||
      mov.tipo_detalhado?.toLowerCase().includes(searchLower) ||
      mov.tipo_documento?.toLowerCase().includes(searchLower) ||
      mov.fornecedor_nome?.toLowerCase().includes(searchLower) ||
      mov.cliente_nome?.toLowerCase().includes(searchLower) ||
      mov.numero_documento?.toLowerCase().includes(searchLower) ||
      mov.chave_documento?.toLowerCase().includes(searchLower) ||
      mov.cfop?.toLowerCase().includes(searchLower) ||
      String(mov.numero_movimentacao)?.includes(searchLower) ||
      mov.centro_custo_nome?.toLowerCase().includes(searchLower) ||
      mov.local_estoque_origem?.toLowerCase().includes(searchLower) ||
      mov.local_estoque_destino?.toLowerCase().includes(searchLower)
    );
  });

  const sortedMovimentacoes = [...filteredMovimentacoes].sort((a, b) => {
    if (!sortField) return 0;

    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_movimentacao) || 0;
        bValue = parseInt(b.numero_movimentacao) || 0;
        break;
      case 'data':
        aValue = new Date(a.data_movimentacao).getTime();
        bValue = new Date(b.data_movimentacao).getTime();
        break;
      case 'tipo':
        aValue = a.tipo_movimentacao;
        bValue = b.tipo_movimentacao;
        break;
      case 'produto':
        aValue = a.produto_nome;
        bValue = b.produto_nome;
        break;
      case 'quantidade':
        aValue = a.quantidade;
        bValue = b.quantidade;
        break;
      case 'fornecedor':
        aValue = a.fornecedor_nome || a.cliente_nome || '';
        bValue = b.fornecedor_nome || b.cliente_nome || '';
        break;
      case 'status':
        aValue = a.status;
        bValue = b.status;
        break;
      default:
        return 0;
    }

    if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedMovimentacoes.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedMovimentacoes = sortedMovimentacoes.slice(startIndex, endIndex);

  const toggleSelectAll = () => {
    const ativasNaPagina = paginatedMovimentacoes.filter(m => m.status === 'Ativa');
    if (selectedItems.length === ativasNaPagina.length && ativasNaPagina.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(ativasNaPagina.map(m => m.id));
    }
  };

  const toggleSelectItem = (id, status) => {
    if (status !== 'Ativa') return;
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkCancel = async () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a cancelar ${selectedItems.length} movimentação(ões) selecionada(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
      setIsCancelingBulk(true);
      setCancelProgress({ current: 0, total: selectedItems.length });
      
      let canceled = 0;
      for (const id of selectedItems) {
        try {
          await onCancel(id, true);
          canceled++;
          setCancelProgress({ current: canceled, total: selectedItems.length });
        } catch (error) {
          console.error('Erro ao cancelar:', error);
        }
      }
      
      setTimeout(() => {
        setIsCancelingBulk(false);
        setSelectedItems([]);
      }, 500);
    }
  };

  const cancelProgressPercentage = cancelProgress.total > 0 
    ? Math.round((cancelProgress.current / cancelProgress.total) * 100) 
    : 0;

  const getBadgeTipo = (tipo) => {
    const config = {
      'Entrada': 'bg-blue-100 text-blue-800 border-blue-300',
      'Saída': 'bg-orange-100 text-orange-800 border-orange-300',
      'Transferência': 'bg-purple-100 text-purple-800 border-purple-300',
      'Ajuste': 'bg-slate-100 text-slate-800 border-slate-300',
    };
    return config[tipo] || '';
  };

  const renderCell = (coluna, mov) => {
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="text-xs font-semibold border-r border-slate-200">{mov.numero_movimentacao || '-'}</TableCell>;
      case 'data':
        return <TableCell className="text-xs border-r border-slate-200">{formatarData(mov.data_movimentacao)}</TableCell>;
      case 'tipo':
        return (
          <TableCell className="border-r border-slate-200">
            <Badge variant="outline" className={`${getBadgeTipo(mov.tipo_movimentacao)} text-xs`}>
              {mov.tipo_movimentacao}
            </Badge>
          </TableCell>
        );
      case 'tipo_detalhado':
        return <TableCell className="text-xs border-r border-slate-200">{getLabelOperacao(mov.tipo_detalhado)}</TableCell>;
      case 'tipo_documento':
        return <TableCell className="text-xs border-r border-slate-200">{mov.tipo_documento || '-'}</TableCell>;
      case 'numero_documento':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{mov.numero_documento || '-'}</TableCell>;
      case 'serie_documento':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{mov.serie_documento || '-'}</TableCell>;
      case 'chave_documento':
        return <TableCell className="text-xs font-mono max-w-[200px] truncate border-r border-slate-200" title={mov.chave_documento}>{mov.chave_documento || '-'}</TableCell>;
      case 'data_documento':
        return <TableCell className="text-xs border-r border-slate-200">{formatarDataSimples(mov.data_documento)}</TableCell>;
      case 'cfop':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{mov.cfop || '-'}</TableCell>;
      case 'natureza_operacao':
        return <TableCell className="text-xs max-w-[150px] truncate border-r border-slate-200" title={mov.natureza_operacao}>{mov.natureza_operacao || '-'}</TableCell>;
      case 'produto':
        return <TableCell className="text-xs font-semibold border-r border-slate-200">{mov.produto_nome}</TableCell>;
      case 'produto_codigo':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{mov.produto_codigo || '-'}</TableCell>;
      case 'produto_categoria':
        return <TableCell className="text-xs border-r border-slate-200">{mov.produto_categoria || '-'}</TableCell>;
      case 'quantidade':
        return <TableCell className="text-right font-mono font-semibold text-emerald-700 text-xs border-r border-slate-200">{formatarNumero(mov.quantidade)}</TableCell>;
      case 'unidade':
        return <TableCell className="text-xs border-r border-slate-200">{mov.unidade_medida || '-'}</TableCell>;
      case 'valor_unitario':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{formatarMoeda(mov.valor_unitario)}</TableCell>;
      case 'valor_total':
        return <TableCell className="text-right font-mono font-semibold text-emerald-700 text-xs border-r border-slate-200">{formatarMoeda(mov.valor_total)}</TableCell>;
      case 'custo_medio_antes':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{formatarMoeda(mov.custo_medio_antes)}</TableCell>;
      case 'custo_medio_depois':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{formatarMoeda(mov.custo_medio_depois)}</TableCell>;
      case 'saldo_antes':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{formatarNumero(mov.saldo_antes)}</TableCell>;
      case 'saldo_depois':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{formatarNumero(mov.saldo_depois)}</TableCell>;
      case 'fornecedor':
        return <TableCell className="text-xs border-r border-slate-200">{mov.fornecedor_nome || mov.cliente_nome || '-'}</TableCell>;
      case 'local_estoque':
        // Usar função utilitária para pegar local correto
        return <TableCell className="text-xs max-w-[120px] truncate border-r border-slate-200">{getLocalEstoque(mov) || '-'}</TableCell>;
      case 'local_origem':
        return <TableCell className="text-xs max-w-[120px] truncate border-r border-slate-200">{mov.local_estoque_origem || mov.local_origem || '-'}</TableCell>;
      case 'local_destino':
        return <TableCell className="text-xs max-w-[120px] truncate border-r border-slate-200">{mov.local_estoque_destino || mov.local_destino || '-'}</TableCell>;
      case 'centro_custo':
        return <TableCell className="text-xs border-r border-slate-200">{mov.centro_custo_nome || '-'}</TableCell>;
      case 'motivo':
        // Mostrar motivo apenas para ajustes
        const motivo = mov.tipo_movimentacao === 'Ajuste' ? (mov.motivo_movimentacao || '-') : '-';
        return <TableCell className="text-xs max-w-[150px] truncate border-r border-slate-200" title={mov.tipo_movimentacao === 'Ajuste' ? mov.motivo_movimentacao : ''}>{motivo}</TableCell>;
      case 'observacoes':
        return <TableCell className="text-xs max-w-[150px] truncate border-r border-slate-200" title={mov.observacoes}>{mov.observacoes || '-'}</TableCell>;
      case 'responsavel':
        return <TableCell className="text-xs border-r border-slate-200">{mov.usuario_responsavel || '-'}</TableCell>;
      case 'status':
        return (
          <TableCell className="border-r border-slate-200">
            <Badge variant="outline" className={`text-xs ${mov.status === 'Ativa' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-red-100 text-red-800 border-red-300'}`}>
              {mov.status}
            </Badge>
          </TableCell>
        );
      default:
        return <TableCell className="text-xs border-r border-slate-200">-</TableCell>;
    }
  };

  const escapeHtml = (str) => String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  const getTextForCell = (id, mov) => {
    switch (id) {
      case 'numero': return mov.numero_movimentacao || '-';
      case 'data': return formatarData(mov.data_movimentacao);
      case 'tipo': return mov.tipo_movimentacao || '-';
      case 'tipo_detalhado': return mov.tipo_detalhado || '-';
      case 'tipo_documento': return mov.tipo_documento || '-';
      case 'numero_documento': return mov.numero_documento || '-';
      case 'serie_documento': return mov.serie_documento || '-';
      case 'chave_documento': return mov.chave_documento || '-';
      case 'data_documento': return formatarDataSimples(mov.data_documento);
      case 'cfop': return mov.cfop || '-';
      case 'natureza_operacao': return mov.natureza_operacao || '-';
      case 'produto': return mov.produto_nome || '-';
      case 'produto_codigo': return mov.produto_codigo || '-';
      case 'produto_categoria': return mov.produto_categoria || '-';
      case 'quantidade': return formatarNumero(mov.quantidade);
      case 'unidade': return mov.unidade_medida || '-';
      case 'valor_unitario': return formatarMoeda(mov.valor_unitario);
      case 'valor_total': return formatarMoeda(mov.valor_total);
      case 'custo_medio_antes': return formatarMoeda(mov.custo_medio_antes);
      case 'custo_medio_depois': return formatarMoeda(mov.custo_medio_depois);
      case 'saldo_antes': return formatarNumero(mov.saldo_antes);
      case 'saldo_depois': return formatarNumero(mov.saldo_depois);
      case 'fornecedor': return mov.fornecedor_nome || mov.cliente_nome || '-';
      case 'local_estoque': {
        const localPrincipal = mov.tipo_movimentacao === 'Entrada' 
          ? (mov.local_estoque_destino || mov.local_destino || mov.local_estoque || '-')
          : (mov.local_estoque_origem || mov.local_origem || mov.local_estoque || '-');
        return localPrincipal;
      }
      case 'local_origem': return mov.local_estoque_origem || mov.local_origem || '-';
      case 'local_destino': return mov.local_estoque_destino || mov.local_destino || '-';
      case 'centro_custo': return mov.centro_custo_nome || '-';
      case 'motivo': return mov.tipo_movimentacao === 'Ajuste' ? (mov.motivo_movimentacao || '-') : '-';
      case 'observacoes': return mov.observacoes || '-';
      case 'responsavel': return mov.usuario_responsavel || '-';
      case 'status': return mov.status || '-';
      default: return '-';
    }
  };

  const handleExportExcel = (onlySelected = false) => {
    const rows = onlySelected 
      ? sortedMovimentacoes.filter(m => selectedItems.includes(m.id))
      : sortedMovimentacoes;
    if (!rows || rows.length === 0) {
      alert('Não há dados para exportar.');
      return;
    }
    const visibleCols = colunasOrdenadas; // já ordenadas e visíveis
    const thead = '<tr>' + visibleCols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('') + '</tr>';
    const tbody = rows.map(mov => {
      const tds = visibleCols.map(c => `<td>${escapeHtml(getTextForCell(c.id, mov))}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table>${thead}${tbody}</table></body></html>`;
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = onlySelected ? 'movimentacoes_selecionadas.xls' : 'movimentacoes_filtradas.xls';
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Movimentações ({movimentacoes.length})
            </CardTitle>
            <div className="flex gap-2 items-center">
              {selectedItems.length > 0 && (
                <div className="flex items-center gap-2 bg-slate-100 border border-slate-300 rounded px-2 py-1">
                  <span className="text-xs font-semibold text-slate-800">
                    {selectedItems.length} selecionado(s)
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-6 px-1.5">
                        <MoreVertical className="w-4 h-4 text-slate-700" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel className="text-xs">Ações em Lote</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleBulkCancel} className="text-xs text-red-600">
                        Cancelar Todos
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">
                        Limpar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 h-8 w-48 text-xs" />
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowConfigColunas(true)}>
                Colunas
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    Exportar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-xs" onClick={() => handleExportExcel(false)}>
                    Excel - linhas filtradas
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-xs" onClick={() => handleExportExcel(true)} disabled={selectedItems.length === 0}>
                    Excel - selecionadas
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 border-b">
                  <TableHead className="w-8 text-xs border-r border-slate-200">
                    <Checkbox
                      checked={selectedItems.length === paginatedMovimentacoes.filter(m => m.status === 'Ativa').length && paginatedMovimentacoes.filter(m => m.status === 'Ativa').length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="text-xs text-center w-8 border-r border-slate-200"></TableHead>
                  {colunasOrdenadas.map((coluna) => {
                    return (
                      <TableHead 
                        key={coluna.id}
                        className={`text-xs border-r border-slate-200 ${coluna.sortable ? 'cursor-pointer hover:bg-slate-100' : ''}`}
                        onClick={() => coluna.sortable && handleSort(coluna.id)}
                      >
                        <div className="flex items-center">
                          {coluna.label}
                          {coluna.sortable && getSortIcon(coluna.id)}
                        </div>
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Carregando...</TableCell>
                    </TableRow>
                  ) : paginatedMovimentacoes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhuma movimentação</TableCell>
                    </TableRow>
                  ) : (
                    paginatedMovimentacoes.map((mov) => (
                      <motion.tr 
                        key={mov.id}
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        className={`hover:bg-slate-50 transition-colors border-b ${mov.status === 'Cancelada' ? 'opacity-50 bg-red-50' : ''}`}
                      >
                        <TableCell className="border-r border-slate-200">
                          <Checkbox
                            checked={selectedItems.includes(mov.id)}
                            onCheckedChange={() => toggleSelectItem(mov.id, mov.status)}
                            disabled={mov.status !== 'Ativa'}
                          />
                        </TableCell>
                        <TableCell className="text-center border-r border-slate-200">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                <MoreVertical className="w-3.5 h-3.5 text-slate-600" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuItem onClick={() => onEdit && onEdit(mov)} disabled={mov.status === 'Cancelada'} className="text-xs">
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onCancel && onCancel(mov.id)} disabled={mov.status === 'Cancelada'} className="text-xs text-red-600">
                                Cancelar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        {colunasOrdenadas.map(coluna => (
                          <React.Fragment key={coluna.id}>
                            {renderCell(coluna, mov)}
                          </React.Fragment>
                        ))}
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <div className="text-xs text-slate-600">
                Mostrando {startIndex + 1} a {Math.min(endIndex, sortedMovimentacoes.length)} de {sortedMovimentacoes.length} registros
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="h-7 text-xs"
                >
                  Anterior
                </Button>
                <span className="text-xs text-slate-600">
                  Página {currentPage} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="h-7 text-xs"
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-3 gap-2">
                {COLUNAS_DISPONIVEIS.map((coluna) => (
                  <label key={coluna.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-slate-50 p-1.5 rounded">
                    <input
                      type="checkbox"
                      checked={colunasVisiveis.includes(coluna.id)}
                      onChange={() => toggleColuna(coluna.id)}
                      className="rounded"
                    />
                    <span>{coluna.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs text-slate-600 font-semibold mb-2">Ordem (arraste para reordenar)</p>
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable droppableId="colunas">
                  {(provided) => (
                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-1">
                      {colunasOrdem.map((colunaId, index) => {
                        const coluna = COLUNAS_DISPONIVEIS.find(c => c.id === colunaId);
                        if (!coluna) return null;
                        
                        return (
                          <Draggable key={colunaId} draggableId={colunaId} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`flex items-center gap-2 p-2 border rounded text-xs ${
                                  snapshot.isDragging ? 'bg-emerald-50 border-emerald-300' : 'bg-white'
                                } ${!colunasVisiveis.includes(colunaId) ? 'opacity-50' : ''}`}
                              >
                                <GripVertical className="w-4 h-4 text-slate-400" />
                                <span className="flex-1">{coluna.label}</span>
                                {colunasVisiveis.includes(colunaId) && (
                                  <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-300">Visível</Badge>
                                )}
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </DragDropContext>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={() => setShowConfigColunas(false)} size="sm" className="h-7 text-xs">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>

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
                <span className="font-semibold text-slate-900">
                  {cancelProgress.current} de {cancelProgress.total}
                </span>
              </div>
              <Progress value={cancelProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-red-600">
                {cancelProgressPercentage}%
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}