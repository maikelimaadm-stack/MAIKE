import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreVertical, Search, Settings, ArrowUpDown, ArrowUp, ArrowDown, Loader2, GripVertical, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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

const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'nome', label: 'Nome do Produto', default: true, sortable: true },
  { id: 'codigo', label: 'Código Interno', default: true, sortable: true },
  { id: 'categoria', label: 'Categoria', default: true, sortable: true },
  { id: 'unidade', label: 'Unidade', default: true, sortable: true },
  { id: 'preco_custo', label: 'Preço Custo', default: true, sortable: true },
  { id: 'preco_venda', label: 'Preço Venda', default: true, sortable: true },
  { id: 'estoque', label: 'Estoque Atual', default: true, sortable: true },
  { id: 'estoque_min', label: 'Estoque Mínimo', default: false, sortable: true },
  { id: 'barras', label: 'Cód. Barras', default: false, sortable: true },
];

const ITEMS_PER_PAGE = 50;

export default function TabelaProdutos({ produtos = [], onEdit, onDelete, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_produtos');
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
    const saved = localStorage.getItem('colunas_ordem_produtos');
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
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      localStorage.setItem('colunas_produtos', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_produtos', JSON.stringify(items));
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

  const filteredProdutos = produtos.filter(produto => {
    const searchLower = searchTerm.toLowerCase();
    return (
      produto.nome_produto?.toLowerCase().includes(searchLower) ||
      produto.categoria?.toLowerCase().includes(searchLower) ||
      produto.codigo_interno?.toLowerCase().includes(searchLower) ||
      produto.codigo_barras?.includes(searchLower) ||
      produto.numero_produto?.includes(searchLower)
    );
  });

  const sortedProdutos = [...filteredProdutos].sort((a, b) => {
    if (!sortField) return 0;

    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_produto) || 0;
        bValue = parseInt(b.numero_produto) || 0;
        break;
      case 'nome':
        aValue = a.nome_produto;
        bValue = b.nome_produto;
        break;
      case 'codigo':
        aValue = a.codigo_interno || '';
        bValue = b.codigo_interno || '';
        break;
      case 'categoria':
        aValue = a.categoria || '';
        bValue = b.categoria || '';
        break;
      case 'unidade':
        aValue = a.unidade_medida || '';
        bValue = b.unidade_medida || '';
        break;
      case 'preco_custo':
        aValue = a.preco_custo || 0;
        bValue = b.preco_custo || 0;
        break;
      case 'preco_venda':
        aValue = a.preco_venda || 0;
        bValue = b.preco_venda || 0;
        break;
      case 'estoque':
        aValue = a.estoque_atual || 0;
        bValue = b.estoque_atual || 0;
        break;
      case 'estoque_min':
        aValue = a.estoque_minimo || 0;
        bValue = b.estoque_minimo || 0;
        break;
      case 'barras':
        aValue = a.codigo_barras || '';
        bValue = b.codigo_barras || '';
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

  const totalPages = Math.ceil(sortedProdutos.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedProdutos = sortedProdutos.slice(startIndex, endIndex);

  const toggleSelectAll = () => {
    if (selectedItems.length === paginatedProdutos.length && paginatedProdutos.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedProdutos.map(p => p.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} produto(s) selecionado(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
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
      }, 500);
    }
  };

  const handleBulkPrint = () => {
    selectedItems.forEach(id => {
      const produto = produtos.find(p => p.id === id);
      if (produto) onPrint(produto);
    });
  };

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  const renderCell = (coluna, produto) => {
    const estoqueAbaixoMinimo = (produto.estoque_atual || 0) <= (produto.estoque_minimo || 0);
    
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="text-xs border-r border-slate-200">{produto.numero_produto || '-'}</TableCell>;
      case 'nome':
        return <TableCell className="text-xs font-semibold border-r border-slate-200">{produto.nome_produto}</TableCell>;
      case 'codigo':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{produto.codigo_interno || '-'}</TableCell>;
      case 'categoria':
        return (
          <TableCell className="border-r border-slate-200">
            <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 text-xs">
              {produto.categoria || 'Sem categoria'}
            </Badge>
          </TableCell>
        );
      case 'unidade':
        return <TableCell className="text-xs border-r border-slate-200">{produto.unidade_medida}</TableCell>;
      case 'preco_custo':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">R$ {formatarNumero(produto.preco_custo || 0)}</TableCell>;
      case 'preco_venda':
        return <TableCell className="text-right font-mono text-xs font-semibold text-green-700 border-r border-slate-200">R$ {formatarNumero(produto.preco_venda || 0)}</TableCell>;
      case 'estoque':
        return (
          <TableCell className="text-right border-r border-slate-200">
            <div className="flex items-center justify-end gap-1">
              {estoqueAbaixoMinimo && <AlertTriangle className="w-3 h-3 text-orange-600" />}
              <span className={`text-xs font-bold ${estoqueAbaixoMinimo ? 'text-orange-700' : 'text-slate-900'}`}>
                {formatarNumero(produto.estoque_atual || 0)}
              </span>
            </div>
          </TableCell>
        );
      case 'estoque_min':
        return <TableCell className="text-right text-xs border-r border-slate-200">{formatarNumero(produto.estoque_minimo || 0)}</TableCell>;
      case 'barras':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{produto.codigo_barras || '-'}</TableCell>;
      default:
        return <TableCell className="text-xs border-r border-slate-200">-</TableCell>;
    }
  };

  return (
    <>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Produtos ({produtos.length})
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
                      <DropdownMenuItem onClick={handleBulkPrint} className="text-xs">
                        Imprimir Todos
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleBulkDelete} className="text-xs text-red-600">
                        Excluir Todos
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
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => setShowConfigColunas(true)}>
                <Settings className="w-3.5 h-3.5" />
                Colunas
              </Button>
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
                      checked={selectedItems.length === paginatedProdutos.length && paginatedProdutos.length > 0}
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
                  ) : paginatedProdutos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhum produto</TableCell>
                    </TableRow>
                  ) : (
                    paginatedProdutos.map((produto) => {
                      const estoqueAbaixoMinimo = (produto.estoque_atual || 0) <= (produto.estoque_minimo || 0);
                      
                      return (
                        <motion.tr 
                          key={produto.id}
                          initial={{ opacity: 0 }} 
                          animate={{ opacity: 1 }} 
                          exit={{ opacity: 0 }} 
                          className={`hover:bg-slate-50 transition-colors border-b ${estoqueAbaixoMinimo ? 'bg-orange-50' : ''}`}
                        >
                          <TableCell className="border-r border-slate-200">
                            <Checkbox
                              checked={selectedItems.includes(produto.id)}
                              onCheckedChange={() => toggleSelectItem(produto.id)}
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
                                <DropdownMenuItem onClick={() => onEdit(produto)} className="text-xs">
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onPrint(produto)} className="text-xs">
                                  Imprimir Ficha
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => onDelete(produto.id)} className="text-xs text-red-600">
                                  Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          {colunasOrdenadas.map(coluna => (
                            <React.Fragment key={coluna.id}>
                              {renderCell(coluna, produto)}
                            </React.Fragment>
                          ))}
                        </motion.tr>
                      );
                    })
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200">
              <div className="text-xs text-slate-600">
                Mostrando {startIndex + 1} a {Math.min(endIndex, sortedProdutos.length)} de {sortedProdutos.length} registros
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="h-7 text-xs"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
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
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showConfigColunas} onOpenChange={setShowConfigColunas}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">Configurar Colunas</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-3 flex-1 overflow-auto">
            <div className="space-y-1">
              <p className="text-xs text-slate-600 font-semibold">Visibilidade</p>
              <div className="grid grid-cols-2 gap-2">
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

      <Dialog open={isDeletingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-red-600" />
              Excluindo Produtos
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto excluímos os produtos selecionados...
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