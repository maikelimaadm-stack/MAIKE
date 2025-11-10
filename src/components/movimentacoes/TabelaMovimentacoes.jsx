
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Search, ArrowRightLeft, Settings, ArrowUpDown, ArrowUp, ArrowDown, User, FileText } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  // Handle potential string input with comma as decimal separator
  const numericValue = typeof numero === 'string' ? parseFloat(numero.replace('.', '').replace(',', '.')) : numero;
  if (isNaN(numericValue)) return "0,00";
  return numericValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatarMoeda = (valor) => {
  if (!valor && valor !== 0) return "R$ 0,00";
  // Ensure valor is a number before calling toLocaleString
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

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'data', label: 'Data/Hora', default: true, sortable: true },
  { id: 'tipo', label: 'Tipo', default: true, sortable: true },
  { id: 'tipo_detalhado', label: 'Tipo Detalhado', default: true, sortable: true },
  { id: 'tipo_documento', label: 'Tipo Doc', default: false, sortable: false },
  { id: 'documento', label: 'Nº Doc', default: false, sortable: false },
  { id: 'chave_documento', label: 'Chave NF-e', default: false, sortable: false },
  { id: 'serie_documento', label: 'Série', default: false, sortable: false },
  { id: 'produto', label: 'Produto', default: true, sortable: true },
  { id: 'produto_codigo', label: 'Cód. Produto', default: false, sortable: false },
  { id: 'produto_categoria', label: 'Categoria', default: false, sortable: false },
  { id: 'quantidade', label: 'Quantidade', default: true, sortable: true },
  { id: 'unidade', label: 'Unidade', default: false, sortable: false },
  { id: 'local_origem', label: 'Origem', default: true, sortable: false },
  { id: 'local_destino', label: 'Destino', default: true, sortable: false },
  { id: 'valor_unitario', label: 'Vlr. Unit.', default: false, sortable: true },
  { id: 'valor_total', label: 'Vlr. Total', default: false, sortable: true },
  { id: 'fornecedor', label: 'Fornecedor', default: false, sortable: true },
  { id: 'cliente', label: 'Cliente', default: false, sortable: false },
  { id: 'safra', label: 'Safra', default: false, sortable: false },
  { id: 'centro_custo', label: 'Centro Custo', default: false, sortable: false },
  { id: 'usuario', label: 'Usuário', default: false, sortable: false },
  { id: 'lancamento_origem', label: 'Lanc. Origem', default: false, sortable: false },
  { id: 'observacoes', label: 'Observações', default: false, sortable: false },
  { id: 'saldo_antes', label: 'Saldo Antes', default: false, sortable: false },
  { id: 'saldo_depois', label: 'Saldo Depois', default: false, sortable: false },
  { id: 'custo_medio_antes', label: 'Custo Médio Antes', default: false, sortable: false },
  { id: 'custo_medio_depois', label: 'Custo Médio Depois', default: false, sortable: false },
];

