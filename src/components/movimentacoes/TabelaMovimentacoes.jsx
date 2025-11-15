
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRightLeft, Search, Settings, Edit, Ban, Printer, CheckSquare, Loader2, AlertTriangle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  { id: 'numero', label: 'Nº Mov', default: true },
  { id: 'data', label: 'Data', default: true },
  { id: 'tipo', label: 'Tipo', default: true },
  { id: 'tipo_detalhado', label: 'Tipo Doc', default: true },
  { id: 'documento', label: 'Nº Documento', default: true },
  { id: 'produto', label: 'Produto', default: true },
  { id: 'quantidade', label: 'Quantidade', default: true },
  { id: 'unidade', label: 'UN', default: true },
  { id: 'fornecedor', label: 'Fornecedor', default: true },
  { id: 'local_estoque_origem', label: 'Local Estoque Origem', default: false },
  { id: 'local_estoque_destino', label: 'Local Estoque Destino', default: true },
  { id: 'centro_custo', label: 'Centro de Custo', default: true },
  { id: 'safra', label: 'Safra', default: false },
  { id: 'valor_unitario', label: 'Vlr Unit.', default: false },
  { id: 'valor_total', label: 'Vlr Total', default: false },
  { id: 'status', label: 'Status', default: true },
];

export default function TabelaMovimentacoes({ movimentacoes = [], onEdit, onCancel, onPrint, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(20);

  const [colunasVisiveis, setColunasVisiveis] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('colunas_movimentacoes');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          // Filter out any column IDs that no longer exist in COLUNAS_DISPONIVEIS
          const validColumns = COLUNAS_DISPONIVEIS.map(c => c.id);
          return parsed.filter(id => validColumns.includes(id));
        } catch {
          return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
        }
      }
    }
    return COLUNAS_DISPONIVEIS.filter(c => c.default).map(c => c.id);
  });
  
  const [selectedItems, setSelectedItems] = useState([]);
  const [showBulkActions, setShowBulkActions] = useState(false);
  const [isCancelingBulk, setIsCancelingBulk] = useState(false);
  const [cancelProgress, setCancelProgress] = useState({ current: 0, total: 0 });

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
      String(mov.numero_movimentacao)?.includes(searchLower) ||
      mov.usuario_responsavel?.toLowerCase().includes(searchLower) ||
      mov.centro_custo_nome?.toLowerCase().includes(searchLower) ||
      mov.safra_nome?.toLowerCase().includes(searchLower) ||
      mov.observacoes?.toLowerCase().includes(searchLower) ||
      mov.local_estoque_origem?.toLowerCase().includes(searchLower) ||
      mov.local_estoque_destino?.toLowerCase().includes(searchLower)
    );
  });

  const totalPages = itemsPerPage === -1 ? 1 : Math.ceil(filteredMovimentacoes.length / itemsPerPage);
  const startIndex = itemsPerPage === -1 ? 0 : (currentPage - 1) * itemsPerPage;
  const endIndex = itemsPerPage === -1 ? filteredMovimentacoes.length : startIndex + itemsPerPage;
  const paginatedMovimentacoes = filteredMovimentacoes.slice(startIndex, endIndex);

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
    if (window.confirm(`⚠️ Cancelar ${selectedItems.length} movimentação(ões)?`)) {
      setIsCancelingBulk(true);
      setCancelProgress({ current: 0, total: selectedItems.length });
      
      let canceled = 0;
      for (const id of selectedItems) {
        try {
          await onCancel(id, true); // Pass true to indicate it's a bulk operation if needed by onCancel
          canceled++;
          setCancelProgress({ current: canceled, total: selectedItems.length });
        } catch (error) {
          console.error('Erro ao cancelar movimentação:', error);
          // Optionally, handle individual cancellation failures here
        }
      }
      
      setTimeout(() => {
        setIsCancelingBulk(false);
        setSelectedItems([]);
        setShowBulkActions(false);
      }, 500); // Give a small delay to show completion
    }
  };

  const handleBulkPrint = () => {
    selectedItems.forEach(id => {
      const mov = movimentacoes.find(m => m.id === id);
      if (mov && onPrint) onPrint(mov);
    });
    setShowBulkActions(false);
  };

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(value === 'all' ? -1 : parseInt(value));
    setCurrentPage(1); // Reset to first page when items per page changes
  };

  const cancelProgressPercentage = cancelProgress.total > 0 
    ? Math.round((cancelProgress.current / cancelProgress.total) * 100) 
    : 0;

  return (
    <>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="bg-white border-b border-slate-200 py-2 px-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <CardTitle className="flex items-center gap-3 text-slate-900 text-sm">
              Movimentações ({filteredMovimentacoes.length})
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
                    <ContextMenuItem onClick={handleBulkPrint} className="cursor-pointer text-xs">
                      <Printer className="w-4 h-4 mr-2" />
                      Imprimir Todos
                    </ContextMenuItem>
                    <ContextMenuItem onClick={handleBulkCancel} className="text-red-600 cursor-pointer text-xs">
                      <Ban className="w-4 h-4 mr-2" />
                      Cancelar Todos
                    </ContextMenuItem>
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
                      checked={selectedItems.length === paginatedMovimentacoes.filter(m => m.status === 'Ativa').length && paginatedMovimentacoes.filter(m => m.status === 'Ativa').length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  {colunasVisiveis.includes('numero') && <TableHead className="font-semibold text-slate-700 text-xs">Nº Mov</TableHead>}
                  {colunasVisiveis.includes('data') && <TableHead className="font-semibold text-slate-700 text-xs">Data</TableHead>}
                  {colunasVisiveis.includes('tipo') && <TableHead className="font-semibold text-slate-700 text-xs">Tipo</TableHead>}
                  {colunasVisiveis.includes('tipo_detalhado') && <TableHead className="font-semibold text-slate-700 text-xs">Tipo Doc</TableHead>}
                  {colunasVisiveis.includes('documento') && <TableHead className="font-semibold text-slate-700 text-xs">Nº Documento</TableHead>}
                  {colunasVisiveis.includes('produto') && <TableHead className="font-semibold text-slate-700 text-xs">Produto</TableHead>}
                  {colunasVisiveis.includes('quantidade') && <TableHead className="font-semibold text-slate-700 text-right text-xs">Qtd</TableHead>}
                  {colunasVisiveis.includes('unidade') && <TableHead className="font-semibold text-slate-700 text-xs">UN</TableHead>}
                  {colunasVisiveis.includes('fornecedor') && <TableHead className="font-semibold text-slate-700 text-xs">Fornecedor</TableHead>}
                  {colunasVisiveis.includes('local_estoque_origem') && <TableHead className="font-semibold text-slate-700 text-xs">Local Estoque Origem</TableHead>}
                  {colunasVisiveis.includes('local_estoque_destino') && <TableHead className="font-semibold text-slate-700 text-xs">Local Estoque Destino</TableHead>}
                  {colunasVisiveis.includes('centro_custo') && <TableHead className="font-semibold text-slate-700 text-xs">Centro de Custo</TableHead>}
                  {colunasVisiveis.includes('safra') && <TableHead className="font-semibold text-slate-700 text-xs">Safra</TableHead>}
                  {colunasVisiveis.includes('valor_unitario') && <TableHead className="font-semibold text-slate-700 text-right text-xs">Vlr Unit.</TableHead>}
                  {colunasVisiveis.includes('valor_total') && <TableHead className="font-semibold text-slate-700 text-right text-xs">Vlr Total</TableHead>}
                  {colunasVisiveis.includes('status') && <TableHead className="font-semibold text-slate-700 text-xs">Status</TableHead>}
                  <TableHead className="font-semibold text-slate-700 text-center text-xs">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <AnimatePresence mode="wait">
                  {isLoading ? (
                    Array(5).fill(0).map((_, i) => (
                      <TableRow key={i} className="animate-pulse">
                        <TableCell className="text-xs"><div className="h-4 bg-slate-200 rounded w-4"></div></TableCell>
                        {/* Render placeholder cells based on visible columns count */}
                        {colunasVisiveis.map((colId, idx) => (
                          <TableCell key={idx} className="text-xs"><div className="h-4 bg-slate-200 rounded w-full"></div></TableCell>
                        ))}
                        <TableCell className="text-xs"><div className="h-8 bg-slate-200 rounded w-full"></div></TableCell>
                      </TableRow>
                    ))
                  ) : paginatedMovimentacoes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={colunasVisiveis.length + 2} className="text-center py-12 text-xs">
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
                    paginatedMovimentacoes.map((mov) => {
                      const getBadgeTipo = (tipo) => {
                        const config = {
                          'Entrada': 'bg-blue-100 text-blue-800 border-blue-300',
                          'Saída': 'bg-orange-100 text-orange-800 border-orange-300',
                          'Transferência': 'bg-purple-100 text-purple-800 border-purple-300',
                          'Ajuste': 'bg-slate-100 text-slate-800 border-slate-300',
                        };
                        return config[tipo] || '';
                      };

                      return (
                        <ContextMenu key={mov.id}>
                          <ContextMenuTrigger asChild>
                            <motion.tr
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${mov.status === 'Cancelada' ? 'opacity-50 bg-red-50' : ''}`}
                            >
                              <TableCell className="text-xs">
                                <Checkbox
                                  checked={selectedItems.includes(mov.id)}
                                  onCheckedChange={() => toggleSelectItem(mov.id, mov.status)}
                                  disabled={mov.status !== 'Ativa'}
                                />
                              </TableCell>
                              {colunasVisiveis.includes('numero') && (
                                <TableCell className="font-bold text-slate-900 text-xs">{mov.numero_movimentacao || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('data') && (
                                <TableCell className="text-slate-700 text-xs">{formatarData(mov.data_movimentacao)}</TableCell>
                              )}
                              {colunasVisiveis.includes('tipo') && (
                                <TableCell className="text-xs">
                                  <Badge className={`${getBadgeTipo(mov.tipo_movimentacao)} border text-xs`}>
                                    {mov.tipo_movimentacao}
                                  </Badge>
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('tipo_detalhado') && (
                                <TableCell className="text-xs text-slate-700">{mov.tipo_detalhado || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('documento') && (
                                <TableCell className="font-mono text-xs" title={`${mov.tipo_documento || ''}: ${mov.numero_documento || ''}`}>{mov.numero_documento || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('produto') && (
                                <TableCell className="font-semibold text-slate-900 text-xs">{mov.produto_nome}</TableCell>
                              )}
                              {colunasVisiveis.includes('quantidade') && (
                                <TableCell className="text-right font-mono font-bold text-green-700 text-xs">
                                  {formatarNumero(mov.quantidade)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('unidade') && (
                                <TableCell className="text-xs">{mov.unidade_medida || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('fornecedor') && (
                                <TableCell className="text-slate-700 text-xs" title={mov.fornecedor_nome}>{(mov.tipo_movimentacao === 'Entrada' || mov.tipo_movimentacao === 'Saída') ? (mov.fornecedor_nome || mov.cliente_nome || '-') : '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('local_estoque_origem') && (
                                <TableCell className="text-slate-700 text-xs max-w-[120px] truncate" title={mov.local_estoque_origem}>
                                  {mov.local_estoque_origem || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('local_estoque_destino') && (
                                <TableCell className="text-slate-700 text-xs max-w-[120px] truncate" title={mov.local_estoque_destino}>
                                  {mov.local_estoque_destino || '-'}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('centro_custo') && (
                                <TableCell className="text-slate-700 text-xs">{mov.centro_custo_nome || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('safra') && (
                                <TableCell className="text-slate-700 text-xs">{mov.safra_nome || '-'}</TableCell>
                              )}
                              {colunasVisiveis.includes('valor_unitario') && (
                                <TableCell className="text-right font-mono text-slate-700 text-xs">
                                  {formatarMoeda(mov.valor_unitario)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('valor_total') && (
                                <TableCell className="text-right font-mono font-bold text-green-700 text-xs">
                                  {formatarMoeda(mov.valor_total)}
                                </TableCell>
                              )}
                              {colunasVisiveis.includes('status') && (
                                <TableCell className="text-xs">
                                  <Badge className={mov.status === 'Ativa' ? 'bg-emerald-100 text-emerald-800 border-emerald-300 border text-xs' : 'bg-red-100 text-red-800 border-red-300 border text-xs'}>
                                    {mov.status}
                                  </Badge>
                                </TableCell>
                              )}
                              <TableCell className="text-xs">
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onEdit && onEdit(mov)}
                                    className="hover:bg-blue-50 hover:text-blue-700 transition-colors h-8 w-8"
                                    title="Editar"
                                    disabled={mov.status === 'Cancelada'}
                                  >
                                    <Edit className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onPrint && onPrint(mov)}
                                    className="hover:bg-green-50 hover:text-green-700 transition-colors h-8 w-8"
                                    title="Imprimir"
                                  >
                                    <Printer className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => onCancel && onCancel(mov.id)}
                                    className="hover:bg-red-50 hover:text-red-700 transition-colors h-8 w-8"
                                    title="Cancelar"
                                    disabled={mov.status === 'Cancelada'}
                                  >
                                    <Ban className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </motion.tr>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem onClick={() => onEdit && onEdit(mov)} disabled={mov.status === 'Cancelada'} className="text-xs">
                              <Edit className="w-4 h-4 mr-2 text-blue-600" />
                              Editar
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onPrint && onPrint(mov)} className="text-xs">
                              <Printer className="w-4 h-4 mr-2 text-green-600" />
                              Imprimir
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onCancel && onCancel(mov.id)} disabled={mov.status === 'Cancelada'} className="text-xs">
                              <Ban className="w-4 h-4 mr-2 text-red-600" />
                              Cancelar
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

          {!isLoading && paginatedMovimentacoes.length > 0 && (
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
                      ({startIndex + 1}-{Math.min(endIndex, filteredMovimentacoes.length)} de {filteredMovimentacoes.length})
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
