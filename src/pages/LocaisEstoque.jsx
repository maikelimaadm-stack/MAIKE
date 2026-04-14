import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Warehouse, Trash2, Edit, MoreVertical, Search, Settings, ArrowUpDown, ArrowUp, ArrowDown, Loader2, GripVertical, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

const getNextLocalNumber = async () => {
  try {
    const locais = await base44.entities.LocalEstoque.list();
    const numeros = locais.map(l => parseInt(l.numero_local) || 0).filter(n => n > 0);
    return numeros.length > 0 ? Math.max(...numeros) + 1 : 1;
  } catch (error) {
    console.error('Erro:', error);
    return 1;
  }
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'nome', label: 'Nome', default: true, sortable: true },
  { id: 'capacidade', label: 'Capacidade', default: true, sortable: true },
  { id: 'descricao', label: 'Descrição', default: true, sortable: false },
];

const ITEMS_PER_PAGE = 50;

export default function LocaisEstoque() {
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({ nome: "", descricao: "", capacidade: "" });
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_locais_estoque');
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
    const saved = localStorage.getItem('colunas_ordem_locais_estoque');
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
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState({ current: 0, total: 0 });

  const queryClient = useQueryClient();

  const { data: locais, isLoading } = useQuery({
    queryKey: ['locais_estoque'],
    queryFn: async () => {
      const data = await base44.entities.LocalEstoque.list();
      return data.sort((a, b) => a.nome.localeCompare(b.nome));
    },
    initialData: [],
  });

  useEffect(() => {
    const numerarLocaisExistentes = async () => {
      if (isLoading || !locais || locais.length === 0) return;
      const locaisSemNumero = locais.filter(l => !l.numero_local);
      if (locaisSemNumero.length > 0) {
        for (const local of locaisSemNumero) {
          try {
            const proximoNumero = await getNextLocalNumber();
            await base44.entities.LocalEstoque.update(local.id, { ...local, numero_local: String(proximoNumero) });
          } catch (error) {
            console.error(`Erro:`, error);
          }
        }
        queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      }
    };
    numerarLocaisExistentes();
  }, [locais, queryClient, isLoading]);

  const toggleColuna = (colunaId) => {
    setColunasVisiveis(prev => {
      const novasColunas = prev.includes(colunaId)
        ? prev.filter(id => id !== colunaId)
        : [...prev, colunaId];
      
      localStorage.setItem('colunas_locais_estoque', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_locais_estoque', JSON.stringify(items));
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
      const proximoNumero = await getNextLocalNumber();
      return base44.entities.LocalEstoque.create({ ...data, numero_local: String(proximoNumero) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      setShowForm(false);
      setFormData({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local cadastrado!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.LocalEstoque.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      setShowForm(false);
      setEditingItem(null);
      setFormData({ nome: "", descricao: "", capacidade: "" });
      toast.success('Local atualizado!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const todosProdutos = await base44.entities.Produto.list();
      const local = locais.find(l => l.id === id);
      const produtosVinculados = todosProdutos.filter(p => p.local_estoque === local?.nome);
      if (produtosVinculados.length > 0) {
        throw new Error(`❌ Possui ${produtosVinculados.length} produto(s). Não é possível excluir.`);
      }
      const todasMovimentacoes = await base44.entities.MovimentacaoEstoque.list();
      const movimentacoesVinculadas = todasMovimentacoes.filter(m => 
        m.local_estoque_origem === local?.nome || m.local_estoque_destino === local?.nome
      );
      if (movimentacoesVinculadas.length > 0) {
        throw new Error(`❌ Possui ${movimentacoesVinculadas.length} movimentação(ões). Não é possível excluir.`);
      }
      return base44.entities.LocalEstoque.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['locais_estoque'] });
      toast.success('Local excluído!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro.');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const dataToSend = {
      nome: formData.nome.toUpperCase(),
      descricao: formData.descricao?.toUpperCase() || undefined,
      capacidade: formData.capacidade?.toUpperCase() || undefined
    };

    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, data: dataToSend });
    } else {
      createMutation.mutate(dataToSend);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormData({ nome: item.nome, descricao: item.descricao || "", capacidade: item.capacidade || "" });
    setShowForm(true);
  };

  const handleDelete = async (id, skipConfirm = false) => {
    if (!skipConfirm) {
      setDeleteConfirmId(id);
      return;
    }
    try {
      await deleteMutation.mutateAsync(id);
    } catch (error) {
      console.error('Erro:', error);
    }
  };

  const filteredLocais = locais.filter(l => {
    const searchLower = searchTerm.toLowerCase();
    return (
      l.nome?.toLowerCase().includes(searchLower) ||
      l.descricao?.toLowerCase().includes(searchLower) ||
      l.numero_local?.includes(searchLower)
    );
  });

  const sortedLocais = [...filteredLocais].sort((a, b) => {
    if (!sortField) return 0;

    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_local) || 0;
        bValue = parseInt(b.numero_local) || 0;
        break;
      case 'nome':
        aValue = a.nome;
        bValue = b.nome;
        break;
      case 'capacidade':
        aValue = a.capacidade || '';
        bValue = b.capacidade || '';
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

  const totalPages = Math.ceil(sortedLocais.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedLocais = sortedLocais.slice(startIndex, endIndex);

  const toggleSelectAll = () => {
    if (selectedItems.length === paginatedLocais.length && paginatedLocais.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedLocais.map(l => l.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    setBulkDeleteConfirm(true);
  };

  const executeBulkDelete = async () => {
    setBulkDeleteConfirm(false);
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
  };

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  const renderCell = (coluna, item) => {
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="text-xs border-r border-slate-200">{item.numero_local || '-'}</TableCell>;
      case 'nome':
        return <TableCell className="text-xs font-semibold border-r border-slate-200">{item.nome}</TableCell>;
      case 'capacidade':
        return <TableCell className="text-xs border-r border-slate-200">{item.capacidade || '-'}</TableCell>;
      case 'descricao':
        return <TableCell className="text-xs max-w-xs truncate border-r border-slate-200">{item.descricao || '-'}</TableCell>;
      default:
        return <TableCell className="text-xs border-r border-slate-200">-</TableCell>;
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-1">
      {!showForm && (
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Locais de Estoque</h1>
            <p className="text-xs text-slate-600">Gerenciar locais de armazenamento</p>
          </div>
          <Button onClick={() => { setEditingItem(null); setFormData({ nome: "", descricao: "", capacidade: "" }); setShowForm(true); }} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-3.5 h-3.5" />
            Novo Local
          </Button>
        </div>
      )}

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="shadow-sm border-slate-300 bg-white">
              <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
                <CardTitle className="text-sm font-semibold text-slate-900">
                  {editingItem ? 'Editar Local' : 'Novo Local'}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <form onSubmit={handleSubmit} className="space-y-2">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs uppercase">Nome *</Label>
                      <Input value={formData.nome} onChange={(e) => setFormData({ ...formData, nome: e.target.value.toUpperCase() })} placeholder="GALPÃO 1" required className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs uppercase">Capacidade</Label>
                      <Input value={formData.capacidade} onChange={(e) => setFormData({ ...formData, capacidade: e.target.value.toUpperCase() })} placeholder="500 SACAS" className="h-8 text-xs uppercase" style={{ textTransform: 'uppercase' }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs uppercase">Descrição</Label>
                      <Textarea value={formData.descricao} onChange={(e) => setFormData({ ...formData, descricao: e.target.value.toUpperCase() })} placeholder="DESCRIÇÃO" className="text-xs uppercase" style={{ textTransform: 'uppercase' }} rows={2} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2 border-t">
                    <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingItem(null); }} size="sm" className="h-8 text-xs">
                      Cancelar
                    </Button>
                    <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                      {editingItem ? 'Atualizar' : 'Salvar'}
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
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <CardTitle className="text-sm font-bold text-slate-800">
                  Locais de Estoque
                </CardTitle>
                <span className="text-xs text-slate-500">{filteredLocais.length} de {locais.length} registros</span>
              </div>
              <div className="flex gap-2 items-center flex-wrap">
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
                  <Input placeholder="Buscar..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }} className="pl-9 h-7 w-48 text-xs" />
                  {searchTerm && (
                    <button onClick={() => setSearchTerm("")} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-3 h-3 text-slate-400" /></button>
                  )}
                </div>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setShowConfigColunas(true)}>
                  <Settings className="w-3.5 h-3.5" />
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
                        checked={selectedItems.length === paginatedLocais.length && paginatedLocais.length > 0}
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
                    ) : paginatedLocais.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhum local</TableCell>
                      </TableRow>
                    ) : (
                      paginatedLocais.map((item) => (
                        <motion.tr 
                          key={item.id}
                          initial={{ opacity: 0 }} 
                          animate={{ opacity: 1 }} 
                          exit={{ opacity: 0 }} 
                          className="hover:bg-slate-50 transition-colors border-b"
                        >
                          <TableCell className="border-r border-slate-200">
                            <Checkbox
                              checked={selectedItems.includes(item.id)}
                              onCheckedChange={() => toggleSelectItem(item.id)}
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
                                <DropdownMenuItem onClick={() => handleEdit(item)} className="text-xs">
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleDelete(item.id)} className="text-xs text-red-600">
                                  Excluir
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                          {colunasOrdenadas.map(coluna => (
                            <React.Fragment key={coluna.id}>
                              {renderCell(coluna, item)}
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
                  Mostrando {startIndex + 1} a {Math.min(endIndex, sortedLocais.length)} de {sortedLocais.length} registros
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

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={() => setDeleteConfirmId(null)}
        title="Confirmar exclusão"
        description="Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita."
        onConfirm={() => {
          handleDelete(deleteConfirmId, true);
          setDeleteConfirmId(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />

      <ConfirmDialog
        open={bulkDeleteConfirm}
        onOpenChange={() => setBulkDeleteConfirm(false)}
        title="Confirmar exclusão"
        description={`Tem certeza que deseja excluir ${selectedItems.length} item(ns)? Esta ação não pode ser desfeita.`}
        onConfirm={executeBulkDelete}
        confirmText="Excluir"
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
    </div>
  );
}