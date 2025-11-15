import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreVertical, Search, Settings, ArrowUpDown, ArrowUp, ArrowDown, Loader2, Edit, Printer, Trash2, X, GripVertical } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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
  const num = typeof numero === 'string' ? parseFloat(numero) : numero;
  if (isNaN(num)) return "0,00";
  return num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

const COLUNAS_DISPONIVEIS = [
  { id: 'numero', label: 'Nº', default: true, sortable: true },
  { id: 'data', label: 'Data', default: true, sortable: true },
  { id: 'tipo', label: 'Tipo', default: true, sortable: true },
  { id: 'placa', label: 'Placa', default: true, sortable: true },
  { id: 'motorista', label: 'Motorista', default: true, sortable: true },
  { id: 'produto', label: 'Produto', default: true, sortable: true },
  { id: 'fornecedor', label: 'Fornecedor/Destino', default: true, sortable: true },
  { id: 'tara', label: 'Tara (kg)', default: true, sortable: true },
  { id: 'bruto', label: 'Bruto (kg)', default: true, sortable: true },
  { id: 'liquido', label: 'Líquido (kg)', default: true, sortable: true },
  { id: 'observacoes', label: 'Observações', default: false, sortable: false },
];

export default function TabelaPesagens({ pesagens = [], onEdit, onDelete, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  
  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    const saved = localStorage.getItem('colunas_pesagens');
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
    const saved = localStorage.getItem('colunas_ordem_pesagens');
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
      
      localStorage.setItem('colunas_pesagens', JSON.stringify(novasColunas));
      
      return novasColunas;
    });
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    
    const items = Array.from(colunasOrdem);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    
    setColunasOrdem(items);
    localStorage.setItem('colunas_ordem_pesagens', JSON.stringify(items));
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

  const filteredPesagens = pesagens.filter(pesagem => {
    const searchLower = searchTerm.toLowerCase();
    return (
      pesagem.placa_caminhao?.toLowerCase().includes(searchLower) ||
      pesagem.nome_motorista?.toLowerCase().includes(searchLower) ||
      pesagem.produto?.toLowerCase().includes(searchLower) ||
      pesagem.fornecedor_destino?.toLowerCase().includes(searchLower) ||
      pesagem.numero_registro?.toString().toLowerCase().includes(searchLower)
    );
  });

  const sortedPesagens = [...filteredPesagens].sort((a, b) => {
    if (!sortField) return 0;

    let aValue, bValue;

    switch (sortField) {
      case 'numero':
        aValue = parseInt(a.numero_registro) || 0;
        bValue = parseInt(b.numero_registro) || 0;
        break;
      case 'data':
        aValue = new Date(a.data_pesagem).getTime();
        bValue = new Date(b.data_pesagem).getTime();
        break;
      case 'tipo':
        aValue = a.tipo_pesagem;
        bValue = b.tipo_pesagem;
        break;
      case 'placa':
        aValue = a.placa_caminhao;
        bValue = b.placa_caminhao;
        break;
      case 'motorista':
        aValue = a.nome_motorista;
        bValue = b.nome_motorista;
        break;
      case 'produto':
        aValue = a.produto;
        bValue = b.produto;
        break;
      case 'fornecedor':
        aValue = a.fornecedor_destino || '';
        bValue = b.fornecedor_destino || '';
        break;
      case 'tara':
        aValue = a.peso_tara;
        bValue = b.peso_tara;
        break;
      case 'bruto':
        aValue = a.peso_bruto;
        bValue = b.peso_bruto;
        break;
      case 'liquido':
        aValue = a.peso_liquido;
        bValue = b.peso_liquido;
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

  const toggleSelectAll = () => {
    if (selectedItems.length === sortedPesagens.length && sortedPesagens.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(sortedPesagens.map(p => p.id));
    }
  };

  const toggleSelectItem = (id) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (window.confirm(`⚠️ ATENÇÃO: Você está prestes a excluir ${selectedItems.length} registro(s) selecionado(s). Esta ação não pode ser desfeita. Deseja continuar?`)) {
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
      const pesagem = pesagens.find(p => p.id === id);
      if (pesagem) onPrint(pesagem);
    });
  };

  const formatarData = (dataString) => {
    if (!dataString) return '-';
    try {
      const date = new Date(dataString);
      if (isNaN(date.getTime())) return '-';
      return format(date, "dd/MM/yyyy", { locale: ptBR });
    } catch {
      return '-';
    }
  };

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  const renderCell = (coluna, pesagem) => {
    switch (coluna.id) {
      case 'numero':
        return <TableCell className="text-xs border-r border-slate-200">{pesagem.numero_registro || '-'}</TableCell>;
      case 'data':
        return <TableCell className="text-xs border-r border-slate-200">{formatarData(pesagem.data_pesagem)}</TableCell>;
      case 'tipo':
        return <TableCell className="text-xs border-r border-slate-200">{pesagem.tipo_pesagem}</TableCell>;
      case 'placa':
        return <TableCell className="text-xs uppercase border-r border-slate-200">{pesagem.placa_caminhao}</TableCell>;
      case 'motorista':
        return <TableCell className="text-xs border-r border-slate-200">{pesagem.nome_motorista}</TableCell>;
      case 'produto':
        return <TableCell className="text-xs border-r border-slate-200">{pesagem.produto}</TableCell>;
      case 'fornecedor':
        return <TableCell className="text-xs border-r border-slate-200">{pesagem.fornecedor_destino || '-'}</TableCell>;
      case 'tara':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{formatarNumero(pesagem.peso_tara)}</TableCell>;
      case 'bruto':
        return <TableCell className="text-right font-mono text-xs border-r border-slate-200">{formatarNumero(pesagem.peso_bruto)}</TableCell>;
      case 'liquido':
        return <TableCell className="text-right font-mono text-xs font-semibold border-r border-slate-200">{formatarNumero(pesagem.peso_liquido)}</TableCell>;
      case 'observacoes':
        return <TableCell className="text-xs max-w-xs truncate border-r border-slate-200">{pesagem.observacoes || '-'}</TableCell>;
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
              Pesagens ({pesagens.length})
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
                        <Printer className="w-3.5 h-3.5 mr-2" />
                        Imprimir Todos
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleBulkDelete} className="text-xs text-red-600">
                        <Trash2 className="w-3.5 h-3.5 mr-2" />
                        Excluir Todos
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setSelectedItems([])} className="text-xs">
                        <X className="w-3.5 h-3.5 mr-2" />
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
                      checked={selectedItems.length === sortedPesagens.length && sortedPesagens.length > 0}
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
                  ) : sortedPesagens.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={50} className="text-center py-12 text-slate-400 text-xs">Nenhuma pesagem</TableCell>
                    </TableRow>
                  ) : (
                    sortedPesagens.map((pesagem) => (
                      <motion.tr 
                        key={pesagem.id}
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }} 
                        className="hover:bg-slate-50 transition-colors border-b"
                      >
                        <TableCell className="border-r border-slate-200">
                          <Checkbox
                            checked={selectedItems.includes(pesagem.id)}
                            onCheckedChange={() => toggleSelectItem(pesagem.id)}
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
                              <DropdownMenuItem onClick={() => onEdit(pesagem)} className="text-xs">
                                <Edit className="w-3.5 h-3.5 mr-2" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onPrint(pesagem)} className="text-xs">
                                <Printer className="w-3.5 h-3.5 mr-2" />
                                Imprimir
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => onDelete(pesagem.id)} className="text-xs text-red-600">
                                <Trash2 className="w-3.5 h-3.5 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        {colunasOrdenadas.map(coluna => (
                          <React.Fragment key={coluna.id}>
                            {renderCell(coluna, pesagem)}
                          </React.Fragment>
                        ))}
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>
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