export default function TabelaMovimentacoes({ movimentacoes = [], onEdit, onCancel, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState('data');
  const [sortDirection, setSortDirection] = useState('desc');
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('colunas_movimentacoes');
      if (saved) {
        try {
          // Filter out any column IDs that no longer exist in COLUNAS_DISPONIVEIS
          const parsed = JSON.parse(saved);
          const validColumns = COLUNAS_DISPONIVEIS.map(c => c.id);
          return parsed.filter(id => validColumns.includes(id));
        } catch {
          return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
        }
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('colunas_movimentacoes', JSON.stringify(novasColunas));
      }
      
      return novasColunas;
    });
  };

  const handleSort = (field) => {
    // Only sort if the field is marked as sortable in COLUNAS_DISPONIVEIS
    const columnDef = COLUNAS_DISPONIVEIS.find(c => c.id === field);
    if (!columnDef || !columnDef.sortable) return;

    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    // Only show sort icon if the field is sortable
    const columnDef = COLUNAS_DISPONIVEIS.find(c => c.id === field);
    if (!columnDef || !columnDef.sortable) return null;

    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-green-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-green-600" />;
  };

  const filteredMovimentacoes = movimentacoes.filter(mov => {
    const searchLower = searchTerm.toLowerCase();
    return (
      mov.produto_nome?.toLowerCase().includes(searchLower) ||
      mov.produto_codigo?.toLowerCase().includes(searchLower) ||
      mov.produto_categoria?.toLowerCase().includes(searchLower) ||
      mov.tipo_movimentacao?.toLowerCase().includes(searchLower) ||
      mov.tipo_detalhado?.toLowerCase().includes(searchLower) ||
      mov.fornecedor_nome?.toLowerCase().includes(searchLower) ||
      mov.cliente_nome?.toLowerCase().includes(searchLower) ||
      mov.numero_documento?.toLowerCase().includes(searchLower) ||
      String(mov.numero_movimentacao)?.includes(searchLower) || // Ensure mov.numero_movimentacao is treated as string for search
      mov.usuario_responsavel?.toLowerCase().includes(searchLower) ||
      mov.tipo_documento?.toLowerCase().includes(searchLower) ||
      mov.centro_custo_nome?.toLowerCase().includes(searchLower) ||
      mov.safra_nome?.toLowerCase().includes(searchLower) ||
      mov.observacoes?.toLowerCase().includes(searchLower)
    );
  });

  const sortedMovimentacoes = [...filteredMovimentacoes].sort((a, b) => {
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
      case 'tipo_detalhado':
        aValue = a.tipo_detalhado;
        bValue = b.tipo_detalhado;
        break;
      case 'produto':
        aValue = a.produto_nome;
        bValue = b.produto_nome;
        break;
      case 'quantidade':
        aValue = a.quantidade;
        bValue = b.quantidade;
        break;
      case 'valor_unitario':
        aValue = a.valor_unitario || 0;
        bValue = b.valor_unitario || 0;
        break;
      case 'valor_total':
        aValue = a.valor_total || 0;
        bValue = b.valor_total || 0;
        break;
      case 'fornecedor':
        aValue = a.fornecedor_nome || '';
        bValue = b.fornecedor_nome || '';
        break;
      case 'cliente':
        aValue = a.cliente_nome || '';
        bValue = b.cliente_nome || '';
        break;
      case 'safra':
        aValue = a.safra_nome || '';
        bValue = b.safra_nome || '';
        break;
      case 'centro_custo':
        aValue = a.centro_custo_nome || '';
        bValue = b.centro_custo_nome || '';
        break;
      default:
        aValue = new Date(a.data_movimentacao).getTime();
        bValue = new Date(b.data_movimentacao).getTime();
        break;
    }

    if (typeof aValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
    if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const getTipoBadge = (tipo) => {
    const config = {
      'Entrada': 'bg-blue-100 text-blue-800 border-blue-300',
      'Saída': 'bg-orange-100 text-orange-800 border-orange-300',
      'Transferência': 'bg-purple-100 text-purple-800 border-purple-300',
      'Ajuste': 'bg-slate-100 text-slate-800 border-slate-300',
    };
    return config[tipo] || '';
  };

  const getOrigemDados = (mov) => {
    if (mov.chave_documento && mov.chave_documento.length === 44) {
      return <Badge className="bg-green-100 text-green-800 border-green-300 gap-1"><FileText className="w-3 h-3" />XML</Badge>;
    }
    return <Badge variant="outline" className="gap-1"><User className="w-3 h-3" />Manual</Badge>;
  };

  return (
    <Card className="shadow-xl border-slate-200 bg-white">
      <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <CardTitle className="flex items-center gap-3 text-slate-900">
            <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
              <ArrowRightLeft className="w-5 h-5 text-white" />
            </div>
            Movimentações de Estoque
            <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
              {sortedMovimentacoes.length} {sortedMovimentacoes.length === 1 ? 'movimentação' : 'movimentações'}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-80">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Buscar por produto, tipo, documento, usuário..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 border-slate-300 focus:border-green-500 focus:ring-green-500"
              />
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" title="Configurar Colunas" className="border-slate-300">
                  <Settings className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
                <DropdownMenuLabel>Colunas Visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {COLUNAS_DISPONIVEIS.map((coluna) => (
                  <DropdownMenuCheckboxItem
                    key={coluna.id}
                    checked={colunasVisiveis.includes(coluna.id)}
                    onCheckedChange={() => toggleColuna(coluna.id)}
                  >
                    {coluna.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                {colunasVisiveis.includes('numero') && (
                  <TableHead 
                    className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('numero')}
                  >
                    <div className="flex items-center">Nº {getSortIcon('numero')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('data') && (
                  <TableHead 
                    className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('data')}
                  >
                    <div className="flex items-center">Data/Hora {getSortIcon('data')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('tipo') && (
                  <TableHead 
                    className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('tipo')}
                  >
                    <div className="flex items-center">Tipo {getSortIcon('tipo')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('tipo_detalhado') && (
                  <TableHead 
                    className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('tipo_detalhado')}
                  >
                    <div className="flex items-center">Tipo Detalhado {getSortIcon('tipo_detalhado')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('tipo_documento') && <TableHead className="font-semibold text-slate-700">Tipo Doc</TableHead>}
                {colunasVisiveis.includes('documento') && <TableHead className="font-semibold text-slate-700">Nº Doc</TableHead>}
                {colunasVisiveis.includes('chave_documento') && <TableHead className="font-semibold text-slate-700">Chave NF-e</TableHead>}
                {colunasVisiveis.includes('serie_documento') && <TableHead className="font-semibold text-slate-700">Série</TableHead>}
                {colunasVisiveis.includes('produto') && (
                  <TableHead 
                    className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('produto')}
                  >
                    <div className="flex items-center">Produto {getSortIcon('produto')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('produto_codigo') && <TableHead className="font-semibold text-slate-700">Cód. Produto</TableHead>}
                {colunasVisiveis.includes('produto_categoria') && <TableHead className="font-semibold text-slate-700">Categoria</TableHead>}
                {colunasVisiveis.includes('quantidade') && (
                  <TableHead 
                    className="font-semibold text-slate-700 text-right cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('quantidade')}
                  >
                    <div className="flex items-center justify-end">Quantidade {getSortIcon('quantidade')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('unidade') && <TableHead className="font-semibold text-slate-700">Unidade</TableHead>}
                {colunasVisiveis.includes('local_origem') && <TableHead className="font-semibold text-slate-700">Origem</TableHead>}
                {colunasVisiveis.includes('local_destino') && <TableHead className="font-semibold text-slate-700">Destino</TableHead>}
                {colunasVisiveis.includes('valor_unitario') && (
                  <TableHead 
                    className="font-semibold text-slate-700 text-right cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('valor_unitario')}
                  >
                    <div className="flex items-center justify-end">Vlr. Unit. {getSortIcon('valor_unitario')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('valor_total') && (
                  <TableHead 
                    className="font-semibold text-slate-700 text-right cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('valor_total')}
                  >
                    <div className="flex items-center justify-end">Vlr. Total {getSortIcon('valor_total')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('fornecedor') && (
                  <TableHead 
                    className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                    onClick={() => handleSort('fornecedor')}
                  >
                    <div className="flex items-center">Fornecedor {getSortIcon('fornecedor')}</div>
                  </TableHead>
                )}
                {colunasVisiveis.includes('cliente') && <TableHead className="font-semibold text-slate-700">Cliente</TableHead>}
                {colunasVisiveis.includes('safra') && <TableHead className="font-semibold text-slate-700">Safra</TableHead>}
                {colunasVisiveis.includes('centro_custo') && <TableHead className="font-semibold text-slate-700">Centro Custo</TableHead>}
                {colunasVisiveis.includes('usuario') && <TableHead className="font-semibold text-slate-700">Usuário</TableHead>}
                {colunasVisiveis.includes('lancamento_origem') && <TableHead className="font-semibold text-slate-700">Lanc. Origem</TableHead>}
                {colunasVisiveis.includes('observacoes') && <TableHead className="font-semibold text-slate-700">Observações</TableHead>}
                {colunasVisiveis.includes('saldo_antes') && <TableHead className="font-semibold text-slate-700 text-right">Saldo Antes</TableHead>}
                {colunasVisiveis.includes('saldo_depois') && <TableHead className="font-semibold text-slate-700 text-right">Saldo Depois</TableHead>}
                {colunasVisiveis.includes('custo_medio_antes') && <TableHead className="font-semibold text-slate-700 text-right">Custo Méd. Antes</TableHead>}
                {colunasVisiveis.includes('custo_medio_depois') && <TableHead className="font-semibold text-slate-700 text-right">Custo Méd. Depois</TableHead>}
                <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence mode="wait">
                {isLoading ? (
                  Array(5).fill(0).map((_, i) => (
                    <TableRow key={i} className="animate-pulse">
                      {colunasVisiveis.map((_, idx) => (
                        <TableCell key={idx}><div className="h-4 bg-slate-200 rounded w-full"></div></TableCell>
                      ))}
                      <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                    </TableRow>
                  ))
                ) : sortedMovimentacoes.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={colunasVisiveis.length + 1} className="text-center py-12">
                      <div className="flex flex-col items-center gap-3 text-slate-400">
                        <ArrowRightLeft className="w-12 h-12" />
                        <p className="text-lg font-medium">Nenhuma movimentação encontrada</p>
                        <p className="text-sm">
                          {searchTerm ? 'Tente ajustar sua busca' : 'Comece registrando uma nova movimentação'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedMovimentacoes.map((mov) => (
                    <ContextMenu key={mov.id}>
                      <ContextMenuTrigger asChild>
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                        >
                          {colunasVisiveis.includes('numero') && (
                            <TableCell className="font-bold text-slate-900">{mov.numero_movimentacao || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('data') && (
                            <TableCell className="text-slate-700 text-xs">{formatarData(mov.data_movimentacao)}</TableCell>
                          )}
                          {colunasVisiveis.includes('tipo') && (
                            <TableCell>
                              <Badge className={`${getTipoBadge(mov.tipo_movimentacao)} border`}>
                                {mov.tipo_movimentacao}
                              </Badge>
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('tipo_detalhado') && (
                            <TableCell className="text-xs text-slate-700">{mov.tipo_detalhado || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('tipo_documento') && (
                            <TableCell className="text-xs text-slate-700">{mov.tipo_documento || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('documento') && (
                            <TableCell className="font-mono text-xs">{mov.numero_documento || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('chave_documento') && (
                            <TableCell className="font-mono text-xs max-w-[150px] truncate" title={mov.chave_documento}>
                                {mov.chave_documento || '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('serie_documento') && (
                            <TableCell className="text-xs">{mov.serie_documento || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('produto') && (
                            <TableCell className="font-semibold text-slate-900">{mov.produto_nome}</TableCell>
                          )}
                          {colunasVisiveis.includes('produto_codigo') && (
                            <TableCell className="font-mono text-xs">{mov.produto_codigo || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('produto_categoria') && (
                            <TableCell className="text-xs">{mov.produto_categoria || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('quantidade') && (
                            <TableCell className="text-right font-mono font-bold text-green-700">
                              {formatarNumero(mov.quantidade)}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('unidade') && (
                            <TableCell className="text-xs">{mov.unidade_medida || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('local_origem') && (
                            <TableCell className="text-slate-700 text-xs max-w-[120px] truncate" title={mov.local_origem || mov.local_estoque_origem}>
                                {mov.local_origem || mov.local_estoque_origem || '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('local_destino') && (
                            <TableCell className="text-slate-700 text-xs max-w-[120px] truncate" title={mov.local_destino || mov.local_estoque_destino}>
                                {mov.local_destino || mov.local_estoque_destino || '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('valor_unitario') && (
                            <TableCell className="text-right font-mono text-slate-700">
                              {formatarMoeda(mov.valor_unitario)}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('valor_total') && (
                            <TableCell className="text-right font-mono font-bold text-green-700">
                              {formatarMoeda(mov.valor_total)}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('fornecedor') && (
                            <TableCell className="text-slate-700 text-xs max-w-[120px] truncate" title={mov.fornecedor_nome}>
                                {mov.fornecedor_nome || '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('cliente') && (
                            <TableCell className="text-slate-700 text-xs max-w-[120px] truncate" title={mov.cliente_nome}>
                                {mov.cliente_nome || '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('safra') && (
                            <TableCell className="text-slate-700 text-xs">{mov.safra_nome || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('centro_custo') && (
                            <TableCell className="text-slate-700 text-xs">{mov.centro_custo_nome || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('usuario') && (
                            <TableCell className="text-slate-600 text-xs">{mov.responsavel || mov.usuario_responsavel || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('lancamento_origem') && (
                            <TableCell className="text-xs">
                              {mov.lancamento_origem_id ? (
                                <Badge variant="outline" className="bg-purple-50 text-purple-700">Financeiro</Badge>
                              ) : '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('observacoes') && (
                            <TableCell className="text-slate-600 text-xs max-w-[150px] truncate" title={mov.observacoes}>
                              {mov.observacoes || '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('saldo_antes') && (
                            <TableCell className="text-right font-mono text-xs">{formatarNumero(mov.saldo_antes)}</TableCell>
                          )}
                          {colunasVisiveis.includes('saldo_depois') && (
                            <TableCell className="text-right font-mono text-xs font-bold">{formatarNumero(mov.saldo_depois)}</TableCell>
                          )}
                          {colunasVisiveis.includes('custo_medio_antes') && (
                            <TableCell className="text-right font-mono text-xs">{formatarMoeda(mov.custo_medio_antes)}</TableCell>
                          )}
                          {colunasVisiveis.includes('custo_medio_depois') && (
                            <TableCell className="text-right font-mono text-xs font-bold">{formatarMoeda(mov.custo_medio_depois)}</TableCell>
                          )}
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onEdit && onEdit(mov)}
                                className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                title="Editar"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onCancel && onCancel(mov.id)}
                                className="hover:bg-red-50 hover:text-red-700 transition-colors"
                                title="Cancelar"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </motion.tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => onEdit && onEdit(mov)}>
                          <Edit className="w-4 h-4 mr-2 text-blue-600" />
                          Editar
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onCancel && onCancel(mov.id)}>
                          <Trash2 className="w-4 h-4 mr-2 text-red-600" />
                          Cancelar
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))
                )}
              </AnimatePresence>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
