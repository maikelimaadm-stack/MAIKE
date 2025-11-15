import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Edit, Trash2, FolderOpen, Settings, Search, MoreVertical, ArrowUpDown, ArrowUp, ArrowDown, Loader2, GripVertical, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
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

const getNextCategoryNumber = async () => {
  try {
    const all = await base44.entities.Categoria.list();
    const numeros = all
      .map(c => parseInt(c.numero_categoria) || 0)
      .filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch {
    return 1;
  }
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'nome', label: 'Nome', default: true, sortable: true },
  { id: 'subcategoria', label: 'Subcategoria', default: false, sortable: true },
  { id: 'descricao', label: 'Descrição', default: true, sortable: false },
];

const ITEMS_PER_PAGE = 50;

export default function Categorias() {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_categorias');
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
    const saved = localStorage.getItem('colunas_ordem_categorias');
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
  
  const [formData, setFormData] = useState({ nome: "", subcategoria: "", descricao: "" });

  const queryClient = useQueryClient();

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ['categorias'],
    queryFn: () => base44.entities.Categoria.list(),
    initialData: [],
  });

  useEffect(() => {
    const numerarCategoriasExistentes = async () => {
      const semNumero = categorias.filter(c => !c.numero_categoria);

      if (semNumero.length > 0) {
        let updateCount = 0;
        for (const categoria of semNumero) {
          try {
            const proximoNumero = await getNextCategoryNumber();
            await base44.entities.Categoria.update(categoria.id, {
              numero_categoria: String(proximoNumero)
            });
            updateCount++;
          } catch (error) {
            console.error(`Erro ao numerar categoria ${categoria.id}:`, error);
            toast.error(`Erro ao numerar categoria ${categoria.nome}.`);
          }
        }
        if (updateCount > 0) {
          queryClient.invalidateQueries({ queryKey: ['categorias'] });
          toast.success('Categorias sem número foram numeradas automaticamente.');
        }
      }
    };

    if (categorias.length > 0) {
      numerarCategoriasExistentes();
    }
  }, [categorias, queryClient]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      localStorage.setItem('colunas_categorias', JSON.stringify(novasColunas));
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_categorias', JSON.stringify(items));
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

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const num = await getNextCategoryNumber();
      return base44.entities.Categoria.create({
        ...data,
        numero_categoria: String(num)
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setShowForm(false);
      resetForm();
      toast.success('Categoria cadastrada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao cadastrar categoria.');
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Categoria.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      setShowForm(false);
      setEditing(null);
      resetForm();
      toast.success('Categoria atualizada!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao atualizar categoria.');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const todosProdutos = await base44.entities.Produto.list();
      const categoriaToDelete = categorias.find(c => c.id === id);
      const temProdutos = todosProdutos.some(p => p.categoria === categoriaToDelete?.nome);
      
      if (temProdutos) {
        throw new Error('❌ Possui produtos vinculados! Não é possível excluir.');
      }
      
      return base44.entities.Categoria.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias'] });
      toast.success('Categoria excluída!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao excluir categoria.');
    }
  });

  const resetForm = () => {
    setFormData({ nome: "", subcategoria: "", descricao: "" });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const data = { 
      nome: formData.nome?.toUpperCase(),
      subcategoria: formData.subcategoria?.toUpperCase() || undefined,
      descricao: formData.descricao?.toUpperCase() || undefined
    };

    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (categoria) => {
    setEditing(categoria);
    setFormData({ 
      nome: categoria.nome || "", 
      subcategoria: categoria.subcategoria || "",
      descricao: categoria.descricao || "" 
    });
    setShowForm(true);
  };

  const handleDelete = async (id, skipConfirm = false) => {
    if (skipConfirm || window.confirm('⚠️ Excluir categoria?')) {
      try {
        await deleteMutation.mutateAsync(id);
      } catch (error) {
        console.error('Erro:', error);
      }
    }
  };

  const filteredCategorias = categorias.filter(c => {
    const searchLower = searchTerm.toLowerCase();
    return (
      c.nome?.toLowerCase().includes(searchLower) ||
      c.subcategoria?.toLowerCase().includes(searchLower) ||
      c.descricao?.toLowerCase().includes(searchLower) ||
      c.numero_categoria?.includes(searchLower)
    );
  });

  const sortedCategorias = [...filteredCategorias].sort((a, b) => {
    if (!sortField) {
      const numA = parseInt(a.numero_categoria) || 0;
      const numB = parseInt(b.numero_categoria) || 0;
      if (numA !== numB) return numA - numB;
      return (a.nome || '').localeCompare(b.nome || '');
    }

    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_categoria) || 0;
        bValue = parseInt(b.numero_categoria) || 0;
        break;
      case 'nome':
        aValue = a.nome;
        bValue = b.nome;
        break;
      case 'subcategoria':
        aValue = a.subcategoria || '';
        bValue = b.subcategoria || '';
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

  const totalPages = Math.ceil(sortedCategorias.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedCategorias = sortedCategorias.slice(startIndex, endIndex);

  const toggleSelectAll = () => {
    if (selectedItems.length === paginatedCategorias.length && paginatedCategorias.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedCategorias.map(c => c.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} categoria(s) selecionada(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
      setIsDeletingBulk(true);
      setDeleteProgress({ current: 0, total: selectedItems.length });
      
      let deleted = 0;
      for (const id of selectedItems) {
        try {
          await handleDelete(id, true);
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

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  const renderCell = (coluna, categoria) => {
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="text-xs border-r border-slate-200">{categoria.numero_categoria || '-'}</TableCell>;
      case 'nome':
        return <TableCell className="text-xs font-semibold border-r border-slate-200">{categoria.nome}</TableCell>;
      case 'subcategoria':
        return <TableCell className="text-xs border-r border-slate-200">{categoria.subcategoria || '-'}</TableCell>;
      case 'descricao':
        return <TableCell className="text-xs border-r border-slate-200">{categoria.descricao || '-'}</TableCell>;
      default:
        return <TableCell className="text-xs border-r border-slate-200">-</TableCell>;
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      {!showForm && (
        <>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Categorias</h1>
              <p className="text-xs text-slate-600">Gerenciar categorias</p>
            </div>
            <Button onClick={() => { setEditing(null); resetForm(); setShowForm(true); }} size="sm" className="h-8 gap-1 text-xs bg-slate-700 hover:bg-slate-800">
              <Plus className="w-3.5 h-3.5" />
              Nova Categoria
            </Button>
          </div>
        </>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
            <Card className="shadow-sm border-slate-300 bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  {editing ? 'Editar Categoria' : 'Nova Categoria'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Nome *</Label>
                      <Input
                        value={formData.nome}
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                        placeholder="NOME"
                        required
                        className="h-8 text-xs uppercase"
                        style={{ textTransform: 'uppercase' }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Subcategoria</Label>
                      <Input
                        value={formData.subcategoria}
                        onChange={(e) => setFormData({ ...formData, subcategoria: e.target.value })}
                        placeholder="SUBCATEGORIA"
                        className="h-8 text-xs uppercase"
                        style={{ textTransform: 'uppercase' }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Descrição</Label>
                      <Input
                        value={formData.descricao}
                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                        placeholder="DESCRIÇÃO"
                        className="h-8 text-xs uppercase"
                        style={{ textTransform: 'uppercase' }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); resetForm(); }} size="sm" className="h-8 text-xs">
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-slate-700 hover:bg-slate-800">
                      {editing ? 'Atualizar' : 'Salvar'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {!showForm && (
        <Card className="shadow-sm border-slate-300">
          <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-sm font-semibold text-slate-900">
                Categorias ({categorias.length})
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
                        checked={selectedItems.length === paginatedCategorias.length && paginatedCategorias.length > 0}
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
                    ) : paginatedCategorias.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhuma categoria</TableCell>
                      </TableRow>
                    ) : (
                      paginatedCategorias.map((categoria) => (
                        <motion.tr 
                          key={categoria.id}
                          initial={{ opacity: 0 }} 
                          animate={{ opacity: 1 }} 
                          exit={{ opacity: 0 }} 
                          className="hover:bg-slate-50 transition-colors border-b"
                        >
                          <TableCell className="border-r border-slate-200">
                            <Checkbox
                              checked={selectedItems.includes(categoria.id)}
                              onCheckedChange={() => toggleSelectItem(categoria.id)}
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
                                <DropdownMenuItem onClick={() => handleEdit(categoria)} className="text-xs">
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleDelete(categoria.id)} className="text-xs text-red-600">
                                  Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          {colunasOrdenadas.map(coluna => (
                            <React.Fragment key={coluna.id}>
                              {renderCell(coluna, categoria)}
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
                  Mostrando {startIndex + 1} a {Math.min(endIndex, sortedCategorias.length)} de {sortedCategorias.length} registros
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
      )}

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
    </div>
  );
}