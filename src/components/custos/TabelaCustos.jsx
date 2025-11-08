
import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Trash2, Printer, Search, DollarSign, Settings, CheckSquare, Loader2, ArrowUpDown, ArrowUp, ArrowDown, Truck, Eye } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const formatarData = (dataString) => {
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
  { id: 'fornecedor', label: 'Fornecedor', default: true, sortable: true },
  { id: 'produto', label: 'Produto', default: true, sortable: true },
  { id: 'quantidade', label: 'Qtd Comprada', default: true, sortable: true },
  { id: 'quantidade_entregue', label: 'Qtd Entregue', default: true, sortable: true },
  { id: 'quantidade_restante', label: 'Qtd Restante', default: true, sortable: true },
  { id: 'unidade', label: 'Unidade', default: true, sortable: false },
  { id: 'valor_unitario', label: 'Valor Unit.', default: true, sortable: true },
  { id: 'valor_total', label: 'Valor Total', default: true, sortable: true },
  { id: 'prazo_entrega', label: 'Prazo Entrega', default: true, sortable: true },
  { id: 'data_entrega', label: 'Data Entrega', default: false, sortable: true },
  { id: 'status', label: 'Status', default: true, sortable: true },
  { id: 'forma_pagamento', label: 'Forma Pagamento', default: false, sortable: false },
  { id: 'observacoes', label: 'Observações', default: false, sortable: false },
];

