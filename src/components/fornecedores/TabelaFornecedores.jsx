import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreVertical, Search, Settings, ArrowUpDown, ArrowUp, ArrowDown, Loader2, GripVertical, ChevronLeft, ChevronRight } from "lucide-react";
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

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'tipo', label: 'Tipo', default: true, sortable: true },
  { id: 'nome', label: 'Nome', default: true, sortable: true },
  { id: 'cpf_cnpj', label: 'CPF/CNPJ', default: true, sortable: false },
  { id: 'telefone', label: 'Telefone', default: true, sortable: false },
  { id: 'email', label: 'Email', default: false, sortable: false },
  { id: 'cidade', label: 'Cidade', default: true, sortable: true },
  { id: 'estado', label: 'UF', default: true, sortable: true },
];

const ITEMS_PER_PAGE = 50;

export default function TabelaFornecedores({ fornecedores = [], onEdit, onDelete, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_fornecedores');
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
    const saved = localStorage.getItem('colunas_ordem_fornecedores');
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
      
      localStorage.setItem('colunas_fornecedores', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_fornecedores', JSON.stringify(items));
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

  const filteredFornecedores = fornecedores.filter(fornecedor => {
    const searchLower = searchTerm.toLowerCase();
    return (
      fornecedor.nome?.toLowerCase().includes(searchLower) ||
      fornecedor.cpf?.toLowerCase().includes(searchLower) ||
      fornecedor.cnpj?.toLowerCase().includes(searchLower) ||
      fornecedor.cidade?.toLowerCase().includes(searchLower) ||
      fornecedor.telefone?.toLowerCase().includes(searchLower) ||
      fornecedor.email?.toLowerCase().includes(searchLower) ||
      fornecedor.numero_cadastro?.toString().includes(searchLower)
    );
  });

  const sortedFornecedores = [...filteredFornecedores].sort((a, b) => {
    if (!sortField) return 0;

    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_cadastro) || 0;
        bValue = parseInt(b.numero_cadastro) || 0;
        break;
      case 'tipo':
        aValue = a.tipo_pessoa;
        bValue = b.tipo_pessoa;
        break;
      case 'nome':
        aValue = a.nome;
        bValue = b.nome;
        break;
      case 'cidade':
        aValue = a.cidade || '';
        bValue = b.cidade || '';
        break;
      case 'estado':
        aValue = a.estado || '';
        bValue = b.estado || '';
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

  const totalPages = Math.ceil(sortedFornecedores.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedFornecedores = sortedFornecedores.slice(startIndex, endIndex);

  const toggleSelectAll = () => {
    if (selectedItems.length === paginatedFornecedores.length && paginatedFornecedores.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedFornecedores.map(f => f.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const executeBulkDelete = async () => {
    setBulkDeleteConfirm(false);
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
  };

  const handleBulkPrint = () => {
    selectedItems.forEach(id => {
      const fornecedor = fornecedores.find(f => f.id === id);
      if (fornecedor) onPrint(fornecedor);
    });
  };

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  const renderCell = (coluna, fornecedor) => {
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="text-xs border-r border-slate-200">{fornecedor.numero_cadastro || '-'}</TableCell>;
      case 'tipo':
        return (
          <TableCell className="border-r border-slate-200">
            <Badge variant="outline" className={`text-xs ${fornecedor.tipo_pessoa === 'Física' ? 'bg-blue-50 text-blue-700 border-blue-300' : 'bg-purple-50 text-purple-700 border-purple-300'}`}>
              {fornecedor.tipo_pessoa}
            </Badge>
          </TableCell>
        );
      case 'nome':
        return <TableCell className="text-xs font-semibold border-r border-slate-200">{fornecedor.nome}</TableCell>;
      case 'cpf_cnpj':
        return <TableCell className="text-xs font-mono border-r border-slate-200">{fornecedor.cpf || fornecedor.cnpj || '-'}</TableCell>;
      case 'telefone':
        return <TableCell className="text-xs border-r border-slate-200">{fornecedor.telefone || '-'}</TableCell>;
      case 'email':
        return <TableCell className="text-xs border-r border-slate-200">{fornecedor.email || '-'}</TableCell>;
      case 'cidade':
        return <TableCell className="text-xs border-r border-slate-200">{fornecedor.cidade || '-'}</TableCell>;
      case 'estado':
        return <TableCell className="text-xs border-r border-slate-200">{fornecedor.estado || '-'}</TableCell>;
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
              Fornecedores/Clientes ({fornecedores.length})
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
                      <DropdownMenuItem onClick={() => setBulkDeleteConfirm(true)} className="text-xs text-red-600">
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
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowConfigColunas(true)}>
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
                      checked={selectedItems.length === paginatedFornecedores.length && paginatedFornecedores.length > 0}
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
                  ) : paginatedFornecedores.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhum fornecedor</TableCell>
                    </TableRow>
                  ) : (
                    paginatedFornecedores.map((fornecedor) => (
                      <motion.tr 
                        key={fornecedor.id}
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        className="hover:bg-slate-50 transition-colors border-b"
                      >
                        <TableCell className="border-r border-slate-200">
                          <Checkbox
                            checked={selectedItems.includes(fornecedor.id)}
                            onCheckedChange={() => toggleSelectItem(fornecedor.id)}
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
                              <DropdownMenuItem onClick={() => onEdit(fornecedor)} className="text-xs">
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onPrint(fornecedor)} className="text-xs">
                                Imprimir Ficha
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => setDeleteConfirm(fornecedor)} className="text-xs text-red-600">
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        {colunasOrdenadas.map(coluna => (
                          <React.Fragment key={coluna.id}>
                            {renderCell(coluna, fornecedor)}
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
                Mostrando {startIndex + 1} a {Math.min(endIndex, sortedFornecedores.length)} de {sortedFornecedores.length} registros
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

      <ConfirmDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
        title="Excluir Fornecedor/Cliente"
        description={`Tem certeza que deseja excluir "${deleteConfirm?.nome}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => {
          onDelete(deleteConfirm.id);
          setDeleteConfirm(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={() => setBulkDeleteConfirm(false)}
        title="Excluir Múltiplos Fornecedores"
        description={`Você está prestes a excluir ${selectedItems.length} fornecedor(es) selecionado(s). Esta ação não pode ser desfeita. Deseja continuar?`}
        onConfirm={executeBulkDelete}
        confirmText="Excluir Todos"
        cancelText="Cancelar"
        variant="destructive"
      />

      <Dialog open={isDeletingBulk} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-red-600" />
              Excluindo Registros
            </DialogTitle>
            <DialogDescription>
              Aguarde enquanto excluímos os registros selecionados...
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