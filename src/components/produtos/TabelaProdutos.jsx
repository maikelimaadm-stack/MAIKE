
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Edit, Trash2, Printer, Search, Package, Settings, AlertTriangle, CheckSquare, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


const formatarNumero = (numero) => {
  if (!numero && numero !== 0) return "0,00";
  return numero.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true },
  { id: 'nome', label: 'Nome do Produto', default: true },
  { id: 'codigo', label: 'Código Interno', default: true },
  { id: 'categoria', label: 'Categoria', default: true },
  { id: 'unidade', label: 'Unidade', default: true },
  { id: 'preco_custo', label: 'Preço Custo', default: true },
  { id: 'preco_venda', label: 'Preço Venda', default: true },
  { id: 'estoque', label: 'Estoque Atual', default: true },
  { id: 'estoque_min', label: 'Estoque Mínimo', default: false },
  { id: 'barras', label: 'Cód. Barras', default: false },
];

export default function TabelaProdutos({ produtos = [], onEdit, onDelete, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('colunas_produtos');
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

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('colunas_produtos', JSON.stringify(novasColunas));
      }
      
      return novasColunas;
    });
  };

  const toggleSelectAll = () => {
    if (paginatedProdutos.length > 0 && paginatedProdutos.every(p => selectedItems.includes(p.id))) {
      // If all currently paginated items are selected, deselect them.
      // Also, ensure to deselect any other selected items that might not be on the current page.
      setSelectedItems(prev => prev.filter(id => !paginatedProdutos.map(p => p.id).includes(id)));
    } else {
      // Otherwise, select all currently paginated items that are not already selected.
      setSelectedItems(prev => {
        const newSelected = new Set(prev);
        paginatedProdutos.forEach(p => newSelected.add(p.id));
        return Array.from(newSelected);
      });
    }
  };


  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (!onDelete) {
      console.error('onDelete prop is not defined');
      return;
    }

    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} produto(s) selecionado(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
      setIsDeletingBulk(true);
      setDeleteProgress({ current: 0, total: selectedItems.length });
      
      let deleted = 0;
      const itemsToDelete = [...selectedItems]; // Create a copy to iterate
      for (const id of itemsToDelete) {
        try {
          await onDelete(id, true);
          deleted++;
          setDeleteProgress({ current: deleted, total: itemsToDelete.length });
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
    if (!onPrint) return;
    selectedItems.forEach(id => {
      const produto = produtos.find(p => p.id === id);
      if (produto) onPrint(produto);
    });
    setShowBulkActions(false);
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

  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(filteredProdutos.length / itemsPerPage);
  const startIndex = itemsPerPage === -1 ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === -1 ? filteredProdutos.length : startIndex + itemsPerPage;
  const paginatedProdutos = filteredProdutos.slice(startIndex, endIndex);

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(value === 'all' ? -1 : parseInt(value));
    setCurrentPage(1);
  };

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  return (
    <>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <CardTitle className="flex items-center gap-3 text-slate-900 text-sm">
              Produtos ({filteredProdutos.length})
              {selectedItems.length > 0 && (
                <Badge variant="secondary" className="bg-blue-100 text-blue-700 border-blue-300 text-xs">
                  {selectedItems.length} selecionados
                </Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-3 w-full md:w-auto">
              {selectedItems.length > 0 && (
                <DropdownMenu open={showBulkActions} onOpenChange={setShowBulkActions}>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2 border-blue-300 text-blue-700 h-8 text-xs">
                      <CheckSquare className="w-4 h-4" />
                      Ações em Massa
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">Ações para {selectedItems.length} itens</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem onClick={handleBulkPrint} className="text-xs">
                      <Printer className="w-4 h-4 mr-2" />
                      Imprimir Todos
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem onClick={handleBulkDelete} className="text-red-600 text-xs">
                      <Trash2 className="w-4 h-4 mr-2" />
                      Excluir Todos
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              
              <div className="relative flex-1 md:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
                <Input
                  placeholder="Buscar..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 border-slate-300 h-8 text-xs"
                />
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" title="Configurar Colunas" className="border-slate-300 h-8 w-8">
                    <Settings className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-96 overflow-y-auto">
                  <DropdownMenuLabel className="text-xs">Colunas Visíveis</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COLUNAS_DISPONIVEIS.map((coluna) => (
                    <DropdownMenuCheckboxItem
                      key={coluna.id}
                      checked={colunasVisiveis.includes(coluna.id)}
                      onCheckedChange={() => toggleColuna(coluna.id)}
                      className="text-xs"
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
                  <TableHead className="w-12 text-xs">
                    <Checkbox
                      checked={paginatedProdutos.length > 0 && paginatedProdutos.every(p => selectedItems.includes(p.id))}
                      indeterminate={paginatedProdutos.some(p => selectedItems.includes(p.id)) && !paginatedProdutos.every(p => selectedItems.includes(p.id))}
                      onCheckedChange={toggleSelectAll}
                      disabled={paginatedProdutos.length === 0}
                    />
                  </TableHead>
                  {colunasVisiveis.includes('numero') && <TableHead className="font-semibold text-slate-700 text-xs">Nº</TableHead>}
                  {colunasVisiveis.includes('nome') && <TableHead className="font-semibold text-slate-700 text-xs">Nome</TableHead>}
                  {colunasVisiveis.includes('codigo') && <TableHead className="font-semibold text-slate-700 text-xs">Código</TableHead>}
                  {colunasVisiveis.includes('barras') && <TableHead className="font-semibold text-slate-700 text-xs">Cód. Barras</TableHead>}
                  {colunasVisiveis.includes('categoria') && <TableHead className="font-semibold text-slate-700 text-xs">Categoria</TableHead>}
                  {colunasVisiveis.includes('unidade') && <TableHead className="font-semibold text-slate-700 text-xs">UN</TableHead>}
                  {colunasVisiveis.includes('preco_custo') && <TableHead className="font-semibold text-slate-700 text-right text-xs">Custo</TableHead>}
                  {colunasVisiveis.includes('preco_venda') && <TableHead className="font-semibold text-slate-700 text-right text-xs">Venda</TableHead>}
                  {colunasVisiveis.includes('estoque') && <TableHead className="font-semibold text-slate-700 text-right text-xs">Estoque</TableHead>}
                  {colunasVisiveis.includes('estoque_min') && <TableHead className="font-semibold text-slate-700 text-right text-xs">Est. Mín.</TableHead>}
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
                      </TableRow>
                    ))
                  ) : paginatedProdutos.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasVisiveis.length + 1} className="text-center py-12">
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                          <Package className="w-12 h-12" />
                          <p className="text-sm font-medium">Nenhum produto encontrado</p>
                          <p className="text-xs">
                            {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando um novo produto'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedProdutos.map((produto) => {
                      const estoqueAbaixoMinimo = (produto.estoque_atual || 0) <= (produto.estoque_minimo || 0);
                      
                      return (
                        <ContextMenu key={produto.id}>
                          <ContextMenuTrigger asChild>
                            <motion.tr
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer text-xs ${estoqueAbaixoMinimo ? 'bg-orange-50' : ''}`}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={selectedItems.includes(produto.id)}
                                  onCheckedChange={() => toggleSelectItem(produto.id)}
                                />
                              </TableCell>
                              {colunasVisiveis.includes('numero') && (
                                <TableCell className="font-bold text-slate-900">
                                  {produto.numero_produto || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('nome') && (
                                <TableCell className="font-semibold text-slate-900">
                                  {produto.nome_produto}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('codigo') && (
                                <TableCell className="font-mono text-slate-700">
                                  {produto.codigo_interno || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('barras') && (
                                <TableCell className="font-mono text-slate-700">
                                  {produto.codigo_barras || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('categoria') && (
                                <TableCell>
                                  <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-300 text-xs">
                                    {produto.categoria || 'Sem categoria'}
                                  </Badge>
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('unidade') && (
                                <TableCell className="text-slate-700">{produto.unidade_medida}</TableCell>
                              )}
                              {colunasVisiveis.includes('preco_custo') && (
                                <TableCell className="text-right font-mono text-slate-700">
                                  R$ {formatarNumero(produto.preco_custo || 0)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('preco_venda') && (
                                <TableCell className="text-right font-mono font-semibold text-green-700">
                                  R$ {formatarNumero(produto.preco_venda || 0)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('estoque') && (
                                <TableCell className="text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {estoqueAbaixoMinimo && <AlertTriangle className="w-4 h-4 text-orange-600" />}
                                    <span className={`font-bold ${estoqueAbaixoMinimo ? 'text-orange-700' : 'text-slate-900'}`}>
                                      {formatarNumero(produto.estoque_atual || 0)}
                                    </span>
                                  </div>
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('estoque_min') && (
                                <TableCell className="text-right text-slate-700">
                                  {formatarNumero(produto.estoque_minimo || 0)}
                                </TableCell>
                              )}
                            </motion.tr>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => onEdit && onEdit(produto)} className="text-xs">
                              <Edit className="w-4 h-4 mr-2 text-blue-600" />
                              Editar
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onPrint && onPrint(produto)} className="text-xs">
                              <Printer className="w-4 h-4 mr-2 text-green-600" />
                              Imprimir Ficha
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onDelete && onDelete(produto.id)} className="text-xs">
                              <Trash2 className="w-4 h-4 mr-2 text-red-600" />
                              Excluir
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>

          {!isLoading && filteredProdutos.length > 0 && ( // Use filteredProdutos.length here to show pagination even if current page is empty
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 p-4 border-t border-slate-200">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span>Mostrar</span>
                <Select value={itemsPerPage === -1 ? 'all' : itemsPerPage.toString()} onValueChange={handleItemsPerPageChange}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="20" className="text-xs">20</SelectItem>
                    <SelectItem value="50" className="text-xs">50</SelectItem>
                    <SelectItem value="100" className="text-xs">100</SelectItem>
                    <SelectItem value="all" className="text-xs">Todos</SelectItem>
                  </SelectContent>
                </Select>
                <span>por página</span>
              </div>

              {itemsPerPage !== -1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className="h-8 w-8">
                    <ChevronsLeft className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="h-8 w-8">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  
                  <div className="flex items-center gap-2 px-3 text-xs">
                    <span className="text-slate-700 font-medium">
                      Pág {currentPage} de {totalPages}
                    </span>
                    <span className="text-slate-500">
                      ({startIndex + 1}-{Math.min(endIndex, filteredProdutos.length)} de {filteredProdutos.length})
                    </span>
                  </div>

                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="h-8 w-8">
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className="h-8 w-8">
                    <ChevronsRight className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