export default function TabelaCustos({ custos, fornecedores = [], onEdit, onDelete, onPrint, onLancarEntrega, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('colunas_custos');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
        }
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });
  
  const [selectedItems, setSelectedItems] = useState([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [fornecedorDetalhes, setFornecedorDetalhes] = useState(null);
  const [historicoEntregas, setHistoricoEntregas] = useState(null);
  const [produtoSelecionado, setProdutoSelecionado] = useState(null);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('colunas_custos', JSON.stringify(novasColunas));
      }
      
      return novasColunas;
    });
  };

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-50" />;
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 ml-1 text-green-600" />
      : <ArrowDown className="w-3 h-3 ml-1 text-green-600" />;
  };

  const toggleSelectAll = () => {
    if (selectedItems.length === filteredCustos.length && filteredCustos.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(filteredCustos.map(c => c.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} lançamento(s) selecionado(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
      setIsDeletingBulk(true);
      setDeleteProgress({ current: 0, total: selectedItems.length });
      
      let deleted = 0;
      for (const id of selectedItems) {
        try {
          await onDelete(id, true);
          deleted++;
          setDeleteProgress({ current: deleted, total: selectedItems.length });
        } catch (error) {
          console.error('Erro ao excluir:', error);
        }
      }
      
      setTimeout(() => {
        setIsDeletingBulk(false);
        setSelectedItems([]);
        setShowBulkActions(false);
      }, 500);
    }
  };

  const handleBulkPrint = () => {
    selectedItems.forEach(id => {
      const custo = custos.find(c => c.id === id);
      if (custo) onPrint(custo);
    });
    setShowBulkActions(false);
  };

  const handleVerFornecedor = (custoId) => {
    const custo = custos.find(c => c.id === custoId);
    if (custo) {
      const fornecedor = fornecedores.find(f => f.id === custo.fornecedor_id);
      setFornecedorDetalhes(fornecedor);
    }
  };

  const handleVerHistoricoEntregas = async (custoId) => {
    const custo = custos.find(c => c.id === custoId);
    if (custo) {
      try {
        const todasEntregas = await base44.entities.HistoricoEntrega.list('-created_date');
        const entregasDoProduto = todasEntregas.filter(e => 
          e.custo_safra_id === custo.id && 
          e.empresa_id === empresaSelecionadaId
        );
        
        setHistoricoEntregas(entregasDoProduto);
        setProdutoSelecionado(custo);
      } catch (error) {
        console.error('Erro ao buscar histórico:', error);
        toast.error('Erro ao carregar histórico de entregas');
      }
    }
  };

  const filteredCustos = custos.filter(custo => {
    const searchLower = searchTerm.toLowerCase();
    return (
      custo.fornecedor_nome?.toLowerCase().includes(searchLower) ||
      custo.produto_nome?.toLowerCase().includes(searchLower) ||
      custo.status_entrega?.toLowerCase().includes(searchLower) ||
      custo.forma_pagamento?.toLowerCase().includes(searchLower)
    );
  });

  const sortedCustos = [...filteredCustos].sort((a, b) => {
    if (!sortField) return 0;

    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_lancamento) || 0;
        bValue = parseInt(b.numero_lancamento) || 0;
        break;
      case 'fornecedor':
        aValue = a.fornecedor_nome;
        bValue = b.fornecedor_nome;
        break;
      case 'produto':
        aValue = a.produto_nome;
        bValue = b.produto_nome;
        break;
      case 'quantidade':
        aValue = a.quantidade;
        bValue = b.quantidade;
        break;
      case 'quantidade_entregue':
        aValue = a.quantidade_entregue || 0;
        bValue = b.quantidade_entregue || 0;
        break;
      case 'quantidade_restante':
        aValue = a.quantidade - (a.quantidade_entregue || 0);
        bValue = b.quantidade - (b.quantidade_entregue || 0);
        break;
      case 'valor_unitario':
        aValue = a.valor_unitario;
        bValue = b.valor_unitario;
        break;
      case 'valor_total':
        aValue = a.valor_total;
        bValue = b.valor_total;
        break;
      case 'prazo_entrega':
        aValue = a.prazo_entrega ? new Date(a.prazo_entrega).getTime() : 0;
        bValue = b.prazo_entrega ? new Date(b.prazo_entrega).getTime() : 0;
        break;
      case 'data_entrega':
        aValue = a.data_entrega ? new Date(a.data_entrega).getTime() : 0;
        bValue = b.data_entrega ? new Date(b.data_entrega).getTime() : 0;
        break;
      case 'status':
        aValue = a.status_entrega;
        bValue = b.status_entrega;
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

  const getStatusBadge = (status) => {
    const config = {
      'Pendente': 'bg-orange-100 text-orange-800 border-orange-300',
      'Em Trânsito': 'bg-blue-100 text-blue-800 border-blue-300',
      'Entregue': 'bg-green-100 text-green-800 border-green-300',
      'Cancelado': 'bg-red-100 text-red-800 border-red-300',
    };
    return config[status] || config['Pendente'];
  };

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  return (
    <>
      <Card className="shadow-xl border-slate-200 bg-white">
        <CardHeader className="bg-gradient-to-r from-slate-50 to-green-50 border-b border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <CardTitle className="flex items-center gap-3 text-slate-900">
              <div className="w-10 h-10 bg-gradient-to-br from-slate-600 to-slate-700 rounded-xl flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-white" />
              </div>
              Lançamentos de Custos
              <Badge variant="secondary" className="ml-2 bg-green-100 text-green-700 border-green-300">
                {filteredCustos.length} {filteredCustos.length === 1 ? 'lançamento' : 'lançamentos'}
              </Badge>
              {selectedItems.length > 0 && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-300">
                  {selectedItems.length} selecionados
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-3 w-full md:w-auto">
              {selectedItems.length > 0 && (
                <DropdownMenu open={showBulkActions} onOpenChange={setShowBulkActions}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2 border-blue-300 text-blue-700">
                      <CheckSquare className="w-4 h-4" />
                      Ações em Massa
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Ações para {selectedItems.length} itens</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem onClick={handleBulkPrint}>
                      <Printer className="w-4 h-4 mr-2" />
                      Imprimir Todos
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem onClick={handleBulkDelete} className="text-red-600">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Excluir Todos
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              
              <div className="relative flex-1 md:w-80">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  placeholder="Buscar por fornecedor, produto, status..."
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
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedItems.length === sortedCustos.length && sortedCustos.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  {colunasVisiveis.includes('numero') && (
                    <TableHead 
                      className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('numero')}
                    >
                      <div className="flex items-center">
                        Nº
                        {getSortIcon('numero')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('fornecedor') && (
                    <TableHead 
                      className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('fornecedor')}
                    >
                      <div className="flex items-center">
                        Fornecedor
                        {getSortIcon('fornecedor')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('produto') && (
                    <TableHead 
                      className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('produto')}
                    >
                      <div className="flex items-center">
                        Produto
                        {getSortIcon('produto')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('quantidade') && (
                    <TableHead 
                      className="font-semibold text-slate-700 text-right cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('quantidade')}
                    >
                      <div className="flex items-center justify-end">
                        Qtd Comprada
                        {getSortIcon('quantidade')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('quantidade_entregue') && (
                    <TableHead 
                      className="font-semibold text-slate-700 text-right cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('quantidade_entregue')}
                    >
                      <div className="flex items-center justify-end">
                        Qtd Entregue
                        {getSortIcon('quantidade_entregue')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('quantidade_restante') && (
                    <TableHead 
                      className="font-semibold text-slate-700 text-right cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('quantidade_restante')}
                    >
                      <div className="flex items-center justify-end">
                        Qtd Restante
                        {getSortIcon('quantidade_restante')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('unidade') && (
                    <TableHead className="font-semibold text-slate-700">UN</TableHead>
                  )}
                  {colunasVisiveis.includes('valor_unitario') && (
                    <TableHead 
                      className="font-semibold text-slate-700 text-right cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('valor_unitario')}
                    >
                      <div className="flex items-center justify-end">
                        Valor Unit.
                        {getSortIcon('valor_unitario')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('valor_total') && (
                    <TableHead 
                      className="font-semibold text-slate-700 text-right cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('valor_total')}
                    >
                      <div className="flex items-center justify-end">
                        Valor Total
                        {getSortIcon('valor_total')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('prazo_entrega') && (
                    <TableHead 
                      className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('prazo_entrega')}
                    >
                      <div className="flex items-center">
                        Prazo Entrega
                        {getSortIcon('prazo_entrega')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('data_entrega') && (
                    <TableHead 
                      className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('data_entrega')}
                    >
                      <div className="flex items-center">
                        Data Entrega
                        {getSortIcon('data_entrega')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('status') && (
                    <TableHead 
                      className="font-semibold text-slate-700 cursor-pointer hover:bg-slate-100"
                      onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center">
                        Status
                        {getSortIcon('status')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('forma_pagamento') && (
                    <TableHead className="font-semibold text-slate-700">Forma Pgto.</TableHead>
                  )}
                  {colunasVisiveis.includes('observacoes') && (
                    <TableHead className="font-semibold text-slate-700">Observações</TableHead>
                  )}
                  <TableHead className="font-semibold text-slate-700 text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence mode="wait">
                  {isLoading ? (
                    Array(5).fill(0).map((_, i) => (
                      <TableRow key={i} className="animate-pulse">
                        <TableCell><div className="h-4 bg-slate-200 rounded w-4"></div></TableCell>
                        {colunasVisiveis.map((col, idx) => (
                          <TableCell key={idx}><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                        ))}
                        <TableCell><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                      </TableRow>
                    ))
                  ) : sortedCustos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasVisiveis.length + 2} className="text-center py-12">
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                          <DollarSign className="w-12 h-12" />
                          <p className="text-lg font-medium">Nenhum lançamento encontrado</p>
                          <p className="text-sm">
                            {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando um novo lançamento'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedCustos.map((custo) => {
                      const qtdEntregue = custo.quantidade_entregue || 0;
                      const qtdRestante = custo.quantidade - qtdEntregue;
                      const percentualEntregue = (qtdEntregue / custo.quantidade) * 100;

                      return (
                        <motion.tr
                          key={custo.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedItems.includes(custo.id)}
                              onCheckedChange={() => toggleSelectItem(custo.id)}
                            />
                          </TableCell>
                          {colunasVisiveis.includes('numero') && (
                            <TableCell className="font-bold text-slate-900">
                              {custo.numero_lancamento || '-'}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('fornecedor') && (
                            <TableCell className="font-semibold text-slate-900">
                              <div className="flex items-center gap-2">
                                {custo.fornecedor_nome}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handleVerFornecedor(custo.id)}
                                  title="Ver detalhes do fornecedor"
                                >
                                  <Eye className="w-3 h-3" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('produto') && (
                            <TableCell className="text-slate-700">
                              <div className="flex items-center gap-2">
                                {custo.produto_nome}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handleVerHistoricoEntregas(custo.id)}
                                  title="Ver histórico de entregas"
                                >
                                  <Eye className="w-3 h-3 text-green-600" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('quantidade') && (
                            <TableCell className="text-right font-mono text-slate-700">
                              {formatarNumero(custo.quantidade)}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('quantidade_entregue') && (
                            <TableCell className="text-right">
                              <div className="space-y-1">
                                <div className="font-mono text-blue-700 font-semibold">
                                  {formatarNumero(qtdEntregue)}
                                </div>
                                {qtdEntregue > 0 && (
                                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                                    <div 
                                      className="bg-blue-600 h-1.5 rounded-full" 
                                      style={{ width: `${percentualEntregue}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('quantidade_restante') && (
                            <TableCell className="text-right font-mono font-bold text-orange-700">
                              {formatarNumero(qtdRestante)}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('unidade') && (
                            <TableCell className="text-slate-700">{custo.unidade_medida}</TableCell>
                          )}
                          {colunasVisiveis.includes('valor_unitario') && (
                            <TableCell className="text-right font-mono text-slate-700">
                              R$ {formatarNumero(custo.valor_unitario)}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('valor_total') && (
                            <TableCell className="text-right font-mono font-bold text-green-700">
                              R$ {formatarNumero(custo.valor_total)}
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('prazo_entrega') && (
                            <TableCell className="text-slate-700">{formatarData(custo.prazo_entrega)}</TableCell>
                          )}
                          {colunasVisiveis.includes('data_entrega') && (
                            <TableCell className="text-slate-700">{formatarData(custo.data_entrega)}</TableCell>
                          )}
                          {colunasVisiveis.includes('status') && (
                            <TableCell>
                              <Badge className={`${getStatusBadge(custo.status_entrega)} border`}>
                                {custo.status_entrega}
                              </Badge>
                            </TableCell>
                          )}
                          {colunasVisiveis.includes('forma_pagamento') && (
                            <TableCell className="text-slate-600">{custo.forma_pagamento || '-'}</TableCell>
                          )}
                          {colunasVisiveis.includes('observacoes') && (
                            <TableCell className="text-slate-600 max-w-xs truncate">
                              {custo.observacoes || '-'}
                            </TableCell>
                          )}
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onLancarEntrega(custo)}
                                className="hover:bg-orange-50 hover:text-orange-700 transition-colors"
                                title="Lançar Entrega"
                              >
                                <Truck className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onEdit(custo)}
                                className="hover:bg-blue-50 hover:text-blue-700 transition-colors"
                                title="Editar"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onPrint(custo)}
                                className="hover:bg-green-50 hover:text-green-700 transition-colors"
                                title="Imprimir"
                              >
                                <Printer className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => onDelete(custo.id)}
                                className="hover:bg-red-50 hover:text-red-700 transition-colors"
                                title="Excluir"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </motion.tr>
                      );
                    })
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!fornecedorDetalhes} onOpenChange={() => setFornecedorDetalhes(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900">
              Detalhes do Fornecedor
            </DialogTitle>
          </DialogHeader>
          {fornecedorDetalhes && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Nome/Razão Social</p>
                  <p className="font-semibold text-slate-900">{fornecedorDetalhes.nome}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Tipo</p>
                  <p className="font-semibold text-slate-900">Pessoa {fornecedorDetalhes.tipo_pessoa}</p>
                </div>
              </div>

              {fornecedorDetalhes.tipo_pessoa === 'Física' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-600">CPF</p>
                    <p className="font-mono font-semibold text-slate-900">{fornecedorDetalhes.cpf || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">RG</p>
                    <p className="font-mono font-semibold text-slate-900">{fornecedorDetalhes.rg || '-'}</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-slate-600">CNPJ</p>
                    <p className="font-mono font-semibold text-slate-900">{fornecedorDetalhes.cnpj || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-slate-600">Inscrição Estadual</p>
                    <p className="font-mono font-semibold text-slate-900">{fornecedorDetalhes.inscricao_estadual || '-'}</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Telefone</p>
                  <p className="font-semibold text-slate-900">{fornecedorDetalhes.telefone || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Email</p>
                  <p className="font-semibold text-slate-900">{fornecedorDetalhes.email || '-'}</p>
                </div>
              </div>

              <div>
                <p className="text-sm text-slate-600">Endereço</p>
                <p className="font-semibold text-slate-900">
                  {fornecedorDetalhes.endereco || '-'}
                  {fornecedorDetalhes.cidade && `, ${fornecedorDetalhes.cidade}`}
                  {fornecedorDetalhes.estado && `-${fornecedorDetalhes.estado}`}
                  {fornecedorDetalhes.cep && ` - CEP: ${fornecedorDetalhes.cep}`}
                </p>
              </div>

              {fornecedorDetalhes.observacoes && (
                <div>
                  <p className="text-sm text-slate-600">Observações</p>
                  <p className="font-semibold text-slate-900">{fornecedorDetalhes.observacoes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!historicoEntregas} onOpenChange={() => { setHistoricoEntregas(null); setProdutoSelecionado(null); }}>
        <DialogContent className="sm:max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-slate-900">
              Histórico de Entregas - {produtoSelecionado?.produto_nome}
            </DialogTitle>
            <DialogDescription>
              Fornecedor: {produtoSelecionado?.fornecedor_nome}
            </DialogDescription>
          </DialogHeader>
          {historicoEntregas && (
            <div className="flex-1 overflow-auto">
              {historicoEntregas.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <Truck className="w-12 h-12 mx-auto mb-3" />
                  <p>Nenhuma entrega registrada ainda</p>
                </div>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Quantidade</TableHead>
                      <TableHead>Unidade</TableHead>
                      <TableHead>Nº NF-e</TableHead>
                      <TableHead>Chave NF-e</TableHead>
                      <TableHead>Obs. NF-e</TableHead>
                      <TableHead>Observações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historicoEntregas.map((entrega, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-semibold">{formatarData(entrega.data_entrega)}</TableCell>
                        <TableCell className="text-right font-bold text-green-700">{formatarNumero(entrega.quantidade_entregue)}</TableCell>
                        <TableCell>{entrega.unidade_medida}</TableCell>
                        <TableCell className="font-mono text-xs">{entrega.numero_nfe || '-'}</TableCell>
                        <TableCell className="font-mono text-xs truncate max-w-[150px]" title={entrega.chave_nfe}>{entrega.chave_nfe || '-'}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={entrega.observacoes_nfe}>{entrega.observacoes_nfe || '-'}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={entrega.observacoes}>{entrega.observacoes || '-'}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-slate-50 font-bold">
                      <TableCell>TOTAL</TableCell>
                      <TableCell className="text-right text-green-700">
                        {formatarNumero(historicoEntregas.reduce((sum, e) => sum + (e.quantidade_entregue || 0), 0))}
                      </TableCell>
                      <TableCell colSpan={5}>{historicoEntregas.length} entrega(s)</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isDeletingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-red-600" />
              Excluindo Lançamentos
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto excluímos os lançamentos selecionados...
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Progresso</span>
                <span className="font-semibold text-slate-900">
                  {deleteProgress.current} de {deleteProgress.total}
                </span>
              </div>
              <Progress value={deleteProgressPercentage} className="h-3" />
              <p className="text-center text-sm font-medium text-red-600">
                {deleteProgressPercentage}%
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
