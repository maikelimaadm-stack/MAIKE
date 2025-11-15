import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { MoreVertical, Search, Scale, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

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
  
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedItems, setSelectedItems] = useState([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
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
    if (selectedItems.length === paginatedPesagens.length && paginatedPesagens.length > 0) {
      setSelectedItems([]);
    } else {
      setSelectedItems(paginatedPesagens.map(p => p.id));
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
        setShowBulkActions(false);
      }, 500);
    }
  };

  const handleBulkPrint = () => {
    selectedItems.forEach(id => {
      const pesagem = pesagens.find(p => p.id === id);
      if (pesagem) onPrint(pesagem);
    });
    setShowBulkActions(false);
  };

  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(sortedPesagens.length / itemsPerPage);
  const startIndex = itemsPerPage === -1 ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === -1 ? sortedPesagens.length : startIndex + itemsPerPage;
  const paginatedPesagens = sortedPesagens.slice(startIndex, endIndex);

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

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(value === 'all' ? -1 : parseInt(value));
    setCurrentPage(1);
  };

  const deleteProgressPercentage = deleteProgress.total > 0 
    ? Math.round((deleteProgress.current / deleteProgress.total) * 100) 
    : 0;

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="relative flex-1 max-w-sm">
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
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
              Colunas
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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

      <Card className="shadow-sm border-slate-300">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 hover:bg-slate-50 border-b">
                  <TableHead className="w-10 text-xs border-r">
                    <Checkbox
                      checked={selectedItems.length === paginatedPesagens.length && paginatedPesagens.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  {colunasVisiveis.includes('numero') && (
                    <TableHead 
                      className="text-xs cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('numero')}
                    >
                      <div className="flex items-center">
                        Nº
                        {getSortIcon('numero')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('data') && (
                    <TableHead 
                      className="text-xs cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('data')}
                    >
                      <div className="flex items-center">
                        Data
                        {getSortIcon('data')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('tipo') && (
                    <TableHead 
                      className="text-xs cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('tipo')}
                    >
                      <div className="flex items-center">
                        Tipo
                        {getSortIcon('tipo')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('placa') && (
                    <TableHead 
                      className="text-xs cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('placa')}
                    >
                      <div className="flex items-center">
                        Placa
                        {getSortIcon('placa')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('motorista') && (
                    <TableHead 
                      className="text-xs cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('motorista')}
                    >
                      <div className="flex items-center">
                        Motorista
                        {getSortIcon('motorista')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('produto') && (
                    <TableHead 
                      className="text-xs cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('produto')}
                    >
                      <div className="flex items-center">
                        Produto
                        {getSortIcon('produto')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('fornecedor') && (
                    <TableHead 
                      className="text-xs cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('fornecedor')}
                    >
                      <div className="flex items-center">
                        Fornecedor/Destino
                        {getSortIcon('fornecedor')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('tara') && (
                    <TableHead 
                      className="text-xs text-right cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('tara')}
                    >
                      <div className="flex items-center justify-end">
                        Tara (kg)
                        {getSortIcon('tara')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('bruto') && (
                    <TableHead 
                      className="text-xs text-right cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('bruto')}
                    >
                      <div className="flex items-center justify-end">
                        Bruto (kg)
                        {getSortIcon('bruto')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('liquido') && (
                    <TableHead 
                      className="text-xs text-right cursor-pointer hover:bg-slate-100 border-r"
                      onClick={() => handleSort('liquido')}
                    >
                      <div className="flex items-center justify-end">
                        Líquido (kg)
                        {getSortIcon('liquido')}
                      </div>
                    </TableHead>
                  )}
                  {colunasVisiveis.includes('observacoes') && (
                    <TableHead className="text-xs border-r">Observações</TableHead>
                  )}
                  <TableHead className="text-xs w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence mode="wait">
                  {isLoading ? (
                    Array(5).fill(0).map((_, i) => (
                      <TableRow key={i} className="animate-pulse">
                        <TableCell className="border-r"><div className="h-4 bg-slate-200 rounded w-4"></div></TableCell>
                        {colunasVisiveis.map((col, idx) => (
                          <TableCell key={idx} className="border-r"><div className="h-4 bg-slate-200 rounded w-20"></div></TableCell>
                        ))}
                        <TableCell className="border-r"><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                      </TableRow>
                    ))
                  ) : paginatedPesagens.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasVisiveis.length + 2} className="text-center py-12">
                        <div className="flex flex-col items-center gap-3 text-slate-400">
                          <Scale className="w-12 h-12" />
                          <p className="text-sm font-medium">Nenhum registro encontrado</p>
                          <p className="text-xs">
                            {searchTerm ? 'Tente ajustar sua busca' : 'Comece adicionando uma nova pesagem'}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedPesagens.map((pesagem) => (
                      <motion.tr
                        key={pesagem.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="border-b border-slate-100 hover:bg-slate-50 transition-colors text-xs"
                      >
                        <TableCell className="border-r">
                          <Checkbox
                            checked={selectedItems.includes(pesagem.id)}
                            onCheckedChange={() => toggleSelectItem(pesagem.id)}
                          />
                        </TableCell>
                        {colunasVisiveis.includes('numero') && (
                          <TableCell className="border-r">
                            {pesagem.numero_registro || '-'}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('data') && (
                          <TableCell className="border-r">
                            {formatarData(pesagem.data_pesagem)}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('tipo') && (
                          <TableCell className="border-r">
                            {pesagem.tipo_pesagem}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('placa') && (
                          <TableCell className="border-r uppercase">
                            {pesagem.placa_caminhao}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('motorista') && (
                          <TableCell className="border-r">{pesagem.nome_motorista}</TableCell>
                        )}
                        {colunasVisiveis.includes('produto') && (
                          <TableCell className="border-r">{pesagem.produto}</TableCell>
                        )}
                        {colunasVisiveis.includes('fornecedor') && (
                          <TableCell className="border-r">{pesagem.fornecedor_destino || '-'}</TableCell>
                        )}
                        {colunasVisiveis.includes('tara') && (
                          <TableCell className="text-right font-mono border-r">
                            {formatarNumero(pesagem.peso_tara)}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('bruto') && (
                          <TableCell className="text-right font-mono border-r">
                            {formatarNumero(pesagem.peso_bruto)}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('liquido') && (
                          <TableCell className="text-right font-mono font-semibold border-r">
                            {formatarNumero(pesagem.peso_liquido)}
                          </TableCell>
                        )}
                        {colunasVisiveis.includes('observacoes') && (
                          <TableCell className="max-w-xs truncate border-r">
                            {pesagem.observacoes || '-'}
                          </TableCell>
                        )}
                        <TableCell className="border-r">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => onEdit(pesagem)} className="text-xs">
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onPrint(pesagem)} className="text-xs">
                                Imprimir
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onDelete(pesagem.id)} className="text-xs text-red-600">
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </motion.tr>
                    ))
                  )}
                </AnimatePresence>
              </TableBody>
            </Table>
          </div>

          {!isLoading && paginatedPesagens.length > 0 && (
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
                      ({startIndex + 1}-{Math.min(endIndex, sortedPesagens.length)} de {sortedPesagens.length})
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